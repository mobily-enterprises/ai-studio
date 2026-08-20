import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_INSPECT_REPOSITORY_HISTORY,
  ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
  ACTION_INSPECT_REPOSITORY_VERSION_FILES,
  ACTION_ABANDON_SESSION,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_CHANGE_DIFF,
  ACTION_INSPECT_SESSION_CHANGES,
  ACTION_INSPECT_SESSION_WORK,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_SAVE_SESSION_WORK,
  ACTION_CHECK_SESSION_UPDATES,
  ACTION_UPDATE_SESSION_WORK,
  ACTION_UPDATE_CURRENT_SESSION,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_INTERRUPT_AGENT_TURN,
  ACTION_BROADCAST_SESSION_VIEW_STATE,
  ACTION_BROADCAST_SESSION_PREVIEW_STATE,
  createSessionActions
} from "../../packages/vibe64-sessions/src/server/actions.js";
import {
  createService
} from "../../packages/vibe64-sessions/src/server/service.js";
import {
  createSessionChangedPublisher
} from "../../packages/vibe64-sessions/src/server/events.js";

test("sessions expose only direct chat and source actions", () => {
  assert.deepEqual(createSessionActions({ sessions: {} }).map((action) => action.id), [
    ACTION_INSPECT_REPOSITORY_HISTORY,
    ACTION_INSPECT_REPOSITORY_VERSION_FILES,
    ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
    ACTION_LIST_SESSIONS,
    ACTION_CREATE_SESSION,
    ACTION_UPDATE_CURRENT_SESSION,
    ACTION_INSPECT_SESSION,
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
    ACTION_BROADCAST_SESSION_VIEW_STATE,
    ACTION_BROADCAST_SESSION_PREVIEW_STATE
  ]);
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
    displayMessage: "Inspect screenshot.png",
    message: "Inspect /tmp/screenshot.png",
    messageId: "message:test",
    originId: "tab:test"
  });

  assert.deepEqual(calls[0][0], "session-1");
  assert.deepEqual(calls[0][1], {
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
  const runtime = {
    async getSession() {
      return { sessionId: "session-1", status: "active" };
    },
    store: {
      async readBackgroundTask() {
        return runningTask;
      },
      async writeBackgroundTaskEvent(_sessionId, _taskId, input) {
        writes.push(input);
        return { ...runningTask, ...input.patch, events: [input.event] };
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
  const runtime = {
    async getSession() {
      return { sessionId: "session-1", status: "active" };
    },
    store: {
      async readBackgroundTask(_sessionId, taskId) {
        return taskId === "update-session"
          ? runningUpdate
          : { id: "save-work", status: "ready" };
      },
      async writeBackgroundTaskEvent(_sessionId, taskId, input) {
        writes.push([taskId, input]);
        return { ...runningUpdate, ...input.patch, events: [input.event], id: taskId };
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
});
