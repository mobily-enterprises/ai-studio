import assert from "node:assert/strict";
import test from "node:test";

import {
  SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE,
  createSessionAgentManager
} from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import {
  VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE
} from "@local/vibe64-runtime/shared";

test("session agent manager sends a message through the selected provider", async () => {
  let received = null;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async sendMessage(context, input) {
        received = { context, input };
        return {
          delivered: true,
          ok: true
        };
      }
    }]
  });
  const turnOwnership = {
    threadId: "thread-1",
    turnId: "turn-1"
  };

  const result = await manager.sendMessage("session-1", {
    message: "Continue"
  }, {
    agentSettings: {
      providerId: "codex"
    },
    turnOwnership
  });

  assert.equal(received.input.message, "Continue");
  assert.deepEqual(received.context.turnOwnership, turnOwnership);
  assert.equal(result.delivered, true);
  assert.equal(result.providerId, "codex");
  assert.equal(result.transportId, "codex_app_server");
});

test("session agent manager exposes focused provider conversations", async () => {
  const calls = [];
  const onEvent = () => null;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async createConversation(context, input) {
        calls.push(["create", context, input]);
        return {
          conversationId: "conversation-1",
          ok: true
        };
      },
      async startConversationTurn(context, input) {
        calls.push(["start", context, input]);
        return {
          ok: true,
          runId: "run-1"
        };
      },
      async waitForConversationTurn(context, input) {
        calls.push(["wait", context, input]);
        return {
          message: "Done",
          ok: true
        };
      }
    }]
  });
  const options = {
    onEvent
  };

  const created = await manager.createConversation("session-1", {}, options);
  const started = await manager.startConversationTurn("session-1", {
    conversationId: created.conversationId,
    message: "Do the task."
  }, options);
  const result = await manager.waitForConversationTurn("session-1", {
    conversationId: created.conversationId,
    runId: started.runId
  }, options);

  assert.equal(result.message, "Done");
  assert.deepEqual(calls.map(([name]) => name), ["create", "start", "wait"]);
  assert.equal(calls[2][1].onEvent, onEvent);
});

test("session agent manager rejects unavailable providers", async () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async sendMessage() {
        throw new Error("Codex must not be called.");
      }
    }]
  });

  await assert.rejects(
    manager.sendMessage("session-1", {
      message: "Hello"
    }, {
      providerId: "opencode"
    }),
    (error) => error?.code === VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE
  );
});

test("session agent manager keeps one provider bound to a session", async () => {
  const adapter = (id) => ({
    id,
    transportId: `${id}_transport`,
    async ensureSession() {
      return { ok: true };
    }
  });
  const manager = createSessionAgentManager({
    providers: [adapter("codex"), adapter("opencode")]
  });

  await manager.ensureSession("session-1", {
    providerId: "codex"
  });
  await assert.rejects(
    manager.ensureSession("session-1", {
      providerId: "opencode"
    }),
    (error) => error?.code === SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE
  );
});

test("session agent manager describes providers without binding a session", () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server"
    }]
  });

  assert.deepEqual(manager.describeProvider(), {
    providerId: "codex",
    transportId: "codex_app_server"
  });
  assert.equal(manager.binding("session-1"), "");
});
