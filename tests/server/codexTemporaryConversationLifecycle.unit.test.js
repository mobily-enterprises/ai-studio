import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createCodexTerminalController
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";
import {
  createService as createTerminalService
} from "../../packages/vibe64-terminals/src/server/service.js";
import {
  createService as createSourceEditorService
} from "../../packages/vibe64-source-editor/src/server/service.js";
import {
  codexAppServerRuntimeDir
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

const TEST_ACCOUNT_IDENTITY_SIGNATURE = `sha256:${"a".repeat(64)}`;
const TEST_AUTH_STATE_SIGNATURE = `v1:${"b".repeat(24)}`;
const TEST_OTHER_ACCOUNT_IDENTITY_SIGNATURE = `sha256:${"d".repeat(64)}`;

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
    async stopRuntime() {
      calls.push(["stopRuntime"]);
      captures.stopRuntimes += 1;
      return { stopped: true };
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

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
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
    providerOptions: [],
    resumes: [],
    runtimeInfo: null,
    serverUserAgent: "vibe64/0.149.0 (unit test)",
    threads: [],
    stopRuntimes: 0,
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
    failDeletes: 0,
    failInterrupts: 0,
    hookLists: [],
    interrupts: [],
    modelAborts: 0,
    modelSignals: [],
    providerOptions: [],
    resumes: [],
    runtimeInfo: { ...source.runtimeInfo },
    stopRuntimes: 0,
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
    onSendTurn: null,
    onSteerTurn: null,
    provider: null,
    sendTurnWait: null,
    steers: [],
    threadStarts: [],
    turns: []
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
    codexAppServerProviderFactory() {
      const subscribers = new Set();
      const provider = {
        closed: 0,
        status: "idle",
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
        async readThread() {
          return {
            turns: provider.turnId ? [{
              id: provider.turnId,
              items: [{
                id: `answer-${provider.turnId}`,
                phase: "final_answer",
                text: `Completed ${provider.turnId}.`,
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
        async resumeThread(threadId) {
          provider.threadId = threadId;
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
        async stopRuntime() {},
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
  await writeFile(path.join(runtimeDir, "runtime.json"), JSON.stringify({
    pid: 99999999,
    runtimeDir,
    transport: "unix"
  }));
  await writeFile(path.join(unscopedRuntimeDir, "runtime.json"), JSON.stringify({
    pid: 99999999,
    runtimeDir: unscopedRuntimeDir,
    transport: "unix"
  }));
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
