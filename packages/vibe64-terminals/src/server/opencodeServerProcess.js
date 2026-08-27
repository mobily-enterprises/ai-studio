import { randomBytes } from "node:crypto";
import {
  closeSync,
  fstatSync,
  openSync,
  readSync
} from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";

import {
  isolatedProcessEnv,
  runVibe64Command,
  stableHash,
  stopVibe64Execution
} from "@local/vibe64-execution/server";

import { createOpenCodeServerClient } from "./opencodeServerClient.js";

const OPENCODE_EXPECTED_VERSION = "1.18.22";
const OPENCODE_ECONOMY_AGENT_ID = "vibe64-economy";
const OPENCODE_HOST = "127.0.0.1";
const OPENCODE_LOG_LIMIT_BYTES = 64 * 1024;
const OPENCODE_READY_TIMEOUT_MS = 30_000;
const OPENCODE_STOP_TIMEOUT_MS = 3_000;
const OPENCODE_MANAGED_STARTUP_SCRIPT = [
  "set -eu",
  "log_path=\"$1\"",
  "shift",
  ": > \"$log_path\"",
  "chmod 600 \"$log_path\"",
  "exec \"$@\" >>\"$log_path\" 2>&1"
].join("\n");
const OPENCODE_INLINE_CONFIG_BASE = Object.freeze({
  agent: {
    [OPENCODE_ECONOMY_AGENT_ID]: {
      description: "Vibe64 bounded helper turns without tools.",
      hidden: true,
      mode: "primary",
      permission: {
        "*": "deny"
      }
    }
  }
});

function text(value = "") {
  return String(value ?? "").trim();
}

function canonicalProviderUrl(value = "") {
  const source = text(value);
  if (!source) {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new TypeError("OpenCode provider routes require a canonical HTTPS URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.toString().replace(/\/$/u, "") !== source.replace(/\/$/u, "")
  ) {
    throw new TypeError("OpenCode provider routes require a canonical HTTPS URL.");
  }
  return source;
}

function openCodeInlineConfig({
  canonicalUrl = "",
  modelProviderId = ""
} = {}) {
  const providerId = text(modelProviderId);
  const baseURL = canonicalProviderUrl(canonicalUrl);
  if (Boolean(providerId) !== Boolean(baseURL)) {
    throw new TypeError("OpenCode provider id and canonical URL must be supplied together.");
  }
  return JSON.stringify({
    ...OPENCODE_INLINE_CONFIG_BASE,
    ...(providerId
      ? {
          provider: {
            [providerId]: {
              options: { baseURL }
            }
          }
        }
      : {})
  });
}

function wait(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeOpenCodeEnvironment(baseEnv = {}, {
  cacheRoot = "",
  canonicalUrl = "",
  dbPath = "",
  managedEnv = {},
  modelProviderId = "",
  password = "",
  privateRoot = "",
  shimDirs = []
} = {}) {
  const homeRoot = path.join(privateRoot, "home");
  const managed = Object.fromEntries(Object.entries(managedEnv || {})
    .filter(([name, value]) => (
      /^VIBE64_[A-Z0-9_]+$/u.test(name) && value !== undefined && value !== null
    ))
    .map(([name, value]) => [name, String(value)]));
  return isolatedProcessEnv(baseEnv, {
    cacheRoot: cacheRoot || path.join(privateRoot, "cache"),
    configRoot: path.join(privateRoot, "config"),
    dataRoot: path.join(privateRoot, "data"),
    extraEnv: {
      ...managed,
      NO_PROXY: [text(baseEnv.NO_PROXY), OPENCODE_HOST, "localhost", "::1"]
        .filter(Boolean)
        .join(","),
      OPENCODE_DB: dbPath,
      OPENCODE_CONFIG_CONTENT: openCodeInlineConfig({ canonicalUrl, modelProviderId }),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_SHARE: "1",
      OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
      OPENCODE_PRINT_LOGS: "0",
      OPENCODE_PURE: "1",
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_SERVER_USERNAME: "opencode"
    },
    homeRoot,
    pathEntries: shimDirs,
    stateRoot: path.join(privateRoot, "state")
  });
}

async function availableLoopbackPort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, OPENCODE_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

async function waitForOpenCodeReady({
  client,
  expectedVersion = OPENCODE_EXPECTED_VERSION,
  processHandle,
  timeoutMs = OPENCODE_READY_TIMEOUT_MS
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (processHandle.exited) {
      throw new Error("OpenCode exited before its server became ready.");
    }
    try {
      const health = await client.health({
        signal: AbortSignal.timeout(Math.max(100, Math.min(2_000, deadline - Date.now())))
      });
      if (health?.healthy === true) {
        if (expectedVersion && text(health.version) !== expectedVersion) {
          const error = new Error(
            `OpenCode ${text(health.version) || "(unknown)"} is installed; Vibe64 requires ${expectedVersion}.`
          );
          error.code = "vibe64_opencode_version_mismatch";
          throw error;
        }
        return health;
      }
    } catch (error) {
      if (error?.code === "vibe64_opencode_version_mismatch") {
        throw error;
      }
      lastError = error;
    }
    await wait(100);
  }
  const error = new Error("OpenCode did not become ready before the startup deadline.");
  error.cause = lastError;
  error.code = "vibe64_opencode_start_timeout";
  throw error;
}

async function createOpenCodeServerProcess({
  apiKey = "",
  cacheRoot = "",
  canonicalUrl = "",
  command = "opencode",
  commandRunner = runVibe64Command,
  dbPath = "",
  env = process.env,
  execution = {},
  expectedVersion = OPENCODE_EXPECTED_VERSION,
  fetchImpl = globalThis.fetch,
  managedEnv = {},
  modelProviderId = "",
  port = 0,
  privateRoot = "",
  readinessTimeoutMs = OPENCODE_READY_TIMEOUT_MS,
  shimDirs = [],
  stopExecution = stopVibe64Execution,
  workdir = ""
} = {}) {
  const normalizedDbPath = path.resolve(text(dbPath));
  const normalizedPrivateRoot = path.resolve(text(privateRoot));
  const normalizedWorkdir = path.resolve(text(workdir));
  if (!text(dbPath) || !text(privateRoot) || !text(workdir)) {
    throw new TypeError("OpenCode server processes require database, private, and working roots.");
  }
  await Promise.all([
    mkdir(path.dirname(normalizedDbPath), { mode: 0o700, recursive: true }),
    ...(text(cacheRoot) ? [mkdir(path.resolve(text(cacheRoot)), { mode: 0o700, recursive: true })] : []),
    mkdir(normalizedPrivateRoot, { mode: 0o700, recursive: true }),
    mkdir(normalizedWorkdir, { recursive: true })
  ]);
  const selectedPort = Number(port) || await availableLoopbackPort();
  const password = randomBytes(32).toString("base64url");
  const client = createOpenCodeServerClient({
    baseUrl: `http://${OPENCODE_HOST}:${selectedPort}`,
    fetchImpl,
    password
  });
  let processHandle = null;
  let stopPromise = null;

  const logPath = path.join(normalizedPrivateRoot, "opencode-server.log");

  function readLogs() {
    let descriptor = null;
    try {
      descriptor = openSync(logPath, "r");
      const size = Number(fstatSync(descriptor).size) || 0;
      const length = Math.min(size, OPENCODE_LOG_LIMIT_BYTES);
      const output = Buffer.alloc(length);
      if (length > 0) {
        readSync(descriptor, output, 0, length, Math.max(0, size - length));
      }
      return {
        stderr: output.toString("utf8").trim(),
        stdout: ""
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { stderr: "", stdout: "" };
      }
      throw error;
    } finally {
      if (descriptor !== null) {
        closeSync(descriptor);
      }
    }
  }

  function stop() {
    if (stopPromise) {
      return stopPromise;
    }
    stopPromise = Promise.resolve().then(async () => {
      const exitProof = processHandle
        ? await processHandle.stop()
        : { code: null, exited: true, signal: "" };
      if (exitProof.exited === true) {
        await rm(normalizedPrivateRoot, { force: true, recursive: true });
      }
      return exitProof;
    });
    return stopPromise;
  }

  try {
    const processEnv = safeOpenCodeEnvironment(env, {
      cacheRoot: text(cacheRoot) ? path.resolve(text(cacheRoot)) : "",
      canonicalUrl,
      dbPath: normalizedDbPath,
      managedEnv,
      modelProviderId,
      password,
      privateRoot: normalizedPrivateRoot,
      shimDirs
    });
    const startResult = await commandRunner({
      actor: "app",
      allowedRoots: [normalizedWorkdir],
      args: [
        "-c",
        OPENCODE_MANAGED_STARTUP_SCRIPT,
        "vibe64-opencode-server",
        logPath,
        text(command) || "opencode",
        "serve",
        "--pure",
        "--hostname",
        OPENCODE_HOST,
        "--port",
        String(selectedPort),
        "--mdns=false"
      ],
      baseEnv: processEnv,
      command: "/bin/sh",
      credentialHome: {
        cacheRoot: text(cacheRoot) ? path.resolve(text(cacheRoot)) : path.join(normalizedPrivateRoot, "cache"),
        configRoot: path.join(normalizedPrivateRoot, "config"),
        dataRoot: path.join(normalizedPrivateRoot, "data"),
        home: path.join(normalizedPrivateRoot, "home"),
        stateRoot: path.join(normalizedPrivateRoot, "state")
      },
      cwd: normalizedWorkdir,
      envPolicy: "auth",
      execution: {
        kind: "assistant",
        label: text(execution.label) || "OpenCode assistant",
        lifecycle: "service",
        operationId: text(execution.operationId) || "opencode-server",
        ownerId: text(execution.ownerId) || stableHash(`${normalizedDbPath}\0${normalizedWorkdir}`),
        projectSlug: text(execution.projectSlug),
        sessionId: text(execution.sessionId)
      },
      inheritProcessEnv: false,
      mode: "detached",
      purpose: "assistant",
      shimDirs
    });
    if (startResult?.ok !== true || !text(startResult?.execution?.id)) {
      const error = new Error(
        text(startResult?.error || startResult?.output) || "OpenCode failed to start."
      );
      error.code = text(startResult?.code) || "vibe64_opencode_start_failed";
      error.execution = startResult?.execution;
      error.retryable = startResult?.retryable === true;
      throw error;
    }
    let stopped = false;
    processHandle = Object.freeze({
      get exited() {
        return stopped;
      },
      executionId: startResult.execution.id,
      pid: startResult.pid,
      readLogs,
      async stop() {
        const proof = await stopExecution(startResult.execution.id, {
          reason: "opencode-server-stop",
          termTimeoutMs: OPENCODE_STOP_TIMEOUT_MS
        });
        stopped = proof?.scopeEmpty === true;
        return {
          ...(proof && typeof proof === "object" ? proof : {}),
          exited: stopped
        };
      }
    });
    const health = await waitForOpenCodeReady({
      client,
      expectedVersion,
      processHandle,
      timeoutMs: readinessTimeoutMs
    });
    if (text(modelProviderId) || String(apiKey)) {
      await client.authenticateApiKey(modelProviderId, apiKey);
    }
    return Object.freeze({
      canonicalUrl: canonicalProviderUrl(canonicalUrl),
      client,
      dbPath: normalizedDbPath,
      health: Object.freeze({ ...health }),
      modelProviderId: text(modelProviderId),
      executionId: processHandle.executionId,
      pid: processHandle.pid,
      port: selectedPort,
      privateRoot: normalizedPrivateRoot,
      readLogs() {
        return readLogs();
      },
      stop,
      workdir: normalizedWorkdir
    });
  } catch (error) {
    const logs = processHandle?.readLogs?.() || { stderr: "", stdout: "" };
    await stop().catch(() => null);
    error.code ||= "vibe64_opencode_start_failed";
    error.details = logs;
    throw error;
  }
}

export {
  OPENCODE_ECONOMY_AGENT_ID,
  OPENCODE_EXPECTED_VERSION,
  OPENCODE_HOST,
  OPENCODE_READY_TIMEOUT_MS,
  OPENCODE_STOP_TIMEOUT_MS,
  availableLoopbackPort,
  canonicalProviderUrl,
  createOpenCodeServerProcess,
  openCodeInlineConfig,
  safeOpenCodeEnvironment
};
