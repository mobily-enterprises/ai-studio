import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_CANCEL_SESSION_RENEWAL,
  ACTION_CONFIRM_SESSION_RENEWAL,
  ACTION_INSPECT_REPOSITORY_HISTORY,
  ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
  ACTION_INSPECT_REPOSITORY_VERSION_FILES,
  ACTION_ABANDON_SESSION,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_RENEWAL,
  ACTION_INSPECT_SESSION_CHANGE_DIFF,
  ACTION_INSPECT_SESSION_CHANGES,
  ACTION_INSPECT_SESSION_WORK,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
  ACTION_RETRY_SESSION_RENEWAL,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_SAVE_SESSION_WORK,
  ACTION_CHECK_SESSION_UPDATES,
  ACTION_UPDATE_SESSION_WORK,
  ACTION_UPDATE_CURRENT_SESSION,
  ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_INTERRUPT_AGENT_TURN,
  ACTION_BROADCAST_SESSION_PREVIEW_STATE,
  createSessionActions
} from "../../packages/vibe64-sessions/src/server/actions.js";
import {
  createService
} from "../../packages/vibe64-sessions/src/server/service.js";
import {
  developmentDatabasePolicy
} from "../../packages/vibe64-project/src/server/developmentDatabasePolicy.js";
import {
  runProjectSessionPolicyExclusive
} from "../../packages/vibe64-project/src/server/projectSourceMutationLock.js";
import {
  vibe64StatusCode
} from "../../packages/vibe64-core/src/server/serverResponses.js";
import {
  createSessionChangedPublisher
} from "../../packages/vibe64-sessions/src/server/events.js";
import {
  runVibe64AgentWriteExclusive
} from "../../packages/vibe64-runtime/src/server/agentWriteLock.js";
import {
  createVibe64SessionStore
} from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import {
  projectRuntimeRoot,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

function agentWriteLockHarness() {
  let active = false;
  const attempts = [];
  return {
    attempts,
    store: {
      async runSessionExclusive(sessionId, operationName, operation) {
        attempts.push({ operationName, sessionId });
        if (active) {
          return {
            acquired: false,
            value: null
          };
        }
        active = true;
        try {
          return {
            acquired: true,
            value: await operation()
          };
        } finally {
          active = false;
        }
      }
    }
  };
}

async function requireAgentWrite(runtime, sessionId, operation) {
  const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, operation);
  if (!exclusive.acquired) {
    const error = new Error(exclusive.value.error);
    error.code = exclusive.value.code;
    error.retryable = exclusive.value.retryable;
    throw error;
  }
  return exclusive.value;
}

function sessionCreationPolicyHarness({
  beforeCreate = async () => {},
  initialSessions = [],
  managed = true,
  publishSessionChanged = async () => {},
  projectRuntimeRoot: runtimeRoot,
  scope = "session",
  startWorkspaceSetup = () => ({ completion: null })
} = {}) {
  const openSessions = initialSessions.map((session) => ({
    status: "active",
    ...session
  }));
  const creationInputs = [];
  let nextSession = openSessions.length + 1;
  const runtime = {
    store: {
      async listSessionsForRenewal() {
        return openSessions.map((session) => ({ ...session }));
      }
    },
    async createSession(input) {
      creationInputs.push(input);
      await beforeCreate();
      const session = {
        sessionId: `session-${nextSession}`,
        status: "active",
        workspaceSetup: {
          status: "unconfigured"
        }
      };
      nextSession += 1;
      openSessions.push(session);
      return session;
    },
    async getSession(sessionId) {
      return openSessions.find((session) => session.sessionId === sessionId) || null;
    },
    async listSessionSummaries() {
      return openSessions
        .filter((session) => ["active", "blocked", "renewal_quiesced"].includes(session.status))
        .map((session) => ({ ...session }));
    }
  };
  const project = {
    async createRuntime() {
      return runtime;
    },
    async developmentDatabasePolicy({ openSessions: currentSessions = [] } = {}) {
      return developmentDatabasePolicy({
        managed,
        openSessions: currentSessions,
        scope
      });
    },
    runProjectSessionPolicyExclusive(operation, options = {}) {
      return runProjectSessionPolicyExclusive(runtimeRoot, operation, options);
    }
  };
  const service = createService({
    project,
    publishSessionChanged,
    terminals: {},
    workspaceSetupRunner: {
      isRunning: () => false,
      start: startWorkspaceSetup,
      wait: () => null
    }
  });
  return {
    creationInputs,
    openSessions,
    project,
    runtime,
    service
  };
}

test("sessions expose only direct chat and source actions", () => {
  assert.deepEqual(createSessionActions({ sessions: {} }).map((action) => action.id), [
    ACTION_INSPECT_REPOSITORY_HISTORY,
    ACTION_INSPECT_REPOSITORY_VERSION_FILES,
    ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
    ACTION_LIST_SESSIONS,
    ACTION_CREATE_SESSION,
    ACTION_UPDATE_CURRENT_SESSION,
    ACTION_INSPECT_SESSION,
    ACTION_INSPECT_SESSION_RENEWAL,
    ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
    ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
    ACTION_CANCEL_SESSION_RENEWAL,
    ACTION_CONFIRM_SESSION_RENEWAL,
    ACTION_RETRY_SESSION_RENEWAL,
    ACTION_INSPECT_SESSION_CHANGES,
    ACTION_INSPECT_SESSION_CHANGE_DIFF,
    ACTION_INSPECT_SESSION_WORK,
    ACTION_SAVE_SESSION_WORK,
    ACTION_CHECK_SESSION_UPDATES,
    ACTION_UPDATE_SESSION_WORK,
    ACTION_READ_SESSION_CONVERSATION_LOG,
    ACTION_RETRY_WORKSPACE_SETUP,
    ACTION_ABANDON_SESSION,
    ACTION_SEND_AGENT_MESSAGE,
    ACTION_INTERRUPT_AGENT_TURN,
    ACTION_BROADCAST_SESSION_PREVIEW_STATE
  ]);
});

test("assistant message action accepts attachment lease ids", () => {
  const action = createSessionActions({ sessions: {} })
    .find((candidate) => candidate.id === ACTION_SEND_AGENT_MESSAGE);
  const attachmentId = "33333333-3333-4333-8333-333333333333";

  assert.deepEqual(action.input.schema.patch({
    attachmentIds: [attachmentId],
    message: "Inspect this file.",
    sessionId: "session-1"
  }), {
    errors: {},
    validatedObject: {
      attachmentIds: [attachmentId],
      message: "Inspect this file.",
      sessionId: "session-1"
    }
  });
});

test("deferred session changes publish modern top-level realtime events", async () => {
  const events = [];
  const publish = createSessionChangedPublisher({
    async publish(event) {
      events.push(event);
      return event;
    }
  });

  await publish("session-1", {
    originId: "tab:test",
    payload: {
      clientRefresh: {
        includeLaunchTargets: true
      }
    },
    reason: "workspace-setup-completed",
    session: {
      revision: 7,
      sessionId: "session-1",
      status: "active"
    }
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "entity.changed");
  assert.equal(events[0].entityId, "session-1");
  assert.equal(events[0].realtime.event, "vibe64.session.changed");
  assert.equal(events[0].realtime.audience, "all_clients");
  assert.deepEqual(events[0].realtime.payload, {
    clientRefresh: {
      includeLaunchTargets: true
    },
    originId: "tab:test",
    reason: "workspace-setup-completed",
    revision: 7,
    sessionId: "session-1",
    status: "active"
  });
  assert.equal(Object.hasOwn(events[0], "meta"), false);
});

test("session detail exposes renewal advice from the current thread and durable history", async () => {
  const session = {
    manifest: { createdAt: "2026-08-23T00:00:00.000Z" },
    metadata: {
      agent_context_usage_provider: "codex",
      agent_context_usage_thread_id: "thread-current",
      agent_context_usage_updated_at: "2026-08-24T01:00:00.000Z",
      agent_context_used_tokens: "232560",
      agent_context_window_tokens: "258400",
      agent_identity_conversation_id: "thread-current"
    },
    sessionId: "session-1",
    status: "active"
  };
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          },
          async readConversationLogPage() {
            return { pagination: { totalTurnCount: 57 }, turns: [] };
          }
        };
      }
    },
    terminals: {
      async agentSessionState() {
        return { ok: true, status: "idle" };
      }
    }
  });

  const result = await service.inspectSession("session-1");

  assert.equal(result.ok, true);
  assert.equal(result.renewalAdvisory.available, true);
  assert.equal(result.renewalAdvisory.primarySignal, "provider-context");
  assert.equal(result.renewalAdvisory.severity, "soon");
  assert.equal(result.renewalAdvisory.signals.contextUsage.usedTokens, 232560);
  assert.equal(result.renewalAdvisory.signals.conversationTurnCount, 57);
  assert.equal(Object.hasOwn(result, "uiSync"), false);
});

test("assistant messages use the plain message contract", async () => {
  const calls = [];
  const publications = [];
  const session = {
    sessionId: "session-1",
    status: "active"
  };
  const runtime = {
    async getSession() {
      return session;
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged(...args) {
      publications.push(args);
    },
    terminals: {
      async sendAgentMessage(...args) {
        calls.push(args);
        return {
          delivered: true,
          ok: true
        };
      }
    }
  });

  const result = await service.sendAgentMessage("session-1", {
    attachmentIds: ["33333333-3333-4333-8333-333333333333"],
    displayMessage: "Inspect screenshot.png",
    message: "Inspect /tmp/screenshot.png",
    messageId: "message:test",
    originId: "tab:test"
  });

  assert.deepEqual(calls[0][0], "session-1");
  assert.deepEqual(calls[0][1], {
    attachmentIds: ["33333333-3333-4333-8333-333333333333"],
    displayMessage: "Inspect screenshot.png",
    message: "Inspect /tmp/screenshot.png",
    messageId: "message:test",
    originId: "tab:test"
  });
  assert.equal(result.messageId, "message:test");
  assert.equal(result.ok, true);
  assert.equal(publications.length, 1);
});

test("empty assistant messages fail without starting a provider turn", async () => {
  const service = createService({
    project: {},
    terminals: {}
  });

  assert.deepEqual(await service.sendAgentMessage("session-1", {
    message: "  "
  }), {
    code: "vibe64_agent_message_input_required",
    error: "Assistant messages require text.",
    ok: false
  });
  assert.equal(Object.hasOwn(service, "broadcastComposerDraft"), false);
  assert.equal(Object.hasOwn(service, "readComposerDraft"), false);
});

test("failed assistant delivery is published as failed, not accepted", async () => {
  const publications = [];
  const session = {
    sessionId: "session-1",
    status: "active"
  };
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return session;
          }
        };
      }
    },
    async publishSessionChanged(...args) {
      publications.push(args);
    },
    terminals: {
      async sendAgentMessage() {
        return {
          code: "codex_thread_reconciliation_failed",
          error: "Codex thread reconciliation failed.",
          ok: false
        };
      }
    }
  });

  const result = await service.sendAgentMessage("session-1", {
    message: "Continue the import.",
    messageId: "message:test"
  });

  assert.equal(result.error, "Codex thread reconciliation failed.");
  assert.equal(result.ok, false);
  assert.equal(publications[0][1].reason, "session-agent-message-failed");
});

test("session work inspection includes the durable native Save operation", async () => {
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return { sessionId: "session-1", status: "active" };
          },
          store: {
            async readBackgroundTask(sessionId, taskId) {
              assert.equal(sessionId, "session-1");
              assert.ok(["save-work", "update-session"].includes(taskId));
              return { id: taskId, status: "ready" };
            }
          }
        };
      }
    },
    terminals: {
      async inspectSessionWork(sessionId) {
        assert.equal(sessionId, "session-1");
        return { canonicalCommit: "abc123", unsaved: true };
      }
    }
  });

  const result = await service.inspectSessionWork("session-1");
  assert.equal(result.ok, true);
  assert.equal(result.unsaved, true);
  assert.deepEqual(result.operation, { id: "save-work", status: "ready" });
  assert.deepEqual(result.updateOperation, { id: "update-session", status: "ready" });
});

test("session work inspection returns operations read after repository inspection", async () => {
  let saveTask = {
    id: "save-work",
    message: "Reconciling the session onto the saved commit.",
    status: "running",
    updatedAt: "2026-08-21T09:26:37.991Z"
  };
  const updateTask = { id: "update-session", status: "ready" };
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return { sessionId: "session-1", status: "active" };
          },
          store: {
            async readBackgroundTask(_sessionId, taskId) {
              return taskId === "save-work" ? saveTask : updateTask;
            }
          }
        };
      }
    },
    terminals: {
      async inspectSessionWork() {
        saveTask = {
          id: "save-work",
          message: "Session work was saved.",
          status: "ready",
          updatedAt: "2026-08-21T09:26:55.716Z"
        };
        return { canonicalCommit: "saved", unsaved: false };
      }
    }
  });

  const result = await service.inspectSessionWork("session-1");

  assert.equal(result.ok, true);
  assert.equal(result.unsaved, false);
  assert.deepEqual(result.operation, saveTask);
});

test("work inspection reconciles an interrupted published Save exactly once", async () => {
  const writes = [];
  const metadata = [];
  const runningTask = {
    checkpointCommit: "checkpoint",
    checkpointTree: "tree",
    expectedCanonicalCommit: "old",
    id: "save-work",
    operationId: "save-1",
    proposedCommit: "saved",
    status: "running"
  };
  let saveTask = runningTask;
  const runtime = {
    async getSession() {
      return { sessionId: "session-1", status: "active" };
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return taskId === "save-work"
          ? saveTask
          : { id: "update-session", status: "ready" };
      },
      async writeBackgroundTaskEvent(_sessionId, _taskId, input) {
        writes.push(input);
        saveTask = { ...saveTask, ...input.patch, events: [input.event] };
        return saveTask;
      },
      async writeMetadataValue(...args) {
        metadata.push(args);
      }
    }
  };
  let recoverCalls = 0;
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async inspectSessionWork() {
        return { unsaved: false };
      },
      async recoverSessionWorkSave(_sessionId, input) {
        recoverCalls += 1;
        assert.equal(input.recovery, runningTask);
        return {
          reconciled: true,
          saveCommit: "saved",
          status: "saved"
        };
      }
    }
  });

  const result = await service.inspectSessionWork("session-1");
  assert.equal(result.ok, true);
  assert.equal(result.operation.status, "ready");
  assert.equal(recoverCalls, 1);
  assert.deepEqual(metadata, [
    ["session-1", "canonical_commit", "saved"],
    ["session-1", "base_commit", "saved"]
  ]);
  assert.equal(writes[0].event.kind, "save-recovered");
});

test("work inspection recovers an interrupted prepared Update and advances its base once", async () => {
  const writes = [];
  const metadata = [];
  const runningUpdate = {
    canonicalCommit: "canonical-new",
    checkpointCommit: "checkpoint",
    checkpointTree: "tree",
    id: "update-session",
    mergedCommit: "merged",
    mergedTree: "merged-tree",
    oldHead: "old-head",
    oldIndexTree: "old-index",
    operationId: "update-1",
    stage: "prepared",
    status: "running"
  };
  let updateTask = runningUpdate;
  const runtime = {
    async getSession() {
      return { sessionId: "session-1", status: "active" };
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return taskId === "update-session"
          ? updateTask
          : { id: "save-work", status: "ready" };
      },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        writes.push([taskId, input]);
        updateTask = { ...updateTask, ...input.patch, events: [input.event], id: taskId };
        return updateTask;
      },
      async writeMetadataValue(...args) {
        metadata.push(args);
      }
    }
  };
  let recoverCalls = 0;
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async inspectSessionWork() {
        return { unsaved: true };
      },
      async recoverSessionWorkUpdate(_sessionId, input) {
        recoverCalls += 1;
        assert.equal(input.recovery, runningUpdate);
        return {
          canonicalCommit: "canonical-new",
          reconciled: true,
          status: "updated"
        };
      }
    }
  });

  const result = await service.inspectSessionWork("session-1");
  assert.equal(result.ok, true);
  assert.equal(result.updateOperation.status, "ready");
  assert.equal(recoverCalls, 1);
  assert.deepEqual(metadata, [
    ["session-1", "canonical_commit", "canonical-new"],
    ["session-1", "base_commit", "canonical-new"]
  ]);
  assert.equal(writes[0][0], "update-session");
  assert.equal(writes[0][1].event.kind, "update-recovered");
});

test("work inspection observes a live Save without mistaking it for an interrupted operation", async () => {
  let backgroundTask = { id: "save-work", status: "ready" };
  let continueSave;
  let saveStarted;
  const saveStartedPromise = new Promise((resolve) => {
    saveStarted = resolve;
  });
  const continueSavePromise = new Promise((resolve) => {
    continueSave = resolve;
  });
  const runtime = {
    async getSession() {
      return { sessionId: "session-1", status: "active" };
    },
    async listSessionSummaries() {
      return [{ sessionId: "session-1", status: "active" }];
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return taskId === "save-work"
          ? backgroundTask
          : { id: taskId, status: "ready" };
      },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        backgroundTask = {
          ...backgroundTask,
          ...input.patch,
          events: [...(backgroundTask.events || []), input.event],
          id: taskId
        };
        return backgroundTask;
      },
      async writeMetadataValue() {}
    }
  };
  let recoveryCalls = 0;
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async inspectSessionWork() {
        return { unsaved: true };
      },
      async recoverSessionWorkSave() {
        recoveryCalls += 1;
        throw new Error("A live Save must not be recovered.");
      },
      async saveSessionWork(_sessionId, input) {
        await input.onRepositoryWriteAcquired();
        saveStarted();
        await continueSavePromise;
        return {
          reconciled: true,
          saveCommit: "saved",
          status: "saved"
        };
      }
    }
  });

  const saving = service.saveSessionWork("session-1");
  await saveStartedPromise;
  const inspected = await service.inspectSessionWork("session-1");
  assert.equal(inspected.operation.status, "running");
  assert.equal(recoveryCalls, 0);

  continueSave();
  const saved = await saving;
  assert.equal(saved.ok, true);
  assert.equal(saved.operation.status, "ready");
});

test("Save authority races become a ready update requirement rather than an AI failure", async () => {
  let backgroundTask = { id: "save-work", status: "ready" };
  const publications = [];
  const runtime = {
    async getSession() {
      return { sessionId: "session-1", status: "active" };
    },
    store: {
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        backgroundTask = {
          ...backgroundTask,
          ...input.patch,
          events: [...(backgroundTask.events || []), input.event],
          id: taskId
        };
        return backgroundTask;
      }
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged(_sessionId, change) {
      publications.push(change);
    },
    terminals: {
      async saveSessionWork(_sessionId, input) {
        await input.onRepositoryWriteAcquired();
        const error = new Error("The saved project changed. Update this session (rebase).");
        error.code = "vibe64_session_save_update_required";
        error.details = {
          canonicalCommit: "new",
          reconciledCommit: "old",
          updateRequired: true
        };
        throw error;
      }
    }
  });

  const result = await service.saveSessionWork("session-1");
  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_session_save_update_required");
  assert.equal(backgroundTask.status, "ready");
  assert.equal(backgroundTask.updateRequired, true);
  assert.equal(Object.hasOwn(backgroundTask, "error"), false);
  assert.equal(backgroundTask.events.at(-1).kind, "save-update-required");
  assert.equal(publications.at(-1).reason, "session-save-update-required");
});

test("native Save persists bounded progress and advances the session base only after reconciliation", async () => {
  const taskEvents = [];
  const metadata = [];
  const publications = [];
  const sessions = new Map([
    ["session-1", { agentRuns: [], sessionId: "session-1", status: "active" }],
    ["session-2", { agentRuns: [], sessionId: "session-2", status: "active" }]
  ]);
  const runtime = {
    async getSession(sessionId) {
      return sessions.get(sessionId);
    },
    async listSessionSummaries() {
      return [...sessions.values()];
    },
    store: {
      async writeBackgroundTaskEvent(sessionId, taskId, input) {
        assert.equal(sessionId, "session-1");
        assert.equal(taskId, "save-work");
        assert.ok(["running", "ready", "failed"].includes(input.patch.status));
        taskEvents.push(input);
        return {
          ...input.patch,
          events: taskEvents.map((entry) => entry.event),
          id: taskId
        };
      },
      async writeMetadataValue(sessionId, name, value) {
        metadata.push([sessionId, name, value]);
      }
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged(...args) {
      publications.push(args);
    },
    terminals: {
      async saveSessionWork(sessionId, input) {
        assert.equal(sessionId, "session-1");
        await input.onRepositoryWriteAcquired();
        await input.onProgress({ kind: "canonical-refreshed", message: "Canonical source refreshed." });
        return {
          reconciled: true,
          saveCommit: "def456",
          status: "saved"
        };
      }
    }
  });

  const result = await service.saveSessionWork("session-1", { originId: "tab:test" });
  assert.equal(result.ok, true);
  assert.equal(result.operation.status, "ready");
  assert.deepEqual(metadata, [
    ["session-1", "canonical_commit", "def456"],
    ["session-1", "base_commit", "def456"],
    ["session-2", "canonical_commit", "def456"]
  ]);
  assert.deepEqual(taskEvents.map((entry) => entry.event.kind), [
    "save-started",
    "canonical-refreshed",
    "saved"
  ]);
  assert.deepEqual(publications.map((entry) => entry[1].reason), [
    "session-save-started",
    "session-save-progress",
    "session-save-completed",
    "repository-canonical-changed"
  ]);
  assert.equal(publications[3][0], "session-2");
  assert.deepEqual(publications[3][1].payload, {
    canonicalCommit: "def456",
    sourceSessionId: "session-1"
  });
});

test("native Save persists its semantic commit-title profile across a durable task reload", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const sessionId = "save-profile-audit";
    const store = createVibe64SessionStore({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await store.createSession({
      runtimeKind: "genesis",
      sessionId
    });
    const executionProfile = {
      limits: {
        maxInputCharacters: 12_000,
        maxOutputCharacters: 1_000,
        timeoutMs: 45_000
      },
      model: "provider-owned-economy-model",
      policy: {
        environmentAccess: false,
        networkAccess: false,
        repositoryWrite: false,
        tools: "none"
      },
      profileId: "economy",
      providerId: "codex",
      request: {
        allowProviderModelFallback: false,
        reasoning: true,
        summary: false
      },
      revision: "codex-economy-v2",
      thinking: "low",
      workloadId: "commit_title"
    };
    const runtime = {
      getSession(id) {
        return store.readSession(id);
      },
      async listSessionSummaries() {
        return [await store.readSession(sessionId)];
      },
      store
    };
    const service = createService({
      project: {
        async createRuntime() {
          return runtime;
        }
      },
      terminals: {
        async saveSessionWork(_sessionId, input) {
          await input.onRepositoryWriteAcquired();
          await input.onProgress({
            executionProfile,
            kind: "message",
            message: "Version name ready.",
            stage: "message-ready"
          });
          return {
            commitTitleExecutionProfile: executionProfile,
            reconciled: true,
            saveCommit: "saved-profile-commit",
            status: "saved"
          };
        }
      }
    });

    const saved = await service.saveSessionWork(sessionId);
    assert.equal(saved.ok, true);

    const reloadedStore = createVibe64SessionStore({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    const reloadedTask = await reloadedStore.readBackgroundTask(sessionId, "save-work");
    assert.deepEqual(reloadedTask.executionProfile, executionProfile);
    assert.deepEqual(reloadedTask.commitTitleExecutionProfile, executionProfile);
    assert.equal(reloadedTask.commitTitleExecutionProfile.profileId, "economy");
    assert.equal(reloadedTask.commitTitleExecutionProfile.revision, "codex-economy-v2");
    assert.equal(reloadedTask.commitTitleExecutionProfile.workloadId, "commit_title");
  });
});

test("a successful Save keeps mirror maintenance failure as a visible retryable warning", async () => {
  const taskEvents = [];
  const runtime = {
    async getSession() {
      return { agentRuns: [], sessionId: "session-1", status: "active" };
    },
    async listSessionSummaries() {
      return [{ agentRuns: [], sessionId: "session-1", status: "active" }];
    },
    store: {
      async readBackgroundTask() {
        return null;
      },
      async writeBackgroundTaskEvent(_sessionId, _taskId, input) {
        taskEvents.push(input);
        return {
          ...input.patch,
          events: taskEvents.map((entry) => entry.event),
          id: "save-work"
        };
      },
      async writeMetadataValue() {}
    }
  };
  const cacheMaintenance = {
    attempted: true,
    code: "vibe64_test_cache_refresh_failed",
    kind: "github_mirror",
    message: "Your work was saved, but Vibe64 could not refresh its local clone cache. A later session or Save will retry it.",
    reason: "refresh_failed",
    retryable: true,
    status: "retryable"
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged() {},
    terminals: {
      async saveSessionWork(_sessionId, input) {
        await input.onRepositoryWriteAcquired();
        await input.onProgress({
          cacheMaintenance,
          kind: "cache-warning",
          message: cacheMaintenance.message,
          stage: "cache-maintenance-warning"
        });
        return {
          cacheMaintenance,
          reconciled: true,
          saveCommit: "saved-with-warning",
          status: "saved"
        };
      }
    }
  });

  const result = await service.saveSessionWork("session-1");

  assert.equal(result.ok, true);
  assert.equal(result.operation.status, "ready");
  assert.equal(result.operation.cacheMaintenance.status, "retryable");
  assert.equal(result.operation.cacheMaintenance.retryable, true);
  assert.deepEqual(taskEvents.map((entry) => entry.event.kind), [
    "save-started",
    "cache-warning",
    "saved"
  ]);
  assert.match(taskEvents.at(-1).event.message, /local clone cache could not be refreshed/u);
  assert.equal(Object.hasOwn(result.operation, "error"), false);
});

test("a reconciled Save supersedes an older failed session update", async () => {
  const tasks = new Map([
    ["update-session", {
      code: "vibe64_session_update_conflict",
      error: "Conflict",
      events: [],
      id: "update-session",
      status: "failed"
    }]
  ]);
  const runtime = {
    async getSession() {
      return { agentRuns: [], sessionId: "session-1", status: "active" };
    },
    async listSessionSummaries() {
      return [{ agentRuns: [], sessionId: "session-1", status: "active" }];
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return tasks.get(taskId) || null;
      },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        const prior = tasks.get(taskId) || { events: [], id: taskId };
        const task = {
          ...prior,
          ...input.patch,
          events: [...(prior.events || []), input.event],
          id: taskId
        };
        tasks.set(taskId, task);
        return task;
      },
      async writeMetadataValue() {}
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async saveSessionWork(_sessionId, input) {
        await input.onRepositoryWriteAcquired();
        return {
          reconciled: true,
          saveCommit: "saved-commit",
          status: "saved"
        };
      }
    }
  });

  const result = await service.saveSessionWork("session-1");

  assert.equal(result.ok, true);
  assert.equal(tasks.get("update-session").status, "ready");
  assert.equal(tasks.get("update-session").code, "");
  assert.equal(tasks.get("update-session").error, "");
  assert.equal(tasks.get("update-session").resolvedBySaveCommit, "saved-commit");
  assert.equal(tasks.get("update-session").events.at(-1).kind, "update-superseded-by-save");
});

test("work inspection repairs a failed update superseded by a later reconciled Save", async () => {
  const tasks = new Map([
    ["save-work", {
      events: [],
      id: "save-work",
      reconciled: true,
      saveCommit: "saved-commit",
      status: "ready",
      updatedAt: "2026-08-19T12:01:00.000Z"
    }],
    ["update-session", {
      code: "vibe64_session_update_conflict",
      error: "Conflict",
      events: [],
      id: "update-session",
      status: "failed",
      updatedAt: "2026-08-19T12:00:00.000Z"
    }]
  ]);
  const runtime = {
    async getSession() {
      return { agentRuns: [], sessionId: "session-1", status: "active" };
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return tasks.get(taskId) || null;
      },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        const prior = tasks.get(taskId) || { events: [], id: taskId };
        const task = {
          ...prior,
          ...input.patch,
          events: [...(prior.events || []), input.event],
          id: taskId
        };
        tasks.set(taskId, task);
        return task;
      }
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async inspectSessionWork() {
        return { unsaved: false };
      }
    }
  });

  const result = await service.inspectSessionWork("session-1");

  assert.equal(result.ok, true);
  assert.equal(result.updateOperation.status, "ready");
  assert.equal(result.updateOperation.code, "");
  assert.equal(result.updateOperation.resolvedBySaveCommit, "saved-commit");
});

test("a failed Update persists conflict recovery and supplies it to the reviewed retry", async () => {
  const conflictRecovery = {
    baseCommit: "base",
    canonicalCommit: "canonical",
    checkpointTree: "checkpoint",
    conflictPaths: ["shared.txt"],
    conflictTree: "conflict-tree",
    oldHead: "head",
    oldIndexTree: "index"
  };
  const tasks = new Map();
  const metadata = [];
  const session = {
    agentRuns: [],
    metadata: {},
    sessionId: "session-1",
    status: "active"
  };
  const runtime = {
    async getSession() {
      return session;
    },
    async listSessionSummaries() {
      return [session];
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return tasks.get(taskId) || null;
      },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        const prior = tasks.get(taskId) || { events: [], id: taskId };
        const task = {
          ...prior,
          ...input.patch,
          events: [...(prior.events || []), input.event],
          id: taskId
        };
        tasks.set(taskId, task);
        return task;
      },
      async writeMetadataValue(_sessionId, name, value) {
        metadata.push([name, value]);
        session.metadata[name] = value;
      }
    }
  };
  let updates = 0;
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged() {},
    terminals: {
      async inspectSessionWork() {
        return {
          ahead: 0,
          behind: 0,
          canonicalCommit: "canonical",
          sessionHead: "canonical",
          updateAvailable: false
        };
      },
      async updateSessionWork(_sessionId, input) {
        updates += 1;
        await input.onRepositoryWriteAcquired();
        if (updates === 1) {
          assert.equal(input.conflictRecovery, null);
          const error = new Error("One file needs review.");
          error.code = "vibe64_session_update_conflict";
          error.details = {
            conflictPaths: ["shared.txt"],
            conflictRecovery
          };
          throw error;
        }
        assert.deepEqual(input.conflictRecovery, conflictRecovery);
        return {
          canonicalCommit: "canonical",
          reconciled: true,
          status: "updated"
        };
      }
    }
  });

  const failed = await service.updateSessionWork("session-1");
  assert.equal(failed.ok, false);
  assert.equal(tasks.get("update-session").status, "failed");
  assert.deepEqual(tasks.get("update-session").conflictRecovery, conflictRecovery);

  const retried = await service.updateSessionWork("session-1");
  assert.equal(retried.ok, true);
  assert.equal(retried.operation.status, "ready");
  assert.equal(retried.operation.conflictRecovery, null);
  assert.deepEqual(retried.operation.conflictPaths, []);
  assert.equal(retried.operation.code, "");
  assert.equal(retried.operation.error, "");
  assert.ok(metadata.some(([name, value]) => name === "base_commit" && value === "canonical"));
});

test("one exact update check is cached and invalidates every sibling session", async () => {
  const metadata = [];
  const publications = [];
  const sessions = new Map([
    ["session-1", {
      agentRuns: [],
      metadata: { base_commit: "canonical-old" },
      sessionId: "session-1",
      status: "active"
    }],
    ["session-2", {
      agentRuns: [],
      metadata: { base_commit: "canonical-old" },
      sessionId: "session-2",
      status: "active"
    }]
  ]);
  const runtime = {
    async getSession(sessionId) {
      return sessions.get(sessionId);
    },
    async listSessionSummaries() {
      return [...sessions.values()];
    },
    store: {
      async writeMetadataValue(sessionId, name, value) {
        metadata.push([sessionId, name, value]);
        const session = sessions.get(sessionId);
        session.metadata = {
          ...session.metadata,
          [name]: value
        };
      }
    }
  };
  let exactChecks = 0;
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    async publishSessionChanged(...args) {
      publications.push(args);
    },
    terminals: {
      async checkSessionUpdates() {
        exactChecks += 1;
        return {
          ahead: 0,
          behind: 2,
          canonicalCommit: "canonical-new",
          incomingVersions: [
            {
              author: "Merc",
              committedAt: "2026-08-19T07:14:00.000Z",
              commit: "a".repeat(40),
              message: "Newest saved work"
            },
            {
              author: "Geoff",
              committedAt: "2026-08-19T07:13:00.000Z",
              commit: "b".repeat(40),
              isMerge: true,
              message: "Earlier saved work"
            }
          ],
          incomingVersionsTruncated: false,
          reconciled: false,
          sessionHead: "session-old",
          updateAvailable: true
        };
      }
    }
  });

  const result = await service.checkSessionUpdates("session-1");
  const cached = await service.checkSessionUpdates("session-1");
  assert.equal(result.updateAvailable, true);
  assert.equal(result.relationship, "behind");
  assert.equal(result.updateStrategy, "rebase");
  assert.equal(cached.cached, true);
  assert.equal(exactChecks, 1);
  assert.match(result.checkedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(metadata[0][0], "session-1");
  assert.equal(metadata[0][1], "canonical_commit");
  assert.equal(metadata[0][2], "canonical-new");
  assert.equal(metadata[1][0], "session-1");
  assert.equal(metadata[1][1], "repository_update_check");
  assert.deepEqual(JSON.parse(metadata[1][2]), {
    ahead: 0,
    behind: 2,
    canonicalCommit: "canonical-new",
    checkedAt: result.checkedAt,
    incomingVersions: [
      {
        author: "Merc",
        committedAt: "2026-08-19T07:14:00.000Z",
        commit: "a".repeat(40),
        isMerge: false,
        message: "Newest saved work",
        shortCommit: "aaaaaaaa"
      },
      {
        author: "Geoff",
        committedAt: "2026-08-19T07:13:00.000Z",
        commit: "b".repeat(40),
        isMerge: true,
        message: "Earlier saved work",
        shortCommit: "bbbbbbbb"
      }
    ],
    incomingVersionsTruncated: false,
    relationship: "behind",
    sessionHead: "session-old",
    updateAvailable: true,
    updateStrategy: "rebase"
  });
  assert.deepEqual(metadata[2], ["session-2", "canonical_commit", "canonical-new"]);
  assert.deepEqual(publications.map((entry) => [entry[0], entry[1].reason]), [
    ["session-1", "session-repository-checked"],
    ["session-2", "repository-canonical-changed"]
  ]);
});

test("repository history returns the last successful update check from session state", async () => {
  const checkedAt = "2026-08-19T07:15:00.000Z";
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              metadata: {
                canonical_commit: "canonical-new",
                repository_update_check: JSON.stringify({
                  ahead: 3,
                  behind: 2,
                  canonicalCommit: "canonical-new",
                  checkedAt,
                  incomingVersions: [
                    {
                      author: "Merc",
                      committedAt: "2026-08-19T07:14:00.000Z",
                      commit: "c".repeat(40),
                      isMerge: false,
                      message: "Latest saved work"
                    },
                    {
                      author: "Geoff",
                      committedAt: "2026-08-19T07:13:00.000Z",
                      commit: "b".repeat(40),
                      isMerge: true,
                      message: "Earlier saved work"
                    }
                  ],
                  relationship: "diverged",
                  sessionHead: "session-local"
                })
              },
              sessionId: "session-1"
            };
          }
        };
      }
    },
    terminals: {
      async inspectRepositoryHistory() {
        return {
          historySnapshotCommit: "canonical-new",
          versions: []
        };
      }
    }
  });

  const result = await service.inspectRepositoryHistory({ sessionId: "session-1" });
  assert.deepEqual(result.updateCheck, {
    ahead: 3,
    behind: 2,
    canonicalCommit: "canonical-new",
    checkedAt,
    incomingVersions: [
      {
        author: "Merc",
        committedAt: "2026-08-19T07:14:00.000Z",
        commit: "c".repeat(40),
        isMerge: false,
        message: "Latest saved work",
        shortCommit: "cccccccc"
      },
      {
        author: "Geoff",
        committedAt: "2026-08-19T07:13:00.000Z",
        commit: "b".repeat(40),
        isMerge: true,
        message: "Earlier saved work",
        shortCommit: "bbbbbbbb"
      }
    ],
    incomingVersionsTruncated: false,
    relationship: "diverged",
    sessionHead: "session-local",
    updateAvailable: true,
    updateStrategy: "rebase"
  });
});

test("repository history does not reuse an update check from an older canonical version", async () => {
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              metadata: {
                canonical_commit: "canonical-new",
                repository_update_check: JSON.stringify({
                  ahead: 0,
                  behind: 1,
                  canonicalCommit: "canonical-old",
                  checkedAt: "2026-08-19T07:15:00.000Z",
                  relationship: "behind"
                })
              },
              sessionId: "session-1"
            };
          }
        };
      }
    },
    terminals: {
      async inspectRepositoryHistory() {
        return { versions: [] };
      }
    }
  });

  const result = await service.inspectRepositoryHistory({ sessionId: "session-1" });
  assert.equal(Object.hasOwn(result, "updateCheck"), false);
});

test("repository history does not reuse an old behind check without incoming version facts", async () => {
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              metadata: {
                canonical_commit: "canonical-new",
                repository_update_check: JSON.stringify({
                  ahead: 0,
                  behind: 1,
                  canonicalCommit: "canonical-new",
                  checkedAt: "2026-08-19T07:15:00.000Z",
                  relationship: "behind"
                })
              },
              sessionId: "session-1"
            };
          }
        };
      }
    },
    terminals: {
      async inspectRepositoryHistory() {
        return { versions: [] };
      }
    }
  });

  const result = await service.inspectRepositoryHistory({ sessionId: "session-1" });
  assert.equal(Object.hasOwn(result, "updateCheck"), false);
});

test("native Save rejects every active provider state before touching Git", async () => {
  let saveCalls = 0;
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              agentRuns: [{ active: false, state: "finalizing" }],
              sessionId: "session-1",
              status: "active"
            };
          }
        };
      }
    },
    terminals: {
      async saveSessionWork() {
        saveCalls += 1;
        const error = new Error("Wait for the assistant turn to finish before saving this session's work.");
        error.code = "vibe64_session_save_agent_active";
        error.retryable = true;
        throw error;
      }
    }
  });

  const result = await service.saveSessionWork("session-1");
  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_session_save_agent_active");
  assert.equal(saveCalls, 1);
});

test("an early assistant message waits for workspace preparation and is sent once", async () => {
  let finishSetup;
  const setupFinished = new Promise((resolve) => {
    finishSetup = resolve;
  });
  let sendCount = 0;
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              sessionId: "session-1",
              status: "active"
            };
          }
        };
      }
    },
    terminals: {
      async sendAgentMessage() {
        sendCount += 1;
        return { ok: true };
      }
    },
    workspaceSetupRunner: {
      isRunning: () => true,
      start: () => null,
      wait: () => setupFinished
    }
  });

  const sending = service.sendAgentMessage("session-1", {
    message: "Build the catalogue."
  });
  await Promise.resolve();
  assert.equal(sendCount, 0);
  finishSetup({ status: "failed" });
  const result = await sending;
  assert.equal(result.ok, true);
  assert.equal(sendCount, 1);
});

test("live workspace preparation prevents retry and close races", async () => {
  const service = createService({
    project: {
      async createRuntime() {
        return {
          async getSession() {
            return {
              sessionId: "session-1",
              status: "active"
            };
          }
        };
      }
    },
    terminals: {},
    workspaceSetupRunner: {
      isRunning: () => true,
      start() {
        const error = new Error("Workspace preparation is already running.");
        error.code = "vibe64_workspace_setup_running";
        throw error;
      },
      wait: () => null
    }
  });

  const closed = await service.abandonSession("session-1");
  assert.equal(closed.ok, false);
  assert.equal(closed.code, "vibe64_workspace_setup_running");

  const retried = await service.retryWorkspaceSetup("session-1");
  assert.equal(retried.ok, false);
  assert.equal(retried.code, "vibe64_workspace_setup_running");
});

test("an active Save keeps abandonment out of its agent-write window", async () => {
  const lock = agentWriteLockHarness();
  let finishSave;
  let saveStarted;
  const saveStartedPromise = new Promise((resolve) => {
    saveStarted = resolve;
  });
  const saveFinishedPromise = new Promise((resolve) => {
    finishSave = resolve;
  });
  const calls = [];
  const session = {
    sessionId: "session-1",
    sourceReady: true,
    status: "active"
  };
  const runtime = {
    async abandonSession() {
      calls.push("abandon");
      session.status = "abandoned";
      return { ...session };
    },
    async clearSessionClosing() {
      calls.push("clear-closing");
    },
    async getSession() {
      return { ...session };
    },
    async markSessionClosing() {
      calls.push("closing");
    },
    store: lock.store
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async closeSessionTerminals() {
        calls.push("terminals");
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const saving = requireAgentWrite(runtime, "session-1", async () => {
    calls.push("save-started");
    saveStarted();
    await saveFinishedPromise;
    calls.push("save-finished");
  });
  await saveStartedPromise;

  const blocked = await service.abandonSession("session-1");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "vibe64_agent_write_mode_busy");
  assert.equal(blocked.retryable, true);
  assert.deepEqual(calls, ["save-started"]);

  finishSave();
  await saving;
  const closed = await service.abandonSession("session-1");
  assert.equal(closed.ok, true);
  assert.deepEqual(calls, [
    "save-started",
    "save-finished",
    "closing",
    "terminals",
    "abandon"
  ]);
  assert.deepEqual(lock.attempts.map((attempt) => attempt.operationName), [
    "agent-write-mode",
    "agent-write-mode",
    "agent-write-mode"
  ]);
});

test("active abandonment keeps Save out of its agent-write window", async () => {
  const lock = agentWriteLockHarness();
  let finishCleanup;
  let cleanupStarted;
  const cleanupStartedPromise = new Promise((resolve) => {
    cleanupStarted = resolve;
  });
  const cleanupFinishedPromise = new Promise((resolve) => {
    finishCleanup = resolve;
  });
  const calls = [];
  const runtime = {
    async abandonSession() {
      calls.push("abandon");
      return { sessionId: "session-1", status: "abandoned" };
    },
    async clearSessionClosing() {},
    async getSession() {
      return { sessionId: "session-1", sourceReady: true, status: "active" };
    },
    async markSessionClosing() {
      calls.push("closing");
    },
    store: lock.store
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async closeSessionTerminals() {
        calls.push("terminals-started");
        cleanupStarted();
        await cleanupFinishedPromise;
        calls.push("terminals-finished");
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const closing = service.abandonSession("session-1");
  await cleanupStartedPromise;
  let saveRan = false;
  const save = await runVibe64AgentWriteExclusive(runtime, "session-1", async () => {
    saveRan = true;
  });
  assert.equal(save.acquired, false);
  assert.equal(save.value.code, "vibe64_agent_write_mode_busy");
  assert.equal(save.value.retryable, true);
  assert.equal(saveRan, false);

  finishCleanup();
  const closed = await closing;
  assert.equal(closed.ok, true);
  assert.deepEqual(calls, [
    "closing",
    "terminals-started",
    "terminals-finished",
    "abandon"
  ]);
});

test("failed abandonment cleanup releases the agent-write lock for retry", async () => {
  const lock = agentWriteLockHarness();
  const calls = [];
  let cleanupAttempt = 0;
  const runtime = {
    async abandonSession() {
      calls.push("abandon");
      return { sessionId: "session-1", status: "abandoned" };
    },
    async clearSessionClosing() {
      calls.push("clear-closing");
    },
    async getSession() {
      return { sessionId: "session-1", sourceReady: true, status: "active" };
    },
    async markSessionClosing() {
      calls.push("closing");
    },
    store: lock.store
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async closeSessionTerminals() {
        cleanupAttempt += 1;
        calls.push(`terminals:${cleanupAttempt}`);
        if (cleanupAttempt === 1) {
          const error = new Error("Temporary assistant cleanup failed.");
          error.code = "vibe64_test_cleanup_failed";
          throw error;
        }
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const failed = await service.abandonSession("session-1");
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "vibe64_test_cleanup_failed");
  assert.deepEqual(calls, ["closing", "terminals:1", "clear-closing"]);

  const retried = await service.abandonSession("session-1");
  assert.equal(retried.ok, true);
  assert.deepEqual(calls, [
    "closing",
    "terminals:1",
    "clear-closing",
    "closing",
    "terminals:2",
    "abandon"
  ]);
});

test("concurrent abandonment has one cleanup owner", async () => {
  const lock = agentWriteLockHarness();
  let finishCleanup;
  let cleanupStarted;
  const cleanupStartedPromise = new Promise((resolve) => {
    cleanupStarted = resolve;
  });
  const cleanupFinishedPromise = new Promise((resolve) => {
    finishCleanup = resolve;
  });
  let abandonCount = 0;
  let cleanupCount = 0;
  const runtime = {
    async abandonSession() {
      abandonCount += 1;
      return { sessionId: "session-1", status: "abandoned" };
    },
    async clearSessionClosing() {},
    async getSession() {
      return { sessionId: "session-1", sourceReady: true, status: "active" };
    },
    async markSessionClosing() {},
    store: lock.store
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {
      async closeSessionTerminals() {
        cleanupCount += 1;
        cleanupStarted();
        await cleanupFinishedPromise;
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const first = service.abandonSession("session-1");
  await cleanupStartedPromise;
  const second = await service.abandonSession("session-1");
  assert.equal(second.ok, false);
  assert.equal(second.code, "vibe64_agent_write_mode_busy");
  assert.equal(cleanupCount, 1);
  assert.equal(abandonCount, 0);

  finishCleanup();
  const closed = await first;
  assert.equal(closed.ok, true);
  assert.equal(cleanupCount, 1);
  assert.equal(abandonCount, 1);
});

test("closing a session releases its managed resources after terminals stop", async () => {
  const calls = [];
  const session = {
    sessionId: "session-1",
    sourcePath: "/srv/session-1/source",
    status: "active"
  };
  const runtime = {
    async abandonSession() {
      calls.push("abandon");
      return { ...session, status: "abandoned" };
    },
    async clearSessionClosing() {},
    async getSession() {
      return session;
    },
    async markSessionClosing() {
      calls.push("closing");
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      },
      async releaseSessionResources(input) {
        calls.push(`resources:${input.sessionId}`);
        return { ok: true };
      }
    },
    terminals: {
      async closeSessionTerminals() {
        calls.push("terminals");
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const result = await service.abandonSession("session-1");
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["closing", "terminals", "resources:session-1", "abandon"]);
});

test("closing a source-creation failure does not release resources that were never provisioned", async () => {
  const calls = [];
  const session = {
    metadata: {
      source_creation_failed: "yes"
    },
    sessionId: "failed-source",
    sourceReady: false,
    status: "blocked"
  };
  const runtime = {
    async abandonSession() {
      calls.push("abandon");
      return { ...session, status: "abandoned" };
    },
    async clearSessionClosing() {},
    async getSession() {
      return session;
    },
    async markSessionClosing() {
      calls.push("closing");
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      },
      async releaseSessionResources() {
        calls.push("resources");
        throw new Error("resources must not be released");
      }
    },
    terminals: {
      async closeSessionTerminals() {
        calls.push("terminals");
      }
    },
    workspaceSetupRunner: {
      isRunning: () => false,
      wait: () => null
    }
  });

  const result = await service.abandonSession("failed-source");
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["closing", "terminals", "abandon"]);
});

test("session responses enforce the ordinary three-session policy on the server", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const harness = sessionCreationPolicyHarness({
      initialSessions: [
        { sessionId: "session-1" },
        { sessionId: "session-2" }
      ],
      managed: true,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      scope: "session"
    });

    const available = await harness.service.listSessions();
    assert.deepEqual(available.creation, {
      canCreate: true,
      mode: "direct",
      showCreateAction: true
    });
    assert.deepEqual(available.limits, {
      maxOpenSessions: 3,
      openSessionCount: 2
    });

    const third = await harness.service.createSession();
    assert.equal(third.ok, true);
    assert.equal(third.sessionId, "session-3");
    assert.equal(third.creation.canCreate, false);
    assert.equal(third.creation.showCreateAction, true);
    assert.deepEqual(third.limits, {
      maxOpenSessions: 3,
      openSessionCount: 3
    });

    const rejected = await harness.service.createSession();
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "vibe64_session_creation_limit");
    assert.deepEqual(rejected.details, {
      code: "vibe64_session_creation_limit",
      maxOpenSessions: 3,
      openSessionCount: 3
    });
    assert.equal(vibe64StatusCode(rejected), 409);
    assert.equal(harness.creationInputs.length, 1);
    assert.equal(harness.openSessions.length, 3);
  });
});

test("concurrent shared-database creation admits one request and leaves no rejected record", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let releaseFirstCreation;
    let reportFirstCreation;
    const firstCreationStarted = new Promise((resolve) => {
      reportFirstCreation = resolve;
    });
    const firstCreationCanFinish = new Promise((resolve) => {
      releaseFirstCreation = resolve;
    });
    const harness = sessionCreationPolicyHarness({
      async beforeCreate() {
        reportFirstCreation();
        await firstCreationCanFinish;
      },
      managed: true,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      scope: "project"
    });

    const first = harness.service.createSession({
      vibe64User: { username: "ada" }
    });
    await firstCreationStarted;
    const second = harness.service.createSession({
      vibe64User: { username: "grace" }
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(harness.creationInputs.length, 1);

    releaseFirstCreation();
    const responses = await Promise.all([first, second]);
    const accepted = responses.find((response) => response.ok === true);
    const rejected = responses.find((response) => response.ok === false);

    assert.equal(accepted.sessionId, "session-1");
    assert.deepEqual(accepted.creation, {
      canCreate: false,
      disabledReason: "This project shares one development database. Close its open session before creating another.",
      mode: "direct",
      showCreateAction: false
    });
    assert.deepEqual(accepted.limits, {
      maxOpenSessions: 1,
      openSessionCount: 1
    });
    assert.equal(rejected.code, "vibe64_session_creation_limit");
    assert.equal(vibe64StatusCode(rejected), 409);
    assert.deepEqual(rejected.details, {
      code: "vibe64_session_creation_limit",
      maxOpenSessions: 1,
      openSessionCount: 1
    });
    assert.equal(harness.creationInputs.length, 1);
    assert.deepEqual(harness.creationInputs[0].metadata, {
      created_by: "ada"
    });
    assert.deepEqual(harness.openSessions.map(({ sessionId, status }) => ({ sessionId, status })), [{
      sessionId: "session-1",
      status: "active"
    }]);
  });
});

test("an unfinished renewal durably reserves the shared-database session slot", async (t) => {
  for (const scenario of [
    {
      metadata: { renewal_quiesced_id: "renewal-1" },
      name: "quiesced before successor creation",
      sessionId: "renewal-source",
      status: "renewal_quiesced"
    },
    {
      metadata: {
        renewal_id: "renewal-1",
        renewed_from: "renewal-source"
      },
      name: "hidden successor transition",
      sessionId: "renewal-successor",
      status: "renewal_pending"
    }
  ]) {
    await t.test(scenario.name, async () => {
      await withTemporaryRoot(async (targetRoot) => {
        const harness = sessionCreationPolicyHarness({
          initialSessions: [{
            metadata: scenario.metadata,
            sessionId: scenario.sessionId,
            status: scenario.status
          }],
          managed: true,
          projectRuntimeRoot: projectRuntimeRoot(targetRoot),
          scope: "project"
        });

        const listed = await harness.service.listSessions();
        assert.equal(listed.creation.canCreate, false);
        assert.equal(listed.creation.showCreateAction, false);
        assert.deepEqual(listed.limits, {
          maxOpenSessions: 1,
          openSessionCount: 1
        });
        const rejected = await harness.service.createSession();
        assert.equal(rejected.code, "vibe64_session_creation_limit");
        assert.equal(harness.creationInputs.length, 0);
      });
    });
  }
});

test("shared-session admission releases its lock before workspace setup starts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let releaseSetup;
    let reportSetupStarted;
    const setupStarted = new Promise((resolve) => {
      reportSetupStarted = resolve;
    });
    const setupCanFinish = new Promise((resolve) => {
      releaseSetup = resolve;
    });
    const harness = sessionCreationPolicyHarness({
      managed: true,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      scope: "project",
      async startWorkspaceSetup() {
        reportSetupStarted();
        await setupCanFinish;
        return { completion: null };
      }
    });

    const acceptedRequest = harness.service.createSession();
    await setupStarted;
    const rejected = await harness.service.createSession();

    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "vibe64_session_creation_limit");
    assert.equal(vibe64StatusCode(rejected), 409);
    releaseSetup();
    const accepted = await acceptedRequest;
    assert.equal(accepted.ok, true);
    assert.equal(accepted.sessionId, "session-1");
  });
});

test("shared-session admission releases its lock before realtime publication", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let releasePublication;
    let reportPublicationStarted;
    const publicationStarted = new Promise((resolve) => {
      reportPublicationStarted = resolve;
    });
    const publicationCanFinish = new Promise((resolve) => {
      releasePublication = resolve;
    });
    const harness = sessionCreationPolicyHarness({
      managed: true,
      async publishSessionChanged() {
        reportPublicationStarted();
        await publicationCanFinish;
      },
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      scope: "project"
    });

    const acceptedRequest = harness.service.createSession();
    await publicationStarted;
    const rejected = await harness.service.createSession();

    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "vibe64_session_creation_limit");
    releasePublication();
    const accepted = await acceptedRequest;
    assert.equal(accepted.ok, true);
    assert.equal(accepted.sessionId, "session-1");
  });
});

test("post-creation setup and publication failures do not falsify a durable session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let publicationCalls = 0;
    const harness = sessionCreationPolicyHarness({
      managed: true,
      async publishSessionChanged() {
        publicationCalls += 1;
        throw new Error("simulated realtime failure");
      },
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      scope: "project",
      async startWorkspaceSetup() {
        throw new Error("simulated setup start failure");
      }
    });

    const accepted = await harness.service.createSession();

    assert.equal(accepted.ok, true);
    assert.equal(accepted.sessionId, "session-1");
    assert.equal(accepted.creation.canCreate, false);
    assert.equal(publicationCalls, 1);
    assert.equal(harness.openSessions.length, 1);
    const rejected = await harness.service.createSession();
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, "vibe64_session_creation_limit");
  });
});

test("new sessions publish running workspace preparation and its eventual result", async () => {
  const publications = [];
  const sessionCreationInputs = [];
  let finishSetup;
  const session = {
    sessionId: "session-1",
    status: "active",
    workspaceSetup: {
      status: "unconfigured"
    }
  };
  const runtime = {
    async createSession(input) {
      sessionCreationInputs.push(input);
      return session;
    },
    async getSession() {
      return { ...session };
    },
    async listSessionSummaries() {
      return sessionCreationInputs.length > 0 ? [{ ...session }] : [];
    }
  };
  const setupFinished = new Promise((resolve) => {
    finishSetup = () => {
      session.workspaceSetup = {
        currentLabel: "Install dependencies",
        status: "succeeded"
      };
      resolve(session.workspaceSetup);
    };
  });
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      },
      async developmentDatabasePolicy({ openSessions = [] } = {}) {
        return developmentDatabasePolicy({
          managed: false,
          openSessions
        });
      },
      async runProjectSessionPolicyExclusive(operation) {
        return operation();
      }
    },
    async publishSessionChanged(...args) {
      publications.push(args);
    },
    terminals: {},
    workspaceSetupRunner: {
      isRunning: () => true,
      start() {
        session.workspaceSetup = {
          currentLabel: "Install dependencies",
          status: "running"
        };
        return {
          completion: setupFinished,
          state: session.workspaceSetup
        };
      },
      wait: () => setupFinished
    }
  });

  const vibe64User = {
    gid: 1001,
    home: "/home/ada",
    uid: 1001,
    username: "ada"
  };
  const created = await service.createSession({
    originId: "tab:test",
    vibe64User
  });
  assert.equal(created.workspaceSetup.status, "running");
  assert.deepEqual(sessionCreationInputs, [{
    metadata: {
      created_by: "ada"
    },
    sourceContext: {
      vibe64User
    }
  }]);
  assert.equal(publications[0][1].reason, "session-created");
  assert.equal(publications[0][1].session.workspaceSetup.status, "running");

  finishSetup();
  await setupFinished;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(publications[1][1].reason, "workspace-setup-completed");
  assert.equal(publications[1][1].session.workspaceSetup.status, "succeeded");
});

test("workspace preparation starts newly configured recipes and retries failed attempts", async () => {
  let admissionBlocked = false;
  let status = "succeeded";
  let startCount = 0;
  const retryValues = [];
  const session = () => ({
    sessionId: "session-1",
    status: "active",
    workspaceSetup: { status }
  });
  const runtime = {
    async getSession() {
      return session();
    }
  };
  const service = createService({
    project: {
      async createRuntime() {
        return runtime;
      }
    },
    terminals: {},
    workspaceSetupRunner: {
      isRunning: () => false,
      async start(input) {
        startCount += 1;
        retryValues.push(input.retry);
        if (admissionBlocked) {
          return {
            code: "vibe64_agent_write_mode_busy",
            error: "Another assistant operation is starting. Try again in a moment.",
            ok: false,
            retryable: true
          };
        }
        status = "running";
        return {
          completion: null,
          state: { status }
        };
      },
      wait: () => null
    }
  });

  const rejected = await service.retryWorkspaceSetup("session-1");
  assert.equal(rejected.code, "vibe64_workspace_setup_retry_not_available");
  assert.equal(startCount, 0);

  status = "unconfigured";
  const newlyConfigured = await service.retryWorkspaceSetup("session-1");
  assert.equal(newlyConfigured.ok, true);
  assert.equal(newlyConfigured.workspaceSetup.status, "running");
  assert.equal(startCount, 1);
  assert.deepEqual(retryValues, [true]);

  status = "failed";
  const retried = await service.retryWorkspaceSetup("session-1");
  assert.equal(retried.ok, true);
  assert.equal(retried.workspaceSetup.status, "running");
  assert.equal(startCount, 2);
  assert.deepEqual(retryValues, [true, true]);

  status = "failed";
  admissionBlocked = true;
  const blocked = await service.retryWorkspaceSetup("session-1");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "vibe64_agent_write_mode_busy");
  assert.equal(blocked.retryable, true);
  assert.equal(status, "failed");
  assert.equal(startCount, 3);
});
