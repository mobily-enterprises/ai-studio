import assert from "node:assert/strict";
import test from "node:test";

import {
  createSignalShutdownHandler
} from "../../server.js";
import {
  readTerminalSession,
  startTerminalSession
} from "@local/vibe64-execution/server/terminalSessions";

test("signal shutdown exits cleanly after Fastify closes", async () => {
  const events = [];
  let timeoutCleared = false;
  const handler = createSignalShutdownHandler({
    app: {
      async close() {
        events.push("close");
      },
      log: testLogger(events)
    },
    clearTimeoutFn() {
      timeoutCleared = true;
    },
    exitProcess(code) {
      events.push(`exit:${code}`);
    },
    beforeClose(signal) {
      events.push(`before:${signal}`);
    },
    closeRuntimeTerminals() {
      events.push("close-terminals");
    },
    setTimeoutFn() {
      return {
        unref() {
          events.push("unref");
        }
      };
    },
    shutdownTimeoutMs: 1000
  });

  await handler("SIGTERM");

  assert.equal(timeoutCleared, true);
  assert.deepEqual(events, [
    "info:Stopping vibe64 server.",
    "unref",
    "before:SIGTERM",
    "close-terminals",
    "close",
    "info:Stopped vibe64 server.",
    "exit:0"
  ]);
});

test("signal shutdown forces exit when Fastify close stalls", async () => {
  const events = [];
  let timeoutCallback = null;
  const handler = createSignalShutdownHandler({
    app: {
      close() {
        events.push("close");
        return new Promise(() => {});
      },
      log: testLogger(events),
      server: {
        closeAllConnections() {
          events.push("close-all");
        },
        closeIdleConnections() {
          events.push("close-idle");
        }
      }
    },
    exitProcess(code) {
      events.push(`exit:${code}`);
    },
    closeRuntimeTerminals() {
      events.push("close-terminals");
    },
    setTimeoutFn(callback) {
      timeoutCallback = callback;
      return {
        unref() {
          events.push("unref");
        }
      };
    },
    shutdownTimeoutMs: 1000
  });

  void handler("SIGTERM");
  await Promise.resolve();
  assert.equal(typeof timeoutCallback, "function");
  timeoutCallback();

  assert.deepEqual(events, [
    "info:Stopping vibe64 server.",
    "unref",
    "close-terminals",
    "close",
    "error:Vibe64 server shutdown timed out; forcing process exit.",
    "close-idle",
    "close-all",
    "exit:1"
  ]);
});

test("signal shutdown stops runtime terminals before a stalled Fastify close", async () => {
  const namespace = "server-shutdown-running-terminal-test";
  const session = startTerminalSession({
    args: [
      "-e",
      "console.log(`child:${process.pid}`); process.stdin.resume(); setInterval(() => {}, 1000);"
    ],
    command: process.execPath,
    commandPreview: "node shutdown fixture",
    namespace
  });
  let childPid = 0;
  for (let attempt = 0; attempt < 80 && !childPid; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const match = readTerminalSession(session.id, { namespace }).output.match(/child:(\d+)/u);
    childPid = Number(match?.[1] || 0);
  }
  assert.equal(Number.isSafeInteger(childPid) && childPid > 1, true);

  let closeStarted = false;
  let timeoutCallback = null;
  const exits = [];
  const handler = createSignalShutdownHandler({
    app: {
      close() {
        closeStarted = true;
        return new Promise(() => {});
      },
      log: testLogger([]),
      server: {}
    },
    exitProcess(code) {
      exits.push(code);
    },
    setTimeoutFn(callback) {
      timeoutCallback = callback;
      return {
        unref() {}
      };
    },
    shutdownTimeoutMs: 1000
  });

  void handler("SIGTERM");
  for (let attempt = 0; attempt < 80 && !closeStarted; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  assert.equal(closeStarted, true);
  assert.equal(readTerminalSession(session.id, { namespace }).ok, false);
  let childAlive = true;
  for (let attempt = 0; attempt < 80 && childAlive; attempt += 1) {
    try {
      process.kill(childPid, 0);
      await new Promise((resolve) => setTimeout(resolve, 25));
    } catch {
      childAlive = false;
    }
  }
  assert.equal(childAlive, false);
  timeoutCallback();
  assert.deepEqual(exits, [1]);
});

function testLogger(events) {
  return {
    error(_fields, message) {
      events.push(`error:${message}`);
    },
    info(_fields, message) {
      events.push(`info:${message}`);
    }
  };
}
