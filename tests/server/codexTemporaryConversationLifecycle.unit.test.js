import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createCodexTerminalController
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";
import {
  codexTerminalNamespace
} from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import {
  freezeTerminalNamespaceAdmission,
  thawTerminalNamespaceAdmission
} from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import {
  createService as createTerminalService
} from "../../packages/vibe64-terminals/src/server/service.js";
import {
  createService as createSourceEditorService
} from "../../packages/vibe64-source-editor/src/server/service.js";
import {
  CODEX_APP_SERVER_EXECUTION_MODES,
  CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
  CODEX_APP_SERVER_PROVIDER_ID,
  codexAppServerRuntimeDir,
  stopCodexAppServerRuntime
} from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import {
  VIBE64_AGENT_RUN_STATE,
  VIBE64_SESSION_STATUS,
  createVibe64SessionStore
} from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import {
  CODEX_ECONOMY_THREAD_LIFECYCLES,
  createCodexEconomyThreadLedger
} from "../../packages/vibe64-terminals/src/server/codexEconomyThreadLedger.js";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  defineVibe64AgentExecutionProfileResolution,
  vibe64AgentExecutionProfileAuditSnapshot
} from "../../packages/vibe64-runtime/src/shared/agentExecutionProfiles.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  currentProjectRequestContext,
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  sessionRenewalHandoverHash
} from "../../packages/vibe64-terminals/src/server/sessionRenewalHandover.js";

const TEST_ACCOUNT_IDENTITY_SIGNATURE = `sha256:${"a".repeat(64)}`;
const TEST_AUTH_STATE_SIGNATURE = `v1:${"b".repeat(24)}`;
const TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE = `sha256:${"d".repeat(64)}`;

function exactStoppedRuntimeMetadata(runtimeDir, {
  stopped = false
} = {}) {
  return {
    pid: 99999999,
    processExitVerifiedAt: stopped ? "2026-08-25T00:00:00.000Z" : "",
    processIdentity: {
      commandHash: "0123456789ab",
      platform: "linux-proc",
      runtimeToken: "11111111-1111-4111-8111-111111111111",
      startTimeTicks: "1",
      version: 1
    },
    processState: stopped ? "stopped" : "running",
    provider: CODEX_APP_SERVER_PROVIDER_ID,
    runtimeDir,
    schemaVersion: CODEX_APP_SERVER_METADATA_SCHEMA_VERSION,
    transport: "unix"
  };
}

async function exactProcessIdentity(pid, runtimeToken, commandHash) {
  const statText = await readFile(`/proc/${pid}/stat`, "utf8");
  const fields = statText.slice(statText.lastIndexOf(")") + 1).trim().split(/\s+/u);
  return {
    commandHash,
    platform: "linux-proc",
    runtimeToken,
    startTimeTicks: fields[19],
    version: 1
  };
}

function createProvider(calls, subscribers, captures, providerOptions = {}) {
  captures.providerOptions.push(providerOptions);
  return {
    close() {
      calls.push(["close"]);
      captures.closes += 1;
    },
    currentConnectionGeneration() {
      return captures.connectionGeneration;
    },
    currentServerInfo() {
      return { userAgent: captures.serverUserAgent };
    },
    async currentRuntimeInfo() {
      captures.onCurrentRuntimeInfo?.();
      return {
        ...captures.runtimeInfo,
        executionMode: providerOptions.executionMode || "interactive"
      };
    },
    async currentEconomyExecutionContext() {
      if (providerOptions.executionMode !== "economy") {
        throw new Error("Interactive providers have no economy execution context.");
      }
      return {
        accountIdentitySignature: captures.runtimeInfo.accountIdentitySignature,
        cwd: path.join(providerOptions.runtimeDir, "workspace"),
        executionMode: "economy"
      };
    },
    async ensureAvailable() {
      calls.push(["ensure"]);
      captures.onEnsureAvailable?.();
      if (captures.ensureAvailableWait) {
        await captures.ensureAvailableWait;
      }
    },
    async ensureRuntime() {
      calls.push(["ensureRuntime"]);
      return {
        endpoint: captures.runtimeInfo.endpoint,
        runtimeDir: captures.runtimeInfo.runtimeDir,
        transport: captures.runtimeInfo.transport
      };
    },
    async listModels(params, options = {}) {
      calls.push(["models", params]);
      captures.modelSignals.push(options.signal || null);
      if (captures.failModelLists > 0) {
        captures.failModelLists -= 1;
        const error = new Error("model catalog temporarily unavailable");
        error.code = "rate_limited";
        throw error;
      }
      if (captures.hangModelLists) {
        return new Promise((resolve, reject) => {
          void resolve;
          const abort = () => {
            captures.modelAborts += 1;
            const error = new Error("model catalog aborted");
            error.code = "ABORT_ERR";
            error.name = "AbortError";
            reject(error);
          };
          if (options.signal?.aborted) {
            abort();
            return;
          }
          options.signal?.addEventListener?.("abort", abort, { once: true });
        });
      }
      return {
        data: [{
          hidden: false,
          model: "gpt-5.6-luna",
          supportedReasoningEfforts: [{
            description: "Low",
            reasoningEffort: "low"
          }]
        }],
        nextCursor: null
      };
    },
    async listEconomyThreads() {
      calls.push(["economyThreads"]);
      captures.economyThreadInventories += 1;
      if (captures.economyThreadInventoryWait) {
        await captures.economyThreadInventoryWait;
      }
      return {
        threadIds: [...captures.economyThreadIds]
      };
    },
    async deleteThread(threadId) {
      calls.push(["delete", threadId]);
      captures.deletes.push(threadId);
      if (captures.failDeletes > 0) {
        captures.failDeletes -= 1;
        const error = new Error("thread deletion failed");
        error.code = "delete_failed";
        error.method = "thread/delete";
        throw error;
      }
      if (captures.undefinedDeletes > 0) {
        captures.undefinedDeletes -= 1;
        return undefined;
      }
      return { id: threadId };
    },
    async interruptTurn(threadId, turnId) {
      calls.push(["interrupt", threadId, turnId]);
      captures.interrupts.push({ threadId, turnId });
      if (captures.failInterrupts > 0) {
        captures.failInterrupts -= 1;
        throw new Error("thread interruption failed");
      }
      if (captures.interruptCompletesTurns) {
        emitCodexNotification(subscribers, turnCompleted({
          status: "completed",
          threadId,
          turnId
        }));
      }
      return { status: "interrupted" };
    },
    async listHooks(cwds) {
      calls.push(["hooks", cwds]);
      const inventoryIndex = captures.hookLists.length;
      captures.hookLists.push(cwds);
      return {
        data: [{
          cwd: cwds[0],
          errors: [],
          hooks: captures.hookInventories[inventoryIndex] || captures.hooks,
          warnings: []
        }]
      };
    },
    async readConfig(params) {
      calls.push(["config", params]);
      captures.configReads.push(params);
      return {
        config: {
          mcp_servers: captures.mcpServers
        }
      };
    },
    async resumeThread(threadId, settings) {
      calls.push(["resume", threadId]);
      captures.resumes.push({ settings, threadId });
      return { id: threadId };
    },
    async readThread(threadId) {
      calls.push(["read", threadId]);
      captures.onReadThread?.(threadId);
      throw new Error("ephemeral threads do not support includeTurns");
    },
    async sendTurn(threadId, input, settings) {
      calls.push(["turn", threadId]);
      const turnId = `turn-${captures.turns.length + 1}`;
      captures.turns.push({ input, settings, threadId });
      return {
        id: turnId,
        raw: { status: "inProgress" }
      };
    },
    async startThread(settings) {
      calls.push(["thread", settings]);
      captures.threads.push(settings);
      captures.onStartThread?.();
      if (captures.startThreadWait) {
        await captures.startThreadWait;
      }
      if (captures.failThreadStarts > 0) {
        captures.failThreadStarts -= 1;
        const error = new Error("thread start failed");
        error.code = "thread_start_failed";
        throw error;
      }
      return { id: "conversation-1" };
    },
    async stopRuntime(options = {}) {
      calls.push(["stopRuntime"]);
      captures.stopRuntimes += 1;
      captures.stopRuntimeOptions.push(options);
      captures.stopRuntimeProviderOptions.push(providerOptions);
      captures.onStopRuntime?.();
      if (captures.stopRuntimeWait) {
        await captures.stopRuntimeWait;
      }
      if (captures.stopRuntimeHandler) {
        return captures.stopRuntimeHandler({
          options,
          providerOptions
        });
      }
      return captures.stopRuntimeResult;
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    }
  };
}

test("economy model discovery uses one live provider catalog per connection generation", async () => {
  await withConversationController(async ({ calls, controller }) => {
    const first = await controller.executionProfileModelCatalog("session-1");
    const second = await controller.executionProfileModelCatalog("session-1");

    assert.equal(first, second);
    assert.deepEqual(first, {
      data: [{
        hidden: false,
        model: "gpt-5.6-luna",
        supportedReasoningEfforts: [{
          reasoningEffort: "low"
        }]
      }]
    });
    assert.deepEqual(calls.filter(([operation]) => operation === "models"), [[
      "models",
      {
        includeHidden: false,
        limit: 100
      }
    ]]);
  });
});

test("economy model discovery does not cache failures and invalidates on reconnect", async () => {
  await withConversationController(async ({ calls, captures, controller }) => {
    captures.failModelLists = 1;
    await assert.rejects(
      controller.executionProfileModelCatalog("session-1"),
      (error) => error.code === "rate_limited"
    );
    await controller.executionProfileModelCatalog("session-1");
    captures.connectionGeneration = 2;
    await controller.executionProfileModelCatalog("session-1");

    assert.equal(calls.filter(([operation]) => operation === "models").length, 3);
  });
});

test("Codex provider description uses the dedicated economy runtime and stable account identity", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const description = await controller.describeProvider("session-1");

    assert.deepEqual(description, {
      accountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
      providerId: "codex",
      transportId: "codex_app_server"
    });
    assert.equal(Object.isFrozen(description), true);
    assert.equal(captures.providerOptions.length, 1);
    assert.equal(captures.providerOptions[0].executionMode, "economy");
    assert.equal(captures.providerOptions[0].runtimeInstanceId, "session-1:economy");
  });
});

test("economy work consumes the caller runtime and session without an implicit project runtime lookup", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectContextRoot,
    projectRuntimeRoot,
    projectService,
    session,
    subscribers
  }) => {
    let implicitRuntimeLookups = 0;
    let explicitRuntimeSessionLookups = 0;
    const originalCreateRuntime = projectService.createRuntime;
    const callerSession = {
      ...session,
      projectContextRoot: path.join(projectRuntimeRoot, "wrong-session-authority")
    };
    const runtime = {
      async getSession() {
        explicitRuntimeSessionLookups += 1;
        return session;
      },
      projectContextRoot,
      stateRoot: projectRuntimeRoot
    };
    projectService.createRuntime = () => {
      implicitRuntimeLookups += 1;
      throw new Error("Explicit economy context must not create another project runtime.");
    };

    try {
      const catalog = await controller.executionProfileModelCatalog("session-1", {
        runtime,
        session: callerSession
      });
      const description = await controller.describeProvider("session-1", {
        runtime,
        session: callerSession
      });
      const pending = controller.runDetachedChatTurn("session-1", {
        executionProfile: sourceExplanationEconomyProfile(),
        outputSchema: sourceExplanationOutputSchema(),
        prompt: "Use the session selected by this browser request."
      }, {
        runtime,
        session: callerSession
      });
      await waitForCapturedTurns(captures, 1);
      completeDetachedTurn(subscribers, {
        text: JSON.stringify({ answer: "Used the explicit session context." })
      });
      const result = await pending;

      assert.equal(catalog.data[0].model, "gpt-5.6-luna");
      assert.equal(description.accountIdentitySignature, TEST_ACCOUNT_IDENTITY_SIGNATURE);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(implicitRuntimeLookups, 0);
      assert.equal(explicitRuntimeSessionLookups, 0);
      const ownership = await createCodexEconomyThreadLedger({
        projectRuntimeRoot
      }).readAll();
      assert.equal(ownership.records.length, 1);
      assert.equal(ownership.records[0].projectContextRoot, projectContextRoot);
      assert.notEqual(
        ownership.records[0].projectContextRoot,
        callerSession.projectContextRoot
      );
    } finally {
      projectService.createRuntime = originalCreateRuntime;
    }
  });
});

test("source explanations preserve one pre-resolved profile through the terminal service and manager", async () => {
  await withConversationController(async ({
    calls,
    captures,
    projectService,
    session,
    subscribers,
    temporaryRoot
  }) => {
    const terminalProjectService = {
      ...projectService,
      async readCurrentProject() {
        return {
          projectContextRoot: projectService.createRuntime().projectContextRoot,
          slug: "test-project"
        };
      },
      async readEnv() {
        return { ok: true, records: [] };
      },
      async runInProjectContext(_context, operation) {
        return operation();
      },
      async saveEnvUserValues() {
        return { ok: true };
      }
    };
    const terminalService = createTerminalService({
      codexTerminalController: {
        codexAppServerProviderFactory(providerOptions) {
          return createProvider(calls, subscribers, captures, providerOptions);
        },
        codexToolHomeRequired: false
      },
      env: {
        VIBE64_RUNTIME_NAMESPACE: "test",
        VIBE64_WORKSPACE: "test"
      },
      projectService: terminalProjectService
    });
    let firstResolvedProfile = null;
    let resolvedProfile = null;
    let resolutionCalls = 0;
    let resolutionCallsWhenThreadStarted = 0;
    captures.onStartThread = () => {
      resolutionCallsWhenThreadStarted = resolutionCalls;
    };
    const sourceTerminalService = {
      ...terminalService,
      async resolveAgentExecutionProfile(...args) {
        resolutionCalls += 1;
        resolvedProfile = await terminalService.resolveAgentExecutionProfile(...args);
        firstResolvedProfile ||= resolvedProfile;
        return resolvedProfile;
      }
    };
    const sourceEditor = createSourceEditorService({
      projectService: terminalProjectService,
      temporaryRoot,
      terminalService: sourceTerminalService
    });
    await writeFile(
      path.join(session.metadata.source_path, "app.js"),
      "export function total(left, right) { return left + right; }\n"
    );

    try {
      const pending = sourceEditor.explainSelection({
        endColumn: 61,
        endLine: 1,
        explanationId: "exp-real-manager-profile",
        path: "app.js",
        sessionId: session.sessionId,
        startColumn: 1,
        startLine: 1
      });
      await waitForCapturedTurns(captures, 1);
      completeDetachedTurn(subscribers, {
        text: JSON.stringify({
          answer: "This function returns the sum of its two arguments."
        })
      });
      const response = await pending;
      const auditProfile = vibe64AgentExecutionProfileAuditSnapshot(firstResolvedProfile);

      assert.equal(response.ok, true, JSON.stringify(response));
      assert.equal(resolutionCallsWhenThreadStarted, 1);
      assert.equal(resolutionCalls, 2);
      assert.equal(calls.filter(([operation]) => operation === "models").length, 1);
      assert.equal(Object.isFrozen(firstResolvedProfile), true);
      assert.deepEqual(response.explanation.executionProfile, auditProfile);
      assert.equal(captures.threads[0].model, auditProfile.model);
      assert.equal(captures.threads[0].config.model_reasoning_effort, auditProfile.thinking);
      assert.equal(captures.turns[0].settings.model, auditProfile.model);
    } finally {
      await sourceEditor.close();
      await terminalService.closeSessionTerminals(session.sessionId);
    }
  });
});

test("terminal renewal callbacks run inside the agent-write lock and hidden seeding uses only its renewal reader", async () => {
  await withConversationController(async ({ projectRuntimeRoot, projectService, session }) => {
    let lockDepth = 0;
    let normalReads = 0;
    let renewalReads = 0;
    const runtime = {
      async getSession() {
        normalReads += 1;
        return session;
      },
      async getSessionForRenewal() {
        renewalReads += 1;
        return {
          ...session,
          status: VIBE64_SESSION_STATUS.RENEWAL_PENDING
        };
      },
      projectContextRoot: projectService.createRuntime().projectContextRoot,
      stateRoot: projectRuntimeRoot,
      store: {
        async runSessionExclusive(sessionId, operationName, operation) {
          assert.equal(sessionId, session.sessionId);
          assert.equal(operationName, "agent-write-mode");
          lockDepth += 1;
          try {
            return {
              acquired: true,
              value: await operation()
            };
          } finally {
            lockDepth -= 1;
          }
        },
        async runSessionExclusiveForRenewal(sessionId, operationName, operation) {
          assert.equal(sessionId, session.sessionId);
          assert.equal(operationName, "agent-write-mode");
          lockDepth += 1;
          try {
            return {
              acquired: true,
              value: await operation()
            };
          } finally {
            lockDepth -= 1;
          }
        }
      }
    };
    const terminalProjectService = {
      ...projectService,
      createRuntime() {
        return runtime;
      },
      async readCurrentProject() {
        return {
          projectContextRoot: runtime.projectContextRoot,
          slug: "test-project"
        };
      },
      async readEnv() {
        return { ok: true, records: [] };
      },
      async runInProjectContext(_context, operation) {
        return operation();
      },
      async saveEnvUserValues() {
        return { ok: true };
      }
    };
    const terminalService = createTerminalService({
      codexTerminalController: {
        codexToolHomeRequired: false
      },
      env: {
        VIBE64_RUNTIME_NAMESPACE: "test",
        VIBE64_WORKSPACE: "test"
      },
      projectService: terminalProjectService
    });
    const cancelled = {
      code: "cancelled-inside-lock",
      ok: false
    };

    const generated = await terminalService.generateSessionRenewalHandover(
      session.sessionId,
      { operationId: "renewal:generate" },
      {
        beforeStart(context) {
          assert.equal(lockDepth, 1);
          assert.equal(context.session, session);
          return cancelled;
        },
        runtime
      }
    );
    const merged = await terminalService.generateSessionRenewalHandover(
      session.sessionId,
      { operationId: "renewal:merged" },
      {
        beforeStart() {
          assert.equal(lockDepth, 1);
          return {
            input: {
              source: {
                authority: "github",
                commit: "a".repeat(40),
                ref: "refs/heads/main\ninvalid",
                repository: "https://github.com/example/project.git"
              }
            },
            ok: true
          };
        },
        runtime
      }
    );
    const seeded = await terminalService.seedSessionRenewalHandover(
      session.sessionId,
      { operationId: "renewal:seed" },
      {
        beforeStart(context) {
          assert.equal(lockDepth, 1);
          assert.equal(context.session.status, VIBE64_SESSION_STATUS.RENEWAL_PENDING);
          return cancelled;
        },
        runtime
      }
    );
    const renewalId = "renewal-terminal-cleanup";
    const hiddenSuccessor = {
      ...session,
      metadata: {
        ...session.metadata,
        renewal_id: renewalId,
        renewed_from: "source-session"
      },
      status: VIBE64_SESSION_STATUS.RENEWAL_PENDING
    };
    assert.equal(normalReads, 3);
    await assert.rejects(
      () => terminalService.closeRenewalSuccessorSessionTerminals(hiddenSuccessor, {
        renewalId: "wrong-renewal",
        runtime
      }),
      TypeError
    );
    await assert.rejects(
      () => terminalService.closeRenewalSuccessorSessionTerminals(hiddenSuccessor, {
        renewalId,
        runtime
      }),
      { code: "vibe64_session_renewal_process_exit_unverified" }
    );

    assert.equal(generated, cancelled);
    assert.equal(merged.code, "vibe64_session_renewal_source_invalid");
    assert.equal(seeded, cancelled);
    assert.equal(normalReads, 3);
    assert.equal(renewalReads, 1);
    assert.equal(lockDepth, 0);
  });
});

function emitCodexNotification(subscribers, notification) {
  for (const subscriber of [...subscribers]) {
    subscriber(notification);
  }
}

function codexEvent({
  message = "",
  phase = "progress",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "codex/event",
    params: {
      event: {
        payload: {
          message,
          phase,
          type: "agent_message"
        },
        type: "event_msg"
      },
      threadId,
      turnId
    }
  };
}

function turnCompleted({
  status = "completed",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "turn/completed",
    params: {
      threadId,
      turn: {
        id: turnId,
        status
      },
      turnId
    }
  };
}

function turnStarted({
  status = "inProgress",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "turn/started",
    params: {
      threadId,
      turn: {
        id: turnId,
        status
      },
      turnId
    }
  };
}

function threadGoalUpdated({
  status = "active",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "thread/goal/updated",
    params: {
      goal: {
        createdAt: 1_777_777_700_000,
        objective: "Complete the representative goal stream.",
        status,
        threadId,
        timeUsedSeconds: 60,
        tokenBudget: null,
        tokensUsed: 1_000,
        updatedAt: 1_777_777_760_000
      },
      threadId,
      turnId
    }
  };
}

function reasoningSummaryDelta({
  itemId = "reasoning-1",
  text = "",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "item/reasoning/summaryTextDelta",
    params: {
      delta: text,
      itemId,
      summaryIndex: 0,
      threadId,
      turnId
    }
  };
}

function assistantItemCompleted({
  itemId = "assistant-1",
  phase = "commentary",
  text = "",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  return {
    method: "item/completed",
    params: {
      completedAtMs: 1_777_777_760_000,
      item: {
        id: itemId,
        phase,
        text,
        type: "agentMessage"
      },
      threadId,
      turnId
    }
  };
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitForSessionValue(readValue, predicate, description) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1_000) {
    const value = await readValue();
    if (predicate(value)) {
      return value;
    }
    await flushPromises();
  }
  const value = await readValue();
  assert.fail(`Timed out waiting for ${description}: ${JSON.stringify(value)}`);
}

async function waitForCapturedTurns(captures, expectedCount) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    if (captures.turns.length >= expectedCount) {
      return;
    }
    await flushPromises();
  }
  assert.fail(`Expected ${expectedCount} captured Codex turns; found ${captures.turns.length}.`);
}

async function waitForEconomyLedgerLifecycle(projectRuntimeRoot, lifecycle) {
  const ledger = createCodexEconomyThreadLedger({ projectRuntimeRoot });
  const startedAt = Date.now();
  while (Date.now() - startedAt < 1000) {
    const listed = await ledger.readAll();
    if (listed.records.length === 1 && listed.records[0].lifecycle === lifecycle) {
      return listed.records[0];
    }
    await flushPromises();
  }
  const listed = await ledger.readAll();
  assert.fail(
    `Expected one ${lifecycle} economy record; found ${JSON.stringify(listed)}.`
  );
}

function sourceExplanationEconomyProfile(overrides = {}) {
  const {
    limits = {},
    ...profileOverrides
  } = overrides;
  return defineVibe64AgentExecutionProfileResolution({
    limits: {
      maxInputCharacters: 100_000,
      maxOutputCharacters: 32_000,
      timeoutMs: 180_000,
      ...limits
    },
    model: "gpt-5.6-luna",
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: "none"
    },
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
    providerId: "codex",
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false
    },
    revision: "codex-economy-luna-low-v2",
    thinking: "low",
    workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION,
    ...profileOverrides
  });
}

function sourceExplanationOutputSchema(maxLength = 5_000) {
  return {
    additionalProperties: false,
    properties: {
      answer: {
        maxLength,
        minLength: 1,
        type: "string"
      }
    },
    required: ["answer"],
    type: "object"
  };
}

function turnTokenUsage({
  threadId = "conversation-1",
  turnId = "turn-1",
  usage = {}
} = {}) {
  return {
    method: "thread/tokenUsage/updated",
    params: {
      threadId,
      tokenUsage: {
        last: usage
      },
      turnId
    }
  };
}

function completeDetachedTurn(subscribers, {
  text = "",
  threadId = "conversation-1",
  turnId = "turn-1"
} = {}) {
  emitCodexNotification(subscribers, codexEvent({
    message: text,
    phase: "final_answer",
    threadId,
    turnId
  }));
  emitCodexNotification(subscribers, turnCompleted({
    threadId,
    turnId
  }));
}

async function managedSessionFixture(temporaryRoot) {
  const projectContextRoot = path.join(temporaryRoot, "authority");
  const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
  const sourcePath = path.join(
    temporaryRoot,
    "managed",
    "sessions",
    "active",
    "session-1",
    "source"
  );
  await Promise.all([
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true }),
    mkdir(sourcePath, { recursive: true })
  ]);
  return {
    projectContextRoot,
    projectRuntimeRoot,
    session: {
      metadata: {
        repository_mode: "local_source",
        source_kind: "session_clone",
        source_path: sourcePath,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      sessionId: "session-1",
      sessionRoot: path.join(projectRuntimeRoot, "sessions", "active", "session-1")
    }
  };
}

async function managedProjectScopedSessionFixture(temporaryRoot, slug, sessionId) {
  const projectContextRoot = path.join(temporaryRoot, slug, "authority");
  const projectRuntimeRoot = path.join(temporaryRoot, slug, "runtime");
  const projectSessionSourceRoot = path.join(temporaryRoot, slug, "managed", "sessions");
  const sourcePath = path.join(
    projectSessionSourceRoot,
    "active",
    sessionId,
    "source"
  );
  await Promise.all([
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true }),
    mkdir(sourcePath, { recursive: true })
  ]);
  const metadata = {
    repository_mode: "local_source",
    source_kind: "session_clone",
    source_path: sourcePath,
    source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
  };
  const store = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot
  });
  await store.createSession({
    metadata,
    runtimeKind: "genesis",
    sessionId
  });
  const session = await store.readSession(sessionId);
  const runtime = {
    async getSession() {
      return store.readSession(sessionId);
    },
    async renderPrompt(_sessionId, { request } = {}) {
      return { prompt: String(request || "Continue.") };
    },
    projectContextRoot,
    stateRoot: projectRuntimeRoot,
    store
  };
  return {
    context: {
      projectContextRoot,
      projectRuntimeRoot,
      projectSessionSourceRoot,
      slug,
      targetRoot: projectContextRoot
    },
    runtime,
    session,
    store
  };
}

function createDeterministicHold() {
  let enter = () => null;
  let release = () => null;
  return {
    enter() {
      enter();
    },
    entered: new Promise((resolve) => {
      enter = resolve;
    }),
    release() {
      release();
    },
    wait: new Promise((resolve) => {
      release = resolve;
    })
  };
}

async function withConversationController(operation, {
  aiPolicy = null
} = {}) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-temporary-conversation-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const calls = [];
  const captures = {
    closes: 0,
    configReads: [],
    connectionGeneration: 1,
    deletes: [],
    environmentVersion: "one",
    economyThreadIds: [],
    economyThreadInventories: 0,
    economyThreadInventoryWait: null,
    ensureAvailableWait: null,
    failModelLists: 0,
    failDeletes: 0,
    failInterrupts: 0,
    failThreadStarts: 0,
    hangModelLists: false,
    hookLists: [],
    hookInventories: [],
    hooks: [{
      currentHash: "sha256:test-hook",
      enabled: true,
      handlerType: "command",
      isManaged: false,
      key: "test:write-hook",
      sourcePath: "/tmp/test-hook.js"
    }],
    mcpServers: {
      "test.write-anywhere": {
        command: "malicious-write-tool"
      }
    },
    interrupts: [],
    interruptCompletesTurns: false,
    modelAborts: 0,
    modelSignals: [],
    onStopRuntime: null,
    onCurrentRuntimeInfo: null,
    onEnsureAvailable: null,
    onProviderFactory: null,
    onProjectEnvironment: null,
    onReadThread: null,
    providerOptions: [],
    projectEnvironmentWait: null,
    resumes: [],
    runtimeInfo: null,
    serverUserAgent: "vibe64/0.149.0 (unit test)",
    threads: [],
    stopRuntimes: 0,
    stopRuntimeOptions: [],
    stopRuntimeProviderOptions: [],
    stopRuntimeHandler: null,
    stopRuntimeResult: { stopped: true },
    stopRuntimeWait: null,
    startThreadWait: null,
    turns: [],
    undefinedDeletes: 0
  };
  const policyReads = [];
  const subscribers = new Set();
  const {
    projectContextRoot,
    projectRuntimeRoot,
    session
  } = await managedSessionFixture(temporaryRoot);
  captures.runtimeInfo = {
    accountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
    authStateSignature: TEST_AUTH_STATE_SIGNATURE,
    endpoint: `unix://${path.join(projectRuntimeRoot, "codex.sock")}`,
    executionContextHash: "c".repeat(12),
    provider: "codex_app_server",
    runtimeDir: path.join(projectRuntimeRoot, "codex-runtime"),
    runtimesHash: "d".repeat(12),
    terminalEnvHash: "e".repeat(12),
    toolHomeSource: "",
    transport: "unix"
  };
  const projectService = {
    createRuntime() {
      return {
        async getSession() {
          return session;
        },
        projectContextRoot,
        stateRoot: projectRuntimeRoot
      };
    },
    async projectExecutionEnvironment() {
      captures.onProjectEnvironment?.();
      if (captures.projectEnvironmentWait) {
        await captures.projectEnvironmentWait;
      }
      return {
        PROVIDER_OWNERSHIP_VERSION: captures.environmentVersion,
        VIBE64_RUNTIME_NAMESPACE: "test",
        VIBE64_WORKSPACE: "test"
      };
    },
    async readProjectAiPolicy({ vibe64User } = {}) {
      policyReads.push(vibe64User || null);
      return aiPolicy
        ? { aiPolicy, ok: true }
        : { ok: true };
    }
  };
  const controller = createCodexTerminalController({
    codexAppServerProviderFactory(providerOptions) {
      captures.onProviderFactory?.();
      return createProvider(calls, subscribers, captures, providerOptions);
    },
    env: {
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService
  });
  let closeController = true;
  try {
    await operation({
      calls,
      captures,
      controller,
      policyReads,
      projectContextRoot,
      projectRuntimeRoot,
      projectService,
      session,
      simulateControllerCrash() {
        closeController = false;
      },
      subscribers,
      temporaryRoot
    });
  } finally {
    if (closeController) {
      await controller.closeAllForSession("session-1");
    }
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

function restartedCaptures(source = {}, overrides = {}) {
  return {
    ...source,
    closes: 0,
    configReads: [],
    deletes: [],
    economyThreadInventories: 0,
    economyThreadInventoryWait: null,
    ensureAvailableWait: null,
    failDeletes: 0,
    failInterrupts: 0,
    hookLists: [],
    interrupts: [],
    modelAborts: 0,
    modelSignals: [],
    onStopRuntime: null,
    providerOptions: [],
    resumes: [],
    runtimeInfo: { ...source.runtimeInfo },
    stopRuntimes: 0,
    stopRuntimeOptions: [],
    stopRuntimeProviderOptions: [],
    stopRuntimeHandler: null,
    stopRuntimeWait: null,
    threads: [],
    turns: [],
    undefinedDeletes: 0,
    ...overrides
  };
}

function createRestartedController({
  calls = [],
  captures,
  codexEconomyThreadLedgerFactory,
  projectService,
  subscribers = new Set()
} = {}) {
  return createCodexTerminalController({
    codexAppServerProviderFactory(providerOptions) {
      return createProvider(calls, subscribers, captures, providerOptions);
    },
    env: {
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    ...(codexEconomyThreadLedgerFactory ? { codexEconomyThreadLedgerFactory } : {}),
    projectService
  });
}

async function withAgentMessageController(operation) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-agent-message-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const {
    projectContextRoot,
    projectRuntimeRoot,
    session
  } = await managedSessionFixture(temporaryRoot);
  const store = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot: path.join(temporaryRoot, "managed", "sessions")
  });
  await store.createSession({
    metadata: session.metadata,
    runtimeKind: "genesis",
    sessionId: session.sessionId
  });

  const captures = {
    finalText: "",
    onSendTurn: null,
    onSteerTurn: null,
    provider: null,
    providerOptions: [],
    sendTurnWait: null,
    sessionThreadIds: [],
    steers: [],
    stopRuntimes: 0,
    threadSnapshotTurns: null,
    threadStarts: [],
    turns: [],
    subscribers: null
  };
  const runtime = {
    async getSession(sessionId) {
      return store.readSession(sessionId);
    },
    async renderPrompt(_sessionId, { request } = {}) {
      return {
        prompt: String(request || "Continue.")
      };
    },
    projectContextRoot,
    stateRoot: projectRuntimeRoot,
    store
  };
  const controller = createCodexTerminalController({
    codexAppServerActiveReconcileMs: 60_000,
    codexAppServerDaemonWellbeingMs: 60_000,
    codexAppServerProviderFactory(providerOptions) {
      captures.providerOptions.push(providerOptions);
      const subscribers = new Set();
      captures.subscribers = subscribers;
      const provider = {
        closed: 0,
        status: "idle",
        threadCwd: "",
        threadId: "11111111-1111-4111-8111-111111111111",
        turnId: "",
        close() {
          provider.closed += 1;
        },
        async ensureAvailable() {},
        async ensureRuntime() {
          const runtimeDir = path.join(temporaryRoot, "provider-runtime");
          return {
            endpoint: `unix://${path.join(runtimeDir, "codex.sock")}`,
            runtimeDir,
            socketPath: path.join(runtimeDir, "codex.sock"),
            transport: "unix"
          };
        },
        isAvailable() {
          return provider.closed === 0;
        },
        async listLoadedThreads() {
          return {
            data: [provider.threadId]
          };
        },
        async listAppServerThreadsForCwd({ cwd }) {
          return {
            cwd,
            threadIds: [...captures.sessionThreadIds]
          };
        },
        async readThread(threadId = provider.threadId) {
          if (Array.isArray(captures.threadSnapshotTurns)) {
            return {
              cwd: provider.threadCwd,
              id: threadId,
              turns: captures.threadSnapshotTurns
            };
          }
          const turn = captures.turns.find((candidate) => (
            candidate.turnId === provider.turnId
          ));
          const finalText = typeof captures.finalText === "function"
            ? captures.finalText(provider.turnId)
            : captures.finalText || `Completed ${provider.turnId}.`;
          return {
            cwd: provider.threadCwd,
            id: threadId,
            turns: provider.turnId ? [{
              id: provider.turnId,
              items: [{
                clientId: turn?.settings?.clientUserMessageId || "",
                content: [{
                  text: turn?.input || "",
                  type: "text"
                }],
                id: `user-${provider.turnId}`,
                type: "userMessage"
              }, {
                id: `answer-${provider.turnId}`,
                phase: "final_answer",
                text: finalText,
                type: "agentMessage"
              }],
              status: provider.status
            }] : []
          };
        },
        async readThreadStatus() {
          return {
            status: provider.status,
            turnId: provider.turnId
          };
        },
        async resumeThread(threadId, settings = {}) {
          provider.threadId = threadId;
          provider.threadCwd = settings.cwd || provider.threadCwd;
          return {
            id: threadId
          };
        },
        async sendTurn(threadId, input, settings) {
          const turnId = `turn-${captures.turns.length + 1}`;
          provider.status = "inProgress";
          provider.turnId = turnId;
          captures.turns.push({
            input,
            settings,
            threadId,
            turnId
          });
          captures.onSendTurn?.({ provider, turnId });
          if (captures.sendTurnWait) {
            await captures.sendTurnWait;
          }
          return {
            id: turnId,
            raw: {
              status: provider.status
            }
          };
        },
        async startThread(settings) {
          captures.threadStarts.push(settings);
          provider.threadCwd = settings.cwd || provider.threadCwd;
          if (!captures.sessionThreadIds.includes(provider.threadId)) {
            captures.sessionThreadIds.push(provider.threadId);
          }
          return {
            id: provider.threadId
          };
        },
        async steerTurn(threadId, turnId, message, options) {
          captures.steers.push({
            message,
            options,
            threadId,
            turnId
          });
          if (captures.onSteerTurn) {
            return captures.onSteerTurn({
              message,
              options,
              provider,
              threadId,
              turnId
            });
          }
          return {
            id: turnId
          };
        },
        async stopRuntime(options = {}) {
          captures.stopRuntimes += 1;
          captures.stopRuntimeOptions = options;
          captures.stopRuntimeProviderOptions = providerOptions;
          return { stopped: true };
        },
        subscribe(callback) {
          subscribers.add(callback);
          return () => subscribers.delete(callback);
        }
      };
      captures.provider = provider;
      return provider;
    },
    env: {
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService: {
      createRuntime() {
        return runtime;
      },
      createSessionStore() {
        return store;
      },
      async projectExecutionEnvironment() {
        return {
          VIBE64_RUNTIME_NAMESPACE: "test",
          VIBE64_WORKSPACE: "test"
        };
      },
      async readProjectAiPolicy() {
        return {
          ok: true
        };
      }
    }
  });

  try {
    await operation({
      captures,
      controller,
      runtime,
      sessionId: session.sessionId,
      store
    });
  } finally {
    await controller.closeAllForSession(session.sessionId);
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

const RENEWAL_SOURCE = Object.freeze({
  authority: "github",
  commit: "a".repeat(40),
  ref: "refs/heads/main",
  repository: "https://github.com/example/project.git"
});

function renewalHandoverText() {
  return [
    "# Session handover",
    "## Objective",
    "Finish the exact saved project work.",
    "## Decisions",
    "Keep the existing architecture.",
    "## Saved source",
    "- Authority: github",
    "- Repository: https://github.com/example/project.git",
    "- Ref: refs/heads/main",
    `- Commit: ${RENEWAL_SOURCE.commit}`,
    "## Touched areas",
    "The server.",
    "## Verification",
    "Focused tests passed.",
    "## Unresolved work",
    "One task remains.",
    "## Next action",
    "Implement the remaining task."
  ].join("\n");
}

function completeAgentMessageHarnessTurn(captures, provider, turnId, text) {
  queueMicrotask(() => {
    provider.status = "completed";
    completeDetachedTurn(captures.subscribers, {
      text,
      threadId: provider.threadId,
      turnId
    });
  });
}

test("session renewal handover runs on the exact visible main thread with stored interactive settings", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    await store.mutateSession(sessionId, async () => {
      await Promise.all([
        store.writeMetadataValue(sessionId, "agent_settings_model", "gpt-5.6-sol"),
        store.writeMetadataValue(sessionId, "agent_settings_provider", "codex"),
        store.writeMetadataValue(sessionId, "agent_settings_thinking", "high")
      ]);
    });
    const prepared = await controller.ensureThread(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    captures.provider.status = "completed";
    captures.provider.turnId = "historical-main-turn";
    const handover = renewalHandoverText();
    captures.finalText = handover;
    captures.onSendTurn = ({ provider, turnId }) => {
      completeAgentMessageHarnessTurn(captures, provider, turnId, handover);
    };

    const result = await controller.generateSessionRenewalHandover(sessionId, {
      agentSettings: {
        model: "gpt-5.6-luna",
        thinking: "low"
      },
      operationKey: "renewal:generate-one",
      source: RENEWAL_SOURCE
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.handover, handover);
    assert.equal(result.threadId, prepared.codexThreadId);
    assert.equal(result.turnId, "turn-1");
    assert.equal(result.clientMessageId, captures.turns[0].settings.clientUserMessageId);
    assert.equal(captures.turns[0].settings.model, "gpt-5.6-sol");
    assert.equal(captures.turns[0].settings.effort, "high");
    assert.equal(Object.hasOwn(captures.turns[0].settings, "outputSchema"), false);
    const saved = await store.readSession(sessionId);
    assert.equal(saved.metadata.agent_renewal_handover_turn_id, "turn-1");
    assert.equal(saved.metadata.agent_renewal_handover_hash, result.handoverHash);
    const renewalRun = saved.agentRuns.find(({ id }) => id === "codex_app_server");
    assert.equal(renewalRun.active, false);
    assert.equal(renewalRun.state, "completed");
    assert.equal(renewalRun.providerThreadId, prepared.codexThreadId);
    assert.equal(renewalRun.providerTurnId, "turn-1");

    const retried = await controller.generateSessionRenewalHandover(sessionId, {
      operationKey: "renewal:generate-one",
      source: RENEWAL_SOURCE
    });
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.reconciled, true);
    assert.equal(retried.turnId, "turn-1");
    assert.equal(captures.turns.length, 1);
  });
});

test("renewed-session seeding starts a fresh hidden turn and requires its exact structured acknowledgement", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    await store.writeMetadataValue(sessionId, "agent_settings_model", "gpt-5.5");
    await store.writeMetadataValue(sessionId, "agent_settings_provider", "codex");
    await store.writeMetadataValue(sessionId, "agent_settings_thinking", "high");
    const handover = renewalHandoverText();
    const handoverHash = sessionRenewalHandoverHash(handover);
    const acknowledgement = {
      handoverHash,
      message: "Ready to continue from the approved handover.",
      schemaVersion: "vibe64.session-renewal-acknowledgement.v1",
      sourceCommit: RENEWAL_SOURCE.commit,
      status: "ready"
    };
    captures.finalText = JSON.stringify(acknowledgement);
    captures.onSendTurn = ({ provider, turnId }) => {
      completeAgentMessageHarnessTurn(
        captures,
        provider,
        turnId,
        JSON.stringify(acknowledgement)
      );
    };

    const session = await store.readSession(sessionId);
    assert.equal(session.metadata.agent_settings_model, "gpt-5.5");
    assert.equal(session.metadata.agent_settings_provider, "codex");
    assert.equal(session.metadata.agent_settings_thinking, "high");
    const result = await controller.seedSessionRenewalHandover(sessionId, {
      agentSettings: {
        model: "gpt-5.6-sol",
        thinking: "low"
      },
      handover,
      handoverHash,
      oldThreadId: "22222222-2222-4222-8222-222222222222",
      operationKey: "renewal:seed-one",
      source: RENEWAL_SOURCE
    }, {
      runtime,
      session
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.freshThread, true);
    assert.equal(result.subscriptionDeferred, true);
    assert.equal(result.acknowledgement.handoverHash, handoverHash);
    assert.equal(result.turnId, "turn-1");
    assert.equal(captures.threadStarts.length, 1);
    assert.equal(captures.threadStarts[0].sandbox, "read-only");
    assert.equal(captures.turns[0].settings.model, "gpt-5.5");
    assert.equal(captures.turns[0].settings.effort, "high");
    assert.deepEqual(captures.turns[0].settings.sandboxPolicy, {
      networkAccess: false,
      type: "readOnly"
    });
    assert.equal(captures.turns[0].settings.outputSchema.additionalProperties, false);
    assert.deepEqual(captures.turns[0].settings.outputSchema.properties.handoverHash.enum, [handoverHash]);
    const saved = await store.readSessionForRenewal(sessionId);
    assert.equal(saved.metadata.agent_renewal_seed_turn_id, "turn-1");
    assert.equal(saved.metadata.agent_briefing_delivered, "yes");

    const retried = await controller.seedSessionRenewalHandover(sessionId, {
      handover,
      handoverHash,
      oldThreadId: "22222222-2222-4222-8222-222222222222",
      operationKey: "renewal:seed-one",
      source: RENEWAL_SOURCE
    }, {
      runtime,
      session: saved
    });
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal(retried.freshThread, false);
    assert.equal(retried.reconciled, true);
    assert.equal(retried.turnId, "turn-1");
    assert.equal(captures.threadStarts.length, 1);
    assert.equal(captures.turns.length, 1);

    const ordinary = await controller.sendMessage(sessionId, {
      agentSettings: {
        model: saved.metadata.agent_settings_model,
        providerId: saved.metadata.agent_settings_provider,
        thinking: saved.metadata.agent_settings_thinking
      },
      message: "Continue with the renewed session settings.",
      messageId: "renewal-settings-ordinary-turn"
    });
    assert.equal(ordinary.ok, true, JSON.stringify(ordinary));
    assert.equal(captures.turns.length, 2);
    assert.equal(captures.turns[1].settings.model, "gpt-5.5");
    assert.equal(captures.turns[1].settings.effort, "high");
    assert.deepEqual(captures.turns[1].settings.sandboxPolicy, {
      networkAccess: "enabled",
      type: "externalSandbox"
    });
    const continued = await store.readSession(sessionId);
    assert.equal(continued.metadata.agent_settings_model, "gpt-5.5");
    assert.equal(continued.metadata.agent_settings_provider, "codex");
    assert.equal(continued.metadata.agent_settings_thinking, "high");
  });
});

test("renewed-session seeding starts fresh when a manual handover has no predecessor thread id", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const handover = renewalHandoverText();
    const handoverHash = sessionRenewalHandoverHash(handover);
    const acknowledgement = {
      handoverHash,
      message: "Ready to continue from the approved manual handover.",
      schemaVersion: "vibe64.session-renewal-acknowledgement.v1",
      sourceCommit: RENEWAL_SOURCE.commit,
      status: "ready"
    };
    captures.finalText = JSON.stringify(acknowledgement);
    captures.onSendTurn = ({ provider, turnId }) => {
      completeAgentMessageHarnessTurn(
        captures,
        provider,
        turnId,
        JSON.stringify(acknowledgement)
      );
    };

    const result = await controller.seedSessionRenewalHandover(sessionId, {
      handover,
      handoverHash,
      operationKey: "renewal:manual-without-old-thread",
      source: RENEWAL_SOURCE
    }, {
      runtime,
      session: await store.readSession(sessionId)
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.freshThread, true);
    assert.equal(result.acknowledgement.handoverHash, handoverHash);
    assert.equal(captures.threadStarts.length, 1);
    assert.equal(captures.turns.length, 1);
  });
});

test("renewed-session seeding rejects a fresh thread that already contains history", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const handover = renewalHandoverText();
    captures.threadSnapshotTurns = [{
      id: "unrelated-turn",
      items: [{
        content: [{ text: "Unrelated prior request", type: "text" }],
        id: "unrelated-user-message",
        type: "userMessage"
      }],
      status: "completed"
    }];

    const result = await controller.seedSessionRenewalHandover(sessionId, {
      handover,
      handoverHash: sessionRenewalHandoverHash(handover),
      operationKey: "renewal:history-bearing-successor",
      source: RENEWAL_SOURCE
    }, {
      runtime,
      session: await store.readSession(sessionId)
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_session_renewal_fresh_thread_required");
    assert.match(result.error, /unrelated conversation/u);
    assert.equal(captures.turns.length, 0);
  });
});

test("session renewal requires manual fallback when the exact old thread has no readable history", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId }) => {
    const prepared = await controller.ensureThread(sessionId);
    assert.equal(prepared.ok, true, JSON.stringify(prepared));

    const result = await controller.generateSessionRenewalHandover(sessionId, {
      operationKey: "renewal:unreadable",
      source: RENEWAL_SOURCE
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_session_renewal_thread_unreadable");
    assert.match(result.error, /manually/u);
    assert.equal(captures.turns.length, 0);
  });
});

test("session renewal provider primitives reject every economy execution profile before provider work", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId, store }) => {
    const source = RENEWAL_SOURCE;
    const handover = renewalHandoverText();
    const handoverHash = sessionRenewalHandoverHash(handover);
    const generation = await controller.generateSessionRenewalHandover(sessionId, {
      executionProfile: null,
      operationKey: "renewal:economy-generate",
      source
    });
    const seed = await controller.seedSessionRenewalHandover(sessionId, {
      executionProfile: {
        profileId: "economy"
      },
      handover,
      handoverHash,
      oldThreadId: "22222222-2222-4222-8222-222222222222",
      operationKey: "renewal:economy-seed",
      source
    }, {
      runtime,
      session: await store.readSession(sessionId)
    });

    assert.equal(generation.code, "vibe64_session_renewal_interactive_provider_required");
    assert.equal(seed.code, "vibe64_session_renewal_interactive_provider_required");
    assert.equal(captures.threadStarts.length, 0);
    assert.equal(captures.turns.length, 0);
  });
});

test("duplicate agent messages with the same message id call the provider once", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId }) => {
    let releaseSendTurn;
    captures.sendTurnWait = new Promise((resolve) => {
      releaseSendTurn = resolve;
    });
    let observeSendTurn;
    const sendTurnObserved = new Promise((resolve) => {
      observeSendTurn = resolve;
    });
    captures.onSendTurn = observeSendTurn;

    const input = {
      message: "Start atomic delivery.",
      messageId: "message-atomic-duplicate"
    };
    const firstDelivery = controller.sendMessage(sessionId, input);
    await sendTurnObserved;
    const concurrentDuplicate = controller.sendMessage(sessionId, input);
    releaseSendTurn();
    captures.sendTurnWait = null;

    const [first, duplicate] = await Promise.all([
      firstDelivery,
      concurrentDuplicate
    ]);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(duplicate, first);

    const durableDuplicate = await controller.sendMessage(sessionId, input);
    assert.equal(durableDuplicate.ok, true, JSON.stringify(durableDuplicate));
    assert.equal(durableDuplicate.duplicate, true);
    assert.equal(durableDuplicate.operationOutcome, "message_already_delivered");
    assert.equal(captures.turns.length, 1);
    assert.equal(captures.steers.length, 0);
    assert.equal(captures.turns[0].settings.clientUserMessageId, input.messageId);
  });
});

test("agent messages reject while a STARTING turn has no provider turn id", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const started = await controller.sendMessage(sessionId, {
      message: "Start before the provider identity arrives.",
      messageId: "message-starting-original"
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    captures.provider.status = "inProgress";
    captures.provider.turnId = "";
    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      event: {
        kind: "test-starting-without-provider-turn",
        state: VIBE64_AGENT_RUN_STATE.STARTING
      },
      patch: {
        outerTurnId: "message-starting-original",
        provider: "codex",
        providerInterface: "codex_app_server",
        providerStatus: "starting",
        providerThreadId: captures.provider.threadId,
        providerTurnId: "",
        state: VIBE64_AGENT_RUN_STATE.STARTING
      }
    });

    const result = await controller.sendMessage(sessionId, {
      message: "Do not race this starting turn.",
      messageId: "message-starting-rejected"
    });
    assert.equal(result.ok, false);
    assert.equal(result.operationOutcome, "active_turn_not_ready");
    assert.equal(result.retryable, true);
    assert.equal(captures.turns.length, 1);
    assert.equal(captures.steers.length, 0);
  });
});

test("agent messages reject while a FINALIZING turn retains its provider turn id", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const started = await controller.sendMessage(sessionId, {
      message: "Start before finalization.",
      messageId: "message-finalizing-original"
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    captures.provider.status = "finalizing";
    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      event: {
        kind: "test-finalizing-with-provider-turn",
        state: VIBE64_AGENT_RUN_STATE.FINALIZING
      },
      patch: {
        outerTurnId: "message-finalizing-original",
        provider: "codex",
        providerInterface: "codex_app_server",
        providerStatus: "completed",
        providerThreadId: captures.provider.threadId,
        providerTurnId: captures.provider.turnId,
        state: VIBE64_AGENT_RUN_STATE.FINALIZING
      }
    });

    const result = await controller.sendMessage(sessionId, {
      message: "Do not race final response persistence.",
      messageId: "message-finalizing-rejected"
    });
    assert.equal(result.ok, false);
    assert.equal(result.operationOutcome, "active_turn_not_ready");
    assert.equal(result.retryable, true);
    assert.equal(captures.turns.length, 1);
    assert.equal(captures.steers.length, 0);
  });
});

test("completion during steer starts one ordinary turn with the same message id", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const started = await controller.sendMessage(sessionId, {
      message: "Start the original turn.",
      messageId: "message-steer-original"
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    captures.onSteerTurn = ({ provider }) => {
      provider.status = "completed";
      const error = new Error("The original turn completed before steering.");
      error.code = -32602;
      error.method = "turn/steer";
      throw error;
    };
    const messageId = "message-steer-completed-race";
    const result = await controller.sendMessage(sessionId, {
      message: "Continue as an ordinary turn.",
      messageId
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.deliveryMode, "new_turn");
    assert.equal(result.turnId, "turn-2");
    assert.equal(captures.steers.length, 1);
    assert.equal(captures.turns.length, 2);
    assert.equal(captures.turns[1].settings.clientUserMessageId, messageId);
    const session = await store.readSession(sessionId);
    const agentRun = session.agentRuns.find(({ id }) => id === "codex_app_server");
    assert.equal(agentRun?.outerTurnId, messageId);
    assert.equal(agentRun?.providerTurnId, "turn-2");
    const conversationLog = await store.readConversationLog(sessionId);
    assert.equal(conversationLog.filter((turn) => (
      turn.user?.text === "Continue as an ordinary turn."
    )).length, 1);
  });
});

test("goal continuation events retain one outer chat turn and persist only the terminal final", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const messageId = "message-goal-cadence-owner";
    const started = await controller.sendMessage(sessionId, {
      message: "Run the durable goal cadence fixture.",
      messageId
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    const provider = captures.provider;
    const threadId = provider.threadId;
    const firstTurnId = provider.turnId;
    emitCodexNotification(captures.subscribers, threadGoalUpdated({
      status: "active",
      threadId,
      turnId: firstTurnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "active",
      "the active goal owner"
    );

    const goalTurns = [{
      commentary: "Verifying the current checkpoint.",
      final: "Internal checkpoint one.\n\nThis provider turn is not the outer chat result.",
      reasoning: "Confirming task completion",
      turnId: firstTurnId
    }, {
      commentary: "Continuing the goal in the same outer turn.",
      final: "Internal checkpoint two.\n\nThe active goal will continue again.",
      reasoning: "Confirming idle state",
      turnId: "goal-turn-2"
    }, {
      commentary: "Preparing the terminal goal result.",
      final: "The goal is paused with the verified checkpoint preserved.",
      reasoning: "Waiting for more information",
      turnId: "goal-turn-3"
    }];

    for (let index = 0; index < goalTurns.length; index += 1) {
      const turn = goalTurns[index];
      emitCodexNotification(captures.subscribers, reasoningSummaryDelta({
        itemId: `reasoning-${index + 1}`,
        text: turn.reasoning,
        threadId,
        turnId: turn.turnId
      }));
      emitCodexNotification(captures.subscribers, assistantItemCompleted({
        itemId: `commentary-${index + 1}`,
        phase: "commentary",
        text: turn.commentary,
        threadId,
        turnId: turn.turnId
      }));
      emitCodexNotification(captures.subscribers, assistantItemCompleted({
        itemId: `final-${index + 1}`,
        phase: "final_answer",
        text: turn.final,
        threadId,
        turnId: turn.turnId
      }));

      const successor = goalTurns[index + 1];
      provider.status = successor ? "inProgress" : "completed";
      provider.turnId = successor?.turnId || turn.turnId;
      emitCodexNotification(captures.subscribers, turnCompleted({
        threadId,
        turnId: turn.turnId
      }));
      if (successor) {
        emitCodexNotification(captures.subscribers, turnStarted({
          threadId,
          turnId: successor.turnId
        }));
        const adopted = await waitForSessionValue(
          () => store.readAgentRun(sessionId, "codex_app_server"),
          (run) => run?.providerTurnId === successor.turnId &&
            run?.state === VIBE64_AGENT_RUN_STATE.ACTIVE,
          `goal successor ${successor.turnId}`
        );
        assert.equal(adopted.inputSource, "chat");
        assert.equal(adopted.outerTurnId, messageId);
        assert.equal(adopted.providerGoalStatus, "active");
      }
    }

    const held = await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerTurnId === "goal-turn-3" &&
        run?.state === VIBE64_AGENT_RUN_STATE.FINALIZING,
      "the terminal provider turn to remain goal-owned"
    );
    assert.equal(held.inputSource, "chat");
    assert.equal(held.outerTurnId, messageId);

    const beforeGoalSettlement = await store.readConversationLog(sessionId);
    assert.equal(beforeGoalSettlement.filter((turn) => turn.assistant).length, 0);
    assert.deepEqual(
      beforeGoalSettlement.flatMap((turn) => turn.thinking || []).map(({ text }) => text),
      goalTurns.map(({ reasoning }) => reasoning)
    );
    assert.deepEqual(
      beforeGoalSettlement.flatMap((turn) => turn.commentary || []).map(({ text }) => text),
      goalTurns.map(({ commentary }) => commentary)
    );

    emitCodexNotification(captures.subscribers, threadGoalUpdated({
      status: "paused",
      threadId,
      turnId: "goal-turn-3"
    }));
    const settled = await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "paused" &&
        run?.state === VIBE64_AGENT_RUN_STATE.COMPLETED,
      "the outer goal result to settle"
    );
    assert.equal(settled.inputSource, "chat");
    assert.equal(settled.outerTurnId, messageId);

    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "final-3",
      phase: "final_answer",
      text: goalTurns[2].final,
      threadId,
      turnId: "goal-turn-3"
    }));
    emitCodexNotification(captures.subscribers, turnCompleted({
      threadId,
      turnId: "goal-turn-3"
    }));
    emitCodexNotification(captures.subscribers, threadGoalUpdated({
      status: "paused",
      threadId,
      turnId: "goal-turn-3"
    }));
    await controller.closeAllForSession(sessionId);

    const conversation = await store.readConversationLog(sessionId);
    const assistantMessages = conversation.map((turn) => turn.assistant).filter(Boolean);
    assert.deepEqual(assistantMessages.map(({ text }) => text), [goalTurns[2].final]);
    const allVisibleText = JSON.stringify(conversation);
    assert.equal(allVisibleText.includes("Internal checkpoint one."), false);
    assert.equal(allVisibleText.includes("Internal checkpoint two."), false);

    const run = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(run.events.filter(({ kind }) => (
      kind === "codex-app-server-turn-continued"
    )).length, 2);
    assert.equal(run.events.filter(({ kind }) => (
      kind === "codex-app-server-result-processed"
    )).length, 1);
    assert.equal(run.events.filter(({ kind }) => (
      kind === "codex-app-server-goal-status-updated"
    )).length, 2);
  });
});

test("a persisted active goal restores its chat owner when a successor is observed from idle", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const messageId = "message-persisted-goal-owner";
    const started = await controller.sendMessage(sessionId, {
      message: "Exercise the persisted goal ownership boundary.",
      messageId
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    const provider = captures.provider;
    const threadId = provider.threadId;
    emitCodexNotification(captures.subscribers, threadGoalUpdated({
      status: "active",
      threadId,
      turnId: provider.turnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "active",
      "the durable active goal status"
    );

    await store.writeAgentRunEvent(sessionId, "codex_app_server", {
      event: {
        kind: "test-persisted-goal-idle-boundary",
        state: VIBE64_AGENT_RUN_STATE.COMPLETED
      },
      patch: {
        providerStatus: "completed",
        state: VIBE64_AGENT_RUN_STATE.COMPLETED
      }
    });
    const persistedIdle = await store.readAgentRun(sessionId, "codex_app_server");
    assert.equal(persistedIdle.inputSource, "chat");
    assert.equal(persistedIdle.outerTurnId, messageId);
    assert.equal(persistedIdle.providerGoalStatus, "active");

    const successorTurnId = "persisted-goal-successor";
    captures.finalText = (turnId) => turnId === successorTurnId
      ? "Recovered goal final."
      : `Completed ${turnId}.`;
    provider.status = "inProgress";
    provider.turnId = successorTurnId;
    emitCodexNotification(captures.subscribers, turnStarted({
      threadId,
      turnId: successorTurnId
    }));
    const recovered = await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerTurnId === successorTurnId &&
        run?.state === VIBE64_AGENT_RUN_STATE.ACTIVE,
      "the idle goal successor to recover"
    );
    assert.equal(recovered.inputSource, "chat");
    assert.equal(recovered.outerTurnId, messageId);
    assert.equal(recovered.providerGoalStatus, "active");

    emitCodexNotification(captures.subscribers, reasoningSummaryDelta({
      itemId: "recovered-goal-reasoning",
      text: "Confirming idle state",
      threadId,
      turnId: successorTurnId
    }));
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "recovered-goal-commentary",
      phase: "commentary",
      text: "The persisted outer owner is still active.",
      threadId,
      turnId: successorTurnId
    }));
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "recovered-goal-final",
      phase: "final_answer",
      text: "Recovered goal final.",
      threadId,
      turnId: successorTurnId
    }));
    provider.status = "completed";
    emitCodexNotification(captures.subscribers, turnCompleted({
      threadId,
      turnId: successorTurnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.state === VIBE64_AGENT_RUN_STATE.FINALIZING,
      "the recovered goal final to remain outer-owned"
    );
    emitCodexNotification(captures.subscribers, threadGoalUpdated({
      status: "complete",
      threadId,
      turnId: successorTurnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerGoalStatus === "complete" &&
        run?.state === VIBE64_AGENT_RUN_STATE.COMPLETED,
      "the recovered goal to complete"
    );
    await controller.closeAllForSession(sessionId);

    const conversation = await store.readConversationLog(sessionId);
    assert.deepEqual(
      conversation.flatMap((turn) => turn.thinking || []).map(({ text }) => text),
      ["Confirming idle state"]
    );
    assert.deepEqual(
      conversation.flatMap((turn) => turn.commentary || []).map(({ text }) => text),
      ["The persisted outer owner is still active."]
    );
    assert.deepEqual(
      conversation.map((turn) => turn.assistant).filter(Boolean).map(({ text }) => text),
      ["Recovered goal final."]
    );
  });
});

test("goal ownership does not change genuine terminal-origin message mirroring", async () => {
  await withAgentMessageController(async ({ captures, controller, sessionId, store }) => {
    const started = await controller.sendMessage(sessionId, {
      message: "Establish the visible chat thread.",
      messageId: "message-before-terminal-origin"
    });
    assert.equal(started.ok, true, JSON.stringify(started));

    const provider = captures.provider;
    const threadId = provider.threadId;
    const chatTurnId = provider.turnId;
    captures.finalText = "Visible chat final.";
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "chat-final",
      phase: "final_answer",
      text: "Visible chat final.",
      threadId,
      turnId: chatTurnId
    }));
    provider.status = "completed";
    emitCodexNotification(captures.subscribers, turnCompleted({
      threadId,
      turnId: chatTurnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.state === VIBE64_AGENT_RUN_STATE.COMPLETED,
      "the visible chat turn to complete"
    );

    const terminalTurnId = "terminal-origin-turn";
    provider.status = "inProgress";
    provider.turnId = terminalTurnId;
    emitCodexNotification(captures.subscribers, turnStarted({
      threadId,
      turnId: terminalTurnId
    }));
    const terminalRun = await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerTurnId === terminalTurnId &&
        run?.state === VIBE64_AGENT_RUN_STATE.ACTIVE,
      "the terminal-origin turn to activate"
    );
    assert.equal(terminalRun.inputSource, "terminal");

    emitCodexNotification(captures.subscribers, reasoningSummaryDelta({
      itemId: "terminal-reasoning",
      text: "Terminal reasoning remains outside chat thinking.",
      threadId,
      turnId: terminalTurnId
    }));
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "terminal-commentary",
      phase: "commentary",
      text: "Visible terminal commentary.",
      threadId,
      turnId: terminalTurnId
    }));
    emitCodexNotification(captures.subscribers, assistantItemCompleted({
      itemId: "terminal-final",
      phase: "final_answer",
      text: "Visible terminal final.",
      threadId,
      turnId: terminalTurnId
    }));
    provider.status = "completed";
    emitCodexNotification(captures.subscribers, turnCompleted({
      threadId,
      turnId: terminalTurnId
    }));
    await waitForSessionValue(
      () => store.readAgentRun(sessionId, "codex_app_server"),
      (run) => run?.providerTurnId === terminalTurnId &&
        run?.state === VIBE64_AGENT_RUN_STATE.COMPLETED,
      "the terminal-origin turn to complete"
    );
    await controller.closeAllForSession(sessionId);

    const conversation = await store.readConversationLog(sessionId);
    assert.deepEqual(
      conversation.map((turn) => turn.assistant).filter(Boolean).map(({ text }) => text),
      ["Visible chat final.", "Visible terminal final."]
    );
    assert.deepEqual(
      conversation.flatMap((turn) => turn.commentary || []).map(({ text }) => text),
      ["Visible terminal commentary."]
    );
    assert.equal(JSON.stringify(conversation).includes("Terminal reasoning remains outside chat thinking."), false);
  });
});

test("a changed session environment retires the previous provider for the same runtime", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-provider-ownership-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const {
    projectContextRoot,
    projectRuntimeRoot,
    session
  } = await managedSessionFixture(temporaryRoot);
  let environmentVersion = "one";
  const providers = [];
  const controller = createCodexTerminalController({
    codexAppServerProviderFactory() {
      const provider = {
        closed: 0,
        close() {
          provider.closed += 1;
        },
        async ensureAvailable() {},
        async startThread() {
          return { id: `conversation-${providers.length + 1}` };
        }
      };
      providers.push(provider);
      return provider;
    },
    env: {
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService: {
      createRuntime() {
        return {
          async getSession() {
            return session;
          },
          projectContextRoot,
          stateRoot: projectRuntimeRoot
        };
      },
      async projectExecutionEnvironment() {
        return {
          PROVIDER_OWNERSHIP_VERSION: environmentVersion,
          VIBE64_RUNTIME_NAMESPACE: "test",
          VIBE64_WORKSPACE: "test"
        };
      }
    }
  });
  try {
    const first = await controller.createConversation("session-1");
    assert.equal(first.ok, true, JSON.stringify(first));
    environmentVersion = "two";
    const second = await controller.createConversation("session-1");
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(providers.length, 2);
    assert.equal(providers[0].closed, 1);
    assert.equal(providers[1].closed, 0);
  } finally {
    await controller.closeAllForSession("session-1");
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("an active chat keeps its provider across environment changes until the next turn", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-active-provider-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const projectContextRoot = path.join(temporaryRoot, "authority");
  const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
  const sourcePath = path.join(
    temporaryRoot,
    "managed",
    "sessions",
    "active",
    "session-1",
    "source"
  );
  await Promise.all([
    mkdir(projectContextRoot, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true }),
    mkdir(sourcePath, { recursive: true })
  ]);
  const store = createVibe64SessionStore({
    projectContextRoot,
    projectRuntimeRoot,
    projectSessionSourceRoot: path.join(temporaryRoot, "managed", "sessions")
  });
  await store.createSession({
    metadata: {
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    runtimeKind: "genesis",
    sessionId: "session-1"
  });

  let environmentVersion = "one";
  let nextTurn = 0;
  let aiPolicy = {
    customNote: "Use examples from the apiary.",
    expertise: "expert",
    promptHints: false,
    rationale: "conclusions",
    responseLength: "very_short",
    revision: 4,
    tone: "direct",
    version: 1
  };
  const vibe64User = {
    preferredName: "Ada",
    role: "owner",
    username: "ada-owner"
  };
  const policyReaders = [];
  const providers = [];
  const runtime = {
    async getSession(sessionId) {
      return store.readSession(sessionId);
    },
    async renderPrompt(_sessionId, { request } = {}) {
      return {
        prompt: String(request || "Continue.")
      };
    },
    projectContextRoot,
    stateRoot: projectRuntimeRoot,
    store
  };
  const controller = createCodexTerminalController({
    codexAppServerActiveReconcileMs: 60_000,
    codexAppServerDaemonWellbeingMs: 60_000,
    codexAppServerProviderFactory(options) {
      const subscribers = new Set();
      const providerNumber = providers.length + 1;
      const provider = {
        closed: 0,
        options,
        resumedThreads: [],
        sentTurns: [],
        startedThreads: [],
        status: "idle",
        steeredMessages: [],
        threadId: "11111111-1111-4111-8111-111111111111",
        turnId: "",
        close() {
          provider.closed += 1;
        },
        async ensureAvailable() {},
        async ensureRuntime() {
          return {
            endpoint: `unix://${path.join(temporaryRoot, `provider-${providerNumber}.sock`)}`,
            runtimeDir: path.join(temporaryRoot, `provider-${providerNumber}`),
            socketPath: path.join(temporaryRoot, `provider-${providerNumber}.sock`),
            transport: "unix"
          };
        },
        async interruptTurn() {
          provider.status = "interrupted";
          return {
            status: "interrupted"
          };
        },
        isAvailable() {
          return provider.closed === 0;
        },
        async listLoadedThreads() {
          return {
            data: [provider.threadId]
          };
        },
        async readThread() {
          return {
            turns: provider.turnId ? [{
              id: provider.turnId,
              items: [{
                id: `answer-${provider.turnId}`,
                phase: "final_answer",
                text: "The original turn completed safely.",
                type: "agentMessage"
              }],
              status: provider.status
            }] : []
          };
        },
        async readThreadStatus() {
          return {
            status: provider.status,
            turnId: provider.turnId
          };
        },
        async resumeThread(threadId, settings) {
          provider.threadId = threadId;
          provider.resumedThreads.push({ settings, threadId });
          return {
            id: threadId
          };
        },
        async sendTurn(threadId, input, settings) {
          nextTurn += 1;
          provider.status = "inProgress";
          provider.turnId = `turn-${nextTurn}`;
          provider.sentTurns.push({ input, settings, threadId });
          return {
            id: provider.turnId,
            raw: {
              status: provider.status
            }
          };
        },
        async startThread(settings) {
          provider.startedThreads.push(settings);
          return {
            id: provider.threadId
          };
        },
        async steerTurn(threadId, turnId, message) {
          provider.steeredMessages.push({
            message,
            threadId,
            turnId
          });
          return {
            id: turnId
          };
        },
        async stopRuntime() {},
        subscribe(callback) {
          subscribers.add(callback);
          return () => subscribers.delete(callback);
        }
      };
      providers.push(provider);
      return provider;
    },
    env: {
      VIBE64_RUNTIME_NAMESPACE: "test",
      VIBE64_WORKSPACE: "test"
    },
    projectService: {
      createRuntime() {
        return runtime;
      },
      createSessionStore() {
        return store;
      },
      async projectExecutionEnvironment() {
        return {
          PROVIDER_OWNERSHIP_VERSION: environmentVersion,
          VIBE64_RUNTIME_NAMESPACE: "test",
          VIBE64_WORKSPACE: "test"
        };
      },
      async readProjectAiPolicy({ vibe64User: requestingUser } = {}) {
        policyReaders.push(requestingUser || null);
        return {
          aiPolicy,
          ok: true
        };
      }
    }
  });

  try {
    const started = await controller.sendMessage("session-1", {
      message: "Start the work.",
      messageId: "message-1",
      vibe64User
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].options.terminalEnv.PROVIDER_OWNERSHIP_VERSION, "one");
    assert.match(
      providers[0].startedThreads[0].developerInstructions,
      /Project owner preference: Use examples from the apiary\./u
    );
    assert.match(providers[0].startedThreads[0].developerInstructions, /Assume the user is an expert/u);
    assert.match(providers[0].sentTurns[0].input, /Current actor id: "ada-owner"/u);
    assert.match(providers[0].sentTurns[0].input, /Current actor display name: "Ada"/u);
    assert.match(providers[0].sentTurns[0].input, /Project AI policy revision: 4/u);
    assert.equal(policyReaders.some((reader) => reader?.username === "ada-owner"), true);
    const firstBriefingFingerprint = (
      await store.readSession("session-1")
    ).metadata.agent_briefing_fingerprint;
    assert.ok(firstBriefingFingerprint);

    environmentVersion = "two";
    const ensured = await controller.ensureThread("session-1");
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].closed, 0);

    const steered = await controller.sendMessage("session-1", {
      message: "Use this additional detail.",
      messageId: "message-2",
      vibe64User
    });
    assert.equal(steered.ok, true, JSON.stringify(steered));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].closed, 0);
    assert.equal(providers[0].steeredMessages.length, 1);
    assert.equal(providers[0].steeredMessages[0].threadId, providers[0].threadId);
    assert.equal(providers[0].steeredMessages[0].turnId, "turn-1");
    assert.match(providers[0].steeredMessages[0].message, /<vibe64-hidden-turn-context>/u);
    assert.match(providers[0].steeredMessages[0].message, /Current actor id: "[^"]+"/u);
    assert.match(providers[0].steeredMessages[0].message, /Use this additional detail\.$/u);
    const attributedTurns = await store.readConversationLog("session-1");
    assert.equal(attributedTurns.slice(0, 2).every((turn) => (
      turn.metadata?.actorId === "ada-owner" &&
      turn.metadata.actorDisplayName === "Ada" &&
      turn.metadata.policyRevision === 4 &&
      turn.metadata.policyVersion === 1
    )), true);

    const activeReconciliation = await controller.reconcileThreads([{
      sessionId: "session-1"
    }]);
    assert.equal(activeReconciliation.ok, true, JSON.stringify(activeReconciliation));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].closed, 0);

    providers[0].status = "completed";
    const completedReconciliation = await controller.reconcileThreads([{
      sessionId: "session-1"
    }]);
    assert.equal(completedReconciliation.ok, true, JSON.stringify(completedReconciliation));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].closed, 0);
    const completedSession = await store.readSession("session-1");
    assert.equal(completedSession.agentRuns.find(({ id }) => id === "codex_app_server")?.state, "completed");
    assert.match(
      JSON.stringify(await store.readConversationLog("session-1")),
      /The original turn completed safely\./u
    );

    aiPolicy = {
      ...aiPolicy,
      customNote: "Prefer the latest hive measurements.",
      revision: 5,
      tone: "playful"
    };
    const restarted = await controller.sendMessage("session-1", {
      message: "Start the next turn.",
      messageId: "message-3",
      vibe64User
    });
    assert.equal(restarted.ok, true, JSON.stringify(restarted));
    assert.equal(providers.length, 2);
    assert.equal(providers[0].closed, 1);
    assert.equal(providers[1].closed, 0);
    assert.equal(providers[1].options.terminalEnv.PROVIDER_OWNERSHIP_VERSION, "two");
    assert.match(
      providers[1].resumedThreads[0].settings.developerInstructions,
      /Project owner preference: Prefer the latest hive measurements\./u
    );
    assert.match(providers[1].sentTurns[0].input, /VIBE64_CONTEXT_REFRESH:/u);
    assert.match(providers[1].sentTurns[0].input, /Project AI policy revision: 5/u);
    assert.match(
      providers[1].sentTurns[0].input,
      /Project owner preference: Prefer the latest hive measurements\./u
    );
    const refreshedSession = await store.readSession("session-1");
    assert.notEqual(
      refreshedSession.metadata.agent_briefing_fingerprint,
      firstBriefingFingerprint
    );
    const restartedMessage = (await store.readConversationLog("session-1"))
      .find((turn) => turn.user?.text === "Start the next turn.");
    assert.deepEqual(restartedMessage?.metadata, {
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      policyRevision: 5,
      policyVersion: 1
    });

    environmentVersion = "three";
    const interrupted = await controller.interruptTurn("session-1", {
      controlRequestId: "interrupt-1"
    });
    assert.equal(interrupted.ok, true, JSON.stringify(interrupted));
    assert.equal(providers.length, 2);
    assert.equal(providers[1].closed, 0);
  } finally {
    await controller.closeAllForSession("session-1");
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("closing a session stops its deterministic runtime before transport metadata is persisted", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-unrecorded-runtime-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const {
    projectContextRoot,
    projectRuntimeRoot,
    session
  } = await managedSessionFixture(temporaryRoot);
  const agentRuntimeRoot = path.join(temporaryRoot, "agent-runtimes");
  const providerEnv = {
    VIBE64_AGENT_RUNTIME_DIR: agentRuntimeRoot,
    VIBE64_RUNTIME_NAMESPACE: "test",
    VIBE64_WORKSPACE: "test"
  };
  const runtimeDir = codexAppServerRuntimeDir({
    env: providerEnv,
    executionRoot: session.metadata.source_path,
    runtimeInstanceId: session.sessionId,
    workdir: session.metadata.source_path
  });
  const unscopedRuntimeDir = codexAppServerRuntimeDir({
    env: providerEnv
  });
  await mkdir(runtimeDir, {
    recursive: true
  });
  await mkdir(unscopedRuntimeDir, {
    recursive: true
  });
  await writeFile(
    path.join(runtimeDir, "runtime.json"),
    JSON.stringify(exactStoppedRuntimeMetadata(runtimeDir))
  );
  await writeFile(
    path.join(unscopedRuntimeDir, "runtime.json"),
    JSON.stringify(exactStoppedRuntimeMetadata(unscopedRuntimeDir))
  );
  let currentSession = session;
  const controller = createCodexTerminalController({
    codexAppServerProviderOptions: {
      env: providerEnv
    },
    env: providerEnv,
    projectService: {
      createRuntime() {
        return {
          async getSession() {
            return currentSession;
          },
          projectContextRoot,
          stateRoot: projectRuntimeRoot
        };
      },
      async projectExecutionEnvironment() {
        return providerEnv;
      }
    }
  });
  try {
    await controller.closeAllForSession("session-1");
    await assert.rejects(
      () => readFile(path.join(runtimeDir, "runtime.json"), "utf8"),
      {
        code: "ENOENT"
      }
    );

    currentSession = {
      metadata: {},
      sessionId: "session-without-source",
      sessionRoot: path.join(projectRuntimeRoot, "sessions", "active", "session-without-source")
    };
    await controller.closeAllForSession("session-without-source");
    assert.equal(
      JSON.parse(await readFile(path.join(unscopedRuntimeDir, "runtime.json"), "utf8")).runtimeDir,
      unscopedRuntimeDir
    );
  } finally {
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("temporary conversations start turns without resuming a nonexistent rollout", async () => {
  await withConversationController(async ({ calls, controller }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));

    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      message: "Explain this conflict."
    });

    assert.equal(turn.ok, true);
    assert.equal(calls.filter(([kind]) => kind === "resume").length, 0);
    assert.deepEqual(calls.filter(([kind]) => kind === "turn"), [
      ["turn", "conversation-1"]
    ]);
  });
});

test("temporary conversations receive the saved project policy and trusted actor context", async () => {
  const aiPolicy = {
    customNote: "Use examples from the apiary.",
    expertise: "expert",
    promptHints: false,
    rationale: "conclusions",
    responseLength: "very_short",
    revision: 8,
    tone: "playful",
    version: 1
  };
  const vibe64User = {
    preferredName: "Ada",
    role: "owner",
    username: "ada-owner"
  };

  await withConversationController(async ({ captures, controller, policyReads }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true,
      policy: "workspace_write",
      vibe64User
    });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));

    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      ephemeral: true,
      message: "Fix the focused issue.",
      policy: "workspace_write",
      vibe64User
    });
    assert.equal(turn.ok, true, JSON.stringify(turn));

    assert.match(
      captures.threads[0].developerInstructions,
      /Project owner preference: Use examples from the apiary\./u
    );
    assert.match(captures.threads[0].developerInstructions, /Assume the user is an expert/u);
    assert.match(captures.turns[0].input, /Current actor id: "ada-owner"/u);
    assert.match(captures.turns[0].input, /Current actor display name: "Ada"/u);
    assert.match(captures.turns[0].input, /Project AI policy revision: 8/u);
    assert.deepEqual(policyReads, [vibe64User, vibe64User]);

    const snapshot = await controller.readConversation("session-1", {
      conversationId: conversation.conversationId,
      ephemeral: true,
      runId: turn.runId
    });
    assert.deepEqual(snapshot.turnMetadata, {
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      policyRevision: 8,
      policyVersion: 1
    });
  }, { aiPolicy });
});

test("temporary workspace-write turns remain active for renewal until completion", async () => {
  await withConversationController(async ({ controller, subscribers }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });

    assert.equal(controller.hasActiveTemporaryConversation("session-1"), false);
    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      ephemeral: true,
      message: "Fix the focused issue.",
      policy: "workspace_write"
    });

    assert.equal(turn.ok, true, JSON.stringify(turn));
    assert.equal(controller.hasActiveTemporaryConversation("session-1"), true);

    emitCodexNotification(subscribers, codexEvent({
      message: "The focused issue is fixed.",
      phase: "final_answer"
    }));
    emitCodexNotification(subscribers, turnCompleted());
    await flushPromises();
    assert.equal(controller.hasActiveTemporaryConversation("session-1"), false);
  });
});

test("temporary read-only turns remain active for renewal until completion", async () => {
  await withConversationController(async ({ controller, subscribers }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });
    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      ephemeral: true,
      message: "Explain the focused issue."
    });

    assert.equal(turn.ok, true, JSON.stringify(turn));
    assert.equal(controller.hasActiveTemporaryConversation("session-1"), true);

    emitCodexNotification(subscribers, codexEvent({
      message: "The focused issue is explained.",
      phase: "final_answer"
    }));
    emitCodexNotification(subscribers, turnCompleted());
    await flushPromises();
    assert.equal(controller.hasActiveTemporaryConversation("session-1"), false);
  });
});

test("temporary conversation retries reuse the accepted provider turn", async () => {
  await withConversationController(async ({ calls, controller }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });
    const input = {
      conversationId: conversation.conversationId,
      ephemeral: true,
      message: "Explain this conflict.",
      messageId: "message_temporary_test"
    };

    const first = await controller.startConversationTurn("session-1", input);
    const retried = await controller.startConversationTurn("session-1", input);

    assert.equal(first.runId, "turn-1");
    assert.equal(retried.runId, "turn-1");
    assert.equal(retried.messageId, input.messageId);
    assert.equal(calls.filter(([kind]) => kind === "turn").length, 1);
  });
});

test("persistent conversations still resume their saved rollout before a turn", async () => {
  await withConversationController(async ({ calls, controller }) => {
    const conversation = await controller.createConversation("session-1");
    assert.equal(conversation.ok, true, JSON.stringify(conversation));

    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      message: "Continue."
    });

    assert.equal(turn.ok, true);
    assert.deepEqual(calls.filter(([kind]) => kind === "resume"), [
      ["resume", "conversation-1"]
    ]);
  });
});

test("temporary conversations expose live progress and final text without reading ephemeral history", async () => {
  await withConversationController(async ({ calls, controller, subscribers }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });
    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      message: "Explain this conflict."
    });

    emitCodexNotification(subscribers, codexEvent({
      message: "Inspecting the conflicting changes."
    }));
    const working = await controller.readConversation("session-1", {
      conversationId: conversation.conversationId,
      runId: turn.runId
    });
    assert.equal(working.status, "inProgress");
    assert.deepEqual(working.progressUpdates, [{
      id: "progress:1",
      text: "Inspecting the conflicting changes."
    }]);

    emitCodexNotification(subscribers, codexEvent({
      message: "The conflict is safe to resolve.",
      phase: "final_answer"
    }));
    emitCodexNotification(subscribers, turnCompleted());
    await flushPromises();

    const completed = await controller.readConversation("session-1", {
      conversationId: conversation.conversationId,
      runId: turn.runId
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.message, "The conflict is safe to resolve.");
    assert.equal(calls.filter(([kind]) => kind === "read").length, 0);
  });
});

test("temporary conversations expose the human message from structured progress", async () => {
  await withConversationController(async ({ controller, subscribers }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });
    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      message: "Resolve this conflict."
    });

    emitCodexNotification(subscribers, codexEvent({
      message: JSON.stringify({
        kind: "continue",
        message: "Comparing both intended changes.",
        report: ""
      })
    }));
    const working = await controller.readConversation("session-1", {
      conversationId: conversation.conversationId,
      runId: turn.runId
    });

    assert.deepEqual(working.progressUpdates, [{
      id: "progress:1",
      text: "Comparing both intended changes."
    }]);
  });
});

test("an expired temporary conversation never falls back to persistent thread history", async () => {
  await withConversationController(async ({ calls, controller }) => {
    const result = await controller.readConversation("session-1", {
      conversationId: "expired-temporary-conversation",
      ephemeral: true,
      runId: "expired-turn"
    });

    assert.equal(result.ok, true);
    assert.equal(result.conversationExpired, true);
    assert.equal(result.status, "failed");
    assert.equal(calls.filter(([kind]) => kind === "read").length, 0);
  });
});

test("temporary conversations accept the final answer after the completion notification", async () => {
  await withConversationController(async ({ controller, subscribers }) => {
    const conversation = await controller.createConversation("session-1", {
      ephemeral: true
    });
    const turn = await controller.startConversationTurn("session-1", {
      conversationId: conversation.conversationId,
      ephemeral: true,
      message: "Explain this conflict."
    });

    emitCodexNotification(subscribers, turnCompleted());
    emitCodexNotification(subscribers, codexEvent({
      message: "The answer arrived safely.",
      phase: "final_answer"
    }));
    await flushPromises();

    const completed = await controller.readConversation("session-1", {
      conversationId: conversation.conversationId,
      ephemeral: true,
      runId: turn.runId
    });
    assert.equal(completed.status, "completed");
    assert.equal(completed.message, "The answer arrived safely.");
  });
});

test("economy detached turns apply the resolved Luna-low profile and strict tool isolation", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectContextRoot,
    projectRuntimeRoot,
    session,
    subscribers
  }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const prompt = "Explain only this bounded source excerpt.";
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt,
      timeoutMs: 999_999
    });
    await waitForCapturedTurns(captures, 1);

    assert.equal(captures.providerOptions.length, 1);
    assert.equal(captures.providerOptions[0].executionMode, "economy");
    assert.equal(captures.providerOptions[0].runtimeInstanceId, "session-1:economy");
    assert.equal(captures.threads.length, 1);
    const threadSettings = captures.threads[0];
    assert.equal(threadSettings.allowProviderModelFallback, false);
    assert.equal(threadSettings.approvalPolicy, "never");
    assert.equal(threadSettings.model, "gpt-5.6-luna");
    assert.equal(threadSettings.sandbox, "read-only");
    assert.equal(threadSettings.threadSource, "vibe64-economy");
    assert.deepEqual(threadSettings.dynamicTools, []);
    assert.deepEqual(threadSettings.environments, []);
    assert.deepEqual(threadSettings.runtimeWorkspaceRoots, []);
    assert.deepEqual(threadSettings.selectedCapabilityRoots, []);
    assert.equal(threadSettings.config.model_reasoning_effort, "low");
    assert.equal(threadSettings.config.model_reasoning_summary, "none");
    assert.equal(threadSettings.config.features.shell_tool, false);
    assert.equal(threadSettings.config.features.plugins, false);
    assert.equal(threadSettings.config.features.apps, false);
    assert.equal(threadSettings.config.features.multi_agent, false);
    assert.equal(threadSettings.config.features.view_image, false);
    assert.deepEqual(threadSettings.config.mcp_servers, {
      "test.write-anywhere": {
        enabled: false
      }
    });
    assert.deepEqual(threadSettings.config.hooks, {
      state: {
        "test:write-hook": {
          enabled: false
        }
      }
    });
    assert.equal(captures.configReads.length, 2);
    assert.equal(captures.hookLists.length, 2);

    assert.equal(captures.turns[0].input, prompt);
    assert.deepEqual(captures.turns[0].settings, {
      approvalPolicy: "never",
      cwd: threadSettings.cwd,
      effort: "low",
      environments: [],
      model: "gpt-5.6-luna",
      outputSchema,
      runtimeWorkspaceRoots: [],
      sandboxPolicy: {
        networkAccess: false,
        type: "readOnly"
      },
      summary: "none"
    });

    emitCodexNotification(subscribers, turnTokenUsage({
      usage: {
        cachedInputTokens: 17,
        cacheWriteInputTokens: 3,
        inputTokens: 41,
        outputTokens: 11,
        reasoningOutputTokens: 5,
        totalTokens: 57
      }
    }));
    const rawText = JSON.stringify({ answer: "The source returns the active account." });
    completeDetachedTurn(subscribers, { text: rawText });
    const result = await pending;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.text, rawText);
    assert.equal(result.inputCharacters, prompt.length);
    assert.equal(result.outputCharacters, rawText.length);
    assert.deepEqual(result.usage, {
      cachedInputTokens: 17,
      cacheWriteInputTokens: 3,
      inputTokens: 41,
      outputTokens: 11,
      reasoningOutputTokens: 5,
      totalTokens: 57
    });
    const ownership = await createCodexEconomyThreadLedger({
      projectRuntimeRoot
    }).readAll();
    assert.equal(Object.hasOwn(session, "projectContextRoot"), false);
    assert.equal(ownership.records.length, 1);
    assert.equal(ownership.records[0].projectContextRoot, projectContextRoot);
  });
});

test("economy follow-ups resume only a controller-owned thread with the same profile", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create the first bounded explanation."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "First explanation." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));

    const followUpPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Answer one follow-up about that explanation.",
      threadId: first.threadId
    });
    await waitForCapturedTurns(captures, 2);

    assert.equal(captures.threads.length, 1);
    assert.equal(captures.resumes.length, 1);
    assert.equal(captures.resumes[0].threadId, first.threadId);
    assert.equal(captures.resumes[0].settings.model, "gpt-5.6-luna");
    assert.equal(captures.resumes[0].settings.sandbox, "read-only");
    assert.equal(captures.resumes[0].settings.config.model_reasoning_effort, "low");
    assert.equal(captures.resumes[0].settings.config.model_reasoning_summary, "none");
    assert.equal(captures.resumes[0].settings.config.features.shell_tool, false);
    assert.deepEqual(captures.resumes[0].settings.config.mcp_servers, {
      "test.write-anywhere": {
        enabled: false
      }
    });
    assert.equal(captures.configReads.length, 4);
    assert.equal(captures.hookLists.length, 4);

    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Follow-up explanation." }),
      turnId: "turn-2"
    });
    const followUp = await followUpPending;
    assert.equal(followUp.ok, true, JSON.stringify(followUp));
    assert.equal(followUp.threadId, first.threadId);

    const arbitrary = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Try an arbitrary thread.",
      threadId: "not-controller-owned"
    });
    assert.equal(arbitrary.ok, false);
    assert.equal(arbitrary.code, "vibe64_codex_economy_thread_unavailable");
    assert.equal(captures.resumes.length, 1);

    const drifted = await controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile({
        revision: "codex-economy-luna-low-v3"
      }),
      outputSchema,
      prompt: "Try profile drift.",
      threadId: first.threadId
    });
    assert.equal(drifted.ok, false);
    assert.equal(drifted.code, "vibe64_codex_economy_thread_unavailable");
    assert.equal(captures.resumes.length, 1);
  });
});

test("concurrent economy follow-ups admit exactly one turn for an owned thread", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const initialPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create one reusable economy thread."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Initial answer." })
    });
    const initial = await initialPending;
    assert.equal(initial.ok, true);

    const followUps = ["First concurrent follow-up.", "Second concurrent follow-up."].map(
      (prompt) => controller.runDetachedChatTurn("session-1", {
        executionProfile,
        outputSchema,
        prompt,
        threadId: initial.threadId
      })
    );
    await waitForCapturedTurns(captures, 2);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Only one follow-up was admitted." }),
      turnId: "turn-2"
    });
    const results = await Promise.all(followUps);
    assert.equal(results.filter(({ ok }) => ok === true).length, 1);
    assert.equal(results.filter(({ code }) => (
      code === "vibe64_codex_economy_thread_unavailable"
    )).length, 1);
    assert.equal(captures.resumes.length, 1);
  });
});

test("economy detached turns reject oversized raw output and retire the thread", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationEconomyProfile({
      limits: {
        maxOutputCharacters: 64
      }
    });
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(8),
      prompt: "Return one tiny explanation."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: "x".repeat(65)
    });
    const result = await pending;

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_agent_execution_profile_unbounded");
    assert.match(result.error, /exceeds the resolved output limit/u);
    assert.deepEqual(captures.deletes, ["conversation-1"]);

    const retired = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(8),
      prompt: "Do not revive the rejected thread.",
      threadId: "conversation-1"
    });
    assert.equal(retired.ok, false);
    assert.equal(retired.code, "vibe64_codex_economy_thread_unavailable");
    assert.equal(captures.resumes.length, 0);
  });
});

test("economy detached turn timeout is clamped to the resolved profile", {
  concurrency: false
}, async (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout"]
  });
  try {
    await withConversationController(async ({ captures, controller }) => {
      const pending = controller.runDetachedChatTurn("session-1", {
        executionProfile: sourceExplanationEconomyProfile({
          limits: {
            timeoutMs: 25
          }
        }),
        outputSchema: sourceExplanationOutputSchema(),
        prompt: "Time-bound this explanation.",
        timeoutMs: 10_000
      });
      void pending.catch(() => null);
      await waitForCapturedTurns(captures, 1);

      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      t.mock.timers.tick(24);
      await flushPromises();
      assert.equal(settled, false);

      t.mock.timers.tick(1);
      const result = await pending;
      assert.equal(result.ok, false);
      assert.match(result.error, /Timed out waiting for Codex app-server response/u);
      assert.deepEqual(captures.deletes, ["conversation-1"]);
    });
  } finally {
    t.mock.timers.reset();
  }
});

test("interactive detached turns retain their existing writable settings and response shape", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      prompt: "Discuss this source normally."
    });
    await waitForCapturedTurns(captures, 1);

    assert.equal(captures.threads.length, 1);
    assert.equal(captures.threads[0].sandbox, "danger-full-access");
    assert.equal("allowProviderModelFallback" in captures.threads[0], false);
    assert.equal("config" in captures.threads[0], false);
    assert.equal("dynamicTools" in captures.threads[0], false);
    assert.deepEqual(captures.turns[0].settings.sandboxPolicy, {
      networkAccess: "enabled",
      type: "externalSandbox"
    });
    assert.equal(captures.turns[0].settings.summary, "concise");
    assert.equal(captures.configReads.length, 0);
    assert.equal(captures.hookLists.length, 0);

    emitCodexNotification(subscribers, turnTokenUsage({
      usage: {
        inputTokens: 20,
        outputTokens: 4,
        totalTokens: 24
      }
    }));
    completeDetachedTurn(subscribers, {
      text: "The normal interactive response."
    });
    const result = await pending;

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.text, "The normal interactive response.");
    assert.equal("usage" in result, false);
    assert.equal("inputCharacters" in result, false);
    assert.equal("outputCharacters" in result, false);
    assert.deepEqual(captures.deletes, []);
  });
});

test("session shutdown interrupts and deletes an active economy thread before stopping its provider", async () => {
  await withConversationController(async ({
    calls,
    captures,
    controller,
    simulateControllerCrash,
    subscribers
  }) => {
    captures.interruptCompletesTurns = true;
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Keep this bounded turn active until shutdown."
    });
    await waitForCapturedTurns(captures, 1);
    await flushPromises();

    await controller.closeAllForSession("session-1");
    simulateControllerCrash();

    const interruptIndex = calls.findIndex(([operation]) => operation === "interrupt");
    const deleteIndex = calls.findIndex(([operation]) => operation === "delete");
    const stopIndex = calls.findIndex(([operation]) => operation === "stopRuntime");
    assert.ok(interruptIndex >= 0);
    assert.ok(deleteIndex > interruptIndex);
    assert.ok(stopIndex > deleteIndex);
    assert.deepEqual(captures.interrupts, [{
      threadId: "conversation-1",
      turnId: "turn-1"
    }]);
    assert.equal(captures.stopRuntimes, 1);

    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Shutdown completed." })
    });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_economy_thread_unavailable");
  });
});

test("ordinary project dormancy close preserves interactive session process-exit proof", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const catalog = await controller.executionProfileModelCatalog(session.sessionId);
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");
    captures.stopRuntimeResult = {
      processExitVerified: true,
      runtimeDirPreserved: true,
      stopped: true
    };

    await controller.closeAllForSession(session.sessionId, {
      preserveProcessExitProof: true
    });

    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, [{
      preserveProcessExitProof: true
    }]);
  });
});

test("ordinary runtime invalidation preserves interactive session process-exit proof", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const conversation = await controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));
    captures.stopRuntimeResult = {
      processExitVerified: true,
      runtimeDirPreserved: true,
      stopped: true
    };

    const invalidated = await controller.invalidateAppServerRuntimes({
      reason: "server-shutdown"
    });

    assert.equal(invalidated.ok, true, JSON.stringify(invalidated));
    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, [{
      preserveProcessExitProof: true
    }]);
  });
});

test("ordinary runtime invalidation stops cached runtimes concurrently and isolates failures", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const conversation = await controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));
    const catalog = await controller.executionProfileModelCatalog(session.sessionId);
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");

    const runtimeStopsHeld = createDeterministicHold();
    let bothRuntimeStopsStarted = () => null;
    const bothRuntimeStops = new Promise((resolve) => {
      bothRuntimeStopsStarted = resolve;
    });
    captures.onStopRuntime = () => {
      if (captures.stopRuntimes === 2) {
        bothRuntimeStopsStarted();
      }
    };
    captures.stopRuntimeWait = runtimeStopsHeld.wait;
    captures.stopRuntimeHandler = ({ providerOptions }) => {
      if (providerOptions.executionMode !== CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY) {
        const error = new Error("Interactive runtime stop failed.");
        error.code = "test_runtime_stop_failed";
        error.retryable = true;
        throw error;
      }
      return {
        processExitVerified: true,
        runtimeDirPreserved: false,
        stopped: true
      };
    };

    const invalidating = controller.invalidateAppServerRuntimes({
      reason: "server-shutdown"
    });
    await bothRuntimeStops;
    assert.equal(captures.stopRuntimes, 2);
    runtimeStopsHeld.release();

    const invalidated = await invalidating;
    assert.equal(invalidated.ok, false);
    assert.equal(invalidated.providerCount, 2);
    assert.equal(invalidated.stopped, 1);
    assert.equal(invalidated.results.length, 1);
    assert.deepEqual(invalidated.failed.map((failure) => ({
      code: failure.code,
      error: failure.error,
      retryable: failure.retryable
    })), [{
      code: "test_runtime_stop_failed",
      error: "Interactive runtime stop failed.",
      retryable: true
    }]);
    assert.deepEqual(captures.stopRuntimeProviderOptions.map((providerOptions, index) => ({
      executionMode: providerOptions.executionMode || CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
      preserveProcessExitProof: captures.stopRuntimeOptions[index].preserveProcessExitProof
    })).sort((left, right) => left.executionMode.localeCompare(right.executionMode)), [{
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.ECONOMY,
      preserveProcessExitProof: false
    }, {
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
      preserveProcessExitProof: true
    }, {
      executionMode: CODEX_APP_SERVER_EXECUTION_MODES.INTERACTIVE,
      preserveProcessExitProof: true
    }]);
  });
});

test("non-shutdown runtime invalidation keeps the controller reusable", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const first = await controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    assert.equal(first.ok, true, JSON.stringify(first));

    const invalidated = await controller.invalidateAppServerRuntimes({
      reason: "account-changed"
    });
    assert.equal(invalidated.ok, true, JSON.stringify(invalidated));
    assert.equal(captures.stopRuntimes, 1);

    const second = await controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(captures.providerOptions.length, 2);
  });
});

test("Codex runtime execution records carry the active project slug", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId }) => {
    const prepared = await runWithProjectRequestContext({
      slug: "assistant-project",
      targetRoot: runtime.projectContextRoot
    }, () => controller.ensureThread(sessionId));

    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.equal(captures.providerOptions[0].project.slug, "assistant-project");
  });
});

test("server shutdown stops a pruned owned runtime once across duplicate callers", async () => {
  await withAgentMessageController(async ({ captures, controller, runtime, sessionId }) => {
    const prepared = await runWithProjectRequestContext({
      targetRoot: runtime.projectContextRoot
    }, () => controller.ensureThread(sessionId));
    assert.equal(prepared.ok, true, JSON.stringify(prepared));
    assert.equal(captures.provider.closed, 0);

    const pruned = await controller.reconcileThreads([]);
    assert.equal(pruned.ok, true, JSON.stringify(pruned));
    assert.equal(captures.provider.closed, 1);
    assert.equal(captures.stopRuntimes, 0);

    const [first, second] = await Promise.all([
      controller.invalidateAppServerRuntimes({ reason: "server-shutdown" }),
      controller.invalidateAppServerRuntimes({ reason: "server-shutdown" })
    ]);

    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(second, first);
    assert.equal(first.providerCount, 1);
    assert.equal(first.stopped, 1);
    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, {
      preserveProcessExitProof: true
    });
  });
});

test("server shutdown stops a runtime to unblock acquisition and rejects later acquisition", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const acquisitionHeld = createDeterministicHold();
    captures.onEnsureAvailable = () => acquisitionHeld.enter();
    captures.ensureAvailableWait = acquisitionHeld.wait;
    captures.stopRuntimeHandler = () => {
      acquisitionHeld.release();
      if (captures.stopRuntimes === 1) {
        return {
          processExitVerified: false,
          runtimeDirPreserved: false,
          stopped: false
        };
      }
      return {
        processExitVerified: true,
        runtimeDirPreserved: true,
        stopped: true
      };
    };

    const acquiring = controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    await acquisitionHeld.entered;
    const firstShutdown = controller.invalidateAppServerRuntimes({
      reason: "server-shutdown"
    });
    const duplicateShutdown = controller.invalidateAppServerRuntimes({
      reason: "server-shutdown"
    });
    const rejectedAcquisition = controller.createConversation(session.sessionId, {
      ephemeral: true
    });

    const [acquired, rejected, first, duplicate] = await Promise.all([
      acquiring,
      rejectedAcquisition,
      firstShutdown,
      duplicateShutdown
    ]);
    assert.equal(acquired.ok, false);
    assert.equal(acquired.code, "vibe64_server_stopping");
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "vibe64_server_stopping");
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(duplicate, first);
    assert.equal(captures.stopRuntimes, 2);
  });
});

test("server shutdown serializes with an owned runtime before metadata is published", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux process identity is required.");
    return;
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-owned-runtime-race-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = `shutdown-race-${randomUUID()}`;
  const sourcePath = path.join(
    temporaryRoot,
    "managed",
    "sessions",
    "active",
    "owned-runtime-race-session",
    "source"
  );
  const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
  await Promise.all([
    mkdir(sourcePath, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true })
  ]);
  const session = {
    metadata: {
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    sessionId: "owned-runtime-race-session"
  };
  const preMetadata = createDeterministicHold();
  let child = null;
  let runtimeDir = "";
  let stopRuntimeCalls = 0;
  const controller = createCodexTerminalController({
    codexAppServerProviderFactory(providerOptions) {
      runtimeDir = providerOptions.runtimeDir;
      return {
        close() {},
        async ensureAvailable() {
          const lockDir = path.join(runtimeDir, "runtime.lock");
          await mkdir(lockDir, { recursive: true });
          await writeFile(path.join(lockDir, "owner.json"), `${JSON.stringify({
            createdAt: new Date().toISOString(),
            pid: process.pid
          })}\n`);
          const runtimeToken = randomUUID();
          const commandHash = randomUUID().replaceAll("-", "").slice(0, 12);
          child = spawn(process.execPath, [
            "-e",
            "setInterval(() => {}, 1000);"
          ], {
            detached: true,
            env: {
              ...process.env,
              VIBE64_CODEX_APP_SERVER_COMMAND_HASH: commandHash,
              VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: runtimeToken
            },
            stdio: "ignore"
          });
          child.unref();
          const processIdentity = await exactProcessIdentity(
            child.pid,
            runtimeToken,
            commandHash
          );
          preMetadata.enter();
          await preMetadata.wait;
          await writeFile(path.join(runtimeDir, "runtime.json"), `${JSON.stringify({
            ...exactStoppedRuntimeMetadata(runtimeDir),
            pid: child.pid,
            processIdentity
          })}\n`);
          await rm(lockDir, { force: true, recursive: true });
        },
        async startThread() {
          return { id: "owned-runtime-race-conversation" };
        },
        async stopRuntime(options = {}) {
          stopRuntimeCalls += 1;
          const stopping = stopCodexAppServerRuntime({
            ...options,
            runtimeDir
          });
          await flushPromises();
          preMetadata.release();
          return stopping;
        }
      };
    },
    env: {
      VIBE64_AGENT_RUNTIME_DIR: path.join(temporaryRoot, "agent-runtimes"),
      VIBE64_RUNTIME_NAMESPACE: process.env.VIBE64_RUNTIME_NAMESPACE,
      VIBE64_WORKSPACE: "test"
    },
    projectService: {
      createRuntime() {
        return {
          async getSession() {
            return session;
          },
          projectContextRoot: temporaryRoot,
          stateRoot: projectRuntimeRoot
        };
      },
      async projectExecutionEnvironment() {
        return {
          VIBE64_RUNTIME_NAMESPACE: process.env.VIBE64_RUNTIME_NAMESPACE,
          VIBE64_WORKSPACE: "test"
        };
      },
      async readProjectAiPolicy() {
        return { ok: true };
      }
    }
  });

  try {
    const acquiring = controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    await preMetadata.entered;
    assert.ok(child?.pid > 1);
    assert.doesNotThrow(() => process.kill(-child.pid, 0));

    const shutdown = await controller.invalidateAppServerRuntimes({
      reason: "server-shutdown"
    });
    const acquired = await acquiring;
    assert.equal(acquired.ok, false);
    assert.equal(acquired.code, "vibe64_server_stopping");
    assert.equal(shutdown.ok, true, JSON.stringify(shutdown));
    assert.equal(shutdown.providerCount, 1);
    assert.equal(shutdown.stopped, 1);
    assert.equal(stopRuntimeCalls, 1);
    assert.throws(() => process.kill(-child.pid, 0), { code: "ESRCH" });
  } finally {
    preMetadata.release();
    if (runtimeDir) {
      await rm(path.join(runtimeDir, "runtime.lock"), { force: true, recursive: true });
      await stopCodexAppServerRuntime({ runtimeDir }).catch(() => null);
    }
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The verified shutdown path normally stops the exact process group.
      }
    }
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("server shutdown proves exit of the exact owned detached runtime", async (t) => {
  if (process.platform !== "linux") {
    t.skip("Linux process identity is required.");
    return;
  }
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-owned-runtime-shutdown-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = `shutdown-${randomUUID()}`;
  const sourcePath = path.join(
    temporaryRoot,
    "managed",
    "sessions",
    "active",
    "owned-runtime-session",
    "source"
  );
  const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
  await Promise.all([
    mkdir(sourcePath, { recursive: true }),
    mkdir(projectRuntimeRoot, { recursive: true })
  ]);
  const session = {
    metadata: {
      repository_mode: "local_source",
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    sessionId: "owned-runtime-session"
  };
  let child = null;
  let runtimeDir = "";
  const controller = createCodexTerminalController({
    codexAppServerProviderFactory(providerOptions) {
      runtimeDir = providerOptions.runtimeDir;
      return {
        close() {},
        async ensureAvailable() {
          await mkdir(runtimeDir, { recursive: true });
          const runtimeToken = randomUUID();
          const commandHash = randomUUID().replaceAll("-", "").slice(0, 12);
          child = spawn(process.execPath, [
            "-e",
            "setInterval(() => {}, 1000);"
          ], {
            detached: true,
            env: {
              ...process.env,
              VIBE64_CODEX_APP_SERVER_COMMAND_HASH: commandHash,
              VIBE64_CODEX_APP_SERVER_RUNTIME_TOKEN: runtimeToken
            },
            stdio: "ignore"
          });
          child.unref();
          await writeFile(path.join(runtimeDir, "runtime.json"), `${JSON.stringify({
            ...exactStoppedRuntimeMetadata(runtimeDir),
            pid: child.pid,
            processIdentity: await exactProcessIdentity(child.pid, runtimeToken, commandHash)
          })}\n`);
        },
        async startThread() {
          return { id: "owned-runtime-conversation" };
        },
        stopRuntime(options = {}) {
          return stopCodexAppServerRuntime({
            ...options,
            runtimeDir
          });
        }
      };
    },
    env: {
      VIBE64_AGENT_RUNTIME_DIR: path.join(temporaryRoot, "agent-runtimes"),
      VIBE64_RUNTIME_NAMESPACE: process.env.VIBE64_RUNTIME_NAMESPACE,
      VIBE64_WORKSPACE: "test"
    },
    projectService: {
      createRuntime() {
        return {
          async getSession() {
            return session;
          },
          projectContextRoot: temporaryRoot,
          stateRoot: projectRuntimeRoot
        };
      },
      async projectExecutionEnvironment() {
        return {
          VIBE64_RUNTIME_NAMESPACE: process.env.VIBE64_RUNTIME_NAMESPACE,
          VIBE64_WORKSPACE: "test"
        };
      },
      async readProjectAiPolicy() {
        return { ok: true };
      }
    }
  });

  try {
    const conversation = await controller.createConversation(session.sessionId, {
      ephemeral: true
    });
    assert.equal(conversation.ok, true, JSON.stringify(conversation));
    assert.ok(child?.pid > 1);
    assert.doesNotThrow(() => process.kill(-child.pid, 0));

    const shutdown = await controller.invalidateAppServerRuntimes({
      reason: "server-shutdown"
    });
    assert.equal(shutdown.ok, true, JSON.stringify(shutdown));
    assert.equal(shutdown.providerCount, 1);
    assert.equal(shutdown.stopped, 1);
    assert.throws(() => process.kill(-child.pid, 0), { code: "ESRCH" });
  } finally {
    if (runtimeDir) {
      await stopCodexAppServerRuntime({ runtimeDir }).catch(() => null);
    }
    if (child?.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // The verified shutdown path normally stops the exact process group.
      }
    }
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});

test("same raw session closes remain isolated across project request contexts", async () => {
  await withConversationController(async ({
    controller,
    projectService,
    simulateControllerCrash,
    temporaryRoot
  }) => {
    const sessionId = "shared-session";
    const alpha = await managedProjectScopedSessionFixture(
      temporaryRoot,
      "alpha",
      sessionId
    );
    const beta = await managedProjectScopedSessionFixture(
      temporaryRoot,
      "beta",
      sessionId
    );
    const fixtures = new Map([
      [alpha.context.slug, alpha],
      [beta.context.slug, beta]
    ]);
    const reads = { alpha: 0, beta: 0 };
    const holds = { alpha: null, beta: null };
    for (const fixture of fixtures.values()) {
      fixture.runtime.getSession = async () => {
        const slug = fixture.context.slug;
        reads[slug] += 1;
        const hold = holds[slug];
        if (hold) {
          holds[slug] = null;
          hold.enter();
          await hold.wait;
        }
        return fixture.session;
      };
    }
    projectService.createRuntime = () => {
      const slug = currentProjectRequestContext()?.slug;
      const fixture = fixtures.get(slug);
      assert.ok(fixture, `Missing scoped fixture for ${slug || "no project"}.`);
      return fixture.runtime;
    };
    projectService.createSessionStore = () => {
      const slug = currentProjectRequestContext()?.slug;
      return fixtures.get(slug)?.store;
    };

    const alphaHold = createDeterministicHold();
    holds.alpha = alphaHold;
    const alphaClose = runWithProjectRequestContext(
      alpha.context,
      () => controller.closeAllForSession(sessionId)
    );
    await alphaHold.entered;

    await runWithProjectRequestContext(
      beta.context,
      () => controller.closeAllForSession(sessionId)
    );
    assert.equal(reads.alpha, 1);
    assert.ok(reads.beta > 0);

    const alphaReadsBeforeDuplicate = reads.alpha;
    const duplicateAlphaClose = runWithProjectRequestContext(
      alpha.context,
      () => controller.closeAllForSession(sessionId)
    );
    await flushPromises();
    assert.equal(reads.alpha, alphaReadsBeforeDuplicate);

    const betaHold = createDeterministicHold();
    holds.beta = betaHold;
    const secondBetaClose = runWithProjectRequestContext(
      beta.context,
      () => controller.closeAllForSession(sessionId)
    );
    await betaHold.entered;

    alphaHold.release();
    await Promise.all([alphaClose, duplicateAlphaClose]);

    const betaReadsBeforeDuplicate = reads.beta;
    const duplicateBetaClose = runWithProjectRequestContext(
      beta.context,
      () => controller.closeAllForSession(sessionId)
    );
    await flushPromises();
    assert.equal(reads.beta, betaReadsBeforeDuplicate);

    betaHold.release();
    await Promise.all([secondBetaClose, duplicateBetaClose]);
    simulateControllerCrash();
  });
});

test("same raw session delivery admission remains independent across project request contexts", {
  timeout: 3_000
}, async () => {
  await withConversationController(async ({
    controller,
    projectService,
    simulateControllerCrash,
    temporaryRoot
  }) => {
    const sessionId = "shared-session";
    const alpha = await managedProjectScopedSessionFixture(temporaryRoot, "alpha", sessionId);
    const beta = await managedProjectScopedSessionFixture(temporaryRoot, "beta", sessionId);
    const fixtures = new Map([
      [alpha.context.slug, alpha],
      [beta.context.slug, beta]
    ]);
    const holds = { alpha: null, beta: null };
    for (const fixture of fixtures.values()) {
      const readSession = fixture.runtime.getSession.bind(fixture.runtime);
      fixture.runtime.getSession = async () => {
        const slug = fixture.context.slug;
        const hold = holds[slug];
        if (hold) {
          holds[slug] = null;
          hold.enter();
          await hold.wait;
        }
        return readSession();
      };
    }
    projectService.createRuntime = () => {
      const fixture = fixtures.get(currentProjectRequestContext()?.slug);
      assert.ok(fixture);
      return fixture.runtime;
    };
    projectService.createSessionStore = () => {
      return fixtures.get(currentProjectRequestContext()?.slug)?.store;
    };

    const alphaMessageHold = createDeterministicHold();
    holds.alpha = alphaMessageHold;
    const alphaMessage = runWithProjectRequestContext(alpha.context, () => (
      controller.sendMessage(sessionId, {
        message: "Start alpha independently.",
        messageId: "same-message"
      })
    ));
    await alphaMessageHold.entered;
    const betaMessageHold = createDeterministicHold();
    holds.beta = betaMessageHold;
    const betaMessage = runWithProjectRequestContext(beta.context, () => (
      controller.sendMessage(sessionId, {
        message: "Start beta independently.",
        messageId: "same-message"
      })
    ));
    await betaMessageHold.entered;
    alphaMessageHold.release();
    betaMessageHold.release();
    assert.equal((await alphaMessage).ok, true);
    assert.equal((await betaMessage).ok, true);

    const alphaConversation = await runWithProjectRequestContext(
      alpha.context,
      () => controller.createConversation(sessionId, { ephemeral: true })
    );
    const betaConversation = await runWithProjectRequestContext(
      beta.context,
      () => controller.createConversation(sessionId, { ephemeral: true })
    );
    assert.equal(alphaConversation.conversationId, betaConversation.conversationId);

    const alphaTurnHold = createDeterministicHold();
    holds.alpha = alphaTurnHold;
    const alphaTurn = runWithProjectRequestContext(alpha.context, () => (
      controller.startConversationTurn(sessionId, {
        conversationId: alphaConversation.conversationId,
        ephemeral: true,
        message: "Run alpha Temporary AI independently.",
        messageId: "same-temporary-message"
      })
    ));
    await alphaTurnHold.entered;
    const betaTurnHold = createDeterministicHold();
    holds.beta = betaTurnHold;
    const betaTurn = runWithProjectRequestContext(beta.context, () => (
      controller.startConversationTurn(sessionId, {
        conversationId: betaConversation.conversationId,
        ephemeral: true,
        message: "Run beta Temporary AI independently.",
        messageId: "same-temporary-message"
      })
    ));
    await betaTurnHold.entered;
    alphaTurnHold.release();
    betaTurnHold.release();
    assert.equal((await alphaTurn).ok, true);
    assert.equal((await betaTurn).ok, true);
    await Promise.all([
      runWithProjectRequestContext(alpha.context, async () => {
        await controller.stopConversation(sessionId, {
          conversationId: alphaConversation.conversationId,
          ephemeral: true,
          runId: (await alphaTurn).runId
        });
        await controller.deleteConversation(sessionId, {
          conversationId: alphaConversation.conversationId,
          ephemeral: true
        });
      }),
      runWithProjectRequestContext(beta.context, async () => {
        await controller.stopConversation(sessionId, {
          conversationId: betaConversation.conversationId,
          ephemeral: true,
          runId: (await betaTurn).runId
        });
        await controller.deleteConversation(sessionId, {
          conversationId: betaConversation.conversationId,
          ephemeral: true
        });
      })
    ]);
    simulateControllerCrash();
  });
});

test("renewal cleanup cannot observe or delete another project's Temporary AI state", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectService,
    simulateControllerCrash,
    temporaryRoot
  }) => {
    const sessionId = "shared-session";
    const alpha = await managedProjectScopedSessionFixture(
      temporaryRoot,
      "alpha",
      sessionId
    );
    const beta = await managedProjectScopedSessionFixture(
      temporaryRoot,
      "beta",
      sessionId
    );
    const fixtures = new Map([
      [alpha.context.slug, alpha],
      [beta.context.slug, beta]
    ]);
    projectService.createRuntime = () => {
      const slug = currentProjectRequestContext()?.slug;
      const fixture = fixtures.get(slug);
      assert.ok(fixture, `Missing scoped fixture for ${slug || "no project"}.`);
      return fixture.runtime;
    };
    projectService.createSessionStore = () => {
      const slug = currentProjectRequestContext()?.slug;
      return fixtures.get(slug)?.store;
    };

    const alphaConversation = await runWithProjectRequestContext(
      alpha.context,
      () => controller.createConversation(sessionId, { ephemeral: true })
    );
    const betaConversation = await runWithProjectRequestContext(
      beta.context,
      () => controller.createConversation(sessionId, { ephemeral: true })
    );
    assert.equal(alphaConversation.conversationId, betaConversation.conversationId);

    const betaTurn = await runWithProjectRequestContext(
      beta.context,
      () => controller.startConversationTurn(sessionId, {
        conversationId: betaConversation.conversationId,
        ephemeral: true,
        message: "Keep beta Temporary AI active during alpha renewal cleanup."
      })
    );
    assert.equal(betaTurn.ok, true, JSON.stringify(betaTurn));
    assert.equal(await runWithProjectRequestContext(
      alpha.context,
      () => controller.hasActiveTemporaryConversation(sessionId)
    ), false);
    assert.equal(await runWithProjectRequestContext(
      beta.context,
      () => controller.hasActiveTemporaryConversation(sessionId)
    ), true);

    captures.stopRuntimeResult = {
      processExitVerified: true,
      runtimeDirPreserved: true,
      stopped: true
    };
    await runWithProjectRequestContext(alpha.context, () => (
      controller.closeAllForSession(sessionId, {
        renewalCleanup: {
          kind: "predecessor",
          renewalId: "alpha-renewal",
          sourceSessionId: sessionId
        },
        runtime: alpha.runtime,
        session: alpha.session
      })
    ));
    assert.equal(captures.stopRuntimeProviderOptions.length, 1);
    assert.equal(
      captures.stopRuntimeProviderOptions[0].executionRoot,
      alpha.session.metadata.source_path
    );

    const alphaAfterCleanup = await runWithProjectRequestContext(
      alpha.context,
      () => controller.readConversation(sessionId, {
        conversationId: alphaConversation.conversationId,
        ephemeral: true
      })
    );
    const betaAfterCleanup = await runWithProjectRequestContext(
      beta.context,
      () => controller.readConversation(sessionId, {
        conversationId: betaConversation.conversationId,
        ephemeral: true
      })
    );
    assert.equal(alphaAfterCleanup.conversationExpired, true);
    assert.equal(betaAfterCleanup.conversationExpired, undefined);
    assert.equal(betaAfterCleanup.status, "inProgress");
    assert.equal(await runWithProjectRequestContext(
      beta.context,
      () => controller.hasActiveTemporaryConversation(sessionId)
    ), true);

    await runWithProjectRequestContext(
      beta.context,
      () => controller.stopConversation(sessionId, {
        conversationId: betaConversation.conversationId,
        ephemeral: true,
        runId: betaTurn.runId
      })
    );
    await runWithProjectRequestContext(
      beta.context,
      () => controller.deleteConversation(sessionId, {
        conversationId: betaConversation.conversationId,
        ephemeral: true
      })
    );
    simulateControllerCrash();
  });
});

test("renewal cleanup cannot drain another project's notification queue", {
  timeout: 3_000
}, async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectService,
    simulateControllerCrash,
    subscribers,
    temporaryRoot
  }) => {
    const sessionId = "shared-session";
    const alpha = await managedProjectScopedSessionFixture(temporaryRoot, "alpha", sessionId);
    const beta = await managedProjectScopedSessionFixture(temporaryRoot, "beta", sessionId);
    const fixtures = new Map([
      [alpha.context.slug, alpha],
      [beta.context.slug, beta]
    ]);
    const originalCreateRuntime = projectService.createRuntime.bind(projectService);
    projectService.createRuntime = () => {
      const fixture = fixtures.get(currentProjectRequestContext()?.slug);
      return fixture?.runtime || originalCreateRuntime();
    };
    projectService.createSessionStore = () => {
      return fixtures.get(currentProjectRequestContext()?.slug)?.store;
    };

    const betaMessage = await runWithProjectRequestContext(beta.context, () => (
      controller.sendMessage(sessionId, {
        message: "Keep beta active while alpha renews.",
        messageId: "beta-notification-owner"
      })
    ));
    assert.equal(betaMessage.ok, true, JSON.stringify(betaMessage));
    const betaSession = await beta.store.readSession(sessionId);
    const betaRun = betaSession.agentRuns.find(({ id }) => id === "codex_app_server");
    const betaThreadId = betaSession.metadata.agent_identity_conversation_id;
    const betaTurnId = betaRun?.providerTurnId;
    assert.ok(betaThreadId);
    assert.ok(betaTurnId);
    assert.ok(subscribers.size > 0);

    const notificationHold = createDeterministicHold();
    const betaNotificationStore = new Proxy(beta.store, {
      get(target, property) {
        if (property === "mutateSession") {
          return async (...args) => {
            notificationHold.enter();
            await notificationHold.wait;
            return target.mutateSession(...args);
          };
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    projectService.createSessionStore = () => {
      const slug = currentProjectRequestContext()?.slug;
      return slug === "beta" ? betaNotificationStore : fixtures.get(slug)?.store;
    };
    await runWithProjectRequestContext(beta.context, async () => {
      emitCodexNotification(subscribers, {
        method: "thread/tokenUsage/updated",
        params: {
          threadId: betaThreadId,
          tokenUsage: {
            last: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15
            },
            modelContextWindow: 100,
            total: { totalTokens: 15 }
          },
          turnId: betaTurnId
        }
      });
    });
    await notificationHold.entered;

    await runWithProjectRequestContext(
      alpha.context,
      () => controller.createConversation(sessionId, { ephemeral: true })
    );
    captures.stopRuntimeResult = {
      processExitVerified: true,
      runtimeDirPreserved: true,
      stopped: true
    };
    await runWithProjectRequestContext(alpha.context, () => (
      controller.closeAllForSession(sessionId, {
        renewalCleanup: {
          kind: "predecessor",
          renewalId: "alpha-notification-renewal",
          sourceSessionId: sessionId
        },
        runtime: alpha.runtime,
        session: alpha.session
      })
    ));

    notificationHold.release();
    await runWithProjectRequestContext(
      beta.context,
      () => controller.closeAllForSession(sessionId)
    );
    simulateControllerCrash();
  });
});

test("renewal cleanup cannot cancel another project's finalizing recovery timer", {
  concurrency: false,
  timeout: 3_000
}, async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  try {
    await withConversationController(async ({
      calls,
      captures,
      controller,
      projectService,
      simulateControllerCrash,
      subscribers,
      temporaryRoot
    }) => {
      const sessionId = "shared-session";
      const alpha = await managedProjectScopedSessionFixture(temporaryRoot, "alpha", sessionId);
      const beta = await managedProjectScopedSessionFixture(temporaryRoot, "beta", sessionId);
      const fixtures = new Map([
        [alpha.context.slug, alpha],
        [beta.context.slug, beta]
      ]);
      const originalCreateRuntime = projectService.createRuntime.bind(projectService);
      projectService.createRuntime = () => {
        const fixture = fixtures.get(currentProjectRequestContext()?.slug);
        return fixture?.runtime || originalCreateRuntime();
      };
      projectService.createSessionStore = () => {
        return fixtures.get(currentProjectRequestContext()?.slug)?.store;
      };

      const betaMessage = await runWithProjectRequestContext(beta.context, () => (
        controller.sendMessage(sessionId, {
          message: "Wait for beta finalization recovery.",
          messageId: "beta-finalizing-owner"
        })
      ));
      assert.equal(betaMessage.ok, true, JSON.stringify(betaMessage));
      const startedBeta = await beta.store.readSession(sessionId);
      const startedRun = startedBeta.agentRuns.find(({ id }) => id === "codex_app_server");
      const betaThreadId = startedBeta.metadata.agent_identity_conversation_id;
      const betaTurnId = startedRun?.providerTurnId;
      await runWithProjectRequestContext(beta.context, async () => {
        emitCodexNotification(subscribers, turnCompleted({
          threadId: betaThreadId,
          turnId: betaTurnId
        }));
      });
      let finalizingRun = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await flushPromises();
        const current = await beta.store.readSession(sessionId);
        finalizingRun = current.agentRuns.find(({ id }) => id === "codex_app_server");
        if (finalizingRun?.state === VIBE64_AGENT_RUN_STATE.FINALIZING) {
          break;
        }
      }
      assert.equal(finalizingRun?.state, VIBE64_AGENT_RUN_STATE.FINALIZING);

      const notificationHold = createDeterministicHold();
      const betaNotificationStore = new Proxy(beta.store, {
        get(target, property) {
          if (property === "mutateSession") {
            return async (...args) => {
              notificationHold.enter();
              await notificationHold.wait;
              return target.mutateSession(...args);
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
      });
      projectService.createSessionStore = () => {
        const slug = currentProjectRequestContext()?.slug;
        return slug === "beta" ? betaNotificationStore : fixtures.get(slug)?.store;
      };
      await runWithProjectRequestContext(beta.context, async () => {
        emitCodexNotification(subscribers, {
          method: "thread/tokenUsage/updated",
          params: {
            threadId: betaThreadId,
            tokenUsage: {
              last: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15
              },
              modelContextWindow: 100,
              total: { totalTokens: 15 }
            },
            turnId: betaTurnId
          }
        });
      });
      await notificationHold.entered;

      await runWithProjectRequestContext(
        alpha.context,
        () => controller.createConversation(sessionId, { ephemeral: true })
      );
      captures.stopRuntimeResult = {
        processExitVerified: true,
        runtimeDirPreserved: true,
        stopped: true
      };
      await runWithProjectRequestContext(alpha.context, () => (
        controller.closeAllForSession(sessionId, {
          renewalCleanup: {
            kind: "predecessor",
            renewalId: "alpha-finalizing-renewal",
            sourceSessionId: sessionId
          },
          runtime: alpha.runtime,
          session: alpha.session
        })
      ));

      const readsBeforeRecovery = calls.filter(([operation]) => operation === "read").length;
      const recoveryRead = new Promise((resolve) => {
        captures.onReadThread = resolve;
      });
      t.mock.timers.tick(10_001);
      await recoveryRead;
      captures.onReadThread = null;
      assert.ok(
        calls.filter(([operation]) => operation === "read").length > readsBeforeRecovery
      );
      notificationHold.release();
      await runWithProjectRequestContext(
        beta.context,
        () => controller.closeAllForSession(sessionId)
      );
      simulateControllerCrash();
    });
  } finally {
    t.mock.timers.reset();
  }
});

test("hidden renewal successor shutdown requires its exact explicit cleanup context", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectService,
    session,
    simulateControllerCrash
  }) => {
    const catalog = await controller.executionProfileModelCatalog(session.sessionId);
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");
    simulateControllerCrash();
    const renewalId = "renewal-cleanup-1";
    const hiddenSession = {
      ...session,
      metadata: {
        ...session.metadata,
        renewal_id: renewalId,
        renewed_from: "source-session"
      },
      status: VIBE64_SESSION_STATUS.RENEWAL_PENDING
    };
    const ordinaryRuntime = projectService.createRuntime();
    let ordinaryReads = 0;
    const hiddenRuntime = {
      ...ordinaryRuntime,
      async getSession() {
        ordinaryReads += 1;
        const error = new Error("Private renewal session");
        error.code = "vibe64_session_renewal_private";
        throw error;
      }
    };
    projectService.createRuntime = () => hiddenRuntime;

    await assert.rejects(
      () => controller.closeAllForSession(hiddenSession.sessionId),
      { code: "vibe64_session_renewal_private" }
    );
    await assert.rejects(
      () => controller.closeAllForSession(hiddenSession.sessionId, {
        renewalCleanup: {
          kind: "successor",
          renewalId: "wrong-renewal",
          sourceSessionId: "source-session"
        },
        runtime: hiddenRuntime,
        session: hiddenSession
      }),
      TypeError
    );
    assert.equal(ordinaryReads, 1);

    let releaseStopRuntime = () => null;
    const stopRuntimeStarted = new Promise((resolve) => {
      captures.onStopRuntime = resolve;
    });
    captures.stopRuntimeWait = new Promise((resolve) => {
      releaseStopRuntime = resolve;
    });
    const hiddenClose = controller.closeAllForSession(hiddenSession.sessionId, {
      renewalCleanup: {
        kind: "successor",
        renewalId,
        sourceSessionId: "source-session"
      },
      runtime: hiddenRuntime,
      session: hiddenSession
    });
    await stopRuntimeStarted;
    await assert.rejects(
      () => controller.closeAllForSession(hiddenSession.sessionId),
      { code: "vibe64_session_renewal_private" }
    );
    releaseStopRuntime();
    await hiddenClose;
    assert.equal(ordinaryReads, 2);
  });
});

test("renewal predecessor cleanup fails closed when a cached Codex process does not confirm exit", async () => {
  await withConversationController(async ({ captures, controller, projectService, session }) => {
    const catalog = await controller.executionProfileModelCatalog(session.sessionId);
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");
    captures.stopRuntimeResult = { stopped: false };
    const renewalId = "renewal-predecessor-unverified-cache";
    const runtime = projectService.createRuntime();
    const activeSession = {
      ...session,
      status: VIBE64_SESSION_STATUS.ACTIVE
    };

    await assert.rejects(
      () => controller.closeAllForSession(session.sessionId, {
        renewalCleanup: {
          kind: "predecessor",
          renewalId,
          sourceSessionId: session.sessionId
        },
        runtime,
        session: activeSession
      }),
      { code: "vibe64_session_renewal_process_exit_unverified" }
    );
    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, [{
      preserveProcessExitProof: true
    }]);
  });
});

test("renewal predecessor cleanup accepts exact preserved process-exit proof", async () => {
  await withConversationController(async ({ captures, controller, projectService, session }) => {
    const catalog = await controller.executionProfileModelCatalog(session.sessionId);
    assert.equal(catalog.data[0].model, "gpt-5.6-luna");
    captures.stopRuntimeResult = {
      processExitVerified: true,
      runtimeDirPreserved: true,
      stopped: false
    };
    const renewalId = "renewal-predecessor-preserved-proof";
    const runtime = projectService.createRuntime();

    await controller.closeAllForSession(session.sessionId, {
      renewalCleanup: {
        kind: "predecessor",
        renewalId,
        sourceSessionId: session.sessionId
      },
      runtime,
      session: {
        ...session,
        status: VIBE64_SESSION_STATUS.ACTIVE
      }
    });

    assert.equal(captures.stopRuntimes, 1);
    assert.deepEqual(captures.stopRuntimeOptions, [{
      preserveProcessExitProof: true
    }]);
  });
});

test("renewal predecessor cleanup does not treat an already-missing runtime directory as exit proof", async () => {
  await withConversationController(async ({ captures, controller, projectService, session, temporaryRoot }) => {
    const activeSession = {
      ...session,
      metadata: {
        ...session.metadata,
        agent_transport_runtime_dir: path.join(temporaryRoot, "missing-codex-runtime")
      },
      status: VIBE64_SESSION_STATUS.ACTIVE
    };
    const renewalId = "renewal-predecessor-missing-runtime";
    const runtime = projectService.createRuntime();

    await assert.rejects(
      () => controller.closeAllForSession(session.sessionId, {
        renewalCleanup: {
          kind: "predecessor",
          renewalId,
          sourceSessionId: session.sessionId
        },
        runtime,
        session: activeSession
      }),
      { code: "vibe64_session_renewal_process_exit_unverified" }
    );
    assert.equal(captures.providerOptions.length, 0);
  });
});

test("archived renewal predecessor releases preserved runtime proof idempotently", async () => {
  await withConversationController(async ({ controller, projectService, session, temporaryRoot }) => {
    const renewalId = "renewal-predecessor-proof-release";
    const runtimeDir = path.join(temporaryRoot, "codex-app-server-renewal-proof");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      path.join(runtimeDir, "runtime.json"),
      `${JSON.stringify(exactStoppedRuntimeMetadata(runtimeDir, { stopped: true }))}\n`
    );
    const archivedSession = {
      ...session,
      archived: true,
      metadata: {
        ...session.metadata,
        agent_transport_runtime_dir: runtimeDir,
        renewal_id: renewalId,
        renewed_to: "renewal-successor"
      },
      status: VIBE64_SESSION_STATUS.ABANDONED
    };
    const runtime = projectService.createRuntime();

    const released = await controller.releaseRenewalPredecessorProcessExitProof(
      session.sessionId,
      {
        renewalId,
        runtime,
        session: archivedSession
      }
    );
    assert.equal(released.released, true);
    assert.equal(released.alreadyReleased, false);
    assert.equal(released.runtimeDirRemoved, true);

    const retried = await controller.releaseRenewalPredecessorProcessExitProof(
      session.sessionId,
      {
        renewalId,
        runtime,
        session: archivedSession
      }
    );
    assert.equal(retried.released, true);
    assert.equal(retried.alreadyReleased, true);

    await assert.rejects(
      () => controller.releaseRenewalPredecessorProcessExitProof(
        session.sessionId,
        {
          renewalId,
          runtime,
          session: {
            ...archivedSession,
            archived: false,
            status: VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
          }
        }
      ),
      TypeError
    );
  });
});

test("authorized renewal successor releases preserved runtime proof idempotently", async () => {
  await withConversationController(async ({ controller, projectService, session, temporaryRoot }) => {
    const renewalId = "renewal-successor-proof-release";
    const sourceSessionId = "source-session";
    const runtimeDir = path.join(temporaryRoot, "codex-app-server-successor-renewal-proof");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      path.join(runtimeDir, "runtime.json"),
      `${JSON.stringify(exactStoppedRuntimeMetadata(runtimeDir, { stopped: true }))}\n`
    );
    const successor = {
      ...session,
      metadata: {
        ...session.metadata,
        agent_transport_runtime_dir: runtimeDir,
        renewal_id: renewalId,
        renewed_from: sourceSessionId
      },
      status: VIBE64_SESSION_STATUS.RENEWAL_PENDING
    };
    const authorization = {
      authorizedAt: "2026-08-25T00:00:00.000Z",
      kind: "vibe64.session_renewal_successor_process_exit_proof_release",
      renewalId,
      runtimeDir,
      schemaVersion: 1,
      sourceSessionId,
      successorSessionId: session.sessionId
    };
    const runtime = projectService.createRuntime();

    await assert.rejects(
      () => controller.releaseRenewalSuccessorProcessExitProof(
        session.sessionId,
        {
          authorization: {
            ...authorization,
            runtimeDir: path.join(temporaryRoot, "different-runtime")
          },
          renewalId,
          runtime,
          session: successor
        }
      ),
      TypeError
    );
    assert.match(await readFile(path.join(runtimeDir, "runtime.json"), "utf8"), /"stopped"/u);

    const released = await controller.releaseRenewalSuccessorProcessExitProof(
      session.sessionId,
      {
        authorization,
        renewalId,
        runtime,
        session: successor
      }
    );
    assert.equal(released.released, true);
    assert.equal(released.alreadyReleased, false);
    assert.equal(released.runtimeDirRemoved, true);

    const retried = await controller.releaseRenewalSuccessorProcessExitProof(
      session.sessionId,
      {
        authorization,
        renewalId,
        runtime,
        session: successor
      }
    );
    assert.equal(retried.released, true);
    assert.equal(retried.alreadyReleased, true);
  });
});

test("cleanup and renewal freeze share one atomic terminal admission boundary", async () => {
  await withConversationController(async ({ calls, captures, controller, session }) => {
    let releaseEnvironment;
    let environmentStarted;
    const environmentStartedPromise = new Promise((resolve) => {
      environmentStarted = resolve;
    });
    captures.onProjectEnvironment = environmentStarted;
    captures.projectEnvironmentWait = new Promise((resolve) => {
      releaseEnvironment = resolve;
    });
    const owner = "session-renewal:cleanup-race";
    const namespace = codexTerminalNamespace(session.sessionId);
    const deleting = controller.deleteDetachedChatThread(session.sessionId, {
      threadId: "conversation-before-freeze"
    });
    await environmentStartedPromise;
    assert.deepEqual(freezeTerminalNamespaceAdmission(namespace, {
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen terminal input.",
      owner
    }), {
      code: "terminal_admission_busy",
      error: "A terminal operation is still finishing.",
      ok: false
    });
    releaseEnvironment();
    const deleted = await deleting;
    assert.equal(deleted.ok, true);
    assert.equal(deleted.status, "deleted");
    assert.equal(calls.some(([operation]) => operation === "ensure"), true);
    assert.equal(calls.some(([operation]) => operation === "delete"), true);

    assert.equal(freezeTerminalNamespaceAdmission(namespace, {
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen terminal input.",
      owner
    }).ok, true);
    const providerCount = captures.providerOptions.length;
    const ensureCount = calls.filter(([operation]) => operation === "ensure").length;
    const deleteCount = calls.filter(([operation]) => operation === "delete").length;
    const interruptCount = calls.filter(([operation]) => operation === "interrupt").length;
    try {
      const interrupted = await controller.interruptDetachedChatTurn(session.sessionId, {
        threadId: "conversation-before-freeze",
        turnId: "turn-before-freeze"
      });
      const stopped = await controller.stopConversation(session.sessionId, {
        conversationId: "conversation-before-freeze",
        runId: "turn-before-freeze"
      });

      assert.equal(interrupted.ok, true);
      assert.equal(interrupted.operationOutcome, "already_idle");
      assert.equal(stopped.ok, true);
      assert.equal(stopped.operationOutcome, "already_idle");
      assert.equal(captures.providerOptions.length, providerCount);
      assert.equal(calls.filter(([operation]) => operation === "ensure").length, ensureCount);
      assert.equal(calls.filter(([operation]) => operation === "delete").length, deleteCount);
      assert.equal(calls.filter(([operation]) => operation === "interrupt").length, interruptCount);
    } finally {
      assert.equal(thawTerminalNamespaceAdmission(namespace, { owner }).ok, true);
    }
  });
});

test("renewal freeze cannot cross any Codex provider acquisition boundary", async (t) => {
  const boundaries = [{
    hook: "onProviderFactory",
    title: "provider factory"
  }, {
    hook: "onEnsureAvailable",
    title: "provider availability"
  }];

  for (const boundary of boundaries) {
    await t.test(boundary.title, async () => {
      await withConversationController(async ({ captures, controller, session }) => {
        const owner = `session-renewal:${boundary.hook}`;
        const namespace = codexTerminalNamespace(session.sessionId);
        let freezeAttempt = null;
        captures[boundary.hook] = () => {
          freezeAttempt = freezeTerminalNamespaceAdmission(namespace, {
            code: "vibe64_session_renewal_quiesced",
            error: "Session renewal has frozen terminal input.",
            owner
          });
        };

        const deleted = await controller.deleteDetachedChatThread(session.sessionId, {
          threadId: `conversation-${boundary.hook}`
        });

        assert.equal(deleted.ok, true);
        assert.deepEqual(freezeAttempt, {
          code: "terminal_admission_busy",
          error: "A terminal operation is still finishing.",
          ok: false
        });
        assert.equal(freezeTerminalNamespaceAdmission(namespace, {
          code: "vibe64_session_renewal_quiesced",
          error: "Session renewal has frozen terminal input.",
          owner
        }).ok, true);
        assert.equal(thawTerminalNamespaceAdmission(namespace, { owner }).ok, true);
      });
    });
  }
});

test("renewal freeze cannot cross persisted economy runtime identity recovery", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectService,
    session,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const pending = controller.runDetachedChatTurn(session.sessionId, {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist one economy thread before the cleanup race."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Persisted." })
    });
    const completed = await pending;
    simulateControllerCrash();

    const namespace = codexTerminalNamespace(session.sessionId);
    const owner = "session-renewal:runtime-identity";
    let freezeAttempt = null;
    const restarted = restartedCaptures(captures, {
      onCurrentRuntimeInfo() {
        freezeAttempt = freezeTerminalNamespaceAdmission(namespace, {
          code: "vibe64_session_renewal_quiesced",
          error: "Session renewal has frozen terminal input.",
          owner
        });
      }
    });
    const restartedController = createRestartedController({
      captures: restarted,
      projectService
    });

    const deleted = await restartedController.deleteDetachedChatThread(session.sessionId, {
      executionProfile,
      threadId: completed.threadId
    });

    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    assert.deepEqual(freezeAttempt, {
      code: "terminal_admission_busy",
      error: "A terminal operation is still finishing.",
      ok: false
    });
    assert.equal(freezeTerminalNamespaceAdmission(namespace, {
      code: "vibe64_session_renewal_quiesced",
      error: "Session renewal has frozen terminal input.",
      owner
    }).ok, true);
    assert.equal(thawTerminalNamespaceAdmission(namespace, { owner }).ok, true);
  });
});

test("failed session cleanup retains economy ownership and succeeds on explicit retry", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create one economy thread to clean up."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready for cleanup." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));

    captures.failDeletes = 1;
    await assert.rejects(
      controller.closeAllForSession("session-1"),
      (error) => {
        assert.equal(error.code, "vibe64_codex_economy_thread_cleanup_failed");
        assert.equal(error.retryable, true);
        return true;
      }
    );
    assert.equal(captures.stopRuntimes, 0);
    assert.equal(captures.closes, 0);

    const followUp = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "A cleanup-required thread must never run another turn.",
      threadId: first.threadId
    });
    assert.equal(followUp.ok, false);
    assert.equal(followUp.code, "vibe64_codex_economy_thread_unavailable");
    assert.equal(captures.turns.length, 1);
    assert.deepEqual(captures.deletes, ["conversation-1"]);

    await controller.closeAllForSession("session-1");
    assert.deepEqual(captures.deletes, ["conversation-1", "conversation-1"]);
    assert.equal(captures.stopRuntimes, 1);
  });
});

test("resume verification failure removes retired ownership and never revives the stale thread", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create a thread before its tool inventory changes."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Initial explanation." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));

    captures.hookInventories[2] = captures.hooks;
    captures.hookInventories[3] = captures.hooks.map((hook) => ({
      ...hook,
      currentHash: "sha256:changed-after-resume"
    }));
    const failedResume = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "This follow-up must fail closed.",
      threadId: first.threadId
    });
    assert.equal(failedResume.ok, false);
    assert.match(failedResume.error, /execution surfaces changed/u);
    assert.deepEqual(captures.deletes, ["conversation-1"]);
    assert.equal(captures.resumes.length, 1);

    const staleRetry = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Never revive the already retired thread.",
      threadId: first.threadId
    });
    assert.equal(staleRetry.ok, false);
    assert.equal(staleRetry.code, "vibe64_codex_economy_thread_unavailable");
    assert.equal(captures.resumes.length, 1);
    assert.deepEqual(captures.deletes, ["conversation-1"]);
  });
});

test("resume verification cleanup failure keeps ownership until deletion is retried", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create a thread for retryable cleanup."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Initial explanation." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));

    captures.hookInventories[2] = captures.hooks;
    captures.hookInventories[3] = captures.hooks.map((hook) => ({
      ...hook,
      currentHash: "sha256:changed-with-delete-failure"
    }));
    captures.failDeletes = 1;
    const failedResume = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Fail verification and the first cleanup attempt.",
      threadId: first.threadId
    });
    assert.equal(failedResume.ok, false);
    assert.equal(failedResume.code, "vibe64_agent_execution_profile_policy_unenforceable");
    assert.match(failedResume.error, /could not retire an economy thread/u);

    const retriedCleanup = await controller.deleteDetachedChatThread("session-1", {
      executionProfile,
      threadId: first.threadId
    });
    assert.equal(retriedCleanup.ok, true, JSON.stringify(retriedCleanup));
    assert.equal(retriedCleanup.status, "deleted");
    assert.deepEqual(captures.deletes, ["conversation-1", "conversation-1"]);

    const staleRetry = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "The successfully retired thread must now be unavailable.",
      threadId: first.threadId
    });
    assert.equal(staleRetry.ok, false);
    assert.equal(staleRetry.code, "vibe64_codex_economy_thread_unavailable");
  });
});

test("start verification cleanup failure records the orphan until deletion is retried", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    captures.hookInventories[0] = captures.hooks;
    captures.hookInventories[1] = captures.hooks.map((hook) => ({
      ...hook,
      currentHash: "sha256:changed-after-start"
    }));
    captures.failDeletes = 1;

    const failedStart = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Fail the post-start inventory check and its first cleanup attempt."
    });
    assert.equal(failedStart.ok, false);
    assert.equal(failedStart.code, "vibe64_agent_execution_profile_policy_unenforceable");
    assert.match(failedStart.error, /could not retire an economy thread/u);
    assert.deepEqual(captures.deletes, ["conversation-1"]);
    assert.equal(captures.turns.length, 0);

    const retriedCleanup = await controller.deleteDetachedChatThread("session-1", {
      executionProfile,
      threadId: "conversation-1"
    });
    assert.equal(retriedCleanup.ok, true, JSON.stringify(retriedCleanup));
    assert.equal(retriedCleanup.status, "deleted");
    assert.deepEqual(captures.deletes, ["conversation-1", "conversation-1"]);

    const staleRetry = await controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Never revive the retired startup thread.",
      threadId: "conversation-1"
    });
    assert.equal(staleRetry.ok, false);
    assert.equal(staleRetry.code, "vibe64_codex_economy_thread_unavailable");
    assert.equal(captures.resumes.length, 0);
  });
});

test("a completed result is not exposed when READY ownership cannot be persisted", async () => {
  await withConversationController(async ({
    captures,
    projectRuntimeRoot,
    projectService,
    subscribers
  }) => {
    const failingLedgerFactory = ({ projectRuntimeRoot: ledgerRoot }) => {
      const ledger = createCodexEconomyThreadLedger({ projectRuntimeRoot: ledgerRoot });
      return Object.freeze({
        ...ledger,
        async write(record, options = {}) {
          if (
            options.expected &&
            record.lifecycle === CODEX_ECONOMY_THREAD_LIFECYCLES.READY
          ) {
            const error = new Error("simulated READY ownership persistence failure");
            error.code = "simulated_ready_ledger_failure";
            throw error;
          }
          return ledger.write(record, options);
        }
      });
    };
    const failingController = createRestartedController({
      captures,
      codexEconomyThreadLedgerFactory: failingLedgerFactory,
      projectService,
      subscribers
    });
    try {
      const pending = failingController.runDetachedChatTurn("session-1", {
        executionProfile: sourceExplanationEconomyProfile(),
        outputSchema: sourceExplanationOutputSchema(),
        prompt: "Do not expose this result without durable READY ownership."
      });
      await waitForCapturedTurns(captures, 1);
      completeDetachedTurn(subscribers, {
        text: JSON.stringify({ answer: "Completed but not durably reusable." })
      });
      const failed = await pending;
      assert.equal(failed.ok, false);
      assert.equal(failed.code, "simulated_ready_ledger_failure");
      assert.deepEqual(captures.deletes, ["conversation-1"]);
      assert.deepEqual(
        await createCodexEconomyThreadLedger({ projectRuntimeRoot }).readAll(),
        { failures: [], records: [] }
      );
    } finally {
      await failingController.closeAllForSession("session-1");
    }
  });
});

test("project shutdown finds and deletes economy-only providers by project ownership", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectContextRoot,
    session,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Create an economy-only provider for project shutdown."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Project-owned explanation." })
    });
    assert.equal((await pending).ok, true);
    assert.equal(Object.hasOwn(session, "projectContextRoot"), false);

    const result = await controller.closeAllForProject({
      projectContextRoot,
      reason: "unit-test"
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.providerCount, 1);
    assert.deepEqual(captures.deletes, ["conversation-1"]);
    assert.equal(captures.stopRuntimes, 1);
  });
});

test("provider replacement retires economy ownership before closing the old connection", async () => {
  await withConversationController(async ({ calls, captures, controller, subscribers }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Create a thread before the provider environment changes."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Provider one." })
    });
    assert.equal((await pending).ok, true);

    captures.environmentVersion = "two";
    await controller.executionProfileModelCatalog("session-1");

    const deleteIndex = calls.findIndex(([operation]) => operation === "delete");
    const closeIndex = calls.findIndex(([operation]) => operation === "close");
    const modelIndex = calls.findIndex(([operation]) => operation === "models");
    assert.ok(deleteIndex >= 0);
    assert.ok(closeIndex > deleteIndex);
    assert.ok(modelIndex > closeIndex);
    assert.equal(captures.closes, 1);
  });
});

test("model catalog resolution aborts at the workload deadline", {
  concurrency: false
}, async (t) => {
  t.mock.timers.enable({
    apis: ["setTimeout"]
  });
  try {
    await withConversationController(async ({ captures, controller }) => {
      captures.hangModelLists = true;
      const pending = controller.executionProfileModelCatalog("session-1", {
        timeoutMs: 25
      });
      while (captures.modelSignals.length === 0) {
        await flushPromises();
      }
      let settled = false;
      void pending.catch(() => {
        settled = true;
      });

      t.mock.timers.tick(24);
      await flushPromises();
      assert.equal(settled, false);

      t.mock.timers.tick(1);
      await assert.rejects(pending, (error) => {
        assert.equal(error.code, "vibe64_codex_model_catalog_timeout");
        assert.equal(error.retryable, true);
        return true;
      });
      assert.equal(captures.modelSignals[0].aborted, true);
      assert.equal(captures.modelAborts, 1);
    });
  } finally {
    t.mock.timers.reset();
  }
});

test("model catalog resolution follows explicit caller cancellation", async () => {
  await withConversationController(async ({ captures, controller }) => {
    captures.hangModelLists = true;
    const abortController = new AbortController();
    const pending = controller.executionProfileModelCatalog("session-1", {
      signal: abortController.signal,
      timeoutMs: 10_000
    });
    while (captures.modelSignals.length === 0) {
      await flushPromises();
    }

    const cancellation = new Error("caller cancelled model discovery");
    abortController.abort(cancellation);
    await assert.rejects(pending, (error) => error === cancellation);
    assert.equal(captures.modelSignals[0].aborted, true);
    assert.equal(captures.modelAborts, 1);
  });
});

test("startup reports an absent economy runtime only when it has no durable ownership", async () => {
  await withConversationController(async ({ captures, controller, session }) => {
    const reconciliation = await controller.reconcileThreads([session]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    assert.deepEqual(reconciliation.results[0].economyInventory, {
      deletedThreadIds: [],
      ok: true,
      ownedThreadIds: [],
      providerKey: reconciliation.results[0].economyInventory.providerKey,
      retiredMissingThreadIds: [],
      status: "runtimeAbsent"
    });
    assert.equal(captures.economyThreadInventories, 0);
  });
});

test("a completed economy thread survives a controller crash and resumes only after identity proof", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectContextRoot,
    projectRuntimeRoot,
    projectService,
    session,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Persist this economy thread before the controller crashes."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Persisted." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));
    const persisted = await createCodexEconomyThreadLedger({
      projectRuntimeRoot
    }).readAll();
    assert.equal(Object.hasOwn(session, "projectContextRoot"), false);
    assert.equal(persisted.records.length, 1);
    assert.equal(persisted.records[0].projectContextRoot, projectContextRoot);
    simulateControllerCrash();

    const restartedCalls = [];
    const restartedSubscribers = new Set();
    const restarted = restartedCaptures(captures);
    const restartedController = createRestartedController({
      calls: restartedCalls,
      captures: restarted,
      projectService,
      subscribers: restartedSubscribers
    });
    const followUpPending = restartedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Resume the exact persisted economy thread.",
      threadId: first.threadId
    });
    await waitForCapturedTurns(restarted, 1);
    assert.deepEqual(restarted.resumes.map(({ threadId }) => threadId), [first.threadId]);
    completeDetachedTurn(restartedSubscribers, {
      text: JSON.stringify({ answer: "Resumed after restart." })
    });
    assert.equal((await followUpPending).ok, true);

    await restartedController.closeAllForSession("session-1");
    assert.deepEqual(restarted.deletes, [first.threadId]);
    assert.deepEqual(await createCodexEconomyThreadLedger({
      projectRuntimeRoot
    }).readAll(), {
      failures: [],
      records: []
    });
  });
});

test("startup inventory retires READY ownership missing after an economy runtime restart", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectRuntimeRoot,
    projectService,
    session,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Persist this completed thread before its private runtime restarts."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Persisted before restart." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(
      (await createCodexEconomyThreadLedger({ projectRuntimeRoot }).readAll())
        .records[0]?.lifecycle,
      CODEX_ECONOMY_THREAD_LIFECYCLES.READY
    );
    simulateControllerCrash();

    const restartedSubscribers = new Set();
    const restarted = restartedCaptures(captures, {
      economyThreadIds: []
    });
    const restartedController = createRestartedController({
      captures: restarted,
      projectService,
      subscribers: restartedSubscribers
    });
    const reconciliation = await restartedController.reconcileThreads([session]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    assert.equal(restarted.economyThreadInventories, 1);
    assert.deepEqual(restarted.deletes, []);
    assert.deepEqual(
      reconciliation.results[0].economyInventory.retiredMissingThreadIds,
      [first.threadId]
    );
    assert.deepEqual(reconciliation.results[0].economyInventory.ownedThreadIds, []);
    assert.deepEqual(
      await createCodexEconomyThreadLedger({ projectRuntimeRoot }).readAll(),
      { failures: [], records: [] }
    );

    const staleFollowUp = await restartedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Do not resume a thread absent from authoritative inventory.",
      threadId: first.threadId
    });
    assert.equal(staleFollowUp.ok, false);
    assert.equal(staleFollowUp.code, "vibe64_codex_economy_thread_unavailable");

    const freshPending = restartedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create a fresh thread immediately after stale ownership retirement."
    });
    await waitForCapturedTurns(restarted, 1);
    completeDetachedTurn(restartedSubscribers, {
      text: JSON.stringify({ answer: "Fresh thread created." })
    });
    const fresh = await freshPending;
    assert.equal(fresh.ok, true, JSON.stringify(fresh));
    assert.equal(fresh.threadId, first.threadId);
    assert.equal(
      (await createCodexEconomyThreadLedger({ projectRuntimeRoot }).readAll())
        .records[0]?.lifecycle,
      CODEX_ECONOMY_THREAD_LIFECYCLES.READY
    );

    await restartedController.closeAllForSession("session-1");
  });
});

test("an active economy turn is interrupted and deleted during crash reconciliation", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectRuntimeRoot,
    projectService,
    session,
    simulateControllerCrash,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Remain active across the simulated crash."
    });
    void pending.catch(() => null);
    await waitForCapturedTurns(captures, 1);
    const before = await waitForEconomyLedgerLifecycle(
      projectRuntimeRoot,
      CODEX_ECONOMY_THREAD_LIFECYCLES.ACTIVE
    );
    assert.equal(before.turnId, "turn-1");
    simulateControllerCrash();

    const restarted = restartedCaptures(captures);
    const restartedController = createRestartedController({
      captures: restarted,
      projectService
    });
    const reconciliation = await restartedController.reconcileThreads([session]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    assert.deepEqual(restarted.interrupts, [{
      threadId: "conversation-1",
      turnId: "turn-1"
    }]);
    assert.deepEqual(restarted.deletes, ["conversation-1"]);
    assert.equal((await createCodexEconomyThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 0);

    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Too late." })
    });
    const crashedResult = await pending;
    assert.equal(crashedResult.ok, false);
  });
});

test("startup reconciliation deletes a thread orphaned before its first ledger write", async () => {
  await withConversationController(async ({
    captures,
    projectService,
    simulateControllerCrash,
    subscribers
  }) => {
    const failingLedgerFactory = ({ projectRuntimeRoot }) => {
      const ledger = createCodexEconomyThreadLedger({ projectRuntimeRoot });
      return Object.freeze({
        ...ledger,
        async write() {
          const error = new Error("simulated crash before durable ownership write");
          error.code = "simulated_ledger_crash";
          throw error;
        }
      });
    };
    captures.failDeletes = 1;
    const failedController = createRestartedController({
      captures,
      codexEconomyThreadLedgerFactory: failingLedgerFactory,
      projectService,
      subscribers
    });
    const failed = await failedController.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Create the crash-window orphan."
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, "vibe64_codex_economy_ownership_blocked");
    assert.deepEqual(captures.deletes, ["conversation-1"]);
    const economyOptions = captures.providerOptions.find(({ executionMode }) => (
      executionMode === "economy"
    ));
    assert.ok(economyOptions?.runtimeDir);
    await mkdir(economyOptions.runtimeDir, { recursive: true });
    simulateControllerCrash();

    const restarted = restartedCaptures(captures, {
      economyThreadIds: ["conversation-1"]
    });
    const restartedController = createRestartedController({
      captures: restarted,
      projectService
    });
    const reconciliation = await restartedController.reconcileThreads(["session-1"]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    assert.equal(restarted.economyThreadInventories, 1);
    assert.deepEqual(restarted.deletes, ["conversation-1"]);
    assert.deepEqual(
      reconciliation.results[0].economyInventory.deletedThreadIds,
      ["conversation-1"]
    );
  });
});

test("startup inventory cannot delete a new economy thread before ownership is durable", async () => {
  await withConversationController(async ({
    captures,
    controller,
    session,
    subscribers
  }) => {
    let releaseStart = null;
    let reportStart = null;
    captures.startThreadWait = new Promise((resolve) => {
      releaseStart = resolve;
    });
    const startObserved = new Promise((resolve) => {
      reportStart = resolve;
    });
    captures.onStartThread = reportStart;
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Create ownership while startup inventory is waiting."
    });
    await startObserved;
    captures.economyThreadIds = ["conversation-1"];

    const reconciliation = controller.reconcileThreads([session]);
    await flushPromises();
    assert.equal(captures.economyThreadInventories, 0);
    releaseStart();
    await waitForCapturedTurns(captures, 1);
    const reconciled = await reconciliation;
    assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
    assert.equal(captures.economyThreadInventories, 1);
    assert.deepEqual(captures.deletes, []);
    assert.deepEqual(
      reconciled.results[0].economyInventory.ownedThreadIds,
      ["conversation-1"]
    );

    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "The owned thread survived inventory." })
    });
    assert.equal((await pending).ok, true);
  });
});

test("startup inventory cannot retire a READY thread claimed by a concurrent follow-up", async () => {
  await withConversationController(async ({
    captures,
    controller,
    session,
    subscribers
  }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const outputSchema = sourceExplanationOutputSchema();
    const firstPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Create a completed thread before startup inventory begins."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready for a follow-up." })
    });
    const first = await firstPending;
    assert.equal(first.ok, true, JSON.stringify(first));

    let releaseInventory = null;
    captures.economyThreadInventoryWait = new Promise((resolve) => {
      releaseInventory = resolve;
    });
    const reconciliation = controller.reconcileThreads([session]);
    while (captures.economyThreadInventories === 0) {
      await flushPromises();
    }

    const followUpPending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema,
      prompt: "Claim the READY thread while inventory is paused.",
      threadId: first.threadId
    });
    await waitForCapturedTurns(captures, 2);
    releaseInventory();
    const reconciled = await reconciliation;
    assert.equal(reconciled.ok, true, JSON.stringify(reconciled));
    assert.deepEqual(reconciled.results[0].economyInventory.retiredMissingThreadIds, []);
    assert.deepEqual(reconciled.results[0].economyInventory.ownedThreadIds, [first.threadId]);
    assert.deepEqual(captures.deletes, []);

    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "The follow-up retained ownership." }),
      turnId: "turn-2"
    });
    assert.equal((await followUpPending).ok, true);
  });
});

test("economy project lifecycle gate releases after a rejected thread start", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    captures.failThreadStarts = 1;
    const failed = await controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Fail this start."
    });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, "thread_start_failed");

    const retried = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "The next start must not deadlock."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "The lifecycle gate was released." })
    });
    assert.equal((await retried).ok, true);
  });
});

test("an account switch blocks persisted economy ownership without deleting it", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectRuntimeRoot,
    projectService,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist this thread under account A."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Owned by account A." })
    });
    const first = await pending;
    assert.equal(first.ok, true);
    simulateControllerCrash();

    const switched = restartedCaptures(captures, {
      runtimeInfo: {
        ...captures.runtimeInfo,
        accountIdentitySignature: TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE
      }
    });
    const switchedController = createRestartedController({
      captures: switched,
      projectService
    });
    const blocked = await switchedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Never adopt this thread from another account.",
      threadId: first.threadId
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "vibe64_codex_economy_ownership_blocked");
    assert.equal(switched.resumes.length, 0);
    assert.equal(switched.deletes.length, 0);
    assert.equal((await createCodexEconomyThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 1);

    const original = restartedCaptures(captures);
    const cleanupController = createRestartedController({
      captures: original,
      projectService
    });
    const cleanup = await cleanupController.deleteDetachedChatThread("session-1", {
      executionProfile,
      threadId: first.threadId
    });
    assert.equal(cleanup.ok, true, JSON.stringify(cleanup));
    assert.equal((await createCodexEconomyThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 0);
  });
});

test("a same-account auth refresh can resume persisted economy ownership", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectService,
    simulateControllerCrash,
    subscribers
  }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist this thread before a token refresh."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Persisted." })
    });
    const first = await pending;
    assert.equal(first.ok, true);
    simulateControllerCrash();

    const refreshedSubscribers = new Set();
    const refreshed = restartedCaptures(captures, {
      runtimeInfo: {
        ...captures.runtimeInfo,
        authStateSignature: `v1:${"c".repeat(24)}`
      }
    });
    const refreshedController = createRestartedController({
      captures: refreshed,
      projectService,
      subscribers: refreshedSubscribers
    });
    const followUpPending = refreshedController.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Resume under the same account after token refresh.",
      threadId: first.threadId
    });
    await waitForCapturedTurns(refreshed, 1);
    assert.deepEqual(refreshed.resumes.map(({ threadId }) => threadId), [first.threadId]);
    completeDetachedTurn(refreshedSubscribers, {
      text: JSON.stringify({ answer: "Same account resumed." })
    });
    assert.equal((await followUpPending).ok, true);
    await refreshedController.closeAllForSession("session-1");
  });
});

test("an abandoned session retires its persisted economy thread during reconciliation", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectRuntimeRoot,
    projectService,
    session,
    simulateControllerCrash,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist before abandonment."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready." })
    });
    assert.equal((await pending).ok, true);
    session.status = VIBE64_SESSION_STATUS.ABANDONED;
    simulateControllerCrash();

    const restarted = restartedCaptures(captures);
    const restartedController = createRestartedController({
      captures: restarted,
      projectService
    });
    const reconciliation = await restartedController.reconcileThreads([session]);
    assert.equal(reconciliation.ok, true, JSON.stringify(reconciliation));
    assert.deepEqual(restarted.deletes, ["conversation-1"]);
    assert.equal((await createCodexEconomyThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 0);
  });
});

test("concurrent session closes coalesce economy deletion and clear durable ownership once", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectRuntimeRoot,
    simulateControllerCrash,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist before concurrent close."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready." })
    });
    assert.equal((await pending).ok, true);

    const closed = await Promise.allSettled([
      controller.closeAllForSession("session-1"),
      controller.closeAllForSession("session-1")
    ]);
    simulateControllerCrash();
    assert.equal(closed.filter(({ status }) => status === "rejected").length, 0);
    assert.deepEqual(captures.deletes, ["conversation-1"]);
    assert.equal((await createCodexEconomyThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 0);
  });
});

test("an unconfirmed delete result preserves cleanup-required ownership for retry", async () => {
  await withConversationController(async ({
    captures,
    controller,
    projectRuntimeRoot,
    simulateControllerCrash,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist before an unconfirmed delete."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready." })
    });
    assert.equal((await pending).ok, true);
    captures.undefinedDeletes = 1;

    await assert.rejects(
      controller.closeAllForSession("session-1"),
      (error) => error.code === "vibe64_codex_economy_thread_cleanup_failed"
    );
    const retained = await createCodexEconomyThreadLedger({ projectRuntimeRoot }).readAll();
    assert.equal(retained.records.length, 1);
    assert.equal(
      retained.records[0].lifecycle,
      CODEX_ECONOMY_THREAD_LIFECYCLES.CLEANUP_REQUIRED
    );
    const retried = await controller.deleteDetachedChatThread("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      threadId: "conversation-1"
    });
    assert.equal(retried.ok, true, JSON.stringify(retried));
    assert.equal((await createCodexEconomyThreadLedger({
      projectRuntimeRoot
    }).readAll()).records.length, 0);
    simulateControllerCrash();
  });
});

test("economy deletion requires the owned thread's exact semantic profile", async () => {
  await withConversationController(async ({ captures, controller, subscribers }) => {
    const executionProfile = sourceExplanationEconomyProfile();
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Persist before profile-bound deletion."
    });
    await waitForCapturedTurns(captures, 1);
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "Ready." })
    });
    const completed = await pending;
    assert.equal(completed.ok, true, JSON.stringify(completed));

    const wrongWorkload = await controller.deleteDetachedChatThread("session-1", {
      executionProfile: {
        profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
        workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE
      },
      threadId: completed.threadId
    });
    assert.equal(wrongWorkload.ok, false);
    assert.equal(wrongWorkload.code, "vibe64_codex_economy_thread_unavailable");

    const missingProfile = await controller.deleteDetachedChatThread("session-1", {
      threadId: completed.threadId
    });
    assert.equal(missingProfile.ok, false);
    assert.equal(missingProfile.code, "vibe64_codex_economy_thread_unavailable");

    const malformedProfile = await controller.deleteDetachedChatThread("session-1", {
      executionProfile: "economy",
      threadId: completed.threadId
    });
    assert.equal(malformedProfile.ok, false);
    assert.equal(malformedProfile.code, "vibe64_codex_economy_ownership_blocked");
    assert.deepEqual(captures.deletes, []);

    const deleted = await controller.deleteDetachedChatThread("session-1", {
      executionProfile: {
        profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
        workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION
      },
      threadId: completed.threadId
    });
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    assert.equal(deleted.status, "deleted");
    assert.deepEqual(captures.deletes, [completed.threadId]);
  });
});

test("economy deletion rejects an unknown thread without calling the provider", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const result = await controller.deleteDetachedChatThread("session-1", {
      executionProfile: {
        profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
        workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION
      },
      threadId: "unowned-economy-thread"
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_economy_thread_unavailable");
    assert.deepEqual(captures.deletes, []);
  });
});

test("economy interruption rejects an unowned thread without calling the provider", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const result = await controller.interruptDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      threadId: "unowned-economy-thread",
      turnId: "unowned-economy-turn"
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_economy_thread_unavailable");
    assert.deepEqual(captures.interrupts, []);
  });
});

test("economy work rejects a stale expected account before creating a thread", async () => {
  await withConversationController(async ({ captures, controller }) => {
    const result = await controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      expectedAccountIdentitySignature: TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Never run under a different selected account."
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_economy_ownership_blocked");
    assert.match(result.error, /selected Codex account changed/u);
    assert.deepEqual(captures.threads, []);
    assert.deepEqual(captures.turns, []);
  });
});

test("economy work rejects an account switch before exposing the result", async () => {
  await withConversationController(async ({
    captures,
    controller,
    subscribers
  }) => {
    const pending = controller.runDetachedChatTurn("session-1", {
      executionProfile: sourceExplanationEconomyProfile(),
      expectedAccountIdentitySignature: TEST_ACCOUNT_IDENTITY_SIGNATURE,
      outputSchema: sourceExplanationOutputSchema(),
      prompt: "Do not expose work after an account switch."
    });
    await waitForCapturedTurns(captures, 1);
    captures.runtimeInfo.accountIdentitySignature = TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE;
    completeDetachedTurn(subscribers, {
      text: JSON.stringify({ answer: "This result belongs to the old account." })
    });
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_economy_ownership_blocked");
    assert.deepEqual(captures.deletes, ["conversation-1"]);
  });
});
