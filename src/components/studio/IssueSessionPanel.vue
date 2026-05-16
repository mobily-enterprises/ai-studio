<template>
  <v-sheet rounded="lg" class="studio-ai-sessions studio-screen__panel">
    <StudioErrorNotice
      v-if="pageError"
      title="AI Studio sessions could not load"
      :error="pageError"
      compact
      class="mb-3"
    />

    <div class="studio-ai-sessions__toolbar">
      <div class="studio-ai-sessions__tabs">
        <v-chip
          v-for="session in sessions"
          :key="session.sessionId"
          :color="session.sessionId === selectedSessionId ? 'primary' : 'default'"
          :variant="session.sessionId === selectedSessionId ? 'flat' : 'tonal'"
          class="studio-ai-sessions__tab"
          size="large"
          @click="selectSession(session.sessionId)"
        >
          <span
            class="studio-ai-sessions__status-dot"
            :class="`studio-ai-sessions__status-dot--${session.status}`"
          />
          <span>{{ shortSessionId(session.sessionId) }}</span>
          <v-btn
            v-if="session.sessionId === selectedSessionId"
            class="studio-ai-sessions__tab-abandon"
            density="compact"
            :disabled="commandBusy || isSelectedSessionClosed"
            :icon="mdiClose"
            :loading="abandonCommand.isRunning"
            size="x-small"
            title="Abandon session"
            variant="text"
            aria-label="Abandon session"
            @click.stop="abandonSelectedSession"
          />
        </v-chip>

        <v-btn
          color="primary"
          variant="tonal"
          :disabled="!canCreateSession || commandBusy"
          :loading="createSessionCommand.isRunning"
          :prepend-icon="mdiPlus"
          :title="createSessionTitle"
          @click="createSessionCommand.run()"
        >
          New Session
        </v-btn>
      </div>
    </div>

    <v-progress-linear
      v-if="pageLoading && !selectedSession"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <v-sheet
      v-else-if="!selectedSession"
      rounded="lg"
      border
      class="studio-ai-sessions__empty"
    >
      <p class="text-body-2 text-medium-emphasis mb-0">No sessions yet.</p>
    </v-sheet>

    <div v-else class="studio-ai-sessions__layout">
      <section class="studio-ai-sessions__main">
        <div class="studio-ai-sessions__heading">
          <div>
            <p class="studio-ai-sessions__eyebrow">AI Studio session</p>
            <h2 class="studio-ai-sessions__title">{{ selectedSessionTitle }}</h2>
          </div>
          <v-chip
            :color="issueSessionStatusColor(selectedSession.status)"
            variant="tonal"
          >
            {{ issueSessionStatusLabel(selectedSession.status) }}
          </v-chip>
        </div>

        <IssueSessionTimeline
          :busy="commandBusy"
          :steps="timelineSteps"
        >
          <template #current-step>
            <div class="studio-ai-sessions__actions">
              <v-btn
                v-for="action in currentActions"
                :key="action.id"
                color="primary"
                variant="flat"
                :disabled="commandBusy || action.enabled !== true"
                :loading="runActionCommand.isRunning && activeActionId === action.id"
                :prepend-icon="actionIcon(action)"
                :title="action.disabledReason || action.label"
                @click="runAction(action)"
              >
                {{ action.label }}
              </v-btn>

              <v-btn
                v-if="currentNext?.visible"
                color="primary"
                variant="tonal"
                :disabled="commandBusy || currentNext.enabled !== true"
                :loading="advanceCommand.isRunning"
                :prepend-icon="mdiArrowRight"
                :title="currentNext.disabledReason || currentNext.label || 'Next'"
                @click="goNext"
              >
                {{ currentNext.label || "Next" }}
              </v-btn>
            </div>

            <v-alert
              v-if="actionResultMessage"
              :type="actionResultType"
              variant="tonal"
              density="compact"
              class="studio-ai-sessions__notice"
            >
              {{ actionResultMessage }}
            </v-alert>

            <v-alert
              v-if="currentStepDisabledReason"
              type="info"
              variant="tonal"
              density="compact"
              class="studio-ai-sessions__notice"
            >
              {{ currentStepDisabledReason }}
            </v-alert>

            <p v-if="copyStatus" class="text-caption text-medium-emphasis mb-0">
              {{ copyStatus }}
            </p>
          </template>
        </IssueSessionTimeline>
      </section>

      <aside class="studio-ai-sessions__side">
        <IssueSessionFacts
          :facts="sessionFacts"
          :status-color="issueSessionStatusColor(selectedSession.status)"
          :status-label="issueSessionStatusLabel(selectedSession.status)"
          @copy="copyText"
        />
      </aside>

      <section class="studio-ai-sessions__terminals">
        <AiStudioCommandTerminal
          :action="commandTerminalAction"
          :session="selectedSession"
          :start-request-key="commandTerminalStartKey"
          @finished="handleCommandTerminalFinished"
          @running-changed="commandTerminalRunning = $event"
        />

        <CodexSessionTerminal
          :prompt-injection-request-key="codexPromptInjectionKey"
          :prompt-override="codexPromptOverride"
          :session="selectedSession"
          @prompt-injected="handleCodexPromptInjected"
          @prompt-injection-failed="handleCodexPromptInjectionFailed"
          @session-update="handleCodexSessionUpdate"
        />
      </section>
    </div>

    <AiStudioDraftEditorDialog
      v-model="draftEditorOpen"
      v-model:body-text="draftEditorBody"
      v-model:issue-title="draftEditorIssueTitle"
      :error="draftEditorError"
      :kind="draftEditorKind"
      :loading="draftEditorLoading"
      :saving="draftEditorSaving"
      @save="saveDraftEditor"
    />
  </v-sheet>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { useList } from "@jskit-ai/users-web/client/composables/useList";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  mdiArrowRight,
  mdiClose,
  mdiPlus
} from "@mdi/js";
import AiStudioCommandTerminal from "@/components/studio/AiStudioCommandTerminal.vue";
import AiStudioDraftEditorDialog from "@/components/studio/AiStudioDraftEditorDialog.vue";
import CodexSessionTerminal from "@/components/studio/CodexSessionTerminal.vue";
import IssueSessionFacts from "@/components/studio/issue-session/IssueSessionFacts.vue";
import IssueSessionTimeline from "@/components/studio/issue-session/IssueSessionTimeline.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useStoredSelection } from "@/composables/useStoredSelection.js";
import {
  isClosedIssueSession,
  issueSessionDisplayTitle,
  issueSessionStatusColor,
  issueSessionStatusLabel
} from "@/lib/issueSessionViewModel.js";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  SELECTED_SESSION_STORAGE_KEY,
  aiStudioActionPath,
  aiStudioSessionPath,
  aiStudioSessionsQueryKey,
  commandInputFromContext
} from "@/lib/aiStudioSessionRequestConfig.js";
import {
  aiStudioActionIcon as actionIcon,
  aiStudioPromptHandoffFromSession,
  aiStudioSessionFacts,
  aiStudioSessionLimits,
  buildAiStudioTimelineSteps,
  commandMessage,
  currentStepDisabledReason as resolveCurrentStepDisabledReason,
  enrichAiStudioSessionForDisplay,
  shortAiStudioSessionId as shortSessionId,
  visibleAiStudioSessions
} from "@/lib/aiStudioSessionPanelModel.js";
import {
  readAiStudioArtifacts,
  saveAiStudioArtifacts,
  saveAiStudioCodexPromptHandoff
} from "@/lib/studioApi.js";

const ISSUE_BODY_ARTIFACT = "issue.md";
const ISSUE_TITLE_ARTIFACT = "issue_title";
const PULL_REQUEST_ARTIFACT = "pull_request.md";

const emit = defineEmits(["title-change"]);

const paths = usePaths();
const sessionSelection = useStoredSelection({
  storageKey: SELECTED_SESSION_STORAGE_KEY
});
const selectedSessionId = sessionSelection.selectedId;
const activeActionId = ref("");
const copyStatus = ref("");
const codexPromptInjectionKey = ref("");
const codexPromptOverride = ref("");
const commandTerminalAction = ref(null);
const commandTerminalRunning = ref(false);
const commandTerminalStartKey = ref("");
const draftEditorBody = ref("");
const draftEditorError = ref("");
const draftEditorIssueTitle = ref("");
const draftEditorKind = ref("issue");
const draftEditorLoading = ref(false);
const draftEditorOpen = ref(false);
const draftEditorSaving = ref(false);
const pendingCommandAdvanceOnSuccess = ref(false);

const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
  surface: AI_STUDIO_SURFACE_ID
}));

const sessionList = useList({
  access: "never",
  apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
  fallbackLoadError: "AI Studio sessions could not be loaded.",
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.sessions.list",
  queryKeyFactory: aiStudioSessionsQueryKey,
  selectItems: (payload) => Array.isArray(payload?.sessions) ? payload.sessions : [],
  surfaceId: AI_STUDIO_SURFACE_ID
});

const createSessionCommand = useCommand({
  access: "never",
  apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
  buildCommandOptions: () => ({
    options: LOCAL_STUDIO_COMMAND_OPTIONS
  }),
  fallbackRunError: "AI Studio session could not be created.",
  messages: {
    error: "AI Studio session could not be created.",
    success: "AI Studio session created."
  },
  onRunSuccess: async (response) => {
    if (response?.sessionId) {
      sessionSelection.select(response.sessionId);
    }
    await refreshSessionData();
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.sessions.create",
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "POST"
});

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
    const promptHandoff = aiStudioPromptHandoffFromSession(response);
    if (promptHandoff?.prompt) {
      codexPromptOverride.value = promptHandoff.prompt;
      codexPromptInjectionKey.value = `${context.sessionId}:${context.actionId}:${Date.now()}`;
      await refreshSessionData();
      return;
    }
    if (actionShouldAdvance(response, context)) {
      await advanceCommand.run({
        sessionId: context.sessionId
      });
      return;
    }
    await refreshSessionData();
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.sessions.action",
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "POST"
});

const advanceCommand = useCommand({
  access: "never",
  apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
  buildCommandOptions: (_payload, { context }) => ({
    method: "POST",
    options: LOCAL_STUDIO_COMMAND_OPTIONS,
    path: aiStudioSessionPath(sessionsApiPath.value, context?.sessionId, "/advance")
  }),
  fallbackRunError: "AI Studio session could not advance.",
  messages: {
    error: "AI Studio session could not advance.",
    success: "AI Studio session advanced."
  },
  onRunSuccess: async () => {
    codexPromptOverride.value = "";
    await refreshSessionData();
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.sessions.advance",
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "POST"
});

const abandonCommand = useCommand({
  access: "never",
  apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
  buildCommandOptions: (_payload, { context }) => ({
    method: "POST",
    options: LOCAL_STUDIO_COMMAND_OPTIONS,
    path: aiStudioSessionPath(sessionsApiPath.value, context?.sessionId, "/abandon")
  }),
  fallbackRunError: "AI Studio session could not be abandoned.",
  messages: {
    error: "AI Studio session could not be abandoned.",
    success: "AI Studio session abandoned."
  },
  onRunSuccess: async () => {
    sessionSelection.clear();
    codexPromptOverride.value = "";
    await sessionList.reload();
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "ai-studio.sessions.abandon",
  surfaceId: AI_STUDIO_SURFACE_ID,
  writeMethod: "POST"
});

const sessions = computed(() => {
  return visibleAiStudioSessions(sessionList.items || []);
});

const selectedListSession = computed(() => {
  return sessions.value.find((session) => session.sessionId === selectedSessionId.value) || null;
});

const selectedSession = computed(() => {
  return enrichAiStudioSessionForDisplay(selectedListSession.value);
});

const currentActions = computed(() => {
  return Array.isArray(selectedSession.value?.actions)
    ? selectedSession.value.actions.filter((action) => action.visible !== false)
    : [];
});

const currentNext = computed(() => selectedSession.value?.next || null);
const isSelectedSessionClosed = computed(() => isClosedIssueSession(selectedSession.value || {}));
const commandBusy = computed(() => Boolean(
  createSessionCommand.isRunning ||
  runActionCommand.isRunning ||
  advanceCommand.isRunning ||
  abandonCommand.isRunning ||
  commandTerminalRunning.value ||
  draftEditorLoading.value ||
  draftEditorSaving.value
));

const pageLoading = computed(() => Boolean(sessionList.isLoading));
const pageError = computed(() => {
  return sessionList.loadError ||
    commandMessage(createSessionCommand, "error") ||
    commandMessage(runActionCommand, "error") ||
    commandMessage(advanceCommand, "error") ||
    commandMessage(abandonCommand, "error") ||
    "";
});

const limits = computed(() => {
  return aiStudioSessionLimits({
    payloadLimits: sessionList.pages?.[0]?.limits || {},
    sessions: sessions.value
  });
});

const canCreateSession = computed(() => limits.value.openSessionCount < limits.value.maxOpenSessions);
const createSessionTitle = computed(() => {
  return canCreateSession.value
    ? "Create a new AI Studio session"
    : `Studio allows up to ${limits.value.maxOpenSessions} active sessions.`;
});

const selectedSessionTitle = computed(() => {
  return issueSessionDisplayTitle(selectedSession.value || {}) ||
    `Session ${shortSessionId(selectedSessionId.value)}`;
});

const timelineSteps = computed(() => {
  return buildAiStudioTimelineSteps(selectedSession.value);
});

const sessionFacts = computed(() => {
  return aiStudioSessionFacts(selectedSession.value || {});
});

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

const actionResultMessage = computed(() => String(latestActionResult.value?.message || ""));
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

async function refreshSessionData() {
  await sessionList.reload();
}

function actionShouldAdvance(response = {}, context = {}) {
  return context.advanceOnSuccess === true &&
    response.actionResult?.status === "completed" &&
    response.next?.visible === true &&
    response.next?.enabled === true;
}

function errorMessageFromResponse(response = {}, fallback = "AI Studio request failed.") {
  return String(response?.errors?.[0]?.message || response?.error || fallback);
}

function selectSession(sessionId = "") {
  activeActionId.value = "";
  codexPromptInjectionKey.value = "";
  codexPromptOverride.value = "";
  commandTerminalAction.value = null;
  commandTerminalRunning.value = false;
  commandTerminalStartKey.value = "";
  draftEditorOpen.value = false;
  pendingCommandAdvanceOnSuccess.value = false;
  sessionSelection.select(sessionId);
}

async function runAction(action = {}) {
  if (!selectedSessionId.value || !action.id || commandBusy.value || action.enabled !== true) {
    return;
  }
  copyStatus.value = "";
  if (action.type === "command") {
    commandTerminalAction.value = action;
    pendingCommandAdvanceOnSuccess.value = action.advanceOnSuccess === true;
    commandTerminalStartKey.value = `${selectedSessionId.value}:${action.id}:${Date.now()}`;
    return;
  }
  if (action.type === "editor") {
    await openDraftEditor(action);
    return;
  }
  activeActionId.value = action.id;
  try {
    await runActionCommand.run({
      actionId: action.id,
      advanceOnSuccess: action.advanceOnSuccess === true,
      sessionId: selectedSessionId.value
    });
  } finally {
    activeActionId.value = "";
  }
}

async function openDraftEditor(action = {}) {
  draftEditorKind.value = action.id === "edit_pr" ? "pull-request" : "issue";
  draftEditorError.value = "";
  draftEditorOpen.value = true;
  draftEditorLoading.value = true;
  try {
    const response = await readAiStudioArtifacts(selectedSessionId.value);
    if (response?.ok === false) {
      draftEditorError.value = errorMessageFromResponse(response, "Draft could not be loaded.");
      return;
    }
    const artifacts = response.artifacts || {};
    draftEditorIssueTitle.value = String(artifacts[ISSUE_TITLE_ARTIFACT] || "");
    draftEditorBody.value = draftEditorKind.value === "issue"
      ? String(artifacts[ISSUE_BODY_ARTIFACT] || "")
      : String(artifacts[PULL_REQUEST_ARTIFACT] || "");
  } catch (error) {
    draftEditorError.value = String(error?.message || error || "Draft could not be loaded.");
  } finally {
    draftEditorLoading.value = false;
  }
}

async function saveDraftEditor() {
  if (!selectedSessionId.value || draftEditorSaving.value) {
    return;
  }
  draftEditorError.value = "";
  draftEditorSaving.value = true;
  try {
    const response = draftEditorKind.value === "issue"
      ? await saveAiStudioArtifacts(selectedSessionId.value, {
          [ISSUE_BODY_ARTIFACT]: draftEditorBody.value,
          [ISSUE_TITLE_ARTIFACT]: draftEditorIssueTitle.value
        })
      : await saveAiStudioArtifacts(selectedSessionId.value, {
          [PULL_REQUEST_ARTIFACT]: draftEditorBody.value
        });
    if (response?.ok === false) {
      draftEditorError.value = errorMessageFromResponse(response, "Draft could not be saved.");
      return;
    }
    copyStatus.value = "Draft saved.";
    await refreshSessionData();
  } catch (error) {
    draftEditorError.value = String(error?.message || error || "Draft could not be saved.");
  } finally {
    draftEditorSaving.value = false;
  }
}

async function goNext() {
  if (!selectedSessionId.value || commandBusy.value || currentNext.value?.enabled !== true) {
    return;
  }
  await advanceCommand.run({
    sessionId: selectedSessionId.value
  });
}

async function abandonSelectedSession() {
  if (!selectedSessionId.value || commandBusy.value || isSelectedSessionClosed.value) {
    return;
  }
  await abandonCommand.run({
    sessionId: selectedSessionId.value
  });
}

async function copyText(value, label = "Value") {
  try {
    await navigator.clipboard.writeText(String(value || ""));
    copyStatus.value = `${label} copied.`;
  } catch (error) {
    copyStatus.value = String(error?.message || error || "Copy failed.");
  }
}

async function handleCommandTerminalFinished(event = {}) {
  commandTerminalRunning.value = false;
  activeActionId.value = "";
  await refreshSessionData();
  await nextTick();
  if (
    event.sessionId === selectedSessionId.value &&
    Number(event.exitCode) === 0 &&
    pendingCommandAdvanceOnSuccess.value &&
    currentNext.value?.visible === true &&
    currentNext.value?.enabled === true
  ) {
    pendingCommandAdvanceOnSuccess.value = false;
    await goNext();
  }
}

async function handleCodexPromptInjected(event = {}) {
  const sessionId = String(event.sessionId || selectedSessionId.value || "");
  if (sessionId) {
    await saveAiStudioCodexPromptHandoff(sessionId, {
      outputStart: Number(event.outputStart || 0),
      signature: `${sessionId}:${Date.now()}`
    }).catch(() => null);
  }
  copyStatus.value = "Prompt sent to Codex.";
}

function handleCodexPromptInjectionFailed(event = {}) {
  copyStatus.value = String(event.error || "Prompt injection failed.");
}

async function handleCodexSessionUpdate() {
  await refreshSessionData();
}

watch(sessions, (nextSessions) => {
  if (sessionList.isInitialLoading) {
    return;
  }
  sessionSelection.selectAvailableId(nextSessions, {
    fallbackId: nextSessions.at(-1)?.sessionId || "",
    getId: (session) => session.sessionId
  });
}, {
  immediate: true
});

watch(selectedSessionTitle, (title) => {
  emit("title-change", title || "");
}, {
  immediate: true
});
</script>

<style scoped>
.studio-ai-sessions {
  display: grid;
  gap: 0.85rem;
  min-height: 0;
}

.studio-ai-sessions__toolbar {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-ai-sessions__tabs {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  min-width: 0;
}

.studio-ai-sessions__tab {
  align-items: center;
  max-width: 18rem;
}

.studio-ai-sessions__tab-abandon {
  margin-left: 0.3rem;
}

.studio-ai-sessions__status-dot {
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  display: inline-block;
  height: 0.52rem;
  margin-right: 0.42rem;
  width: 0.52rem;
}

.studio-ai-sessions__status-dot--abandoned,
.studio-ai-sessions__status-dot--failed {
  background: rgb(var(--v-theme-error));
}

.studio-ai-sessions__status-dot--finished {
  background: rgb(var(--v-theme-success));
}

.studio-ai-sessions__empty {
  padding: 0.9rem;
}

.studio-ai-sessions__layout {
  align-items: flex-start;
  display: grid;
  gap: 0.9rem;
  grid-template-columns: minmax(0, 1.15fr) minmax(20rem, 0.85fr);
}

.studio-ai-sessions__main,
.studio-ai-sessions__side {
  min-width: 0;
}

.studio-ai-sessions__heading {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  min-width: 0;
}

.studio-ai-sessions__eyebrow {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.02em;
  line-height: 1.1;
  margin: 0 0 0.18rem;
  text-transform: uppercase;
}

.studio-ai-sessions__title {
  font-size: 1.08rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.18;
  margin: 0;
  overflow-wrap: anywhere;
}

.studio-ai-sessions__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.studio-ai-sessions__notice {
  margin-top: 0.35rem;
}

.studio-ai-sessions__terminals {
  display: grid;
  gap: 0.75rem;
  grid-column: 1 / -1;
  min-width: 0;
}

@media (max-width: 980px) {
  .studio-ai-sessions__layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .studio-ai-sessions__toolbar,
  .studio-ai-sessions__heading {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
