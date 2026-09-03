import { createHash } from "node:crypto";

import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS,
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_TOOL_POLICIES,
  VIBE64_AGENT_PARAMETER_IDS,
  VIBE64_AGENT_PROVIDERS,
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  Vibe64AgentExecutionProfileError,
  defineVibe64AgentExecutionProfileRequest,
  defineVibe64AgentExecutionProfileResolution,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";

const CODEX_PRODUCT_PROVIDER_ID = "codex";
const CODEX_APP_SERVER_TRANSPORT_ID = "codex_app_server";
const CODEX_ATTACHMENT_MAX_ITEMS = 10;
const CODEX_ATTACHMENT_RENEW_RETRY_DELAYS_MS = Object.freeze([500, 1_000, 2_000, 5_000]);
const CODEX_ECONOMY_PROFILE_REVISION = "codex-economy-luna-low-v2";
const CODEX_ECONOMY_MODEL_CANDIDATES = Object.freeze([
  Object.freeze({
    model: "gpt-5.6-luna",
    thinking: "low"
  })
]);
const CODEX_ECONOMY_WORKLOAD_LIMITS = VIBE64_AGENT_ECONOMY_WORKLOAD_LIMITS;
const acceptedAttachmentRenewalTimers = new WeakMap();

function codexAssistantSettings(context = {}, input = {}) {
  const requested = input?.agentSettings && typeof input.agentSettings === "object"
    ? input.agentSettings
    : context?.agentSettings && typeof context.agentSettings === "object"
      ? context.agentSettings
      : {};
  const selection = context?.assistantSelection;
  return selection?.engineId === CODEX_PRODUCT_PROVIDER_ID
    ? {
        ...requested,
        model: selection.modelId,
        providerId: CODEX_PRODUCT_PROVIDER_ID,
        thinking: selection.variantId
      }
    : requested;
}

function codexAssistantCapabilities(connected = true) {
  const definition = VIBE64_AGENT_PROVIDERS.find((provider) => (
    provider.id === CODEX_PRODUCT_PROVIDER_ID
  ));
  const modelParameter = definition?.parameters?.find((parameter) => (
    parameter.id === VIBE64_AGENT_PARAMETER_IDS.MODEL
  ));
  const models = (Array.isArray(modelParameter?.options) ? modelParameter.options : [])
    .filter((option) => normalizeText(option.value))
    .map((option) => ({
      id: normalizeText(option.value),
      label: normalizeText(option.label) || normalizeText(option.value),
      status: "available",
      variants: (Array.isArray(option.supportedThinking) ? option.supportedThinking : [])
        .map((variantId) => ({
          id: normalizeText(variantId),
          label: normalizeText(variantId).replace(/^./u, (value) => value.toUpperCase())
        }))
    }));
  const revision = `sha256:${createHash("sha256").update(JSON.stringify({
    connected,
    models
  })).digest("hex")}`;
  return {
    agents: [{
      description: "OpenAI Codex coding agent",
      id: "codex",
      label: "Codex",
      mode: "primary"
    }],
    authentication: {
      management: "account-owner",
      modes: ["oauth", "api-key"]
    },
    defaults: {
      agentId: "codex",
      modelId: VIBE64_CODEX_DEFAULT_MODEL,
      modelProviderId: "openai",
      variantId: VIBE64_CODEX_DEFAULT_THINKING
    },
    engineId: CODEX_PRODUCT_PROVIDER_ID,
    health: {
      message: connected ? "" : "Connect Codex before starting a Codex session.",
      status: connected ? "ready" : "unavailable"
    },
    label: "Codex",
    modelProviders: [{
      connected,
      description: "Codex models provided by OpenAI",
      id: "openai",
      label: "OpenAI",
      models
    }],
    revision,
    transportId: CODEX_APP_SERVER_TRANSPORT_ID
  };
}

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
  const id = normalizeText(turn?.turnId || result?.turnId);
  const active = Boolean(id) && (turn?.active === true || result?.active === true);
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

function codexAttachmentIds(input = {}) {
  return Array.isArray(input?.attachmentIds)
    ? input.attachmentIds.map(normalizeText).filter(Boolean)
    : [];
}

function codexAttachmentDeliveryFailure(code, error, retryable) {
  return {
    code,
    error,
    ok: false,
    retryable
  };
}

async function validateCodexAttachmentsBeforeDelivery(controller, sessionId = "", input = {}) {
  const attachmentIds = codexAttachmentIds(input);
  if (attachmentIds.length < 1) {
    return null;
  }
  if (typeof controller.renewAttachments !== "function") {
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_unavailable",
      "Attachments are temporarily unavailable. Try sending again.",
      true
    );
  }
  let renewal;
  try {
    renewal = await controller.renewAttachments(sessionId, attachmentIds);
  } catch (error) {
    vibe64SessionDebugLog("server.codexAttachments.deliveryValidation.error", {
      attachmentCount: attachmentIds.length,
      error: vibe64SessionDebugError(error),
      sessionId
    });
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_unavailable",
      "Attachments are temporarily unavailable. Try sending again.",
      true
    );
  }
  if (renewal?.ok === false) {
    return codexAttachmentDeliveryFailure(
      normalizeText(renewal?.code) || "vibe64_agent_attachment_unavailable",
      normalizeText(renewal?.error) || "Attachments are temporarily unavailable. Try sending again.",
      renewal?.retryable !== false
    );
  }

  const expectedIds = new Set(attachmentIds);
  const busyIds = new Set((Array.isArray(renewal?.busy) ? renewal.busy : [])
    .map(normalizeText)
    .filter((attachmentId) => expectedIds.has(attachmentId)));
  const missingIds = new Set((Array.isArray(renewal?.missing) ? renewal.missing : [])
    .map(normalizeText)
    .filter((attachmentId) => expectedIds.has(attachmentId)));
  const retainedIds = new Set((Array.isArray(renewal?.retained) ? renewal.retained : [])
    .map(normalizeText)
    .filter((attachmentId) => expectedIds.has(attachmentId)));
  if (missingIds.size > 0) {
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_missing",
      "One or more attachments are no longer available. Remove and upload them again.",
      false
    );
  }
  if (busyIds.size > 0) {
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_busy",
      "One or more attachments are still being prepared. Try sending again.",
      true
    );
  }
  if ([...expectedIds].some((attachmentId) => !retainedIds.has(attachmentId))) {
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_unavailable",
      "Attachments could not be verified. Try sending again.",
      true
    );
  }
  return null;
}

async function renewAcceptedCodexAttachments(controller, sessionId = "", input = {}, accepted = false) {
  const attachmentIds = codexAttachmentIds(input);
  if (!accepted || attachmentIds.length < 1 || typeof controller.renewAttachments !== "function") {
    return;
  }
  // Delivery cannot be rolled back after the provider or PTY has accepted it.
  // Retrying only the lease operation cannot submit the human turn twice.
  let pendingIds = attachmentIds;
  let lastRenewal = null;
  for (const retryDelayMs of [0, 100, 250]) {
    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    let renewal;
    try {
      renewal = await controller.renewAttachments(sessionId, pendingIds);
    } catch (error) {
      vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.error", {
        attachmentCount: pendingIds.length,
        error: vibe64SessionDebugError(error),
        sessionId
      });
      scheduleAcceptedCodexAttachmentRenewal(controller, sessionId, pendingIds);
      return lastRenewal;
    }
    lastRenewal = renewal;
    if (renewal?.ok === false) {
      scheduleAcceptedCodexAttachmentRenewal(controller, sessionId, pendingIds);
      return renewal;
    }
    const busy = Array.isArray(renewal?.busy)
      ? renewal.busy.map(normalizeText).filter(Boolean)
      : [];
    if (busy.length < 1) {
      return renewal;
    }
    pendingIds = busy;
  }
  scheduleAcceptedCodexAttachmentRenewal(controller, sessionId, pendingIds);
  return lastRenewal;
}

function acceptedCodexAttachmentRenewalTimerMap(controller) {
  let timers = acceptedAttachmentRenewalTimers.get(controller);
  if (!timers) {
    timers = new Map();
    acceptedAttachmentRenewalTimers.set(controller, timers);
  }
  return timers;
}

function scheduleAcceptedCodexAttachmentRenewal(
  controller,
  sessionId,
  attachmentIds,
  attempt = 0
) {
  const pendingIds = [...new Set((Array.isArray(attachmentIds) ? attachmentIds : [])
    .map(normalizeText)
    .filter(Boolean))];
  if (pendingIds.length < 1) {
    return;
  }
  if (attempt >= CODEX_ATTACHMENT_RENEW_RETRY_DELAYS_MS.length) {
    vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.exhausted", {
      attachmentCount: pendingIds.length,
      sessionId
    });
    return;
  }
  const timerKey = `${normalizeText(sessionId)}:${[...pendingIds].sort().join(",")}`;
  const timers = acceptedCodexAttachmentRenewalTimerMap(controller);
  const existingTimer = timers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    if (timers.get(timerKey) !== timer) {
      return;
    }
    timers.delete(timerKey);
    void Promise.resolve().then(() => (
      controller.renewAttachments(sessionId, pendingIds)
    )).then((renewal) => {
      const busy = Array.isArray(renewal?.busy)
        ? renewal.busy.map(normalizeText).filter(Boolean)
        : [];
      if (renewal?.ok === false) {
        scheduleAcceptedCodexAttachmentRenewal(controller, sessionId, pendingIds, attempt + 1);
        return;
      }
      if (busy.length > 0) {
        scheduleAcceptedCodexAttachmentRenewal(controller, sessionId, busy, attempt + 1);
        return;
      }
      const missing = Array.isArray(renewal?.missing)
        ? renewal.missing.map(normalizeText).filter(Boolean)
        : [];
      if (missing.length > 0) {
        vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.missing", {
          attachmentCount: missing.length,
          sessionId
        });
      }
    }).catch((error) => {
      vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.error", {
        attachmentCount: pendingIds.length,
        error: vibe64SessionDebugError(error),
        sessionId
      });
      scheduleAcceptedCodexAttachmentRenewal(controller, sessionId, pendingIds, attempt + 1);
    });
  }, CODEX_ATTACHMENT_RENEW_RETRY_DELAYS_MS[attempt]);
  timer.unref?.();
  timers.set(timerKey, timer);
}

function codexAttachmentLimitResult(input = {}) {
  const attachmentIds = codexAttachmentIds(input);
  if (attachmentIds.length <= CODEX_ATTACHMENT_MAX_ITEMS) {
    return null;
  }
  return {
    code: "vibe64_agent_attachment_limit_exceeded",
    error: `A message can include at most ${CODEX_ATTACHMENT_MAX_ITEMS} attachments.`,
    ok: false
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
  connectionStatus = async () => true,
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
    async capabilities(context) {
      return codexAssistantCapabilities((await connectionStatus(context)) !== false);
    },
    async closeProject(_context, input = {}) {
      return controller.closeAllForProject(input);
    },
    async closeSession(context) {
      return controller.closeAllForSession(context.sessionId, {
        preserveProcessExitProof: context.preserveProcessExitProof === true,
        renewalCleanup: context.renewalCleanup,
        runtime: context.runtime,
        session: context.session
      });
    },
    async releaseRenewalPredecessorProcessExitProof(context, input = {}) {
      return controller.releaseRenewalPredecessorProcessExitProof(context.sessionId, {
        renewalId: input.renewalId,
        runtime: context.runtime,
        session: context.session
      });
    },
    async releaseRenewalPredecessorAttachments(context, input = {}) {
      return controller.releaseRenewalPredecessorAttachments(context.sessionId, {
        renewalId: input.renewalId,
        runtime: context.runtime,
        session: context.session
      });
    },
    async releaseRenewalSuccessorProcessExitProof(context, input = {}) {
      return controller.releaseRenewalSuccessorProcessExitProof(context.sessionId, {
        authorization: input.authorization,
        renewalId: input.renewalId,
        runtime: context.runtime,
        session: context.session
      });
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
    async generateSessionRenewalHandover(context, input = {}) {
      if (typeof controller.generateSessionRenewalHandover !== "function") {
        throw new TypeError("Codex session renewal handover generation is unavailable.");
      }
      return controller.generateSessionRenewalHandover(context.sessionId, {
        ...input,
        agentSettings: codexAssistantSettings(context, input),
        vibe64User: input.vibe64User || context.vibe64User || null
      }, {
        runtime: context.runtime,
        session: context.session
      });
    },
    async hasActiveTemporaryConversation(context) {
      return {
        active: controller.hasActiveTemporaryConversation(context.sessionId),
        ok: true
      };
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
    async pinAttachments(context, input = {}) {
      if (typeof controller.pinAttachments !== "function") {
        return codexAttachmentDeliveryFailure(
          "vibe64_agent_attachment_unavailable",
          "Attachments cannot be retained for owner approval.",
          true
        );
      }
      return controller.pinAttachments(
        context.sessionId,
        codexAttachmentIds(input),
        normalizeText(input.suggestionId)
      );
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
      const request = {
        ...input,
        vibe64User: input.vibe64User || context.vibe64User || null
      };
      const result = typeof context.onEvent === "function"
        ? await controller.streamDetachedChatTurn(context.sessionId, request, {
            onEvent: context.onEvent,
            runtime: context.runtime,
            session: context.session
          })
        : await controller.runDetachedChatTurn(context.sessionId, request, {
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
    async seedSessionRenewalHandover(context, input = {}) {
      if (typeof controller.seedSessionRenewalHandover !== "function") {
        throw new TypeError("Codex renewed-session handover seeding is unavailable.");
      }
      return controller.seedSessionRenewalHandover(context.sessionId, {
        ...input,
        agentSettings: codexAssistantSettings(context, input),
        vibe64User: input.vibe64User || context.vibe64User || null
      }, {
        runtime: context.runtime,
        session: context.session
      });
    },
    async sendMessage(context, input = {}) {
      const message = input && typeof input === "object" && !Array.isArray(input)
        ? {
            ...input,
            agentSettings: codexAssistantSettings(context, input),
            vibe64User: input.vibe64User || context.vibe64User || null
          }
        : {
            agentSettings: codexAssistantSettings(context),
            message: input,
            vibe64User: context.vibe64User || null
          };
      const attachmentLimit = codexAttachmentLimitResult(message);
      if (attachmentLimit) {
        return normalizeCodexSessionResult(attachmentLimit);
      }
      const attachmentValidation = await validateCodexAttachmentsBeforeDelivery(
        controller,
        context.sessionId,
        message
      );
      if (attachmentValidation) {
        return normalizeCodexSessionResult(attachmentValidation);
      }
      const result = normalizeCodexSessionResult(await controller.sendMessage(context.sessionId, message, {
        runtime: context.runtime,
        session: context.session,
        turnOwnership: context.turnOwnership
      }));
      await renewAcceptedCodexAttachments(controller, context.sessionId, message, (
        result.ok &&
        result.newTurnRequired !== true &&
        (result.delivered === true || Boolean(result.turn?.id))
      ));
      return result;
    },
    async sessionState(context) {
      return normalizeCodexSessionResult(await controller.terminalState(context.sessionId, {
        session: context.session
      }));
    },
    async startConversationTurn(context, input = {}) {
      const message = {
        ...input,
        vibe64User: input.vibe64User || context.vibe64User || null
      };
      const attachmentLimit = codexAttachmentLimitResult(message);
      if (attachmentLimit) {
        return attachmentLimit;
      }
      const attachmentValidation = await validateCodexAttachmentsBeforeDelivery(
        controller,
        context.sessionId,
        message
      );
      if (attachmentValidation) {
        return attachmentValidation;
      }
      const result = await controller.startConversationTurn(context.sessionId, message);
      await renewAcceptedCodexAttachments(
        controller,
        context.sessionId,
        message,
        result?.ok !== false && Boolean(normalizeText(result?.runId))
      );
      return result;
    },
    async startTerminal(context, input = {}) {
      return controller.startTerminal(context.sessionId, input);
    },
    async stopConversation(context, input = {}) {
      return controller.stopConversation(context.sessionId, input);
    },
    async streamDetachedChatTurn(context, input = {}) {
      const executionProfile = emitCodexExecutionProfile(context, input.executionProfile);
      const result = await controller.streamDetachedChatTurn(context.sessionId, {
        ...input,
        vibe64User: input.vibe64User || context.vibe64User || null
      }, {
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
    async unpinAttachments(context, input = {}) {
      if (typeof controller.unpinAttachments !== "function") {
        return { ok: true, released: [] };
      }
      return controller.unpinAttachments(
        context.sessionId,
        codexAttachmentIds(input),
        normalizeText(input.suggestionId)
      );
    },
    async waitForConversationTurn(context, input = {}) {
      return controller.waitForConversationTurn(context.sessionId, input, {
        onEvent: context.onEvent
      });
    },
    async writeTerminal(context, input = {}) {
      const terminalInput = {
        ...input.input,
        vibe64User: input.input?.vibe64User || context.vibe64User || null
      };
      const attachmentLimit = codexAttachmentLimitResult(terminalInput);
      if (attachmentLimit) {
        return attachmentLimit;
      }
      const attachmentValidation = await validateCodexAttachmentsBeforeDelivery(
        controller,
        context.sessionId,
        terminalInput
      );
      if (attachmentValidation) {
        return attachmentValidation;
      }
      const result = await controller.writeTerminal(
        context.sessionId,
        input.terminalSessionId,
        input.data,
        terminalInput
      );
      await renewAcceptedCodexAttachments(
        controller,
        context.sessionId,
        terminalInput,
        result?.ok === true
      );
      return result;
    }
  });
}

export {
  CODEX_APP_SERVER_TRANSPORT_ID,
  CODEX_ATTACHMENT_MAX_ITEMS,
  CODEX_ECONOMY_MODEL_CANDIDATES,
  CODEX_ECONOMY_PROFILE_REVISION,
  CODEX_ECONOMY_WORKLOAD_LIMITS,
  CODEX_PRODUCT_PROVIDER_ID,
  createCodexSessionAgentProvider,
  resolveCodexEconomyExecutionProfile
};
