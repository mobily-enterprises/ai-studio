import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  VIBE64_DEFAULT_AGENT_PROVIDER_ID
} from "@local/vibe64-runtime/shared";
import {
  useVibe64AgentSettings
} from "@/composables/useVibe64AgentSettings.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  chatMessagePayload,
  createChatMessageId,
  unmatchedOptimisticMessages
} from "@/lib/vibe64ChatMessage.js";
import {
  numberedQuestionSubmissionText,
  parseNumberedQuestionPrompt
} from "@/lib/vibe64NumberedQuestionSugar.js";
import {
  parseAnswerChoicePrompt
} from "@/lib/vibe64AnswerChoiceSugar.js";
import {
  latestAssistantMessageAwaitingUserReply
} from "@/lib/vibe64ConversationQuestions.js";
import {
  VIBE64_SESSION_TOOL_DEFINITIONS,
  vibe64SessionToolDashboardSuffix,
  vibe64SessionToolIdFromRouteSegment
} from "@/lib/vibe64SessionToolDefinitions.js";
import {
  normalizeProjectRoutePath,
  projectAppPath
} from "@/lib/vibe64ProjectScope.js";
import {
  vibe64SessionSourcePath
} from "@/lib/vibe64SessionPaths.js";
import {
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "@/lib/vibe64SessionViewModel.js";
import {
  sessionGithubCommandActor
} from "@/lib/vibe64GitCommandActor.js";
import {
  defineVibe64AsyncComponent
} from "@/lib/vibe64AsyncComponent.js";

const DIRECT_SESSION_TOOL_IDS = new Set([
  "info",
  "changes",
  "repository",
  "editor",
  "system",
  "ai-terminal"
]);
const STANDALONE_SESSION_TOOL_IDS = new Set([
  "editor",
  "system"
]);
const vibe64AutopilotViewEmits = ["busy-change", "project-attention"];
const vibe64AutopilotViewProps = {
  active: {
    default: true,
    type: Boolean
  },
  agentConnectionStatus: {
    default: "connected",
    type: String
  },
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  cancelAgentMessage: {
    default: async () => false,
    type: Function
  },
  conversationLog: {
    default: () => ({}),
    type: Object
  },
  githubActorTeleportTarget: {
    default: "",
    type: String
  },
  interruptAgentTurn: {
    default: async () => false,
    type: Function
  },
  page: {
    default: () => ({}),
    type: Object
  },
  previewToolbarTeleportTarget: {
    default: "",
    type: String
  },
  projectContext: {
    default: () => ({}),
    type: Object
  },
  projectPane: {
    default: "preview",
    type: String
  },
  refreshSessionData: {
    default: async () => null,
    type: Function
  },
  refreshSessionWork: {
    default: async () => null,
    type: Function
  },
  retryWorkspaceSetup: {
    default: async () => false,
    type: Function
  },
  saveSessionWork: {
    default: async () => false,
    type: Function
  },
  updateSessionWork: {
    default: async () => false,
    type: Function
  },
  sendAgentMessage: {
    default: async () => false,
    type: Function
  },
  session: {
    default: null,
    type: Object
  },
  sessionAbandon: {
    default: () => ({}),
    type: Object
  },
  sessionSelectionClosed: {
    default: false,
    type: Boolean
  },
  sessionsApiPath: {
    default: "",
    type: [String, Object, Function]
  },
  sessionToolbar: {
    default: () => ({}),
    type: Object
  },
  workState: {
    default: () => ({}),
    type: Object
  }
};

function normalizedAgentTurnText(value = "") {
  return String(value || "").trim();
}

function agentConnectionThinkingLabel({
  active = false,
  status = "connected"
} = {}) {
  if (!active || status === "connected") {
    return "";
  }
  if (status === "disconnected") {
    return "Connection lost — assistant status unknown.";
  }
  return status === "reconciling"
    ? "Checking assistant status..."
    : "Assistant status could not be verified.";
}

function normalizeProjectPane(value = "") {
  return value === "dashboard" ? "dashboard" : "preview";
}

function sessionNavLabel(session = {}) {
  const name = normalizedAgentTurnText(
    session?.sessionName || session?.metadata?.issue_word
  );
  if (name) {
    return name;
  }
  const sessionId = normalizedAgentTurnText(session?.sessionId);
  return sessionId.includes("_")
    ? sessionId.split("_").slice(-2).join("_")
    : sessionId.slice(0, 12);
}

function workspaceSetupFixPrompt(workspaceSetup = {}) {
  const diagnostic = normalizedAgentTurnText(workspaceSetup?.diagnostic) ||
    "Workspace preparation did not complete.";
  return [
    "Workspace preparation needs attention:",
    diagnostic,
    "Please diagnose and fix this in the current workspace, preserving the existing work. When it is fixed, tell me to retry workspace preparation."
  ].join("\n\n");
}

function previewIdentityFixPrompt({
  error = "",
  identity = {}
} = {}) {
  const name = normalizedAgentTurnText(identity?.name) || "configured identity";
  const type = normalizedAgentTurnText(identity?.type) || "selector";
  const value = normalizedAgentTurnText(identity?.value) || "unknown";
  const diagnostic = normalizedAgentTurnText(error) || "The application rejected the identity.";
  return [
    `The managed preview could not sign in as \`${name}\` (${type}: \`${value}\`):`,
    diagnostic,
    "Please diagnose and fix this in the current application. Ensure its app-owned, idempotent development seed creates this user profile and any workspace membership the app requires in every fresh database, then run the normal database preparation command and verify the identity exchange. Keep preview authentication material host-managed; do not add, reveal, or hardcode Vibe64 secrets."
  ].join("\n\n");
}

function useVibe64AutopilotView(props, emit) {
  const route = useRoute();
  const router = useRouter();
  const projectSlug = useVibe64ProjectSlug();
  const Vibe64LaunchControls = defineVibe64AsyncComponent({
    label: "Launch controls",
    loader: () => import("@/components/studio/Vibe64LaunchControls.vue"),
    minHeight: "10rem"
  });
  const agentSettings = useVibe64AgentSettings();
  const currentAgentSettings = computed(() => agentSettings.settings.value);
  const requestAgentSettings = computed(() => {
    const settings = currentAgentSettings.value || {};
    return String(settings.providerId || "") !== VIBE64_DEFAULT_AGENT_PROVIDER_ID ||
      String(settings.model || "") ||
      String(settings.thinking || "")
      ? settings
      : null;
  });
  const sessionId = computed(() => normalizedAgentTurnText(props.session?.sessionId));
  const sessionGithubActor = computed(() => sessionGithubCommandActor(props.session || {}));
  const sessionGithubActorHeaderVisible = computed(() => Boolean(
    props.active &&
    sessionGithubActor.value.available &&
    String(props.githubActorTeleportTarget || "").trim()
  ));
  const sessionSourceRoot = computed(() => vibe64SessionSourcePath(props.session || {}));
  const activeAgentTurn = computed(() => {
    const turn = props.session?.agentSession?.turn;
    return turn && typeof turn === "object" && !Array.isArray(turn) ? turn : {};
  });
  const agentActive = computed(() => activeAgentTurn.value.active === true);
  const chatCollapsed = computed(() => Boolean(props.chatCollapsed));
  const sessionToolbarVisible = computed(() => Boolean(
    Array.isArray(props.sessionToolbar?.sessions) && props.sessionToolbar.sessions.length
  ));

  const composerDraft = ref("");
  const composerAttachments = ref([]);
  const composerError = ref("");
  const composerSending = ref(false);
  const interrupting = ref(false);
  const optimisticMessages = ref([]);
  const questionAnswers = ref({});
  const dismissedNumberedQuestionText = ref("");
  const saveWorkConfirmOpen = ref(false);
  const saveWorkError = ref("");
  const saveWorkFailure = ref(null);
  const saveWorkExpanded = ref(false);
  const saveWorkSending = ref(false);
  const selectedAnswerChoice = ref("");
  const workspaceSetupRetryError = ref("");
  const workspaceSetupRetrying = ref(false);
  const previewAttachmentState = ref({
    attachDiagnostics: null,
    capture: null,
    captureAvailable: false,
    captureBusy: false,
    diagnosticsAvailable: false,
    diagnosticsBusy: false
  });
  let messageSequence = 0;

  const latestAssistantQuestionText = computed(() => (
    latestAssistantMessageAwaitingUserReply(props.conversationLog)
  ));
  const numberedQuestionInput = computed(() => (
    parseNumberedQuestionPrompt(latestAssistantQuestionText.value)
  ));
  const numberedQuestions = computed(() => (
    dismissedNumberedQuestionText.value === latestAssistantQuestionText.value
      ? []
      : numberedQuestionInput.value.questions || []
  ));
  const answerChoices = computed(() => (
    numberedQuestions.value.length
      ? []
      : parseAnswerChoicePrompt(latestAssistantQuestionText.value).choices || []
  ));
  const structuredQuestionActive = computed(() => Boolean(
    numberedQuestions.value.length || answerChoices.value.length
  ));

  const repositoryOperationActive = computed(() => [
    props.workState?.operation,
    props.workState?.updateOperation
  ].some((operation) => ["queued", "running", "starting"].includes(
    String(operation?.status || "").trim().toLowerCase()
  )));

  const composerDisabled = computed(() => Boolean(
    !props.active ||
    !sessionId.value ||
    props.sessionSelectionClosed ||
    composerSending.value ||
    repositoryOperationActive.value
  ));
  const composerCanSubmit = computed(() => Boolean(
    !composerDisabled.value && (
      numberedQuestions.value.length
        ? numberedQuestions.value.every((question) => String(questionAnswers.value[question.name] || "").trim())
        : answerChoices.value.length
          ? selectedAnswerChoice.value || composerDraft.value.trim()
          : composerDraft.value.trim()
    )
  ));
  const agentStopVisible = computed(() => agentActive.value);
  const agentStopEnabled = computed(() => agentStopVisible.value && !interrupting.value);
  const thinkingVisible = computed(() => Boolean(agentActive.value || composerSending.value));
  const thinkingLabel = computed(() => (
    agentConnectionThinkingLabel({
      active: agentActive.value,
      status: props.agentConnectionStatus
    }) ||
    (agentActive.value ? "Assistant is working..." : "") ||
    (composerSending.value ? "Sending to assistant..." : "")
  ));
  const composerHint = computed(() => (
    structuredQuestionActive.value
      ? "Answer the assistant, then send one combined reply."
      : ""
  ));
  const composerPlaceholder = computed(() => (
    numberedQuestions.value.length
      ? "Optional additional context…"
      : answerChoices.value.length
        ? "Choose an answer above, or type another answer…"
        : "What would you like to work on? A rough idea is enough…"
  ));
  const workspaceSetup = computed(() => {
    const value = props.session?.workspaceSetup;
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  });
  const workspaceSetupStatus = computed(() => {
    const status = normalizedAgentTurnText(workspaceSetup.value?.status);
    return ["ambiguous", "failed", "running", "succeeded"].includes(status)
      ? status
      : "unconfigured";
  });
  const workspaceSetupRunning = computed(() => workspaceSetupStatus.value === "running");
  const workspaceSetupNeedsAttention = computed(() => (
    workspaceSetupStatus.value === "failed" || workspaceSetupStatus.value === "ambiguous"
  ));
  const workspaceSetupVisible = computed(() => (
    workspaceSetupRunning.value || workspaceSetupNeedsAttention.value
  ));
  const workspaceSetupTitle = computed(() => ({
    ambiguous: "Workspace setup needs a choice",
    failed: "Workspace preparation failed",
    running: "Preparing workspace…"
  })[workspaceSetupStatus.value] || "");
  const workspaceSetupCurrentLabel = computed(() => (
    workspaceSetupRunning.value
      ? normalizedAgentTurnText(workspaceSetup.value?.currentLabel)
      : ""
  ));
  const workspaceSetupDiagnostic = computed(() => (
    workspaceSetupRetryError.value || normalizedAgentTurnText(workspaceSetup.value?.diagnostic)
  ));
  const workspaceSetupRetryDisabled = computed(() => Boolean(
    workspaceSetupRunning.value ||
    workspaceSetupRetrying.value ||
    !sessionId.value ||
    props.sessionSelectionClosed
  ));
  const workspaceSetupAskDisabled = computed(() => Boolean(
    !workspaceSetupNeedsAttention.value || composerDisabled.value
  ));

  async function retryWorkspaceSetup() {
    if (workspaceSetupRetryDisabled.value) {
      return false;
    }
    workspaceSetupRetryError.value = "";
    workspaceSetupRetrying.value = true;
    try {
      return await props.retryWorkspaceSetup() !== false;
    } catch (error) {
      workspaceSetupRetryError.value = normalizedAgentTurnText(error?.message || error) ||
        "Workspace preparation could not be started.";
      return false;
    } finally {
      workspaceSetupRetrying.value = false;
    }
  }

  function askCodexToFixWorkspaceSetup() {
    if (workspaceSetupAskDisabled.value) {
      return false;
    }
    return sendChatPayload(chatMessagePayload(workspaceSetupFixPrompt({
      ...workspaceSetup.value,
      diagnostic: workspaceSetupDiagnostic.value
    })));
  }

  function askCodexToFixPreviewIdentity(input = {}) {
    if (composerDisabled.value) {
      return false;
    }
    return sendChatPayload(chatMessagePayload(previewIdentityFixPrompt(input)));
  }

  function updateComposerAttachments(attachments = []) {
    composerAttachments.value = Array.isArray(attachments) ? attachments : [];
  }

  function updatePreviewAttachmentState(state = {}) {
    previewAttachmentState.value = {
      attachDiagnostics: typeof state.attachDiagnostics === "function" ? state.attachDiagnostics : null,
      capture: typeof state.capture === "function" ? state.capture : null,
      captureAvailable: state.captureAvailable === true,
      captureBusy: state.captureBusy === true,
      diagnosticsAvailable: state.diagnosticsAvailable === true,
      diagnosticsBusy: state.diagnosticsBusy === true
    };
  }

  function captureVisiblePreview() {
    return previewAttachmentState.value.capture?.() ?? false;
  }

  function attachPreviewDiagnostics() {
    return previewAttachmentState.value.attachDiagnostics?.() ?? false;
  }

  function nextMessageId() {
    messageSequence += 1;
    return createChatMessageId({
      sequence: messageSequence
    });
  }

  function optimisticMessage(payload = {}, messageId = "") {
    const now = new Date();
    return {
      createdAt: now.toISOString(),
      createdAtMs: now.getTime(),
      error: "",
      id: messageId,
      payload,
      status: "pending",
      text: normalizedAgentTurnText(
        payload?.displayMessage || payload?.message
      )
    };
  }

  function updateOptimisticMessage(messageId = "", update = {}) {
    optimisticMessages.value = optimisticMessages.value.map((message) => (
      message.id === messageId
        ? { ...message, ...update }
        : message
    ));
  }

  async function sendChatPayload(payload = {}, { messageId: existingMessageId = "" } = {}) {
    if (composerSending.value || !normalizedAgentTurnText(payload?.message)) {
      return false;
    }
    const messageId = String(existingMessageId || "").trim() || nextMessageId();
    const optimistic = optimisticMessage(payload, messageId);
    optimisticMessages.value = [
      ...optimisticMessages.value,
      optimistic
    ];
    composerError.value = "";
    composerSending.value = true;
    try {
      const accepted = await props.sendAgentMessage({
        ...payload,
        ...(requestAgentSettings.value ? { agentSettings: requestAgentSettings.value } : {}),
        messageId
      }) !== false;
      if (!accepted) {
        updateOptimisticMessage(messageId, {
          error: "Message could not be sent.",
          status: "failed"
        });
      }
      return accepted;
    } catch (error) {
      const message = normalizedAgentTurnText(error?.message || error) || "Message could not be sent.";
      composerError.value = message;
      updateOptimisticMessage(messageId, {
        error: message,
        status: "failed"
      });
      return false;
    } finally {
      composerSending.value = false;
    }
  }

  async function submitComposerMessage() {
    if (!composerCanSubmit.value) {
      return false;
    }
    const additionalContext = composerDraft.value.trim();
    const message = numberedQuestions.value.length
      ? [
          numberedQuestionSubmissionText(numberedQuestions.value, questionAnswers.value),
          additionalContext
        ].filter(Boolean).join("\n\n")
      : selectedAnswerChoice.value || additionalContext;
    const payload = chatMessagePayload(message, composerAttachments.value);
    if (!payload) {
      return false;
    }
    composerDraft.value = "";
    questionAnswers.value = {};
    selectedAnswerChoice.value = "";
    return sendChatPayload(payload);
  }

  function dismissNumberedQuestions() {
    if (!numberedQuestions.value.length) {
      return false;
    }
    dismissedNumberedQuestionText.value = latestAssistantQuestionText.value;
    questionAnswers.value = {};
    return true;
  }

  function optimisticMessageById(messageId = "") {
    return optimisticMessages.value.find((message) => message.id === messageId) || null;
  }

  async function cancelOptimisticMessage(messageId = "") {
    const message = optimisticMessageById(messageId);
    if (!message) {
      return false;
    }
    if (message.status === "pending" && await props.cancelAgentMessage(messageId) === false) {
      return false;
    }
    optimisticMessages.value = optimisticMessages.value.filter((item) => item.id !== messageId);
    return true;
  }

  function editOptimisticMessage(messageId = "") {
    const message = optimisticMessageById(messageId);
    if (!message || message.status !== "failed") {
      return false;
    }
    composerDraft.value = message.text;
    optimisticMessages.value = optimisticMessages.value.filter((item) => item.id !== messageId);
    return true;
  }

  async function resendOptimisticMessage(messageId = "") {
    const message = optimisticMessageById(messageId);
    if (!message || message.status !== "failed") {
      return false;
    }
    optimisticMessages.value = optimisticMessages.value.filter((item) => item.id !== messageId);
    return sendChatPayload(message.payload, { messageId });
  }

  const toolbarRepositoryWorkState = computed(() => {
    const selectedId = String(props.session?.sessionId || "").trim();
    const sessions = Array.isArray(props.sessionToolbar?.sessions)
      ? props.sessionToolbar.sessions
      : [];
    return sessions.find((session) => String(session?.sessionId || "").trim() === selectedId)
      ?.repositoryWorkState || null;
  });
  const saveWorkRepositoryState = computed(() => {
    const inspected = props.workState && typeof props.workState === "object"
      ? props.workState
      : {};
    const monitored = toolbarRepositoryWorkState.value;
    const inspectedAt = Date.parse(String(inspected.checkedAt || "")) || 0;
    const monitoredAt = Date.parse(String(monitored?.checkedAt || "")) || 0;
    const monitoredState = String(monitored?.state || "");
    if (!monitored || monitoredAt < inspectedAt) {
      return inspected;
    }
    const monitoredUnsaved = monitoredState === "unsaved"
      ? true
      : ["saved", "update_available"].includes(monitoredState)
        ? false
        : inspected.unsaved;
    return {
      ...inspected,
      checkedAt: monitored.checkedAt || inspected.checkedAt,
      error: monitoredState === "unavailable"
        ? inspected.error || "Repository status is unavailable."
        : inspected.error || "",
      loading: monitoredState === "checking",
      unsaved: monitoredUnsaved,
      updateAvailable: monitored.updateAvailable === true ||
        ["update_available", "updating"].includes(monitoredState),
      updateStatusPending: monitoredState === "updating"
    };
  });
  const saveWorkUnsaved = computed(() => saveWorkRepositoryState.value?.unsaved === true);
  const saveWorkRequiresUpdate = computed(() => Boolean(
    saveWorkRepositoryState.value?.updateAvailable === true ||
    saveWorkRepositoryState.value?.updateStatusPending === true
  ));
  const saveWorkRepositoryBusy = computed(() => ["saving", "updating"].includes(
    String(toolbarRepositoryWorkState.value?.state || "")
  ));
  const saveWorkDisabled = computed(() => Boolean(
    composerDisabled.value ||
    agentActive.value ||
    saveWorkSending.value ||
    saveWorkRepositoryBusy.value ||
    saveWorkRepositoryState.value?.loading ||
    saveWorkRepositoryState.value?.error ||
    (!saveWorkRequiresUpdate.value && !saveWorkUnsaved.value)
  ));
  const saveWorkActionLabel = computed(() => (
    saveWorkRequiresUpdate.value ? "Update this session (rebase)" : "Save work"
  ));
  const saveWorkFailureIsUpdate = computed(() => (
    String(saveWorkFailure.value?.code || "").startsWith("vibe64_session_update_") ||
    String(props.workState?.updateOperation?.code || "").startsWith("vibe64_session_update_")
  ));
  const saveWorkActivityIsUpdate = computed(() => (
    saveWorkRequiresUpdate.value || saveWorkFailureIsUpdate.value
  ));
  const saveWorkActivityLabel = computed(() => (
    saveWorkActivityIsUpdate.value ? "Update this session (rebase)" : "Save work"
  ));
  const saveWorkTitle = computed(() => {
    if (repositoryOperationActive.value || saveWorkRepositoryBusy.value) {
      return "Wait for the current repository operation to finish";
    }
    if (agentActive.value || composerSending.value) {
      return "Wait for the assistant turn to finish before saving";
    }
    if (saveWorkRepositoryState.value?.loading) {
      return "Checking whether this session has work to save";
    }
    if (saveWorkRepositoryState.value?.error) {
      return "Repository status is unavailable; check for updates before saving";
    }
    if (saveWorkRequiresUpdate.value) {
      return saveWorkUnsaved.value
        ? "Update this session (rebase) with the latest saved project version while preserving its unsaved work. Save will be available when the update finishes."
        : "Update this session (rebase) to the latest saved project version.";
    }
    if (!saveWorkUnsaved.value) {
      return "No work to save";
    }
    return "Save this session's work to the project repository";
  });
  const saveWorkOperation = computed(() => {
    const updateOperation = props.workState?.updateOperation || null;
    const updateActive = ["queued", "running", "starting"].includes(
      String(updateOperation?.status || "").trim().toLowerCase()
    );
    return updateActive || saveWorkActivityIsUpdate.value
      ? updateOperation
      : props.workState?.operation || null;
  });
  const saveWorkOperationActive = computed(() => ["queued", "running", "starting"].includes(
    String(saveWorkOperation.value?.status || "").trim().toLowerCase()
  ));
  const saveWorkOutput = computed(() => (Array.isArray(saveWorkOperation.value?.events)
    ? saveWorkOperation.value.events
      .map((event) => [event.at, event.message].filter(Boolean).join("  "))
      .filter(Boolean)
      .join("\n")
    : ""));
  const saveWorkStatus = computed(() => String(saveWorkOperation.value?.status || ""));

  watch(() => ({
    code: String(saveWorkOperation.value?.code || ""),
    details: saveWorkOperation.value?.details || null,
    error: String(saveWorkOperation.value?.error || ""),
    operationId: String(saveWorkOperation.value?.operationId || ""),
    status: String(saveWorkOperation.value?.status || "").trim().toLowerCase()
  }), (operation) => {
    if (operation.code === "vibe64_session_save_update_required") {
      if (saveWorkFailure.value?.code === operation.code) {
        saveWorkError.value = "";
        saveWorkFailure.value = null;
      }
      return;
    }
    if (operation.status !== "failed" || !operation.error) {
      return;
    }
    saveWorkError.value = operation.error;
    saveWorkFailure.value = {
      code: operation.code,
      details: operation.details,
      message: operation.error
    };
  }, { immediate: true });
  const saveWorkCanResolveWithTemporaryAi = computed(() => [
    "vibe64_session_save_history_diverged",
    "vibe64_session_update_conflict",
    "vibe64_session_update_history_diverged"
  ].includes(String(saveWorkFailure.value?.code || "")));
  const saveWorkRetryable = computed(() => Boolean(
    saveWorkError.value &&
    !saveWorkDisabled.value &&
    !saveWorkCanResolveWithTemporaryAi.value
  ));

  async function updateBeforeSave() {
    saveWorkSending.value = true;
    saveWorkError.value = "";
    saveWorkFailure.value = null;
    saveWorkExpanded.value = true;
    try {
      return await props.updateSessionWork();
    } catch (error) {
      saveWorkFailure.value = error && typeof error === "object"
        ? {
            code: String(error.code || error.response?.code || ""),
            details: error.details || error.response?.details || null,
            message: error instanceof Error ? error.message : String(error || "")
          }
        : null;
      saveWorkError.value = error instanceof Error
        ? error.message
        : String(error || "This session could not be updated.");
      return false;
    } finally {
      saveWorkSending.value = false;
      saveWorkExpanded.value = false;
    }
  }

  function requestSaveWork() {
    if (saveWorkDisabled.value) {
      return false;
    }
    if (saveWorkRequiresUpdate.value) {
      return updateBeforeSave();
    }
    saveWorkConfirmOpen.value = true;
    return true;
  }

  function retrySaveWork() {
    return saveWorkRetryable.value ? requestSaveWork() : false;
  }

  function cancelSaveWork() {
    saveWorkConfirmOpen.value = false;
  }

  async function confirmSaveWork() {
    if (saveWorkDisabled.value) {
      return false;
    }
    saveWorkSending.value = true;
    saveWorkError.value = "";
    saveWorkFailure.value = null;
    saveWorkExpanded.value = true;
    saveWorkConfirmOpen.value = false;
    try {
      const result = await props.saveSessionWork();
      return result;
    } catch (error) {
      saveWorkFailure.value = error && typeof error === "object"
        ? {
            code: String(error.code || error.response?.code || ""),
            details: error.details || error.response?.details || null,
            message: error instanceof Error ? error.message : String(error || "")
          }
        : null;
      saveWorkError.value = error instanceof Error
        ? error.message
        : String(error || "Session work could not be saved.");
      return false;
    } finally {
      saveWorkSending.value = false;
      saveWorkExpanded.value = false;
    }
  }

  async function requestAgentInterrupt() {
    if (!agentStopEnabled.value) {
      return false;
    }
    interrupting.value = true;
    try {
      return await props.interruptAgentTurn({ reason: "user_interrupt" }) !== false;
    } finally {
      interrupting.value = false;
    }
  }

  const chatTurns = computed(() => {
    const turns = Array.isArray(props.conversationLog?.turns) ? props.conversationLog.turns : [];
    if (!optimisticMessages.value.length) {
      return turns;
    }
    const optimistic = unmatchedOptimisticMessages(turns, optimisticMessages.value);
    return [
      ...turns,
      ...optimistic.map((message) => ({
        optimistic: {
          error: message.error,
          id: message.id,
          status: message.status
        },
        turnId: message.id,
        user: {
          at: message.createdAt,
          role: "user",
          text: message.text
        }
      }))
    ];
  });
  const conversationLogVisible = computed(() => Boolean(props.active));
  const conversationScrollKey = computed(() => `${sessionId.value}:${chatTurns.value.length}`);
  const chatReloading = ref(false);
  const chatReloadAvailable = computed(() => Boolean(
    props.active && props.session && (
      typeof props.refreshSessionData === "function" ||
      typeof props.conversationLog?.reload === "function"
    )
  ));

  async function reloadChatPane() {
    if (!chatReloadAvailable.value || chatReloading.value) {
      return false;
    }
    chatReloading.value = true;
    try {
      await Promise.allSettled([
        props.refreshSessionData?.(),
        props.conversationLog?.reload?.()
      ]);
      return true;
    } finally {
      chatReloading.value = false;
    }
  }

  async function loadMoreChatTurns() {
    return typeof props.conversationLog?.loadMore === "function"
      ? props.conversationLog.loadMore()
      : false;
  }

  const rightPaneTab = ref("preview");
  const lastDashboardRoutePath = ref("");
  const sourceEditorOpenRequest = ref(null);
  const systemRestoreRequest = ref(null);
  const systemReturnContext = ref(null);
  let sourceEditorOpenSequence = 0;
  let systemRestoreSequence = 0;

  const projectPaneValue = computed(() => normalizeProjectPane(props.projectPane));
  const routeSessionToolId = computed(() => {
    const dashboardPrefix = `${normalizeProjectRoutePath(projectAppPath(projectSlug.value, "/dashboard"))}/`;
    const routePath = `${normalizeProjectRoutePath(route.path)}/`;
    if (!routePath.startsWith(dashboardPrefix)) {
      return "";
    }
    const segment = routePath.slice(dashboardPrefix.length).split("/")[0] || "";
    const toolId = vibe64SessionToolIdFromRouteSegment(segment);
    return DIRECT_SESSION_TOOL_IDS.has(toolId) ? toolId : "";
  });
  const dashboardShellVisible = computed(() => Boolean(
    projectPaneValue.value === "dashboard" &&
    !STANDALONE_SESSION_TOOL_IDS.has(rightPaneTab.value)
  ));
  const dashboardRouteVisible = computed(() => [
    "dashboard",
    "info",
    "changes",
    "repository"
  ].includes(rightPaneTab.value));
  const sessionToolBackPath = computed(() => (
    lastDashboardRoutePath.value || projectAppPath(projectSlug.value, "/dashboard/env")
  ));

  function sessionToolRuntimeState(toolId = "") {
    if (["editor", "system"].includes(toolId)) {
      return {
        disabled: !sessionSourceRoot.value,
        title: sessionSourceRoot.value
          ? (toolId === "editor" ? "Browse session source files" : "Explore the current project Cities")
          : "Create the session source first"
      };
    }
    return {};
  }

  const sessionToolControls = computed(() => VIBE64_SESSION_TOOL_DEFINITIONS
    .filter((definition) => DIRECT_SESSION_TOOL_IDS.has(definition.id))
    .map((definition) => ({
      ...definition,
      ...sessionToolRuntimeState(definition.id)
    })));

  function sessionToolRoutePath(toolId = "") {
    const suffix = vibe64SessionToolDashboardSuffix(toolId);
    return suffix ? projectAppPath(projectSlug.value, suffix) : "";
  }

  function selectSessionTool(toolId = "", { navigate = true } = {}) {
    if (!DIRECT_SESSION_TOOL_IDS.has(toolId)) {
      return false;
    }
    const tool = sessionToolControls.value.find((item) => item.id === toolId);
    if (tool?.disabled) {
      return false;
    }
    rightPaneTab.value = toolId;
    if (navigate) {
      const targetPath = sessionToolRoutePath(toolId);
      if (targetPath && normalizeProjectRoutePath(targetPath) !== normalizeProjectRoutePath(route.path)) {
        void router.push(targetPath);
      }
    }
    emit("project-attention");
    return true;
  }

  function backToDashboard() {
    const targetPath = sessionToolBackPath.value;
    if (targetPath && normalizeProjectRoutePath(targetPath) !== normalizeProjectRoutePath(route.path)) {
      void router.push(targetPath);
    }
  }

  function rightPaneTabMounted(tabId = "") {
    return rightPaneTab.value === String(tabId || "");
  }

  const activeSessionNav = computed(() => ({
    label: sessionNavLabel(props.session || {}),
    selectTool: selectSessionTool,
    sessionId: sessionId.value,
    status: String(props.session?.status || ""),
    statusLabel: vibe64SessionStatusLabel(props.session?.status),
    tools: sessionToolControls.value.map((tool) => ({
      ...tool,
      active: rightPaneTab.value === tool.id,
      disabledReason: tool.disabled ? tool.title || "" : "",
      to: sessionToolRoutePath(tool.id)
    })),
    visible: Boolean(props.session)
  }));
  const dashboardSessionContext = computed(() => ({
    activeSessionNav: activeSessionNav.value,
    copyText: typeof props.page?.copyText === "function" ? props.page.copyText : null,
    embeddedShell: true,
    projectContext: props.projectContext || {},
    refreshSessionWork: props.refreshSessionWork,
    requestSaveWork,
    session: props.session || null,
    sessionId: sessionId.value,
    sessionsApiPath: props.sessionsApiPath,
    statusColor: vibe64SessionStatusColor(props.session?.status),
    statusLabel: vibe64SessionStatusLabel(props.session?.status),
    workState: props.workState || null
  }));

  const systemBackAvailable = computed(() => Boolean(
    systemReturnContext.value?.sessionId === sessionId.value
  ));

  function openSourceEditorFile(target = {}) {
    const path = normalizedAgentTurnText(target?.path);
    if (!path) {
      return false;
    }
    systemReturnContext.value = target.origin === "system"
      ? {
          ...(target.systemContext && typeof target.systemContext === "object" ? target.systemContext : {}),
          sessionId: sessionId.value
        }
      : null;
    sourceEditorOpenSequence += 1;
    sourceEditorOpenRequest.value = {
      column: Number(target.column || 0) || 0,
      line: Number(target.line || 0) || 0,
      path,
      sequence: sourceEditorOpenSequence
    };
    return selectSessionTool("editor");
  }

  function backToSystemFromEditor() {
    if (!systemBackAvailable.value) {
      return false;
    }
    systemRestoreSequence += 1;
    systemRestoreRequest.value = {
      ...systemReturnContext.value,
      sequence: systemRestoreSequence
    };
    return selectSessionTool("system");
  }

  const sourceEditorAskCodexAvailable = computed(() => Boolean(
    props.active && sessionId.value && !props.sessionSelectionClosed
  ));

  function prefillComposer(text = "") {
    const prompt = normalizedAgentTurnText(text);
    if (!prompt || !sourceEditorAskCodexAvailable.value) {
      return false;
    }
    composerDraft.value = prompt;
    emit("project-attention");
    return true;
  }

  function askCodexAboutSourceEditorFile(path = "") {
    const normalizedPath = normalizedAgentTurnText(path);
    return normalizedPath
      ? prefillComposer(`Please look at \`${normalizedPath}\` and help me with this file.`)
      : false;
  }

  function askCodexAboutSystemContext(input = {}) {
    return prefillComposer(input?.prompt || input?.text);
  }

  function updateAgentSetting(parameterId = "", value = "") {
    agentSettings.update({
      [String(parameterId || "")]: String(value || "")
    });
  }

  watch(() => [projectPaneValue.value, route.path, routeSessionToolId.value].join("|"), () => {
    if (projectPaneValue.value === "preview") {
      rightPaneTab.value = "preview";
      return;
    }
    if (routeSessionToolId.value) {
      selectSessionTool(routeSessionToolId.value, { navigate: false });
      return;
    }
    lastDashboardRoutePath.value = route.path;
    rightPaneTab.value = "dashboard";
  }, { immediate: true });

  watch(sessionId, () => {
    composerDraft.value = "";
    composerAttachments.value = [];
    composerError.value = "";
    optimisticMessages.value = [];
    questionAnswers.value = {};
    dismissedNumberedQuestionText.value = "";
    selectedAnswerChoice.value = "";
    workspaceSetupRetryError.value = "";
    systemReturnContext.value = null;
    systemRestoreRequest.value = null;
  });

  watch(() => workspaceSetup.value?.updatedAt, () => {
    workspaceSetupRetryError.value = "";
  });

  watch(latestAssistantQuestionText, (questionText) => {
    questionAnswers.value = {};
    if (questionText !== dismissedNumberedQuestionText.value) {
      dismissedNumberedQuestionText.value = "";
    }
    selectedAnswerChoice.value = "";
  });

  watch(() => props.conversationLog?.turns, (turns) => {
    if (!optimisticMessages.value.length) {
      return;
    }
    const remaining = unmatchedOptimisticMessages(turns, optimisticMessages.value);
    if (remaining.length !== optimisticMessages.value.length) {
      optimisticMessages.value = remaining;
    }
  });

  watch(() => Boolean(composerSending.value || interrupting.value || saveWorkSending.value), (busy) => {
    emit("busy-change", busy);
  }, { immediate: true });

  return {
    Vibe64LaunchControls,
    agentActive,
    agentStopEnabled,
    agentStopVisible,
    answerChoices,
    askCodexAboutSourceEditorFile,
    askCodexAboutSystemContext,
    askCodexToFixPreviewIdentity,
    askCodexToFixWorkspaceSetup,
    attachPreviewDiagnostics,
    backToDashboard,
    backToSystemFromEditor,
    cancelOptimisticMessage,
    cancelSaveWork,
    captureVisiblePreview,
    chatCollapsed,
    chatReloadAvailable,
    chatReloading,
    chatTurns,
    composerAttachments,
    composerCanSubmit,
    composerDisabled,
    composerDraft,
    composerError,
    composerHint,
    composerPlaceholder,
    composerSending,
    conversationLogVisible,
    conversationScrollKey,
    currentAgentSettings,
    dashboardSessionContext,
    dashboardRouteVisible,
    dashboardShellVisible,
    dismissNumberedQuestions,
    confirmSaveWork,
    editOptimisticMessage,
    interrupting,
    loadMoreChatTurns,
    numberedQuestions,
    openSourceEditorFile,
    previewAttachmentState,
    projectSlug,
    questionAnswers,
    reloadChatPane,
    retrySaveWork,
    retryWorkspaceSetup,
    requestSaveWork,
    resendOptimisticMessage,
    requestAgentInterrupt,
    rightPaneTab,
    rightPaneTabMounted,
    saveWorkConfirmOpen,
    saveWorkDisabled,
    saveWorkActivityIsUpdate,
    saveWorkActivityLabel,
    saveWorkActionLabel,
    saveWorkError,
    saveWorkExpanded,
    saveWorkFailure,
    saveWorkCanResolveWithTemporaryAi,
    saveWorkOperation,
    saveWorkOperationActive,
    saveWorkOutput,
    saveWorkRetryable,
    saveWorkSending,
    saveWorkStatus,
    saveWorkTitle,
    saveWorkRequiresUpdate,
    saveWorkUnsaved,
    selectSessionTool,
    sessionId,
    sessionGithubActor,
    sessionGithubActorHeaderVisible,
    sessionSourceRoot,
    sessionToolControls,
    sessionToolbarVisible,
    selectedAnswerChoice,
    sourceEditorAskCodexAvailable,
    sourceEditorOpenRequest,
    submitComposerMessage,
    systemBackAvailable,
    systemRestoreRequest,
    thinkingLabel,
    thinkingVisible,
    updateAgentSetting,
    updateComposerAttachments,
    updatePreviewAttachmentState,
    workspaceSetupAskDisabled,
    workspaceSetupCurrentLabel,
    workspaceSetupDiagnostic,
    workspaceSetupNeedsAttention,
    workspaceSetupRetryDisabled,
    workspaceSetupRetrying,
    workspaceSetupRunning,
    workspaceSetupStatus,
    workspaceSetupTitle,
    workspaceSetupVisible
  };
}

export {
  agentConnectionThinkingLabel,
  previewIdentityFixPrompt,
  useVibe64AutopilotView,
  workspaceSetupFixPrompt,
  vibe64AutopilotViewEmits,
  vibe64AutopilotViewProps
};
