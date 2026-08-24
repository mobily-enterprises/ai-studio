import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS
} from "../../packages/vibe64-runtime/src/shared/index.js";
import {
  CODEX_ECONOMY_MODEL_CANDIDATES,
  CODEX_ECONOMY_PROFILE_REVISION,
  CODEX_ECONOMY_WORKLOAD_LIMITS,
  createCodexSessionAgentProvider,
  resolveCodexEconomyExecutionProfile
} from "../../packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js";

function catalogModel({
  hidden = false,
  model = "gpt-5.6-luna",
  reasoning = ["low", "medium"],
  upgrade = null
} = {}) {
  return {
    hidden,
    model,
    supportedReasoningEfforts: reasoning.map((reasoningEffort) => ({
      description: reasoningEffort,
      reasoningEffort
    })),
    upgrade
  };
}

function economyRequest(workloadId = VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION) {
  return {
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
    workloadId
  };
}

test("Codex economy resolves Luna-low from the live catalog with bounded tool-free policy", () => {
  const result = resolveCodexEconomyExecutionProfile(economyRequest(), {
    data: [catalogModel()]
  });

  assert.equal(result.model, "gpt-5.6-luna");
  assert.equal(result.thinking, "low");
  assert.equal(result.revision, CODEX_ECONOMY_PROFILE_REVISION);
  assert.deepEqual(result.request, {
    allowProviderModelFallback: false,
    reasoning: true,
    summary: false
  });
  assert.deepEqual(result.policy, {
    environmentAccess: false,
    networkAccess: false,
    repositoryWrite: false,
    tools: "none"
  });
  assert.deepEqual(
    result.limits,
    CODEX_ECONOMY_WORKLOAD_LIMITS[VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION]
  );
});

test("Codex economy ignores catalog upgrade advice and never falls back to an interactive model", () => {
  assert.throws(() => resolveCodexEconomyExecutionProfile(economyRequest(), {
    data: [catalogModel({
      model: "gpt-5.6-sol",
      upgrade: "gpt-5.7-sol"
    })]
  }), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE);
    assert.match(error.message, /No interactive-model fallback was attempted/u);
    assert.deepEqual(error.candidates, ["gpt-5.6-luna"]);
    return true;
  });
});

test("Codex economy fails closed when Luna-low is hidden or low reasoning is unavailable", () => {
  assert.throws(() => resolveCodexEconomyExecutionProfile(economyRequest(), {
    data: [catalogModel({ hidden: true })]
  }), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE);
    return true;
  });

  assert.throws(() => resolveCodexEconomyExecutionProfile(economyRequest(), {
    data: [catalogModel({ reasoning: ["medium", "high"] })]
  }), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.REASONING_UNSUPPORTED);
    assert.equal(error.model, "gpt-5.6-luna");
    assert.equal(error.thinking, "low");
    return true;
  });
});

test("Codex declares one provider-owned economy capability with limits for every bounded workload", () => {
  const provider = createCodexSessionAgentProvider({
    controller: {
      executionProfileModelCatalog: async () => ({ data: [catalogModel()] })
    }
  });

  assert.deepEqual(provider.executionProfiles, [VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY]);
  assert.deepEqual(
    Object.keys(CODEX_ECONOMY_WORKLOAD_LIMITS).sort(),
    Object.values(VIBE64_AGENT_EXECUTION_WORKLOAD_IDS).sort()
  );
  assert.deepEqual(CODEX_ECONOMY_MODEL_CANDIDATES, [{
    model: "gpt-5.6-luna",
    thinking: "low"
  }]);
});

test("Codex adapter resolves the live profile before a detached run and returns only its audit snapshot", async () => {
  const calls = [];
  const abortController = new AbortController();
  const runtime = Object.freeze({ stateRoot: "/runtime/project-a" });
  const session = Object.freeze({ sessionId: "session-a" });
  const controller = {
    async executionProfileModelCatalog(sessionId, options) {
      calls.push(["catalog", sessionId, options]);
      return {
        data: [catalogModel()]
      };
    },
    async runDetachedChatTurn(sessionId, input, options) {
      calls.push(["run", sessionId, input, options]);
      return {
        ok: true,
        text: "{\"answer\":\"Bounded answer\"}"
      };
    }
  };
  const provider = createCodexSessionAgentProvider({ controller });
  const resolution = await provider.resolveExecutionProfile({
    runtime,
    session,
    sessionId: "session-a",
    signal: abortController.signal
  }, economyRequest());
  const result = await provider.runDetachedChatTurn({
    runtime,
    session,
    sessionId: "session-a"
  }, {
    executionProfile: resolution,
    prompt: "Explain this bounded excerpt."
  });

  assert.equal(calls[0][0], "catalog");
  assert.deepEqual(calls[0][2], {
    runtime,
    session,
    signal: abortController.signal,
    timeoutMs: 180_000
  });
  assert.equal(calls[1][0], "run");
  assert.equal(calls[1][2].executionProfile.model, "gpt-5.6-luna");
  assert.equal(calls[1][3].runtime, runtime);
  assert.equal(calls[1][3].session, session);
  assert.equal(result.executionProfile.model, "gpt-5.6-luna");
  assert.equal(result.executionProfile.revision, CODEX_ECONOMY_PROFILE_REVISION);
  assert.equal(Object.hasOwn(result.executionProfile, "enforcement"), false);
});

test("Codex adapter publishes the resolved audit profile before a streamed detached turn", async () => {
  const events = [];
  const runtime = Object.freeze({ stateRoot: "/runtime/project-a" });
  const session = Object.freeze({ sessionId: "session-a" });
  const controller = {
    async streamDetachedChatTurn(_sessionId, input, options = {}) {
      assert.equal(input.executionProfile.model, "gpt-5.6-luna");
      assert.equal(options.runtime, runtime);
      assert.equal(options.session, session);
      options.onEvent({
        threadId: "economy-thread",
        type: "thread"
      });
      return {
        ok: true,
        text: "{\"answer\":\"Bounded answer\"}"
      };
    }
  };
  const provider = createCodexSessionAgentProvider({ controller });
  const resolution = resolveCodexEconomyExecutionProfile(economyRequest(), {
    data: [catalogModel()]
  });

  const result = await provider.streamDetachedChatTurn({
    onEvent(event) {
      events.push(event);
    },
    runtime,
    session,
    sessionId: "session-a"
  }, {
    executionProfile: resolution,
    prompt: "Explain this bounded excerpt."
  });

  assert.deepEqual(events.map((event) => event.type), [
    "execution-profile",
    "thread"
  ]);
  assert.equal(events[0].executionProfile.model, "gpt-5.6-luna");
  assert.equal(events[0].executionProfile.revision, CODEX_ECONOMY_PROFILE_REVISION);
  assert.deepEqual(result.executionProfile, events[0].executionProfile);
});

test("Codex adapter rejects consumer-supplied model knobs", async () => {
  const provider = createCodexSessionAgentProvider({
    controller: {
      executionProfileModelCatalog: async () => ({ data: [catalogModel()] })
    }
  });

  await assert.rejects(provider.resolveExecutionProfile({
    sessionId: "session-a"
  }, {
    ...economyRequest(),
    model: "gpt-5.6-sol"
  }), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.INVALID);
    assert.equal(error.field, "request.model");
    return true;
  });
});

test("Codex adapter fails closed when live model discovery is not wired", async () => {
  const provider = createCodexSessionAgentProvider({
    controller: {}
  });

  await assert.rejects(provider.resolveExecutionProfile({
    sessionId: "session-a"
  }, economyRequest()), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE);
    return true;
  });
});

test("Codex adapter delegates stable account description to the controller", async () => {
  const runtime = Object.freeze({ stateRoot: "/runtime/project-a" });
  const session = Object.freeze({ sessionId: "session-a" });
  const provider = createCodexSessionAgentProvider({
    controller: {
      async describeProvider(sessionId, options) {
        assert.equal(sessionId, "session-a");
        assert.equal(options.runtime, runtime);
        assert.equal(options.session, session);
        return {
          accountIdentitySignature: "sha256:account-a",
          providerId: "codex",
          transportId: "codex_app_server"
        };
      }
    }
  });

  assert.deepEqual(await provider.describeProvider({
    runtime,
    session,
    sessionId: "session-a"
  }), {
    accountIdentitySignature: "sha256:account-a",
    providerId: "codex",
    transportId: "codex_app_server"
  });
});

test("Codex adapter propagates explicit runtime and session through detached cleanup and interruption", async () => {
  const runtime = Object.freeze({ stateRoot: "/runtime/project-a" });
  const session = Object.freeze({ sessionId: "session-a" });
  const calls = [];
  const provider = createCodexSessionAgentProvider({
    controller: {
      async deleteDetachedChatThread(sessionId, input, options) {
        calls.push(["delete", sessionId, input, options]);
        return { ok: true, status: "deleted" };
      },
      async interruptDetachedChatTurn(sessionId, input, options) {
        calls.push(["interrupt", sessionId, input, options]);
        return { interrupted: true, ok: true };
      }
    }
  });
  const context = {
    runtime,
    session,
    sessionId: "session-a"
  };
  const deleteInput = { threadId: "economy-thread" };
  const interruptInput = {
    threadId: "economy-thread",
    turnId: "economy-turn"
  };

  await provider.deleteDetachedChatThread(context, deleteInput);
  await provider.interruptDetachedChatTurn(context, interruptInput);

  assert.deepEqual(calls.map(([operation]) => operation), ["delete", "interrupt"]);
  assert.equal(calls[0][1], "session-a");
  assert.equal(calls[0][2], deleteInput);
  assert.equal(calls[0][3].runtime, runtime);
  assert.equal(calls[0][3].session, session);
  assert.equal(calls[1][1], "session-a");
  assert.equal(calls[1][2], interruptInput);
  assert.equal(calls[1][3].runtime, runtime);
  assert.equal(calls[1][3].session, session);
});
