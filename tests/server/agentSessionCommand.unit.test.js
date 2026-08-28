import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAgentSessionCommandService
} from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";

test("agent shell commands run as session-owned managed executions and drain on session close", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-agent-session-command-"));
  const sessionId = "session-1";
  const projectSlug = "project-1";
  const projectRoot = path.join(temporaryRoot, "project");
  const sourceRoot = path.join(temporaryRoot, "sessions", "active", sessionId, "source");
  const wrapperHostDir = path.join(temporaryRoot, "wrappers");
  const runCalls = [];
  const stopOwnedCalls = [];
  const descriptor = {
    metadata: {
      source_kind: "session_clone",
      source_path: sourceRoot,
      source_path_authority: "managed_session_source"
    },
    sessionId,
    sessionRoot: path.join(temporaryRoot, "state", sessionId)
  };
  const project = {
    projectRoot,
    slug: projectSlug
  };
  await writeFile(path.join(temporaryRoot, ".keep"), "");
  const service = createAgentSessionCommandService({
    projectService: {
      async createSessionStore() {
        return {
          async readSessionSourceDescriptor() {
            return descriptor;
          }
        };
      },
      async readCurrentProject() {
        return project;
      },
      async runInProjectContext(slug, operation) {
        assert.equal(slug, projectSlug);
        return operation();
      }
    },
    async runCommand(request) {
      runCalls.push(request);
      await writeFile(request.baseEnv.VIBE64_AGENT_SESSION_RUN_OUTPUT_PATH, "started chrome\n");
      await writeFile(request.baseEnv.VIBE64_AGENT_SESSION_RUN_RESULT_PATH, "0\n");
      return {
        execution: { id: "execution-1" },
        ok: true
      };
    },
    async stopOwnedExecutions(selector, options) {
      stopOwnedCalls.push([selector, options]);
      return {
        closed: 1,
        processExitProofs: [{ executionId: "execution-1", ok: true, stopped: true }],
        supported: true
      };
    }
  });

  try {
    await service.bindSession(sessionId, { wrapperHostDir });
    const command = "/usr/bin/google-chrome --headless https://example.test &";
    const result = await service.run({
      commandBase64: Buffer.from(command, "utf8").toString("base64url"),
      cwd: sourceRoot,
      env: {
        SAFE_ENV: "kept",
        VIBE64_AGENT_SESSION_COMMAND_TOKEN: "must-not-leak"
      },
      sessionId
    });

    assert.equal(result.ok, true);
    assert.equal(result.stdout, "started chrome\n");
    assert.equal(runCalls.length, 1);
    const request = runCalls[0];
    assert.equal(request.mode, "detached");
    assert.equal(request.execution.kind, "job");
    assert.equal(request.execution.lifecycle, "service");
    assert.equal(request.execution.ownerId, sessionId);
    assert.equal(request.execution.projectSlug, projectSlug);
    assert.equal(request.execution.sessionId, sessionId);
    assert.equal(request.cwd, sourceRoot);
    assert.deepEqual(request.allowedRoots, [sourceRoot]);
    assert.equal(request.baseEnv.SAFE_ENV, "kept");
    assert.equal(Object.hasOwn(request.baseEnv, "VIBE64_AGENT_SESSION_COMMAND_TOKEN"), false);
    assert.equal(
      Buffer.from(request.baseEnv.VIBE64_AGENT_SESSION_RUN_COMMAND_BASE64, "base64").toString("utf8"),
      command
    );

    const closed = await service.closeAllForSession(sessionId);
    assert.equal(closed.ok, true);
    assert.deepEqual(stopOwnedCalls, [[
      { ownerId: sessionId, sessionId },
      { reason: "session-close" }
    ]]);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});
