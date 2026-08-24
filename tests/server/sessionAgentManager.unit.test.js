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

test("session agent manager describes providers without binding a session", async () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server"
    }]
  });

  assert.deepEqual(await manager.describeProvider(), {
    providerId: "codex",
    transportId: "codex_app_server"
  });
  assert.equal(manager.binding("session-1"), "");
});

test("session agent manager binds and delegates authoritative provider descriptions", async () => {
  let received = null;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async describeProvider(context) {
        received = context;
        return {
          accountIdentitySignature: `sha256:${"a".repeat(64)}`,
          providerId: "codex",
          transportId: "codex_app_server"
        };
      }
    }, {
      id: "other",
      transportId: "other_transport"
    }]
  });
  const session = { sessionId: "session-1" };
  const description = await manager.describeProvider({
    providerId: "codex",
    runtime: { stateRoot: "/runtime" },
    session
  });

  assert.deepEqual(description, {
    accountIdentitySignature: `sha256:${"a".repeat(64)}`,
    providerId: "codex",
    transportId: "codex_app_server"
  });
  assert.equal(Object.isFrozen(description), true);
  assert.equal(received.session, session);
  assert.equal(manager.binding("session-1"), "codex");
  await assert.rejects(
    manager.describeProvider({ providerId: "other", session }),
    (error) => error.code === SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE
  );
});

test("session agent manager rejects non-fingerprint account descriptions", async () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async describeProvider() {
        return {
          accountIdentitySignature: "credential-shaped-account-identity",
          providerId: "codex",
          transportId: "codex_app_server"
        };
      }
    }]
  });

  await assert.rejects(
    manager.describeProvider({ session: { sessionId: "session-1" } }),
    /did not return a stable account identity/u
  );
});

test("session agent manager never resolves a live model profile before economy cleanup", async () => {
  let deletes = 0;
  let resolutions = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async deleteDetachedChatThread(_context, input) {
        deletes += 1;
        assert.deepEqual(input.executionProfile, {
          profileId: "economy",
          workloadId: "source_explanation"
        });
        return { ok: true };
      },
      async resolveExecutionProfile() {
        resolutions += 1;
        throw new Error("Cleanup must not consult the live model catalog.");
      }
    }]
  });

  const result = await manager.deleteDetachedChatThread("session-1", {
    executionProfile: {
      profileId: "economy",
      workloadId: "source_explanation"
    },
    threadId: "thread-1"
  });
  assert.equal(result.ok, true);
  assert.equal(deletes, 1);
  assert.equal(resolutions, 0);
});

test("session agent manager rejects malformed economy cleanup markers before provider work", async () => {
  let deletes = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async deleteDetachedChatThread() {
        deletes += 1;
        throw new Error("Malformed cleanup must not reach the provider.");
      }
    }]
  });

  await assert.rejects(
    manager.deleteDetachedChatThread("session-1", {
      executionProfile: "economy",
      threadId: "thread-1"
    }),
    (error) => (
      error.code === "vibe64_agent_execution_profile_invalid" &&
      error.field === "request"
    )
  );
  assert.equal(deletes, 0);
});

test("session agent manager resolves semantic execution profiles before provider work", async () => {
  const calls = [];
  const abortController = new AbortController();
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile(context, request) {
        calls.push(["resolve", context, request]);
        return {
          limits: {
            maxInputCharacters: 10_000,
            maxOutputCharacters: 1_000,
            timeoutMs: 30_000
          },
          model: "provider-owned-model",
          policy: {
            environmentAccess: false,
            networkAccess: false,
            repositoryWrite: false,
            tools: "none"
          },
          profileId: request.profileId,
          providerId: "codex",
          request: {
            allowProviderModelFallback: false,
            reasoning: true,
            summary: false
          },
          revision: "codex-economy-v1",
          thinking: "low",
          workloadId: request.workloadId
        };
      },
      async runDetachedChatTurn(context, input) {
        calls.push(["run", context, input]);
        return {
          executionProfile: input.executionProfile,
          ok: true,
          text: "Done"
        };
      }
    }]
  });

  const result = await manager.runDetachedChatTurn("session-1", {
    executionProfile: {
      profileId: "economy",
      workloadId: "source_explanation"
    },
    prompt: "Explain this source."
  }, {
    signal: abortController.signal
  });

  assert.deepEqual(calls.map(([operation]) => operation), ["resolve", "run"]);
  assert.deepEqual(calls[0][2], {
    profileId: "economy",
    workloadId: "source_explanation"
  });
  assert.equal(calls[0][1].signal, abortController.signal);
  assert.equal(calls[1][1].signal, abortController.signal);
  assert.equal(calls[1][2].executionProfile.model, "provider-owned-model");
  assert.equal(result.executionProfile.revision, "codex-economy-v1");
});

test("session agent manager executes its exact pre-resolved profile without resolving again", async () => {
  let resolutions = 0;
  const detachedProfiles = [];
  const providerResolution = {
    limits: {
      maxInputCharacters: 10_000,
      maxOutputCharacters: 1_000,
      timeoutMs: 30_000
    },
    model: "provider-owned-model",
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
    revision: "codex-economy-v1",
    thinking: "low",
    workloadId: "source_explanation"
  };
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile() {
        resolutions += 1;
        return providerResolution;
      },
      async runDetachedChatTurn(_context, input) {
        detachedProfiles.push(input.executionProfile);
        return {
          executionProfile: input.executionProfile,
          ok: true,
          text: "Done"
        };
      },
      async streamDetachedChatTurn(_context, input) {
        detachedProfiles.push(input.executionProfile);
        return {
          executionProfile: input.executionProfile,
          ok: true,
          text: "Streamed"
        };
      }
    }]
  });

  const resolved = await manager.resolveExecutionProfile("session-1", {
    profileId: "economy",
    workloadId: "source_explanation"
  });
  const result = await manager.runDetachedChatTurn("session-1", {
    executionProfile: resolved,
    prompt: "Explain this source."
  });
  const streamed = await manager.streamDetachedChatTurn("session-1", {
    executionProfile: resolved,
    prompt: "Explain this source again."
  });

  assert.equal(resolutions, 1);
  assert.equal(Object.isFrozen(resolved), true);
  assert.deepEqual(detachedProfiles, [providerResolution, providerResolution]);
  assert.deepEqual(result.executionProfile, providerResolution);
  assert.deepEqual(streamed.executionProfile, providerResolution);
});

test("session agent manager rejects copied, forged, and cross-session pre-resolved profiles", async () => {
  let detachedTurns = 0;
  const providerResolution = {
    limits: {
      maxInputCharacters: 10_000,
      maxOutputCharacters: 1_000,
      timeoutMs: 30_000
    },
    model: "provider-owned-model",
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
    revision: "codex-economy-v1",
    thinking: "low",
    workloadId: "source_explanation"
  };
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile() {
        return providerResolution;
      },
      async runDetachedChatTurn() {
        detachedTurns += 1;
        return { ok: true };
      }
    }]
  });
  const resolved = await manager.resolveExecutionProfile("session-1", {
    profileId: "economy",
    workloadId: "source_explanation"
  });

  for (const [sessionId, executionProfile] of [
    ["session-1", providerResolution],
    ["session-1", { ...resolved }],
    ["session-2", resolved]
  ]) {
    await assert.rejects(
      manager.runDetachedChatTurn(sessionId, {
        executionProfile,
        prompt: "Explain this source."
      }),
      (error) => (
        error.code === "vibe64_agent_execution_profile_invalid" &&
        error.field === "executionProfile"
      )
    );
  }
  await manager.closeSession("session-1");
  await assert.rejects(
    manager.runDetachedChatTurn("session-1", {
      executionProfile: resolved,
      prompt: "Do not reuse a profile from a closed session binding."
    }),
    (error) => (
      error.code === "vibe64_agent_execution_profile_invalid" &&
      error.field === "executionProfile"
    )
  );
  assert.equal(detachedTurns, 0);
});

test("session agent manager rejects malformed provider resolutions before provider work", async () => {
  let detachedTurns = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile(_context, request) {
        return {
          limits: {
            maxInputCharacters: 10_000,
            maxOutputCharacters: 1_000,
            timeoutMs: 30_000
          },
          model: "provider-owned-model",
          policy: {
            environmentAccess: false,
            networkAccess: true,
            repositoryWrite: false,
            tools: "none"
          },
          profileId: request.profileId,
          providerId: "codex",
          request: {
            allowProviderModelFallback: false,
            reasoning: true,
            summary: false
          },
          revision: "codex-economy-v1",
          thinking: "low",
          workloadId: request.workloadId
        };
      },
      async runDetachedChatTurn() {
        detachedTurns += 1;
        throw new Error("Malformed provider resolutions must not reach detached work.");
      }
    }]
  });

  await assert.rejects(
    manager.runDetachedChatTurn("session-1", {
      executionProfile: {
        profileId: "economy",
        workloadId: "source_explanation"
      },
      prompt: "Explain this source."
    }),
    (error) => (
      error.code === "vibe64_agent_execution_profile_unsafe" &&
      error.field === "policy.networkAccess"
    )
  );
  assert.equal(detachedTurns, 0);
});

test("session agent manager rejects provider resolution identity mismatches before detached work", async () => {
  const validResolution = {
    limits: {
      maxInputCharacters: 10_000,
      maxOutputCharacters: 1_000,
      timeoutMs: 30_000
    },
    model: "provider-owned-model",
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
    revision: "codex-economy-v1",
    thinking: "low",
    workloadId: "source_explanation"
  };

  for (const mismatch of [
    {
      field: "profileId",
      value: "interactive",
      verify(error) {
        return error.code === "vibe64_agent_execution_profile_unknown" &&
          error.profileId === "interactive";
      }
    },
    {
      field: "providerId",
      value: "other",
      verify(error) {
        return error.code === "vibe64_agent_execution_profile_invalid" &&
          error.field === "resolution.providerId" &&
          error.expected === "codex" &&
          error.actual === "other";
      }
    },
    {
      field: "workloadId",
      value: "prompt_hint",
      verify(error) {
        return error.code === "vibe64_agent_execution_profile_invalid" &&
          error.field === "resolution.workloadId" &&
          error.expected === "source_explanation" &&
          error.actual === "prompt_hint";
      }
    }
  ]) {
    let detachedTurns = 0;
    const manager = createSessionAgentManager({
      providers: [{
        id: "codex",
        transportId: "codex_app_server",
        async resolveExecutionProfile() {
          return {
            ...validResolution,
            [mismatch.field]: mismatch.value
          };
        },
        async runDetachedChatTurn() {
          detachedTurns += 1;
          throw new Error("Mismatched provider resolutions must not reach detached work.");
        }
      }]
    });

    await assert.rejects(
      manager.runDetachedChatTurn("session-1", {
        executionProfile: {
          profileId: "economy",
          workloadId: "source_explanation"
        },
        prompt: "Explain this source."
      }),
      mismatch.verify
    );
    assert.equal(detachedTurns, 0);
  }
});

test("session agent manager validates direct provider resolution identity before attribution", async () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile(requestContext, request) {
        assert.equal(requestContext.providerId, "codex");
        return {
          limits: {
            maxInputCharacters: 10_000,
            maxOutputCharacters: 1_000,
            timeoutMs: 30_000
          },
          model: "provider-owned-model",
          policy: {
            environmentAccess: false,
            networkAccess: false,
            repositoryWrite: false,
            tools: "none"
          },
          profileId: request.profileId,
          providerId: "other",
          request: {
            allowProviderModelFallback: false,
            reasoning: true,
            summary: false
          },
          revision: "codex-economy-v1",
          thinking: "low",
          workloadId: request.workloadId
        };
      }
    }]
  });

  await assert.rejects(
    manager.resolveExecutionProfile("session-1", {
      profileId: "economy",
      workloadId: "source_explanation"
    }),
    (error) => (
      error.code === "vibe64_agent_execution_profile_invalid" &&
      error.field === "resolution.providerId" &&
      error.expected === "codex" &&
      error.actual === "other"
    )
  );
});

test("session agent manager rejects consumer-owned execution details before provider resolution", async () => {
  let providerCalls = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile() {
        providerCalls += 1;
        throw new Error("Malformed semantic requests must not reach the provider.");
      },
      async runDetachedChatTurn() {
        providerCalls += 1;
        throw new Error("Detached work must not start.");
      }
    }]
  });

  await assert.rejects(manager.runDetachedChatTurn("session-1", {
    executionProfile: {
      model: "consumer-must-not-control-this",
      profileId: "economy",
      workloadId: "source_explanation"
    },
    prompt: "Explain this source."
  }), (error) => (
    error.code === "vibe64_agent_execution_profile_invalid" &&
    error.field === "request.model"
  ));
  assert.equal(providerCalls, 0);
});

test("session agent manager fails closed when a provider cannot resolve a requested profile", async () => {
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async runDetachedChatTurn() {
        throw new Error("Detached work must not start.");
      }
    }]
  });

  await assert.rejects(
    manager.runDetachedChatTurn("session-1", {
      executionProfile: {
        profileId: "economy",
        workloadId: "source_explanation"
      },
      prompt: "Explain this source."
    }),
    /does not implement resolveExecutionProfile/u
  );
});

test("session agent manager surfaces required Codex authentication before economy work starts", async () => {
  let detachedTurns = 0;
  const manager = createSessionAgentManager({
    providers: [{
      id: "codex",
      transportId: "codex_app_server",
      async resolveExecutionProfile() {
        const error = new Error(
          "Codex could not activate the selected account for isolated economy work. Reconnect Codex and retry."
        );
        error.code = "vibe64_codex_economy_auth_unavailable";
        throw error;
      },
      async runDetachedChatTurn() {
        detachedTurns += 1;
        throw new Error("Unauthenticated economy work must not start.");
      }
    }]
  });

  await assert.rejects(
    manager.runDetachedChatTurn("session-1", {
      executionProfile: {
        profileId: "economy",
        workloadId: "source_explanation"
      },
      prompt: "Explain this source."
    }),
    (error) => (
      error.code === "vibe64_codex_economy_auth_unavailable" &&
      /Reconnect Codex and retry/u.test(error.message)
    )
  );
  assert.equal(detachedTurns, 0);
});
