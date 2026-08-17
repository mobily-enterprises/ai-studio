import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_ABANDON_SESSION,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_DIFF,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RETRY_WORKSPACE_SETUP,
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
    ACTION_LIST_SESSIONS,
    ACTION_CREATE_SESSION,
    ACTION_UPDATE_CURRENT_SESSION,
    ACTION_INSPECT_SESSION,
    ACTION_INSPECT_SESSION_DIFF,
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
