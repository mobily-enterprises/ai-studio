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
  defineVibe64AsyncComponent
} from "@/lib/vibe64AsyncComponent.js";
import SAVE_WORK_PROMPT from "@/prompts/save-work-commit-and-push.md?raw";

const DIRECT_SESSION_TOOL_IDS = new Set([
  "editor",
  "system",
  "diff",
  "ai-terminal"
]);
const STANDALONE_SESSION_TOOL_IDS = new Set([
  "editor",
  "system",
  "diff"
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
  diff: {
    default: () => ({}),
    type: Object
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
  review: {
    default: () => ({}),
    type: Object
  },
  retryWorkspaceSetup: {
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
  const Vibe64SessionDiffPanel = defineVibe64AsyncComponent({
    label: "Diff viewer",
    loader: () => import("@/components/studio/vibe64-session/Vibe64SessionDiffPanel.vue"),
    minHeight: "14rem"
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

  const composerDisabled = computed(() => Boolean(
    !props.active ||
    !sessionId.value ||
    props.sessionSelectionClosed ||
    composerSending.value
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
        : "Ask Codex to work on this project…"
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

  async function sendChatPayload(payload = {}) {
    if (composerSending.value || !normalizedAgentTurnText(payload?.message)) {
      return false;
    }
    const messageId = nextMessageId();
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
    return sendChatPayload(message.payload);
  }

  const saveWorkDisabled = computed(() => Boolean(
    composerDisabled.value || agentActive.value || saveWorkSending.value
  ));

  function requestSaveWork() {
    if (saveWorkDisabled.value) {
      return false;
    }
    saveWorkConfirmOpen.value = true;
    return true;
  }

  function cancelSaveWork() {
    saveWorkConfirmOpen.value = false;
  }

  async function confirmSaveWork() {
    if (saveWorkDisabled.value) {
      return false;
    }
    saveWorkSending.value = true;
    try {
      const sent = await sendChatPayload(chatMessagePayload(SAVE_WORK_PROMPT));
      if (sent) {
        saveWorkConfirmOpen.value = false;
      }
      return sent;
    } finally {
      saveWorkSending.value = false;
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
    if (toolId === "diff") {
      return {
        disabled: props.review?.diffDisabled === true,
        title: props.review?.diffTitle || "Review session source changes"
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
    if (toolId === "diff" && !props.diff?.payload && !props.diff?.loading) {
      void props.diff?.load?.();
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
    session: props.session || null,
    sessionId: sessionId.value,
    statusColor: vibe64SessionStatusColor(props.session?.status),
    statusLabel: vibe64SessionStatusLabel(props.session?.status)
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
    Vibe64SessionDiffPanel,
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
    retryWorkspaceSetup,
    requestSaveWork,
    resendOptimisticMessage,
    requestAgentInterrupt,
    rightPaneTab,
    rightPaneTabMounted,
    saveWorkConfirmOpen,
    saveWorkDisabled,
    saveWorkSending,
    selectSessionTool,
    sessionId,
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
