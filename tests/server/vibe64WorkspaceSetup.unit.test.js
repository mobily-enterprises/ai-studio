import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH,
  WORKSPACE_SETUP_TRANSCRIPT_TRUNCATED_MARKER,
  workspaceSetupState,
  workspaceSetupStateFromMetadata
} from "@local/vibe64-runtime/server/workspaceSetupState";
import {
  createWorkspaceSetupRunner,
  WORKSPACE_SETUP_COMMAND_TIMEOUT_MS
} from "../../packages/vibe64-terminals/src/server/workspaceSetup.js";
import {
  projectRuntimeRoot,
  sourceMetadata,
  sourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

async function workspaceSession(targetRoot, sessionId = "workspace-session") {
  const sourceRoot = sourcePath(targetRoot, sessionId);
  await mkdir(path.join(sourceRoot, "web"), {
    recursive: true
  });
  const runtime = new Vibe64SessionRuntime({
    promptEnvironment: {
      VIBE64_RUNTIME_PACK_ROOT: "/managed/runtime-packs"
    },
    projectContextRoot: targetRoot,
    projectRuntimeRoot: projectRuntimeRoot(targetRoot)
  });
  await runtime.store.createSession({
    metadata: sourceMetadata(targetRoot, sessionId),
    runtimeKind: "genesis",
    sessionId
  });
  return {
    runtime,
    session: await runtime.store.readSession(sessionId),
    sourceRoot
  };
}

function readySetup(overrides = {}) {
  return {
    components: ["jskit"],
    diagnostics: [],
    recipeHash: "sha256:recipe",
    runtimeRequirements: ["nodejs"],
    source: "component:jskit",
    stackHash: "sha256:stack",
    status: "ready",
    steps: [{
      argv: ["npm", "install"],
      label: "Install JavaScript dependencies",
      runtimeRequirements: ["nodejs"],
      workdir: "."
    }],
    ...overrides
  };
}

test("workspace preparation executes declared argv in order through the managed gateway", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session, sourceRoot } = await workspaceSession(targetRoot);
    const calls = [];
    const runner = createWorkspaceSetupRunner({
      inspect: () => readySetup({
        steps: [{
          argv: ["composer", "install", "--no-interaction"],
          label: "Install PHP dependencies",
          runtimeRequirements: ["composer", "php"],
          workdir: "."
        }, {
          argv: ["npm", "install"],
          label: "Install JavaScript dependencies",
          runtimeRequirements: ["nodejs"],
          workdir: "web"
        }]
      }),
      projectService: {
        async projectExecutionEnvironment() {
          return {
            PROJECT_SETTING: "configured-secret-value"
          };
        }
      },
      async runCommand(request) {
        calls.push(request);
        return {
          exitCode: 0,
          ok: true,
          output: request.command === "composer"
            ? "Downloading PHP packages\nconfigured-secret-value\n"
            : "Installing JavaScript packages\nAPI_TOKEN=raw-token\n"
        };
      }
    });

    const started = await runner.start({ runtime, session });
    assert.equal(started.state.status, "running");
    assert.match(started.state.transcript, /\[Install PHP dependencies\] Running\./u);
    assert.equal(runner.isRunning(session.sessionId), true);
    assert.equal(await runner.wait(session.sessionId), await started.completion);
    assert.equal(runner.isRunning(session.sessionId), false);

    assert.deepEqual(calls.map(({ command, args, cwd }) => ({ args, command, cwd })), [{
      args: ["install", "--no-interaction"],
      command: "composer",
      cwd: sourceRoot
    }, {
      args: ["install"],
      command: "npm",
      cwd: path.join(sourceRoot, "web")
    }]);
    for (const call of calls) {
      assert.equal(call.actor, "app");
      assert.equal(call.envPolicy, "project");
      assert.deepEqual(call.allowedRoots, [sourceRoot]);
      assert.deepEqual(call.project.runtimeConfigEnv, {
        PROJECT_SETTING: "configured-secret-value"
      });
      assert.equal(Object.hasOwn(call.project, "databaseEnv"), false);
      assert.deepEqual(call.runtimes, ["node26", "composer", "php"]);
      assert.equal(call.timeout, WORKSPACE_SETUP_COMMAND_TIMEOUT_MS);
    }

    const stored = workspaceSetupStateFromMetadata(
      (await runtime.store.readSession(session.sessionId)).metadata
    );
    assert.equal(stored.status, "succeeded");
    assert.equal(stored.currentLabel, "Install JavaScript dependencies");
    assert.equal(stored.recipeHash, "sha256:recipe");
    assert.equal(stored.diagnostic, "");
    assert.match(stored.transcript, /\[Install PHP dependencies\] Running\./u);
    assert.match(stored.transcript, /Downloading PHP packages/u);
    assert.match(stored.transcript, /\[Install JavaScript dependencies\] Succeeded\./u);
    assert.match(stored.transcript, /Workspace preparation succeeded\./u);
    assert.doesNotMatch(stored.transcript, /configured-secret-value|raw-token|--no-interaction/u);
    assert.match(stored.transcript, /\[redacted\]/u);
  });
});

test("workspace preparation state bounds and normalizes durable transcripts", () => {
  const oldState = workspaceSetupStateFromMetadata({
    workspace_setup: JSON.stringify({
      currentLabel: "Install dependencies",
      recipeHash: "sha256:old-shape",
      status: "succeeded"
    })
  });
  assert.equal(oldState.transcript, "");

  const bounded = workspaceSetupState({
    status: "running",
    transcript: `\u001b[31m${"x".repeat(WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH * 2)}tail\u001b[0m`
  });
  assert.equal(bounded.transcript.length, WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH);
  assert.equal(bounded.transcript.startsWith(WORKSPACE_SETUP_TRANSCRIPT_TRUNCATED_MARKER), true);
  assert.equal(bounded.transcript.endsWith("tail"), true);
  assert.equal(bounded.transcript.includes("\u001b"), false);
});

test("workspace preparation transcript remains visible after a runtime restart", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot, "restart-session");
    const runner = createWorkspaceSetupRunner({
      inspect: () => readySetup(),
      projectService: {},
      async runCommand() {
        return {
          exitCode: 0,
          ok: true,
          output: `${"x".repeat(WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH * 2)}Restorable workspace output.`
        };
      }
    });

    const started = await runner.start({ runtime, session });
    await started.completion;
    const restartedRuntime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    const restored = await restartedRuntime.getSession(session.sessionId, {
      inspectSource: false
    });
    assert.equal(restored.workspaceSetup.status, "succeeded");
    assert.equal(
      restored.workspaceSetup.transcript.length <= WORKSPACE_SETUP_TRANSCRIPT_MAX_LENGTH,
      true
    );
    assert.equal(
      restored.workspaceSetup.transcript.startsWith(WORKSPACE_SETUP_TRANSCRIPT_TRUNCATED_MARKER),
      true
    );
    assert.match(restored.workspaceSetup.transcript, /Restorable workspace output\./u);
    assert.match(restored.workspaceSetup.transcript, /Workspace preparation succeeded\./u);
  });
});

test("workspace preparation configuration never infers a package manager", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let commandCount = 0;
    const runner = createWorkspaceSetupRunner({
      inspect: () => ({
        components: [],
        diagnostics: [],
        runtimeRequirements: [],
        source: null,
        stackHash: "sha256:empty",
        status: "unconfigured",
        steps: []
      }),
      projectService: {},
      async runCommand() {
        commandCount += 1;
      }
    });

    const result = await runner.start({ runtime, session });
    assert.equal(result.completion, null);
    assert.equal(result.state.status, "unconfigured");
    assert.equal(commandCount, 0);

    const repeated = await runner.start({
      runtime,
      session: await runtime.getSession(session.sessionId, {
        inspectSource: false
      })
    });
    assert.deepEqual(repeated.state, result.state);
    assert.equal(
      (await runtime.store.readSession(session.sessionId)).metadata.workspace_setup,
      undefined
    );
  });
});

test("workspace preparation starts when a later Stack declaration supplies a recipe", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let configured = false;
    let commandCount = 0;
    const runner = createWorkspaceSetupRunner({
      inspect: () => configured
        ? readySetup()
        : {
            components: [],
            diagnostics: [],
            runtimeRequirements: [],
            source: null,
            stackHash: "sha256:empty",
            status: "unconfigured",
            steps: []
          },
      projectService: {},
      async runCommand() {
        commandCount += 1;
        return {
          exitCode: 0,
          ok: true
        };
      }
    });

    const unconfigured = await runner.start({ runtime, session });
    assert.equal(unconfigured.state.status, "unconfigured");
    configured = true;

    const started = await runner.start({
      runtime,
      session: await runtime.getSession(session.sessionId, {
        inspectSource: false
      })
    });
    assert.equal(started.state.status, "running");
    assert.equal((await started.completion).status, "succeeded");
    assert.equal(commandCount, 1);
  });
});

test("workspace preparation reruns a successful recipe after its identity changes", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let recipeHash = "sha256:retired-contract";
    let commandCount = 0;
    const runner = createWorkspaceSetupRunner({
      inspect: () => readySetup({ recipeHash }),
      projectService: {},
      async runCommand() {
        commandCount += 1;
        return {
          exitCode: 0,
          ok: true
        };
      }
    });

    const initial = await runner.start({ runtime, session });
    assert.equal((await initial.completion).recipeHash, "sha256:retired-contract");

    recipeHash = "sha256:current-contract";
    const migrated = await runner.start({
      runtime,
      session: await runtime.getSession(session.sessionId, {
        inspectSource: false
      })
    });
    assert.equal(migrated.state.status, "running");
    assert.equal((await migrated.completion).recipeHash, "sha256:current-contract");
    assert.equal(commandCount, 2);
  });
});

test("workspace preparation treats a missing Genesis Stack as unconfigured", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    const runner = createWorkspaceSetupRunner({
      inspect: async () => {
        const error = new Error("Run genesis init first.");
        error.code = "STACK_REQUIRED";
        throw error;
      },
      projectService: {}
    });

    const result = await runner.start({ runtime, session });
    assert.equal(result.completion, null);
    assert.equal(result.state.status, "unconfigured");
    assert.equal(result.state.diagnostic, "");
  });
});

test("ambiguous setup remains an actionable session state without executing either recipe", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let commandCount = 0;
    const runner = createWorkspaceSetupRunner({
      inspect: () => ({
        diagnostics: [{
          code: "STACK_SECTION_AMBIGUOUS",
          message: "JSKIT and Laravel both declare workspace setup. Add one project override."
        }],
        status: "blocked",
        steps: []
      }),
      projectService: {},
      async runCommand() {
        commandCount += 1;
      }
    });

    const result = await runner.start({ runtime, session });
    assert.equal(result.state.status, "ambiguous");
    assert.match(result.state.diagnostic, /both declare workspace setup/u);
    assert.equal(commandCount, 0);
    assert.equal((await runtime.store.readSession(session.sessionId)).status, "active");

    const repeated = await runner.start({
      runtime,
      session: await runtime.getSession(session.sessionId, {
        inspectSource: false
      })
    });
    assert.deepEqual(repeated.state, result.state);
  });
});

test("command failure records a short diagnostic and leaves the session active", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let shouldFail = true;
    const runner = createWorkspaceSetupRunner({
      inspect: () => readySetup(),
      projectService: {
        async projectExecutionEnvironment() {
          return {
            REGISTRY_TOKEN: "retry-secret"
          };
        }
      },
      async runCommand() {
        return shouldFail
          ? {
              exitCode: 1,
              ok: false,
              stderr: "npm could not reach the registry using retry-secret"
            }
          : {
              exitCode: 0,
              ok: true,
              output: "Dependencies are current."
            };
      }
    });

    const started = await runner.start({ runtime, session });
    const finished = await started.completion;
    assert.equal(finished.status, "failed");
    assert.equal(finished.currentLabel, "Install JavaScript dependencies");
    assert.equal(finished.diagnostic, "npm could not reach the registry using [redacted]");
    assert.match(finished.transcript, /npm could not reach the registry using \[redacted\]/u);
    assert.doesNotMatch(finished.transcript, /retry-secret/u);
    assert.match(finished.transcript, /\[Install JavaScript dependencies\] Failed\./u);
    assert.equal((await runtime.store.readSession(session.sessionId)).status, "active");

    shouldFail = false;
    const retried = await runner.start({
      retry: true,
      runtime,
      session: await runtime.getSession(session.sessionId, {
        inspectSource: false
      })
    });
    const succeeded = await retried.completion;
    assert.equal(succeeded.status, "succeeded");
    assert.match(succeeded.transcript, /Workspace preparation retry started\./u);
    assert.match(succeeded.transcript, /Dependencies are current\./u);
    assert.equal(
      succeeded.transcript.match(/\[Install JavaScript dependencies\] Failed\./gu)?.length,
      1
    );
    assert.equal(
      succeeded.transcript.match(/\[Install JavaScript dependencies\] Succeeded\./gu)?.length,
      1
    );
  });
});

test("an active preparation is shared instead of starting another run", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { runtime, session } = await workspaceSession(targetRoot);
    let finishCommand;
    const commandFinished = new Promise((resolve) => {
      finishCommand = resolve;
    });
    const runner = createWorkspaceSetupRunner({
      inspect: () => readySetup(),
      projectService: {},
      runCommand: () => commandFinished
    });

    const started = await runner.start({ runtime, session });
    const joined = await runner.start({ runtime, session });
    assert.equal(joined.completion, started.completion);
    finishCommand({ exitCode: 0, ok: true });
    await started.completion;
  });
});
