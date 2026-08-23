import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createCodexTerminalController
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";
import {
  codexAppServerRuntimeDir
} from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import {
  createVibe64SessionStore
} from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";

function createProvider(calls, subscribers) {
  return {
    async ensureAvailable() {
      calls.push(["ensure"]);
    },
    async resumeThread(threadId) {
      calls.push(["resume", threadId]);
      return { id: threadId };
    },
    async readThread(threadId) {
      calls.push(["read", threadId]);
      throw new Error("ephemeral threads do not support includeTurns");
    },
    async sendTurn(threadId) {
      calls.push(["turn", threadId]);
      return {
        id: "turn-1",
        raw: { status: "inProgress" }
      };
    },
    async startThread(settings) {
      calls.push(["thread", settings]);
      return { id: "conversation-1" };
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    }
  };
}

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
    projectRuntimeRoot,
    session: {
      metadata: {
        repository_mode: "local_source",
        source_kind: "session_clone",
        source_path: sourcePath,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      projectContextRoot,
      sessionId: "session-1",
      sessionRoot: path.join(projectRuntimeRoot, "sessions", "active", "session-1")
    }
  };
}

async function withConversationController(operation) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-temporary-conversation-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const calls = [];
  const subscribers = new Set();
  const { projectRuntimeRoot, session } = await managedSessionFixture(temporaryRoot);
  const controller = createCodexTerminalController({
    codexAppServerProviderFactory() {
      return createProvider(calls, subscribers);
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
          stateRoot: projectRuntimeRoot
        };
      },
      async projectExecutionEnvironment() {
        return {
          VIBE64_RUNTIME_NAMESPACE: "test",
          VIBE64_WORKSPACE: "test"
        };
      }
    }
  });
  try {
    await operation({ calls, controller, subscribers });
  } finally {
    await controller.closeAllForSession("session-1");
    if (previousRuntimeNamespace === undefined) {
      delete process.env.VIBE64_RUNTIME_NAMESPACE;
    } else {
      process.env.VIBE64_RUNTIME_NAMESPACE = previousRuntimeNamespace;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

test("a changed session environment retires the previous provider for the same runtime", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-provider-ownership-"));
  const previousRuntimeNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "test";
  const { projectRuntimeRoot, session } = await managedSessionFixture(temporaryRoot);
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
        async resumeThread(threadId) {
          provider.threadId = threadId;
          return {
            id: threadId
          };
        },
        async sendTurn() {
          nextTurn += 1;
          provider.status = "inProgress";
          provider.turnId = `turn-${nextTurn}`;
          return {
            id: provider.turnId,
            raw: {
              status: provider.status
            }
          };
        },
        async startThread() {
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
      }
    }
  });

  try {
    const started = await controller.sendMessage("session-1", {
      message: "Start the work.",
      messageId: "message-1"
    });
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].options.terminalEnv.PROVIDER_OWNERSHIP_VERSION, "one");

    environmentVersion = "two";
    const ensured = await controller.ensureThread("session-1");
    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].closed, 0);

    const steered = await controller.sendMessage("session-1", {
      message: "Use this additional detail.",
      messageId: "message-2"
    });
    assert.equal(steered.ok, true, JSON.stringify(steered));
    assert.equal(providers.length, 1);
    assert.equal(providers[0].closed, 0);
    assert.deepEqual(providers[0].steeredMessages, [{
      message: "Use this additional detail.",
      threadId: providers[0].threadId,
      turnId: "turn-1"
    }]);

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

    const restarted = await controller.sendMessage("session-1", {
      message: "Start the next turn.",
      messageId: "message-3"
    });
    assert.equal(restarted.ok, true, JSON.stringify(restarted));
    assert.equal(providers.length, 2);
    assert.equal(providers[0].closed, 1);
    assert.equal(providers[1].closed, 0);
    assert.equal(providers[1].options.terminalEnv.PROVIDER_OWNERSHIP_VERSION, "two");

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
  const { projectRuntimeRoot, session } = await managedSessionFixture(temporaryRoot);
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
      projectContextRoot: session.projectContextRoot,
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
