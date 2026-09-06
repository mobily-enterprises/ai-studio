import assert from "node:assert/strict";
import test from "node:test";

import {
  vibe64Driver
} from "../../packages/vibe64-genesis/src/server/promptContext.js";
import {
  createCodexSessionAgentProvider
} from "../../packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js";
import {
  createOpenCodeSessionAgentProvider
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js";
import {
  createSessionAgentManager,
  defineEphemeralAssistantScope
} from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";

const catalogRevision = `sha256:${"a".repeat(64)}`;

test("generic ephemeral assistant scope is exact, bounded, and independent of projects", () => {
  const scope = defineEphemeralAssistantScope({
    environment: {},
    id: "repair_123",
    runtimeRoot: "/tmp/vibe64-ephemeral-runtime",
    stableContext: "Trusted host context",
    workdir: "/tmp/vibe64-ephemeral-workdir"
  });
  assert.equal(scope.id, "repair_123");
  assert.equal(scope.stableContext, "Trusted host context");
  assert.equal(Object.isFrozen(scope), true);
  assert.equal(vibe64Driver({
    scope: "ephemeral",
    stableContext: scope.stableContext
  }), scope.stableContext);
  assert.throws(() => defineEphemeralAssistantScope({
    ...scope,
    projectSlug: "should-not-exist"
  }), /unsupported fields: projectSlug/u);
  assert.throws(() => defineEphemeralAssistantScope({
    ...scope,
    stableContext: "x".repeat((64 * 1024) + 1)
  }), /bounded stable context/u);
  const missingRuntimeRoot = { ...scope };
  delete missingRuntimeRoot.runtimeRoot;
  assert.throws(() => defineEphemeralAssistantScope(missingRuntimeRoot), /missing required fields: runtimeRoot/u);
  assert.throws(() => defineEphemeralAssistantScope({
    ...scope,
    stableContext: { text: "not a string" }
  }), /stable context must be a string/u);
  assert.throws(() => vibe64Driver({
    conversationKind: "system-repair",
    scope: "ephemeral",
    stableContext: "No hosted kinds in public Genesis."
  }), /unsupported fields: conversationKind/u);
});

for (const engineId of ["codex", "opencode"]) {
  test(`${engineId} reuses its provider lifecycle for one non-project ephemeral conversation`, async () => {
    const calls = [];
    const controller = conversationController(calls);
    const provider = engineId === "codex"
      ? createCodexSessionAgentProvider({ controller })
      : createOpenCodeSessionAgentProvider({ controller });
    const manager = createSessionAgentManager({
      providers: [provider],
      async readAssistantAccess() {
        return {
          available: true,
          ownerOnly: true
        };
      }
    });
    const selection = {
      agentId: engineId,
      catalogRevision,
      engineId,
      modelId: "model-1",
      modelProviderId: engineId === "codex" ? "openai" : "provider-1",
      schema: "vibe64.assistant-selection.v1",
      variantId: "low"
    };
    const scope = {
      environment: {},
      id: `${engineId}_ephemeral_1`,
      runtimeRoot: `/tmp/${engineId}-ephemeral-runtime`,
      stableContext: "Host-supplied context without tools.",
      workdir: `/tmp/${engineId}-ephemeral-workdir`
    };
    const options = {
      assistantSelection: selection,
      vibe64User: { role: "owner", username: "owner" }
    };

    const created = await manager.createEphemeralConversation(scope, {}, options);
    const started = await manager.startEphemeralConversationTurn(scope, {
      conversationId: created.conversationId,
      message: "Inspect this state unchanged.",
      messageId: "message_1"
    }, options);
    const read = await manager.readEphemeralConversation(scope, {
      conversationId: created.conversationId,
      runId: started.runId
    }, options);
    const waited = await manager.waitForEphemeralConversationTurn(scope, {
      conversationId: created.conversationId,
      runId: started.runId
    }, options);
    await manager.stopEphemeralConversation(scope, {
      conversationId: created.conversationId,
      runId: started.runId
    }, options);
    await manager.deleteEphemeralConversation(scope, {
      conversationId: created.conversationId
    }, options);

    assert.equal(read.message, "Done");
    assert.equal(waited.message, "Done");
    assert.deepEqual(calls.map((call) => call.name), [
      "create",
      "start",
      "read",
      "wait",
      "stop",
      "delete"
    ]);
    for (const call of calls) {
      assert.equal(call.sessionId, scope.id);
      assert.equal(call.options.assistantScope.id, scope.id);
      assert.equal(call.options.assistantScope.stableContext, scope.stableContext);
      if (engineId === "opencode") {
        assert.equal(call.options.runtime, null);
        assert.equal(call.options.session, null);
      }
    }
    assert.equal(calls.find((call) => call.name === "start").input.message, "Inspect this state unchanged.");
    assert.equal(manager.binding(scope.id), "");
  });
}

test("owner-only assistant access rejects a member before provider creation", async () => {
  let providerCalls = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async createConversation() {
        providerCalls += 1;
        return { conversationId: "conversation_1", ok: true };
      }
    }],
    async readAssistantAccess() {
      return { available: true, ownerOnly: true };
    }
  });
  await assert.rejects(() => manager.createEphemeralConversation({
    environment: {},
    id: "member_ephemeral",
    runtimeRoot: "/tmp/member-ephemeral-runtime",
    stableContext: "Trusted context",
    workdir: "/tmp/member-ephemeral-workdir"
  }, {}, {
    assistantSelection: {
      agentId: "codex",
      catalogRevision,
      engineId: "codex",
      modelId: "model-1",
      modelProviderId: "openai",
      variantId: "low"
    },
    vibe64User: { role: "member" }
  }), /owner/u);
  assert.equal(providerCalls, 0);
});

function conversationController(calls) {
  const capture = (name, result) => async (sessionId, input = {}, options = {}) => {
    calls.push({ input, name, options, sessionId });
    return result;
  };
  return {
    createConversation: capture("create", { conversationId: "conversation_1", ok: true }),
    deleteConversation: capture("delete", { deleted: true, ok: true }),
    readConversation: capture("read", { message: "Done", ok: true, status: "completed" }),
    startConversationTurn: capture("start", { ok: true, runId: "run_1", status: "inProgress" }),
    stopConversation: capture("stop", { ok: true, status: "interrupted" }),
    waitForConversationTurn: capture("wait", { message: "Done", ok: true, status: "completed" })
  };
}
