import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  installVibe64ManagedExecutionProvider,
  stopVibe64Execution
} from "../../packages/vibe64-execution/src/server/managedExecution.js";
import {
  normalizeExecutionDescriptor
} from "../../packages/vibe64-execution/src/server/request.js";
import {
  runVibe64Command
} from "../../packages/vibe64-execution/src/server/runVibe64Command.js";

const execFileAsync = promisify(execFile);
const EXEC_HELPER = path.resolve("packages/vibe64-execution/src/host/execHelper.js");

test("execution descriptors carry intent without accepting controller policy", () => {
  const descriptor = normalizeExecutionDescriptor({
    id: "caller-owned-id",
    kind: "assistant",
    label: "Session assistant",
    lifecycle: "service",
    memoryMaxBytes: 1,
    operationId: "turn-1",
    ownerId: "session-1",
    systemdUnit: "caller.service"
  }, {
    mode: "detached",
    project: {
      slug: "dogandgroom"
    },
    session: {
      id: "2026-08-17_13-05-55"
    }
  });

  assert.match(descriptor.id, /^[0-9a-f-]{36}$/u);
  assert.notEqual(descriptor.id, "caller-owned-id");
  assert.deepEqual(descriptor, {
    controlGenerationId: "",
    id: descriptor.id,
    kind: "assistant",
    label: "Session assistant",
    lifecycle: "service",
    operationId: "turn-1",
    ownerId: "session-1",
    parentExecutionId: "",
    projectSlug: "dogandgroom",
    sessionId: "2026-08-17_13-05-55"
  });
  assert.equal(Object.isFrozen(descriptor), true);
});

test("the installed provider owns run and stop by the same execution id", async (t) => {
  const calls = [];
  const provider = {
    async runCommand(request, context) {
      calls.push({
        envExecutionId: context.env.VIBE64_EXECUTION_ID,
        executionId: request.execution.id,
        operation: "run"
      });
      return {
        execution: request.execution,
        exitCode: 0,
        ok: true,
        output: "managed"
      };
    },
    async stopExecution(executionId) {
      calls.push({
        executionId,
        operation: "stop"
      });
      return {
        executionId,
        ok: true,
        stopped: true
      };
    }
  };
  const release = installVibe64ManagedExecutionProvider(provider);
  t.after(release);

  const result = await runVibe64Command({
    command: process.execPath,
    execution: {
      kind: "assistant",
      lifecycle: "service",
      ownerId: "session-1"
    },
    mode: "detached",
    runtimes: []
  });
  const stopped = await stopVibe64Execution(result.execution.id);

  assert.equal(result.ok, true);
  assert.equal(result.output, "managed");
  assert.equal(stopped.ok, true);
  assert.deepEqual(calls, [
    {
      envExecutionId: result.execution.id,
      executionId: result.execution.id,
      operation: "run"
    },
    {
      executionId: result.execution.id,
      operation: "stop"
    }
  ]);
});

test("a managed host fails closed when its execution provider is unavailable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-managed-required-"));
  const markerPath = path.join(root, "started.txt");
  const previous = process.env.VIBE64_MANAGED_EXECUTION_REQUIRED;
  process.env.VIBE64_MANAGED_EXECUTION_REQUIRED = "1";
  t.after(async () => {
    if (previous === undefined) {
      delete process.env.VIBE64_MANAGED_EXECUTION_REQUIRED;
    } else {
      process.env.VIBE64_MANAGED_EXECUTION_REQUIRED = previous;
    }
    await rm(root, { force: true, recursive: true });
  });

  const result = await runVibe64Command({
    args: [
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "started");`
    ],
    command: process.execPath,
    cwd: root,
    execution: {
      kind: "job",
      lifecycle: "finite",
      ownerId: "managed-host-test"
    },
    runtimes: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_managed_execution_provider_unavailable");
  assert.equal(result.retryable, false);
  assert.match(result.error, /did not start this work/iu);
  await assert.rejects(readFile(markerPath, "utf8"), { code: "ENOENT" });
});

test("standalone detached execution stops and drains its exact process group", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-owned-detached-"));
  const markerPath = path.join(root, "started.txt");
  const result = await runVibe64Command({
    args: [
      "-e",
      `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "started"); setInterval(() => {}, 1000);`
    ],
    command: process.execPath,
    cwd: root,
    execution: {
      kind: "assistant",
      lifecycle: "service",
      ownerId: "session-standalone"
    },
    mode: "detached",
    runtimes: []
  });

  assert.equal(result.ok, true, result.output);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if (await readFile(markerPath, "utf8") === "started") {
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  assert.equal(await readFile(markerPath, "utf8"), "started");

  const stopped = await stopVibe64Execution(result.execution.id);
  assert.deepEqual(stopped, {
    executionId: result.execution.id,
    ok: true,
    scopeEmpty: true,
    stopped: true
  });
  assert.throws(
    () => process.kill(result.pid, 0),
    (error) => error?.code === "ESRCH"
  );
});

test("standalone finite execution drains descendants before reporting completion", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-owned-capture-"));
  const childPidPath = path.join(root, "child.pid");
  const result = await runVibe64Command({
    args: [
      "-e",
      [
        "const { spawn } = require('node:child_process');",
        "const { writeFileSync } = require('node:fs');",
        "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
        `writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));`,
        "child.unref();"
      ].join("\n")
    ],
    command: process.execPath,
    cwd: root,
    execution: {
      kind: "job",
      lifecycle: "finite",
      ownerId: "setup-1"
    },
    runtimes: []
  });

  assert.equal(result.ok, true, result.output);
  const childPid = Number(await readFile(childPidPath, "utf8"));
  assert.throws(
    () => process.kill(childPid, 0),
    (error) => error?.code === "ESRCH"
  );
});

test("standalone PTY execution closes and drains by execution id", async () => {
  const namespace = `v64-owned-pty-${Date.now()}`;
  const result = await runVibe64Command({
    args: [
      "-e",
      "setInterval(() => {}, 1000)"
    ],
    command: process.execPath,
    execution: {
      kind: "terminal",
      lifecycle: "interactive",
      ownerId: "terminal-1"
    },
    mode: "pty",
    runtimes: [],
    terminal: {
      namespace
    }
  });

  assert.equal(result.ok, true, result.error);
  const stopped = await stopVibe64Execution(result.execution.id);
  assert.deepEqual(stopped, {
    executionId: result.execution.id,
    ok: true,
    scopeEmpty: true,
    stopped: true
  });
});

test("managed runner preserves final counters after a successful transient unit can unload", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-managed-result-"));
  try {
    const executionId = randomUUID();
    const payloadPath = path.join(root, "command.json");
    await writeFile(payloadPath, `${JSON.stringify({
      args: ["-e", "Buffer.alloc(8 * 1024 * 1024);"],
      command: process.execPath,
      cwd: root,
      env: {
        PATH: process.env.PATH
      },
      executionId,
      inputBase64: "",
      inputPresent: false,
      schema: "vibe64.managed-execution.command",
      schemaVersion: 1
    })}\n`, "utf8");

    await execFileAsync(process.execPath, [EXEC_HELPER, "run-managed", payloadPath], {
      cwd: root
    });
    const result = JSON.parse(await readFile(path.join(root, "result.json"), "utf8"));

    assert.equal(result.schema, "vibe64.managed-execution.result");
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.executionId, executionId);
    assert.equal(result.execMainStatus, "0");
    assert.equal(result.result, "success");
    assert.ok(Number(result.memoryPeak) > 0);
    assert.ok(Number(result.tasksPeak) > 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
