import { computed, proxyRefs, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";
import {
  normalizeActionInputFields
} from "@/lib/aiStudioActionInputModel.js";
import {
  aiStudioActionIcon as actionIcon,
  commandMessage,
  currentStepDisabledReason as resolveCurrentStepDisabledReason
} from "@/lib/aiStudioSessionPanelModel.js";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  aiStudioActionPath,
  aiStudioIntentPath,
  aiStudioSessionPath,
  commandInputFromContext
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  aiStudioSessionWorktreePath
} from "@/lib/aiStudioSessionPaths.js";
import {
  readRefOrGetterBoolean
} from "@/lib/vueRefOrGetterValue.js";
import {
  aiStudioSessionDebugDurationMs,
  aiStudioSessionDebugError,
  aiStudioSessionDebugLog,
  aiStudioSessionDebugSummary
} from "@/lib/aiStudioSessionDebugLog.js";

function displayableActionResultMessage(result = {}) {
  const message = String(result?.message || "");
  return /^Rendered\b/u.test(message) ? "" : message;
}

function intentInputFromContext(context = {}) {
  return {
    fields: context?.fields && typeof context.fields === "object" && !Array.isArray(context.fields)
      ? context.fields
      : {},
    stepId: String(context?.stepId || ""),
    stepStatus: String(context?.stepStatus || "")
  };
}

function actionDispatchRoute(action = {}) {
  return String(action.dispatchRoute || "session-action").trim();
}

function staleAdvanceError(error = {}) {
  return String(error?.code || "") === "ai_studio_step_not_ready";
}

function useAiStudioSessionActions({
  clearCopyStatus = () => null,
  commandBusy = () => false,
  commandTerminal,
  onRewindSuccess = () => null,
  openInputDialog = () => null,
  refreshSessionData,
  selectedSession,
  selectedSessionId,
  sessionsApiPath
} = {}) {
  const activeActionId = ref("");
  const advanceRunning = ref(false);
  const advanceMessage = ref("");
  const advanceMessageType = ref("success");
  const recoverStuckStepRunning = ref(false);
  const recoverStuckStepMessage = ref("");
  const recoverStuckStepMessageType = ref("success");

  const runActionCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => commandInputFromContext(context),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioActionPath(sessionsApiPath.value, context?.sessionId, context?.actionId)
    }),
    fallbackRunError: "AI Studio action could not run.",
    messages: {
      error: "AI Studio action could not run.",
      success: "AI Studio action completed."
    },
    onRunSuccess: async (response, { context } = {}) => {
      aiStudioSessionDebugLog("client.sessionActions.runAction.success", {
        ...aiStudioSessionDebugSummary(response || {}),
        actionId: String(context?.actionId || ""),
        actionResultStatus: String(response?.actionResult?.status || ""),
        advanceOnSuccess: context?.advanceOnSuccess === true
      });
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.action",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const runIntentCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => intentInputFromContext(context),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioIntentPath(sessionsApiPath.value, context?.sessionId, context?.intentId)
    }),
    fallbackRunError: "AI Studio intent could not run.",
    messages: {
      error: "AI Studio intent could not run.",
      success: "AI Studio intent completed."
    },
    onRunSuccess: async (response, { context } = {}) => {
      aiStudioSessionDebugLog("client.sessionActions.runIntent.success", {
        ...aiStudioSessionDebugSummary(response || {}),
        intentId: String(context?.intentId || ""),
        requestedStepId: String(context?.stepId || ""),
        requestedStepStatus: String(context?.stepStatus || "")
      });
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.intent",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const advanceCommand = proxyRefs({
    isRunning: advanceRunning,
    message: advanceMessage,
    messageType: advanceMessageType,
    run: runAdvanceCommand
  });
  const recoverStuckStepCommand = proxyRefs({
    isRunning: recoverStuckStepRunning,
    message: recoverStuckStepMessage,
    messageType: recoverStuckStepMessageType,
    run: runRecoverStuckStepCommand
  });

  const rewindCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildRawPayload: (_model, { context }) => ({
      stepId: String(context?.stepId || "")
    }),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioSessionPath(sessionsApiPath.value, context?.sessionId, "/rewind")
    }),
    fallbackRunError: "AI Studio session could not rewind.",
    messages: {
      error: "AI Studio session could not rewind.",
      success: "AI Studio session rewound."
    },
    onRunSuccess: async () => {
      onRewindSuccess();
      await refreshSessionData();
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.sessions.rewind",
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  const baseCurrentActions = computed(() => {
    return Array.isArray(selectedSession.value?.actions)
      ? selectedSession.value.actions.filter((action) => action.visible !== false)
      : [];
  });
  const currentNext = computed(() => selectedSession.value?.next || null);
  const currentActions = computed(() => {
    return baseCurrentActions.value;
  });
  const worktreeReady = computed(() => Boolean(aiStudioSessionWorktreePath(selectedSession.value || {})));
  const latestActionResult = computed(() => {
    if (selectedSession.value?.actionResult) {
      return selectedSession.value.actionResult;
    }
    const actionResults = Array.isArray(selectedSession.value?.actionResults)
      ? selectedSession.value.actionResults
      : [];
    return actionResults
      .filter((result) => result.stepId === selectedSession.value?.currentStep)
      .slice()
      .sort((left, right) => String(left.at || "").localeCompare(String(right.at || "")))
      .at(-1) || null;
  });
  const actionResultMessage = computed(() => displayableActionResultMessage(latestActionResult.value));
  const actionResultType = computed(() => {
    const status = String(latestActionResult.value?.status || "");
    if (status === "completed") {
      return "success";
    }
    if (status === "blocked" || status === "failed") {
      return "warning";
    }
    return "info";
  });
  const currentStepDisabledReason = computed(() => {
    return resolveCurrentStepDisabledReason(currentActions.value, currentNext.value);
  });
  const waitingForPromptedArtifact = computed(() => {
    return false;
  });
  const acceptChangesUtilitiesVisible = computed(() => {
    const intents = Array.isArray(selectedSession.value?.intents) ? selectedSession.value.intents : [];
    return intents.some((intent) => intent.clientAction === "open_diff" && intent.enabled !== false);
  });
  const busy = computed(() => Boolean(
    runActionCommand.isRunning ||
    runIntentCommand.isRunning ||
    advanceCommand.isRunning ||
    recoverStuckStepCommand.isRunning ||
    rewindCommand.isRunning
  ));
  const error = computed(() => {
    return commandMessage(runActionCommand, "error") ||
      commandMessage(runIntentCommand, "error") ||
      commandMessage(advanceCommand, "error") ||
      commandMessage(recoverStuckStepCommand, "error") ||
      commandMessage(rewindCommand, "error") ||
      "";
  });

  function clear() {
    activeActionId.value = "";
  }

  async function runAdvanceCommand({
    sessionId = unref(selectedSessionId)
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || advanceRunning.value) {
      return null;
    }
    advanceRunning.value = true;
    advanceMessage.value = "";
    advanceMessageType.value = "success";
    try {
      const response = await usersWebHttpClient.request(
        aiStudioSessionPath(sessionsApiPath.value, normalizedSessionId, "/advance"),
        {
          method: "POST",
          ...LOCAL_STUDIO_COMMAND_OPTIONS
        }
      );
      aiStudioSessionDebugLog("client.sessionActions.advanceCommand.success", {
        ...aiStudioSessionDebugSummary(response || selectedSession.value || {}),
        selectedSessionId: String(unref(selectedSessionId) || "")
      });
      advanceMessage.value = "AI Studio session advanced.";
      await refreshSessionData();
      return response;
    } catch (error) {
      if (staleAdvanceError(error)) {
        aiStudioSessionDebugLog("client.sessionActions.advanceCommand.stale", {
          ...aiStudioSessionDebugSummary(selectedSession.value || {}),
          code: String(error?.code || ""),
          error: aiStudioSessionDebugError(error),
          selectedSessionId: String(unref(selectedSessionId) || ""),
          sessionId: normalizedSessionId,
          status: error?.status ?? null
        });
        advanceMessage.value = "";
        await refreshSessionData();
        return {
          code: String(error?.code || ""),
          ok: false,
          stale: true,
          status: error?.status ?? null
        };
      }
      advanceMessageType.value = "error";
      advanceMessage.value = String(error?.message || "AI Studio session could not advance.");
      throw error;
    } finally {
      advanceRunning.value = false;
    }
  }

  async function runActionById({
    actionId = "",
    advanceOnSuccess = false,
    input = {},
    sessionId = unref(selectedSessionId)
  } = {}) {
    const normalizedActionId = String(actionId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!normalizedSessionId || !normalizedActionId || busy) {
      aiStudioSessionDebugLog("client.sessionActions.runActionById.skipped", {
        actionId: normalizedActionId,
        busy,
        reason: !normalizedSessionId ? "missing_session" : !normalizedActionId ? "missing_action" : "busy",
        sessionId: normalizedSessionId
      });
      return;
    }
    const startedAtMs = Date.now();
    aiStudioSessionDebugLog("client.sessionActions.runActionById.start", {
      ...aiStudioSessionDebugSummary(selectedSession.value || {}),
      actionId: normalizedActionId,
      advanceOnSuccess: advanceOnSuccess === true,
      inputKeys: Object.keys(input && typeof input === "object" && !Array.isArray(input) ? input : {}).sort(),
      sessionId: normalizedSessionId
    });
    clearCopyStatus();
    activeActionId.value = normalizedActionId;
    try {
      const response = await runActionCommand.run({
        actionId: normalizedActionId,
        advanceOnSuccess: advanceOnSuccess === true,
        input: input && typeof input === "object" && !Array.isArray(input) ? input : {},
        sessionId: normalizedSessionId
      });
      aiStudioSessionDebugLog("client.sessionActions.runActionById.done", {
        ...aiStudioSessionDebugSummary(response || {}),
        actionId: normalizedActionId,
        actionResultStatus: String(response?.actionResult?.status || ""),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        ok: response?.ok !== false,
        sessionId: normalizedSessionId
      });
      return response;
    } catch (error) {
      aiStudioSessionDebugLog("client.sessionActions.runActionById.error", {
        actionId: normalizedActionId,
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        error: aiStudioSessionDebugError(error),
        sessionId: normalizedSessionId
      });
      throw error;
    } finally {
      activeActionId.value = "";
    }
  }

  async function runRecoverStuckStepCommand({
    sessionId = unref(selectedSessionId)
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId || recoverStuckStepRunning.value) {
      return null;
    }
    recoverStuckStepRunning.value = true;
    recoverStuckStepMessage.value = "";
    recoverStuckStepMessageType.value = "success";
    try {
      const response = await usersWebHttpClient.request(
        aiStudioSessionPath(sessionsApiPath.value, normalizedSessionId, "/recover-stuck-step"),
        {
          method: "POST",
          ...LOCAL_STUDIO_COMMAND_OPTIONS
        }
      );
      aiStudioSessionDebugLog("client.sessionActions.recoverStuckStepCommand.success", {
        ...aiStudioSessionDebugSummary(response || selectedSession.value || {}),
        selectedSessionId: String(unref(selectedSessionId) || "")
      });
      recoverStuckStepMessage.value = "AI Studio session step recovered.";
      await refreshSessionData();
      return response;
    } catch (error) {
      recoverStuckStepMessageType.value = "error";
      recoverStuckStepMessage.value = String(error?.message || "AI Studio session step could not be recovered.");
      throw error;
    } finally {
      recoverStuckStepRunning.value = false;
    }
  }

  async function recoverStuckStep({
    sessionId = unref(selectedSessionId)
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!normalizedSessionId || busy) {
      aiStudioSessionDebugLog("client.sessionActions.recoverStuckStep.skipped", {
        ...aiStudioSessionDebugSummary(selectedSession.value || {}),
        busy,
        reason: !normalizedSessionId ? "missing_session" : "busy",
        sessionId: normalizedSessionId
      });
      return null;
    }
    const startedAtMs = Date.now();
    aiStudioSessionDebugLog("client.sessionActions.recoverStuckStep.start", {
      ...aiStudioSessionDebugSummary(selectedSession.value || {}),
      sessionId: normalizedSessionId
    });
    try {
      const response = await recoverStuckStepCommand.run({
        sessionId: normalizedSessionId
      });
      aiStudioSessionDebugLog("client.sessionActions.recoverStuckStep.done", {
        ...aiStudioSessionDebugSummary(response || selectedSession.value || {}),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        ok: response?.ok !== false,
        sessionId: normalizedSessionId
      });
      commandTerminal.clear();
      return response;
    } catch (error) {
      aiStudioSessionDebugLog("client.sessionActions.recoverStuckStep.error", {
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        error: aiStudioSessionDebugError(error),
        sessionId: normalizedSessionId
      });
      throw error;
    }
  }

  async function runIntentById({
    fields = {},
    intentId = "",
    sessionId = unref(selectedSessionId),
    stepId = selectedSession.value?.currentStep || "",
    stepStatus = selectedSession.value?.stepMachine?.status || ""
  } = {}) {
    const normalizedIntentId = String(intentId || "").trim();
    const normalizedSessionId = String(sessionId || "").trim();
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!normalizedSessionId || !normalizedIntentId || busy) {
      aiStudioSessionDebugLog("client.sessionActions.runIntentById.skipped", {
        busy,
        intentId: normalizedIntentId,
        reason: !normalizedSessionId ? "missing_session" : !normalizedIntentId ? "missing_intent" : "busy",
        sessionId: normalizedSessionId
      });
      return;
    }
    const startedAtMs = Date.now();
    aiStudioSessionDebugLog("client.sessionActions.runIntentById.start", {
      ...aiStudioSessionDebugSummary(selectedSession.value || {}),
      fieldKeys: Object.keys(fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {}).sort(),
      intentId: normalizedIntentId,
      sessionId: normalizedSessionId,
      stepId: String(stepId || ""),
      stepStatus: String(stepStatus || "")
    });
    clearCopyStatus();
    activeActionId.value = normalizedIntentId;
    try {
      const response = await runIntentCommand.run({
        fields: fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {},
        intentId: normalizedIntentId,
        sessionId: normalizedSessionId,
        stepId,
        stepStatus
      });
      aiStudioSessionDebugLog("client.sessionActions.runIntentById.done", {
        ...aiStudioSessionDebugSummary(response || {}),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        intentId: normalizedIntentId,
        ok: response?.ok !== false,
        sessionId: normalizedSessionId
      });
      return response;
    } catch (error) {
      aiStudioSessionDebugLog("client.sessionActions.runIntentById.error", {
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        error: aiStudioSessionDebugError(error),
        intentId: normalizedIntentId,
        sessionId: normalizedSessionId
      });
      throw error;
    } finally {
      activeActionId.value = "";
    }
  }

  async function advanceSession({
    sessionId = unref(selectedSessionId)
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!normalizedSessionId || busy || currentNext.value?.enabled !== true) {
      aiStudioSessionDebugLog("client.sessionActions.advanceSession.skipped", {
        ...aiStudioSessionDebugSummary(selectedSession.value || {}),
        busy,
        nextDisabledReason: String(currentNext.value?.disabledReason || ""),
        reason: !normalizedSessionId ? "missing_session" : busy ? "busy" : "next_disabled",
        sessionId: normalizedSessionId
      });
      return;
    }
    const startedAtMs = Date.now();
    aiStudioSessionDebugLog("client.sessionActions.advanceSession.start", {
      ...aiStudioSessionDebugSummary(selectedSession.value || {}),
      sessionId: normalizedSessionId
    });
    try {
      const response = await advanceCommand.run({
        sessionId: normalizedSessionId
      });
      aiStudioSessionDebugLog("client.sessionActions.advanceSession.done", {
        ...aiStudioSessionDebugSummary(response || selectedSession.value || {}),
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        ok: response?.ok !== false,
        sessionId: normalizedSessionId
      });
      if (response?.stale !== true) {
        commandTerminal.clear();
      }
      return response;
    } catch (error) {
      aiStudioSessionDebugLog("client.sessionActions.advanceSession.error", {
        durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
        error: aiStudioSessionDebugError(error),
        sessionId: normalizedSessionId
      });
      throw error;
    }
  }

  async function runAction(action = {}, options = {}) {
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!unref(selectedSessionId) || !action.id || busy || action.enabled !== true) {
      aiStudioSessionDebugLog("client.sessionActions.runAction.skipped", {
        actionId: String(action.id || ""),
        actionEnabled: action.enabled === true,
        busy,
        reason: !unref(selectedSessionId) ? "missing_session" : !action.id ? "missing_action" : busy ? "busy" : "action_disabled",
        sessionId: String(unref(selectedSessionId) || "")
      });
      return;
    }
    const providedInput = options.input && typeof options.input === "object" && !Array.isArray(options.input)
      ? options.input
      : null;
    if (!providedInput && normalizeActionInputFields(action.inputFields).length > 0) {
      openInputDialog(action);
      return;
    }
    if (actionDispatchRoute(action) === "external-link") {
      openActionLink(action);
      return;
    }
    if (actionDispatchRoute(action) === "command-terminal") {
      aiStudioSessionDebugLog("client.sessionActions.runAction.commandTerminal.start", {
        actionId: String(action.id || ""),
        sessionId: String(unref(selectedSessionId) || "")
      });
      commandTerminal.start(action);
      return;
    }
    return runActionById({
      actionId: action.id,
      advanceOnSuccess: action.advanceOnSuccess === true,
      input: providedInput || {}
    });
  }

  async function runIntent(intent = {}, options = {}) {
    const busy = readRefOrGetterBoolean(commandBusy);
    if (!unref(selectedSessionId) || !intent.id || busy || intent.enabled !== true) {
      aiStudioSessionDebugLog("client.sessionActions.runIntent.skipped", {
        busy,
        intentEnabled: intent.enabled === true,
        intentId: String(intent.id || ""),
        reason: !unref(selectedSessionId) ? "missing_session" : !intent.id ? "missing_intent" : busy ? "busy" : "intent_disabled",
        sessionId: String(unref(selectedSessionId) || "")
      });
      return;
    }
    if (intent.clientAction === "open_diff") {
      return;
    }
    return runIntentById({
      fields: options.fields,
      intentId: intent.id
    });
  }

  function openActionLink(action = {}) {
    const metadataName = String(action.hrefMetadata || "").trim();
    const href = metadataName ? String(selectedSession.value?.metadata?.[metadataName] || "") : "";
    if (href && typeof window !== "undefined") {
      window.open(href, "_blank", "noopener");
    }
  }

  async function goNext() {
    await advanceSession();
  }

  async function rewindToStep(step = {}) {
    const stepId = String(step.rewindStepId || step.id || "");
    if (!unref(selectedSessionId) || readRefOrGetterBoolean(commandBusy) || step.canRewind !== true || !stepId) {
      return;
    }
    await rewindCommand.run({
      sessionId: unref(selectedSessionId),
      stepId
    });
  }

  return {
    acceptChangesUtilitiesVisible,
    actionIcon,
    actionResultMessage,
    actionResultType,
    activeActionId,
    advanceSession,
    advanceCommand,
    busy,
    clear,
    currentActions,
    currentNext,
    currentStepDisabledReason,
    error,
    goNext,
    recoverStuckStep,
    recoverStuckStepCommand,
    rewindCommand,
    rewindToStep,
    runAction,
    runActionById,
    runActionCommand,
    runIntent,
    runIntentById,
    runIntentCommand,
    waitingForPromptedArtifact,
    worktreeReady
  };
}

export {
  useAiStudioSessionActions
};
