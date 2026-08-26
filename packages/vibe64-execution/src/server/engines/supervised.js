import { spawn } from "node:child_process";
import process from "node:process";

import { envRecord } from "../normalize.js";

const DEFAULT_SUPERVISED_LOG_LIMIT_BYTES = 64 * 1024;
const DEFAULT_SUPERVISED_STOP_TIMEOUT_MS = 3_000;

function wait(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundedProcessOutput(stream = null, limitBytes = DEFAULT_SUPERVISED_LOG_LIMIT_BYTES) {
  let output = "";
  const onData = (chunk) => {
    output = `${output}${String(chunk || "")}`.slice(-limitBytes);
  };
  stream?.on?.("data", onData);
  return {
    read() {
      return output.trim();
    },
    stop() {
      stream?.off?.("data", onData);
    }
  };
}

function processExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function signalProcessGroup(child, signal) {
  if (!child?.pid) {
    return false;
  }
  try {
    process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

async function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      callback(value);
    };
    child.once?.("spawn", () => settle(resolve));
    child.once?.("error", (error) => settle(reject, error));
    setImmediate(() => settle(resolve));
  });
}

async function startSupervisedProcess({
  args = [],
  command = "",
  cwd = "",
  env = {},
  logLimitBytes = DEFAULT_SUPERVISED_LOG_LIMIT_BYTES,
  spawnImpl = spawn,
  stopTimeoutMs = DEFAULT_SUPERVISED_STOP_TIMEOUT_MS
} = {}) {
  if (!String(command || "").trim()) {
    throw new TypeError("Supervised processes require a command.");
  }
  const child = spawnImpl(String(command), (Array.isArray(args) ? args : [args]).map(String), {
    cwd: String(cwd || "").trim() || undefined,
    detached: true,
    env: envRecord(env),
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout = boundedProcessOutput(child.stdout, logLimitBytes);
  const stderr = boundedProcessOutput(child.stderr, logLimitBytes);
  let stopPromise = null;
  try {
    await waitForSpawn(child);
  } catch (error) {
    stdout.stop();
    stderr.stop();
    throw error;
  }
  const exit = processExit(child);

  async function stop() {
    if (stopPromise) {
      return stopPromise;
    }
    stopPromise = Promise.resolve().then(async () => {
      if (child.exitCode !== null || child.signalCode) {
        return {
          code: child.exitCode,
          exited: true,
          signal: child.signalCode || ""
        };
      }
      signalProcessGroup(child, "SIGTERM");
      const settled = await Promise.race([
        exit.then((value) => ({ exited: true, value })),
        wait(stopTimeoutMs).then(() => ({ exited: false }))
      ]);
      if (settled.exited) {
        return { ...settled.value, exited: true };
      }
      signalProcessGroup(child, "SIGKILL");
      return { ...await exit, exited: true, forced: true };
    }).finally(() => {
      stdout.stop();
      stderr.stop();
    });
    return stopPromise;
  }

  return Object.freeze({
    get exited() {
      return child.exitCode !== null || Boolean(child.signalCode);
    },
    pid: child.pid,
    readLogs() {
      return {
        stderr: stderr.read(),
        stdout: stdout.read()
      };
    },
    stop
  });
}

export {
  DEFAULT_SUPERVISED_LOG_LIMIT_BYTES,
  DEFAULT_SUPERVISED_STOP_TIMEOUT_MS,
  startSupervisedProcess
};
