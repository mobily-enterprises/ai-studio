import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_TOOL_POLICIES,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  VIBE64_ASSISTANT_ENGINE_IDS
} from "../../packages/vibe64-runtime/src/shared/index.js";
import {
  OPENCODE_ECONOMY_PROFILE_REVISION,
  createOpenCodeSessionAgentProvider,
  resolveOpenCodeEconomyExecutionProfile
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js";

const selection = Object.freeze({
  agentId: "build",
  catalogRevision: `sha256:${"a".repeat(64)}`,
  engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
  modelId: "deepseek-chat",
  modelProviderId: "deepseek",
  schema: "vibe64.assistant-selection.v1",
  variantId: "high"
});

test("OpenCode resolves every Vibe64 helper workload to the selected model and a deny-all policy", () => {
  for (const workloadId of Object.values(VIBE64_AGENT_EXECUTION_WORKLOAD_IDS)) {
    const profile = resolveOpenCodeEconomyExecutionProfile({
      assistantSelection: selection
    }, {
      profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
      workloadId
    });
    assert.equal(profile.profileId, VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY);
    assert.equal(profile.workloadId, workloadId);
    assert.equal(profile.providerId, VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE);
    assert.equal(profile.model, "deepseek-chat");
    assert.equal(profile.thinking, "high");
    assert.equal(profile.revision, OPENCODE_ECONOMY_PROFILE_REVISION);
    assert.deepEqual(profile.policy, {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: VIBE64_AGENT_EXECUTION_TOOL_POLICIES.NONE
    });
    assert.equal(profile.request.allowProviderModelFallback, false);
  }
});

test("OpenCode refuses helper profiles without its durable provider and model selection", () => {
  assert.throws(
    () => resolveOpenCodeEconomyExecutionProfile({
      assistantSelection: { ...selection, engineId: "codex" }
    }, {
      profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
      workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE
    }),
    (error) => error?.code === "vibe64_agent_execution_profile_model_unavailable"
  );
});

test("OpenCode provider advertises and audits its helper execution profile on turns", async () => {
  const events = [];
  const calls = [];
  const controller = {
    async runDetachedChatTurn(...args) {
      calls.push(args);
      return {
        ok: true,
        text: '{"subject":"Add multi-AI sessions"}',
        threadId: "ses_helper"
      };
    }
  };
  const provider = createOpenCodeSessionAgentProvider({ controller });
  const profile = resolveOpenCodeEconomyExecutionProfile({
    assistantSelection: selection
  }, {
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
    workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE
  });
  const result = await provider.runDetachedChatTurn({
    assistantSelection: selection,
    onEvent: (event) => events.push(event),
    runtime: { stateRoot: "/runtime" },
    session: { sessionId: "session-1" },
    sessionId: "session-1"
  }, {
    executionProfile: profile,
    prompt: "Name this work"
  });

  assert.deepEqual(provider.executionProfiles, [VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "session-1");
  assert.equal(calls[0][1].executionProfile, profile);
  assert.deepEqual(events, [{
    executionProfile: profile,
    type: "execution-profile"
  }]);
  assert.deepEqual(result.executionProfile, profile);
});
