import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_TOOL_POLICIES,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  Vibe64AgentExecutionProfileError,
  defineVibe64AgentExecutionProfileRequest,
  defineVibe64AgentExecutionProfileResolution,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";

const CODEX_PRODUCT_PROVIDER_ID = "codex";
const CODEX_APP_SERVER_TRANSPORT_ID = "codex_app_server";
const CODEX_ECONOMY_PROFILE_REVISION = "codex-economy-luna-low-v2";
const CODEX_ECONOMY_MODEL_CANDIDATES = Object.freeze([
  Object.freeze({
    model: "gpt-5.6-luna",
    thinking: "low"
  })
]);
const CODEX_ECONOMY_WORKLOAD_LIMITS = Object.freeze({
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE]: Object.freeze({
    maxInputCharacters: 24_000,
    maxOutputCharacters: 512,
    timeoutMs: 30_000
  }),
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.CONVERSATION_SUMMARY]: Object.freeze({
    maxInputCharacters: 200_000,
    maxOutputCharacters: 16_000,
    timeoutMs: 120_000
  }),
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.PROMPT_HINT]: Object.freeze({
    maxInputCharacters: 24_000,
    maxOutputCharacters: 2_000,
    timeoutMs: 30_000
  }),
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SESSION_TITLE]: Object.freeze({
    maxInputCharacters: 24_000,
    maxOutputCharacters: 512,
    timeoutMs: 30_000
  }),
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION]: Object.freeze({
    maxInputCharacters: 100_000,
    maxOutputCharacters: 32_000,
    timeoutMs: 180_000
  })
});

function codexExecutionProfileError(code, message, details = {}) {
  return new Vibe64AgentExecutionProfileError(code, message, details);
}

function codexCatalogRows(value = null) {
  const rows = Array.isArray(value) ? value : value?.data;
  if (!Array.isArray(rows)) {
    throw codexExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE,
      "Codex did not return a usable live model catalog."
    );
  }
  return rows;
}

function codexCatalogReasoningEfforts(model = {}) {
  return new Set((Array.isArray(model?.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
    : [])
    .map((option) => normalizeText(option?.reasoningEffort))
    .filter(Boolean));
}

function codexEconomyExecutionProfileRequest(request = {}) {
  const executionProfile = defineVibe64AgentExecutionProfileRequest(request);
  if (executionProfile.profileId !== VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY) {
    throw codexExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.PROFILE_UNKNOWN,
      `Codex does not provide execution profile ${executionProfile.profileId}.`,
      { profileId: executionProfile.profileId }
    );
  }
  const limits = CODEX_ECONOMY_WORKLOAD_LIMITS[executionProfile.workloadId];
  if (!limits) {
    throw codexExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.WORKLOAD_UNSUPPORTED,
      `Codex economy does not support workload ${executionProfile.workloadId}.`,
      { workloadId: executionProfile.workloadId }
    );
  }
  return {
    executionProfile,
    limits
  };
}

function resolveCodexEconomyExecutionProfile(request = {}, catalog = null) {
  const {
    executionProfile,
    limits
  } = codexEconomyExecutionProfileRequest(request);

  const models = codexCatalogRows(catalog);
  let unsupportedReasoningModel = "";
  let selected = null;
  for (const candidate of CODEX_ECONOMY_MODEL_CANDIDATES) {
    const model = models.find((row) => (
      row?.hidden !== true && normalizeText(row?.model) === candidate.model
    ));
    if (!model) {
      continue;
    }
    if (!codexCatalogReasoningEfforts(model).has(candidate.thinking)) {
      unsupportedReasoningModel ||= candidate.model;
      continue;
    }
    selected = candidate;
    break;
  }
  if (!selected) {
    if (unsupportedReasoningModel) {
      throw codexExecutionProfileError(
        VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.REASONING_UNSUPPORTED,
        `Codex economy model ${unsupportedReasoningModel} does not support low reasoning.`,
        {
          model: unsupportedReasoningModel,
          thinking: "low"
        }
      );
    }
    throw codexExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE,
      "The Codex economy model is not available for this account. No interactive-model fallback was attempted.",
      {
        candidates: CODEX_ECONOMY_MODEL_CANDIDATES.map(({ model }) => model)
      }
    );
  }

  return defineVibe64AgentExecutionProfileResolution({
    ...executionProfile,
    limits,
    model: selected.model,
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: VIBE64_AGENT_EXECUTION_TOOL_POLICIES.NONE
    },
    providerId: CODEX_PRODUCT_PROVIDER_ID,
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false
    },
    revision: CODEX_ECONOMY_PROFILE_REVISION,
    thinking: selected.thinking
  });
}

function normalizeCodexTurn(result = {}) {
  const turn = result?.codexAgentTurn || {};
  const active = turn?.active === true || result?.active === true;
  const id = normalizeText(turn?.turnId || result?.turnId);
  if (!id && !active) {
    return null;
  }
  return {
    active,
    error: normalizeText(turn?.error),
    id,
    startedAt: normalizeText(turn?.startedAt),
    state: normalizeText(turn?.state),
    status: normalizeText(turn?.status || turn?.state),
    threadId: normalizeText(turn?.threadId || result?.codexThreadId || result?.threadId),
    updatedAt: normalizeText(turn?.updatedAt)
  };
}

function normalizeCodexSessionResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const turn = normalizeCodexTurn(source);
  return {
    ...(normalizeText(source.code) ? { code: normalizeText(source.code) } : {}),
    ...(normalizeText(source.error) ? { error: normalizeText(source.error) } : {}),
    ...(normalizeText(source.deliveryMode) ? { deliveryMode: normalizeText(source.deliveryMode) } : {}),
    delivered: source.delivered === true,
    ...(normalizeText(source.operationOutcome) ? { operationOutcome: normalizeText(source.operationOutcome) } : {}),
    ...(normalizeText(source.reason) ? { reason: normalizeText(source.reason) } : {}),
    connectionReused: typeof source.connectionReused === "boolean" ? source.connectionReused : null,
    identity: source.agentIdentity || null,
    ...(typeof source.interrupted === "boolean" ? { interrupted: source.interrupted } : {}),
    newTurnRequired: source.newTurnRequired === true,
    ok: source.ok !== false,
    refreshRecommended: source.refreshRecommended === true,
    retryable: typeof source.retryable === "boolean" ? source.retryable : null,
    sessionUpdated: source.sessionUpdated === true,
    terminal: source.codexTerminal || null,
    thread: {
      id: normalizeText(source.codexThreadId || source.threadId || turn?.threadId)
    },
    turn,
    workdir: normalizeText(source.codexWorkdir)
  };
}

function emitCodexExecutionProfile(context = {}, executionProfile = null) {
  if (!executionProfile) {
    return null;
  }
  const snapshot = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
  if (typeof context.onEvent === "function") {
    context.onEvent({
      executionProfile: snapshot,
      type: "execution-profile"
    });
  }
  return snapshot;
}

function createCodexSessionAgentProvider({
  controller
} = {}) {
  if (!controller) {
    throw new TypeError("Codex session agent provider requires a controller.");
  }
  return Object.freeze({
    executionProfiles: Object.freeze([
      VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY
    ]),
    id: CODEX_PRODUCT_PROVIDER_ID,
    transportId: CODEX_APP_SERVER_TRANSPORT_ID,
    async closeProject(_context, input = {}) {
      return controller.closeAllForProject(input);
    },
    async closeSession({ sessionId }) {
      return controller.closeAllForSession(sessionId);
    },
    async closeTerminal(context, input = {}) {
      return controller.closeTerminal(context.sessionId, input.terminalSessionId);
    },
    async createConversation(context, input = {}) {
      return controller.createConversation(context.sessionId, input);
    },
    async deleteConversation(context, input = {}) {
      return controller.deleteConversation(context.sessionId, input);
    },
    async deleteAttachment(context, input = {}) {
      return controller.deleteAttachment(context.sessionId, input);
    },
    async deleteDetachedChatThread(context, input = {}) {
      return controller.deleteDetachedChatThread(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session
      });
    },
    async describeProvider(context) {
      if (typeof controller.describeProvider !== "function") {
        throw new TypeError("Codex provider account description is unavailable.");
      }
      return controller.describeProvider(context.sessionId, {
        runtime: context.runtime,
        session: context.session
      });
    },
    async ensureSession(context) {
      return normalizeCodexSessionResult(await controller.ensureThread(context.sessionId));
    },
    async interruptDetachedChatTurn(context, input = {}) {
      return controller.interruptDetachedChatTurn(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session
      });
    },
    async interruptTurn(context, input = {}) {
      return normalizeCodexSessionResult(await controller.interruptTurn(context.sessionId, input));
    },
    async invalidateRuntimes(_context, input = {}) {
      return controller.invalidateAppServerRuntimes(input);
    },
    async readConversation(context, input = {}) {
      return controller.readConversation(context.sessionId, input);
    },
    async resolveExecutionProfile(context, input = {}) {
      if (typeof controller.executionProfileModelCatalog !== "function") {
        throw codexExecutionProfileError(
          VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE,
          "Codex economy model discovery is unavailable."
        );
      }
      const {
        executionProfile,
        limits
      } = codexEconomyExecutionProfileRequest(input);
      return resolveCodexEconomyExecutionProfile(
        executionProfile,
        await controller.executionProfileModelCatalog(context.sessionId, {
          runtime: context.runtime,
          session: context.session,
          signal: context.signal,
          timeoutMs: limits.timeoutMs
        })
      );
    },
    async readTerminal(context, input = {}) {
      return controller.readTerminal(context.sessionId, input.terminalSessionId);
    },
    async reconcileSessions(_context, sessions = [], options = {}) {
      return controller.reconcileThreads(sessions, options);
    },
    async resizeTerminal(context, input = {}) {
      return controller.resizeTerminal(context.sessionId, input.terminalSessionId, input.size);
    },
    async runDetachedChatTurn(context, input = {}) {
      const executionProfile = emitCodexExecutionProfile(context, input.executionProfile);
      const result = typeof context.onEvent === "function"
        ? await controller.streamDetachedChatTurn(context.sessionId, input, {
            onEvent: context.onEvent,
            runtime: context.runtime,
            session: context.session
          })
        : await controller.runDetachedChatTurn(context.sessionId, input, {
            runtime: context.runtime,
            session: context.session
          });
      return executionProfile
        ? {
            ...result,
            executionProfile
          }
        : result;
    },
    async sendMessage(context, input = {}) {
      const message = input && typeof input === "object" && !Array.isArray(input)
        ? {
            ...input,
            agentSettings: input.agentSettings || context.agentSettings || {},
            vibe64User: input.vibe64User || context.vibe64User || null
          }
        : {
            agentSettings: context.agentSettings || {},
            message: input,
            vibe64User: context.vibe64User || null
          };
      return normalizeCodexSessionResult(await controller.sendMessage(context.sessionId, message, {
        turnOwnership: context.turnOwnership
      }));
    },
    async sessionState(context) {
      return normalizeCodexSessionResult(await controller.terminalState(context.sessionId, {
        session: context.session
      }));
    },
    async startConversationTurn(context, input = {}) {
      return controller.startConversationTurn(context.sessionId, input);
    },
    async startTerminal(context, input = {}) {
      return controller.startTerminal(context.sessionId, input);
    },
    async stopConversation(context, input = {}) {
      return controller.stopConversation(context.sessionId, input);
    },
    async streamDetachedChatTurn(context, input = {}) {
      const executionProfile = emitCodexExecutionProfile(context, input.executionProfile);
      const result = await controller.streamDetachedChatTurn(context.sessionId, input, {
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session
      });
      return executionProfile
        ? {
            ...result,
            executionProfile
          }
        : result;
    },
    async subscribeTerminal(context, input = {}) {
      return controller.subscribeTerminal(context.sessionId, input.terminalSessionId, input.subscriber);
    },
    async unsubscribeSessions(_context, sessions = []) {
      return controller.unsubscribeKnownAppServerThreads(sessions);
    },
    async uploadAttachment(context, input = {}) {
      return controller.uploadAttachment(context.sessionId, input);
    },
    async waitForConversationTurn(context, input = {}) {
      return controller.waitForConversationTurn(context.sessionId, input, {
        onEvent: context.onEvent
      });
    },
    async writeTerminal(context, input = {}) {
      return controller.writeTerminal(
        context.sessionId,
        input.terminalSessionId,
        input.data,
        input.input
      );
    }
  });
}

export {
  CODEX_APP_SERVER_TRANSPORT_ID,
  CODEX_ECONOMY_MODEL_CANDIDATES,
  CODEX_ECONOMY_PROFILE_REVISION,
  CODEX_ECONOMY_WORKLOAD_LIMITS,
  CODEX_PRODUCT_PROVIDER_ID,
  createCodexSessionAgentProvider,
  resolveCodexEconomyExecutionProfile
};
