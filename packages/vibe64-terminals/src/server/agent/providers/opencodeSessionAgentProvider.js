import {
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_TOOL_POLICIES,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_TRANSPORT_IDS,
  Vibe64AgentExecutionProfileError,
  defineVibe64AgentExecutionProfileRequest,
  defineVibe64AgentExecutionProfileResolution,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";
import { OPENCODE_EXPECTED_VERSION } from "../../opencodeServerProcess.js";

const OPENCODE_ECONOMY_PROFILE_REVISION =
  `opencode-${OPENCODE_EXPECTED_VERSION}-selected-model-tool-free-v1`;
const OPENCODE_ECONOMY_WORKLOAD_LIMITS = Object.freeze({
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
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.DATABASE_ASSISTANT]: Object.freeze({
    maxInputCharacters: 500_000,
    maxOutputCharacters: 16_000,
    timeoutMs: 180_000
  }),
  [VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.PROMPT_HINT]: Object.freeze({
    maxInputCharacters: 24_000,
    maxOutputCharacters: 2_500,
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

function openCodeExecutionProfileError(code, message, details = {}) {
  return new Vibe64AgentExecutionProfileError(code, message, details);
}

function resolveOpenCodeEconomyExecutionProfile(context = {}, request = {}) {
  const executionProfile = defineVibe64AgentExecutionProfileRequest(request);
  if (executionProfile.profileId !== VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY) {
    throw openCodeExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.PROFILE_UNKNOWN,
      `OpenCode does not provide execution profile ${executionProfile.profileId}.`,
      { profileId: executionProfile.profileId }
    );
  }
  const limits = OPENCODE_ECONOMY_WORKLOAD_LIMITS[executionProfile.workloadId];
  if (!limits) {
    throw openCodeExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.WORKLOAD_UNSUPPORTED,
      `OpenCode economy does not support workload ${executionProfile.workloadId}.`,
      { workloadId: executionProfile.workloadId }
    );
  }
  const selection = context.assistantSelection || {};
  if (
    selection.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE ||
    !String(selection.modelProviderId || "").trim() ||
    !String(selection.modelId || "").trim()
  ) {
    throw openCodeExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE,
      "OpenCode cannot run a helper turn without the session's selected provider and model."
    );
  }
  const thinking = String(selection.variantId || "").trim();
  return defineVibe64AgentExecutionProfileResolution({
    ...executionProfile,
    limits,
    model: String(selection.modelId).trim(),
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: VIBE64_AGENT_EXECUTION_TOOL_POLICIES.NONE
    },
    providerId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
    request: {
      allowProviderModelFallback: false,
      reasoning: Boolean(thinking),
      summary: false
    },
    revision: OPENCODE_ECONOMY_PROFILE_REVISION,
    thinking
  });
}

function emitOpenCodeExecutionProfile(context = {}, executionProfile = null) {
  if (!executionProfile) {
    return null;
  }
  const snapshot = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
  context.onEvent?.({
    executionProfile: snapshot,
    type: "execution-profile"
  });
  return snapshot;
}

function unsupportedOperation(operation = "operation") {
  return {
    code: "vibe64_opencode_operation_unsupported",
    error: `OpenCode does not support the Vibe64 ${operation} operation yet.`,
    ok: false,
    retryable: false
  };
}

function createOpenCodeSessionAgentProvider({ controller } = {}) {
  if (!controller) {
    throw new TypeError("OpenCode session agent providers require a controller.");
  }
  return Object.freeze({
    executionProfiles: Object.freeze([
      VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY
    ]),
    id: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
    transportId: VIBE64_ASSISTANT_TRANSPORT_IDS.OPENCODE_SERVER,
    async capabilities(context, input = {}) {
      return controller.capabilities(input, context);
    },
    async closeProject(_context, input = {}) {
      return controller.closeAllForProject(input);
    },
    async closeSession(context) {
      return controller.closeAllForSession(context.sessionId, {
        runtime: context.runtime,
        session: context.session
      });
    },
    async closeTerminal() {
      return unsupportedOperation("raw terminal");
    },
    async createConversation(context, input = {}) {
      return controller.createConversation(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async deleteAttachment() {
      return unsupportedOperation("attachment deletion");
    },
    async deleteConversation(context, input = {}) {
      return controller.deleteConversation(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async deleteDetachedChatThread(context, input = {}) {
      return controller.deleteConversation(context.sessionId, {
        conversationId: input.threadId || input.conversationId
      }, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async describeProvider(context) {
      return controller.describeProvider(context.sessionId, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async ensureSession(context) {
      return controller.ensureSession(context.sessionId, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async generateSessionRenewalHandover(context, input = {}) {
      return controller.generateSessionRenewalHandover(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async hasActiveTemporaryConversation(context) {
      return {
        active: controller.hasActiveTemporaryConversation(context.sessionId),
        ok: true
      };
    },
    async interruptDetachedChatTurn(context, input = {}) {
      return controller.stopConversation(context.sessionId, {
        conversationId: input.threadId || input.conversationId
      }, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async interruptTurn(context, input = {}) {
      return controller.interruptTurn(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async invalidateRuntimes(_context, input = {}) {
      return controller.invalidateRuntimes(input);
    },
    async readConversation(context, input = {}) {
      return controller.readConversation(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async readTerminal() {
      return unsupportedOperation("raw terminal");
    },
    async reconcileSessions(_context, sessions = [], options = {}) {
      return controller.reconcileSessions(sessions, options);
    },
    async releaseRenewalPredecessorAttachments() {
      return { ok: true, released: 0 };
    },
    async releaseRenewalPredecessorProcessExitProof(context) {
      const closed = await controller.closeAllForSession(context.sessionId, {
        runtime: context.runtime,
        session: context.session
      });
      const released = controller.releaseProcessExitProof(context.sessionId);
      return {
        ...closed,
        ...released,
        ok: closed.ok !== false && released.ok !== false
      };
    },
    async releaseRenewalSuccessorProcessExitProof(context) {
      return controller.releaseProcessExitProof(context.sessionId);
    },
    async resizeTerminal() {
      return unsupportedOperation("raw terminal");
    },
    async resolveExecutionProfile(context, input = {}) {
      return resolveOpenCodeEconomyExecutionProfile(context, input);
    },
    async runDetachedChatTurn(context, input = {}) {
      const executionProfile = emitOpenCodeExecutionProfile(context, input.executionProfile);
      const result = await controller.runDetachedChatTurn(context.sessionId, input, {
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
      return executionProfile ? { ...result, executionProfile } : result;
    },
    async seedSessionRenewalHandover(context, input = {}) {
      return controller.seedSessionRenewalHandover(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async sendMessage(context, input = {}) {
      return controller.sendMessage(context.sessionId, input, {
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session,
        turnOwnership: context.turnOwnership,
        vibe64User: context.vibe64User
      });
    },
    async sessionState(context) {
      return controller.sessionState(context.sessionId, {
        runtime: context.runtime,
        session: context.session
      });
    },
    async startConversationTurn(context, input = {}) {
      return controller.startConversationTurn(context.sessionId, input, {
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async startTerminal() {
      return unsupportedOperation("raw terminal");
    },
    async stopConversation(context, input = {}) {
      return controller.stopConversation(context.sessionId, input, {
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async streamDetachedChatTurn(context, input = {}) {
      return controller.streamDetachedChatTurn(context.sessionId, input, {
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async subscribeTerminal() {
      return unsupportedOperation("raw terminal");
    },
    async unsubscribeSessions() {
      return { ok: true };
    },
    async uploadAttachment() {
      return unsupportedOperation("attachment upload");
    },
    async waitForConversationTurn(context, input = {}) {
      return controller.waitForConversationTurn(context.sessionId, input, {
        onEvent: context.onEvent,
        runtime: context.runtime,
        session: context.session,
        vibe64User: context.vibe64User
      });
    },
    async writeTerminal() {
      return unsupportedOperation("raw terminal");
    }
  });
}

export {
  OPENCODE_ECONOMY_PROFILE_REVISION,
  OPENCODE_ECONOMY_WORKLOAD_LIMITS,
  createOpenCodeSessionAgentProvider,
  resolveOpenCodeEconomyExecutionProfile,
  unsupportedOperation
};
