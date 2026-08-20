<template>
  <section
    class="studio-autopilot"
    :class="{ 'studio-autopilot--chat-collapsed': chatCollapsed }"
  >
    <Teleport
      v-if="sessionGithubActorHeaderVisible"
      :to="props.githubActorTeleportTarget"
    >
      <div
        class="studio-home-shell-session-github-actor"
        :class="{ 'studio-home-shell-session-github-actor--inactive': !sessionGithubActor.active }"
        role="status"
        :title="sessionGithubActor.title"
      >
        <v-icon :icon="mdiGithub" size="14" />
        <span>{{ sessionGithubActor.displayLabel }}</span>
      </div>
    </Teleport>
    <section class="studio-autopilot__chat-panel" aria-label="Session chat">
      <header class="studio-autopilot__session-header">
        <Vibe64SessionToolbar
          v-if="sessionToolbarVisible"
          :abandon="props.sessionAbandon"
          compact
          :max-visible-sessions="3"
          :selected-session-id="sessionId"
          :selection-closed="sessionAbandonDisabled"
          :toolbar="props.sessionToolbar"
          @select-session="activateRealSession"
        />

        <div class="studio-autopilot__header-actions">
          <v-btn
            aria-label="Open temporary AI"
            :disabled="!sessionId"
            :icon="mdiIncognito"
            size="small"
            title="Open a temporary AI conversation"
            type="button"
            variant="text"
            @click="openTemporaryAi"
          />
          <v-btn
            :aria-label="saveWorkActionLabel"
            class="studio-autopilot__save-work"
            :color="saveWorkRequiresUpdate ? 'warning' : (saveWorkUnsaved ? 'error' : undefined)"
            :disabled="saveWorkDisabled"
            :loading="saveWorkSending"
            :prepend-icon="saveWorkRequiresUpdate ? mdiSourcePull : mdiContentSaveOutline"
            size="small"
            :title="saveWorkTitle"
            type="button"
            variant="tonal"
            @click="requestSaveWork"
          >
            {{ saveWorkActionLabel }}
          </v-btn>
        </div>
      </header>

      <Vibe64ConversationLog
        class="studio-autopilot__conversation"
        :error="props.conversationLog?.error"
        :has-more-before="props.conversationLog?.hasMoreBefore"
        :loading="props.conversationLog?.loading"
        :loading-more="props.conversationLog?.loadingMore"
        :load-more-error="props.conversationLog?.loadMoreError"
        :reloadable="chatReloadAvailable"
        :reloading="chatReloading"
        :scroll-key="conversationScrollKey"
        :source-root="sessionSourceRoot"
        :turns="chatTurns"
        :visible="conversationLogVisible"
        @cancel-turn="cancelOptimisticMessage"
        @edit-turn="editOptimisticMessage"
        @load-more="loadMoreChatTurns"
        @open-source-file="openSourceEditorFile"
        @reload="reloadChatPane"
        @resend-turn="resendOptimisticMessage"
      />

      <div
        v-if="saveWorkOperationActive || saveWorkSending || saveWorkError || workspaceSetupVisible || thinkingVisible"
        class="studio-autopilot__activity"
      >
        <Vibe64TerminalSurface
          v-if="saveWorkOperationActive || saveWorkSending || saveWorkError"
          body-mode="log"
          :collapsible="true"
          :error="saveWorkError"
          :error-title="`${saveWorkActivityLabel} needs attention`"
          :expanded="saveWorkExpanded"
          height="clamp(8rem, 22vh, 14rem)"
          mobile-takeover
          :open-error-details="true"
          :output="saveWorkOutput"
          :show-close="false"
          :show-interrupt="false"
          :starting="saveWorkSending"
          :status="saveWorkStatus"
          :subtitle="saveWorkActivityIsUpdate ? 'Replay current work on the latest saved version' : 'Canonical project Save'"
          :title="saveWorkActivityLabel"
          @toggle-expanded="saveWorkExpanded = !saveWorkExpanded"
        >
          <template v-if="saveWorkError && saveWorkCanResolveWithTemporaryAi" #error-actions>
            <v-btn
              :prepend-icon="mdiRobotOutline"
              size="x-small"
              type="button"
              variant="tonal"
              @click="openTemporaryAiForRepositoryActionError"
            >
              Resolve with temporary AI
            </v-btn>
          </template>
        </Vibe64TerminalSurface>

        <div
          v-if="workspaceSetupVisible"
          class="studio-autopilot__workspace-setup"
          :class="`studio-autopilot__workspace-setup--${workspaceSetupStatus}`"
          aria-live="polite"
          :role="workspaceSetupNeedsAttention ? 'alert' : 'status'"
        >
          <div class="studio-autopilot__workspace-setup-summary">
            <span class="studio-autopilot__workspace-setup-mark" aria-hidden="true" />
            <strong>{{ workspaceSetupTitle }}</strong>
            <span
              v-if="workspaceSetupCurrentLabel"
              class="studio-autopilot__workspace-setup-current"
            >
              {{ workspaceSetupCurrentLabel }}
            </span>
          </div>
          <p
            v-if="workspaceSetupNeedsAttention && workspaceSetupDiagnostic"
            class="studio-autopilot__workspace-setup-diagnostic"
          >
            {{ workspaceSetupDiagnostic }}
          </p>
          <div
            v-if="workspaceSetupNeedsAttention"
            class="studio-autopilot__workspace-setup-actions"
          >
            <v-btn
              :disabled="workspaceSetupRetryDisabled"
              :loading="workspaceSetupRetrying"
              size="x-small"
              type="button"
              variant="tonal"
              @click="retryWorkspaceSetup"
            >
              Retry setup
            </v-btn>
            <v-btn
              :disabled="workspaceSetupAskDisabled"
              size="x-small"
              type="button"
              variant="text"
              @click="askCodexToFixWorkspaceSetup"
            >
              Ask Codex to fix
            </v-btn>
          </div>
        </div>

        <div
          v-if="thinkingVisible"
          class="studio-autopilot__thinking"
          aria-live="polite"
          role="status"
        >
          <span class="studio-autopilot__thinking-mark" />
          <span>{{ thinkingLabel }}</span>
        </div>
      </div>

      <div class="studio-autopilot__composer">
        <Vibe64AutopilotPromptTextarea
          ref="composerInput"
          v-model="composerDraft"
          aria-label="Message Codex"
          :attachments-enabled="Boolean(sessionId)"
          :disabled="composerDisabled"
          :error-messages="composerError"
          :hint="composerHint"
          persistent-hint
          :placeholder="composerPlaceholder"
          :rows="2"
          :session-id="sessionId"
          tab-to-submit
          @attachments-change="updateComposerAttachments"
          @submit="sendComposerMessage"
          @tab-to-submit="focusComposerSendButton"
        >
          <template #input-start>
            <div
              v-if="numberedQuestions.length"
              class="studio-autopilot__question-fields"
              aria-label="Assistant questions"
            >
              <div class="studio-autopilot__question-fields-header">
                <v-btn
                  aria-label="Answer normally instead"
                  size="small"
                  variant="text"
                  @click="dismissNumberedQuestions"
                >
                  Answer normally
                </v-btn>
              </div>
              <div
                v-for="question in numberedQuestions"
                :key="question.name"
                class="studio-autopilot__question-field"
              >
                <v-text-field
                  v-model="questionAnswers[question.name]"
                  autocomplete="off"
                  density="compact"
                  hide-details="auto"
                  :label="`[${question.number}] ${question.label}`"
                  variant="outlined"
                />
                <v-chip-group
                  v-if="question.choices.length"
                  v-model="questionAnswers[question.name]"
                  class="studio-autopilot__question-choices"
                  column
                  selected-class="text-primary"
                >
                  <v-chip
                    v-for="choice in question.choices"
                    :key="choice.value"
                    filter
                    size="small"
                    :value="choice.value"
                    variant="outlined"
                  >
                    {{ choice.label }}<span v-if="choice.recommended"> · Recommended</span>
                  </v-chip>
                </v-chip-group>
              </div>
            </div>
            <div
              v-else-if="answerChoices.length"
              class="studio-autopilot__answer-choices"
              aria-label="Suggested answers"
            >
              <v-chip-group
                v-model="selectedAnswerChoice"
                column
                selected-class="text-primary"
              >
                <v-chip
                  v-for="choice in answerChoices"
                  :key="choice.value"
                  filter
                  :value="choice.value"
                  variant="outlined"
                >
                  {{ choice.label }}
                </v-chip>
              </v-chip-group>
            </div>
          </template>
          <template #footer>
            <div class="studio-autopilot__composer-actions">
              <Vibe64AgentSettingsMenu
                :agent-settings="currentAgentSettings"
                :disabled="composerSending"
                @update-setting="updateAgentSetting"
              />
              <v-btn
                aria-label="Attach files"
                :disabled="composerDisabled"
                :icon="mdiPaperclip"
                size="small"
                title="Attach files"
                type="button"
                variant="text"
                @click="composerInput?.openFilePicker?.()"
              />
              <v-btn
                v-if="previewAttachmentState.captureAvailable"
                aria-label="Attach visible preview"
                :disabled="composerDisabled || previewAttachmentState.captureBusy"
                :icon="mdiEyePlusOutline"
                :loading="previewAttachmentState.captureBusy"
                size="small"
                title="Attach visible preview"
                type="button"
                variant="text"
                @click="captureVisiblePreview"
              />
              <v-btn
                v-if="previewAttachmentState.diagnosticsAvailable"
                aria-label="Attach console & network"
                :disabled="composerDisabled || previewAttachmentState.diagnosticsBusy"
                :icon="mdiConsoleNetworkOutline"
                :loading="previewAttachmentState.diagnosticsBusy"
                size="small"
                title="Attach console and network diagnostics"
                type="button"
                variant="text"
                @click="attachPreviewDiagnostics"
              />
              <span class="studio-autopilot__composer-spacer" />
              <v-btn
                v-if="agentStopVisible"
                color="error"
                :disabled="!agentStopEnabled"
                :loading="interrupting"
                :prepend-icon="mdiStopCircleOutline"
                size="small"
                type="button"
                variant="tonal"
                @click="requestAgentInterrupt"
              >
                Stop
              </v-btn>
              <v-btn
                v-if="agentStopVisible"
                ref="composerSendButton"
                aria-label="Steer assistant"
                :aria-disabled="!composerCanSubmit"
                class="studio-autopilot__send--steer"
                :class="{ 'studio-autopilot__send--inactive': !composerCanSubmit }"
                color="primary"
                :disabled="composerDisabled"
                :loading="composerSending"
                :prepend-icon="mdiArrowTopRight"
                size="small"
                title="Steer assistant"
                type="button"
                variant="flat"
                @click="sendComposerMessage"
              >
                Steer
              </v-btn>
              <v-btn
                v-else
                ref="composerSendButton"
                aria-label="Send message"
                :aria-disabled="!composerCanSubmit"
                :class="{ 'studio-autopilot__send--inactive': !composerCanSubmit }"
                color="primary"
                :disabled="composerDisabled"
                :icon="mdiSend"
                :loading="composerSending"
                size="small"
                title="Send message"
                type="button"
                variant="flat"
                @click="sendComposerMessage"
              />
            </div>
          </template>
        </Vibe64AutopilotPromptTextarea>
      </div>

      <Vibe64TemporaryAiWorkspace
        ref="temporaryAiWorkspace"
        :agent-settings="currentAgentSettings"
        :session-id="sessionId"
        :sessions-api-path="props.sessionsApiPath"
      />
    </section>

    <section class="studio-autopilot__project-panel" aria-label="Project">
      <Vibe64DashboardShell
        v-if="props.projectPane === 'dashboard'"
        v-show="dashboardShellVisible"
        class="studio-autopilot__dashboard-shell"
        :dashboard-context="dashboardContext"
      >
        <div
          v-show="dashboardRouteVisible"
          class="studio-autopilot__right-pane-page"
          role="tabpanel"
        >
          <slot
            v-if="dashboardRouteVisible"
            name="dashboard"
            :dashboard-context="dashboardContext"
          />
        </div>

        <div
          v-show="rightPaneTab === 'ai-terminal'"
          class="studio-autopilot__right-pane-page"
          role="tabpanel"
        >
          <slot
            v-if="rightPaneTabMounted('ai-terminal')"
            name="ai-terminal"
            :active="rightPaneTab === 'ai-terminal'"
          />
        </div>
      </Vibe64DashboardShell>

      <section
        v-show="props.projectPane === 'dashboard' && rightPaneTab === 'editor'"
        class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
        role="tabpanel"
      >
        <header class="studio-autopilot__session-tool-header">
          <v-btn
            v-if="systemBackAvailable"
            :prepend-icon="mdiArrowLeft"
            size="x-small"
            type="button"
            variant="tonal"
            @click="backToSystemFromEditor"
          >
            Back to Cities
          </v-btn>
          <v-btn
            v-else
            :prepend-icon="mdiArrowLeft"
            size="x-small"
            type="button"
            variant="tonal"
            @click="backToDashboard"
          >
            Back to dashboard
          </v-btn>
        </header>
        <Vibe64SessionSourceEditor
          v-if="rightPaneTabMounted('editor')"
          :active="props.projectPane === 'dashboard' && rightPaneTab === 'editor'"
          :ask-codex-available="sourceEditorAskCodexAvailable"
          class="studio-autopilot__session-tool-content"
          :open-request="sourceEditorOpenRequest"
          :open-sync-state="props.session?.uiSync?.sourceEditor || null"
          :project-slug="projectSlug"
          :session-id="sessionId"
          :sessions-api-path="props.sessionsApiPath"
          @ask-codex-about-file="askCodexAboutSourceEditorFile"
        />
      </section>

      <section
        v-show="props.projectPane === 'dashboard' && rightPaneTab === 'system'"
        class="studio-autopilot__right-pane-page studio-autopilot__session-tool-pane"
        role="tabpanel"
      >
        <header class="studio-autopilot__session-tool-header">
          <v-btn
            :prepend-icon="mdiArrowLeft"
            size="x-small"
            type="button"
            variant="tonal"
            @click="backToDashboard"
          >
            Back to dashboard
          </v-btn>
        </header>
        <Vibe64SystemWorldView
          v-if="rightPaneTabMounted('system')"
          :active="props.projectPane === 'dashboard' && rightPaneTab === 'system'"
          :ask-chat-available="sourceEditorAskCodexAvailable"
          class="studio-autopilot__session-tool-content"
          :resolve-request-url="resolveStudioRequestUrl"
          :restore-request="systemRestoreRequest"
          :session-id="sessionId"
          @ask-in-chat="askCodexAboutSystemContext"
          @open-source-file-immersive="openSourceEditorFile"
          @open-source-file="openSourceEditorFile"
        />
      </section>

      <div
        v-show="props.projectPane !== 'dashboard'"
        class="studio-autopilot__right-pane-page"
        role="tabpanel"
      >
        <Vibe64LaunchControls
          :ask-codex-to-fix-preview-identity="askCodexToFixPreviewIdentity"
          :attach-preview-file="attachPreviewFile"
          :auto-start-managed-preview="!props.sessionSelectionClosed"
          button-label="Run"
          button-size="small"
          button-variant="tonal"
          :busy="Boolean(props.page?.busy || props.page?.launchBusy)"
          class="studio-autopilot__preview-launch"
          embedded-preview
          :preview-displayed="rightPaneTab === 'preview' && props.projectPane === 'preview'"
          :session="props.session"
          :toolbar-teleport-target="rightPaneTab === 'preview' && props.projectPane === 'preview' ? props.previewToolbarTeleportTarget : ''"
          :window-displayed="props.active"
          @preview-attachment-state="updatePreviewAttachmentState"
        />
      </div>
    </section>

    <v-dialog v-model="saveWorkConfirmOpen" max-width="34rem">
      <v-card>
        <v-card-title>Save current work?</v-card-title>
        <v-card-text>
          Vibe64 will save this session to the project's canonical repository. It preserves concurrent canonical
          changes and stops before publishing only when another open session has changes that Git cannot merge cleanly.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="saveWorkSending" type="button" variant="text" @click="cancelSaveWork">
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            :loading="saveWorkSending"
            type="button"
            variant="flat"
            @click="confirmSaveWork"
          >
            Save
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, defineAsyncComponent, ref, watch } from "vue";
import {
  mdiArrowLeft,
  mdiArrowTopRight,
  mdiConsoleNetworkOutline,
  mdiContentSaveOutline,
  mdiEyePlusOutline,
  mdiGithub,
  mdiIncognito,
  mdiPaperclip,
  mdiRobotOutline,
  mdiSend,
  mdiSourcePull,
  mdiStopCircleOutline
} from "@mdi/js";
import Vibe64AgentSettingsMenu from "@/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import Vibe64ConversationLog from "@/components/studio/vibe64-session/Vibe64ConversationLog.vue";
import Vibe64TerminalSurface from "@/components/studio/Vibe64TerminalSurface.vue";
import Vibe64SessionSourceEditor from "@/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import Vibe64TemporaryAiWorkspace from "@/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue";
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import {
  useVibe64AutopilotView,
  vibe64AutopilotViewEmits,
  vibe64AutopilotViewProps
} from "@/composables/useVibe64AutopilotView.js";

const emit = defineEmits(vibe64AutopilotViewEmits);
const props = defineProps(vibe64AutopilotViewProps);
const Vibe64SystemWorldView = defineAsyncComponent(() => (
  import("@local/vibe64-system-graph/client").then((module) => module.loadVibe64SystemWorldView())
));
const composerInput = ref(null);
const composerSendButton = ref(null);
const temporaryAiWorkspace = ref(null);

const {
  Vibe64LaunchControls,
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
  retryWorkspaceSetup,
  requestSaveWork,
  resendOptimisticMessage,
  requestAgentInterrupt,
  rightPaneTab,
  rightPaneTabMounted,
  saveWorkConfirmOpen,
  saveWorkActivityIsUpdate,
  saveWorkActivityLabel,
  saveWorkActionLabel,
  saveWorkDisabled,
  saveWorkError,
  saveWorkExpanded,
  saveWorkCanResolveWithTemporaryAi,
  saveWorkOperationActive,
  saveWorkOutput,
  saveWorkSending,
  saveWorkStatus,
  saveWorkTitle,
  saveWorkRequiresUpdate,
  saveWorkUnsaved,
  sessionId,
  sessionGithubActor,
  sessionGithubActorHeaderVisible,
  sessionSourceRoot,
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
} = useVibe64AutopilotView(props, emit);

const dashboardContext = computed(() => ({
  ...(dashboardSessionContext.value || {}),
  requestUpdateWork: props.updateSessionWork,
  requestTemporaryAi: openTemporaryAiForRepositoryError
}));

const sessionAbandonDisabled = computed(() => Boolean(
  props.sessionSelectionClosed ||
  props.sessionAbandon?.command?.isRunning ||
  workspaceSetupRunning.value ||
  workspaceSetupRetrying.value
));

async function sendComposerMessage() {
  const accepted = await submitComposerMessage();
  if (accepted) {
    composerInput.value?.clearAttachments?.();
  }
  return accepted;
}

function focusComposerSendButton() {
  const button = composerSendButton.value?.$el || composerSendButton.value;
  button?.focus?.();
}

function openTemporaryAi() {
  temporaryAiWorkspace.value?.showWorkspace?.();
}

function activateRealSession() {
  temporaryAiWorkspace.value?.closeWorkspace?.();
}

const repositoryTemporaryAiGitBoundary = [
  "Vibe64—not Temporary AI—owns every repository operation. The failed operation has already been rolled back.",
  "You may inspect Git read-only and edit ordinary working-tree files in this session. Do not change HEAD, branches, refs, the index, stashes, remotes, commits, checkpoints, or repository configuration.",
  "Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase, cherry-pick, revert, pull, push, fetch, or update-ref. Do not create a recovery ref or stash; Vibe64 already owns durable recovery.",
  "Record the initial HEAD and index with read-only commands, leave both byte-for-byte unchanged, and do not publish. Resolve only by editing the conflicting working-tree files so the user can retry the Vibe64 operation.",
  "For an overlapping edit, keep the latest saved version's overlapping lines byte-for-byte and preserve this session's additional intent in adjacent non-overlapping content. Do not report success while Git has unmerged index entries or while HEAD/index differ from their initial values."
].join("\n");

function openTemporaryAiForRepositoryActionError() {
  const action = saveWorkActivityIsUpdate.value ? "Update" : "Save";
  temporaryAiWorkspace.value?.openTask?.({
    draft: [
      `Help resolve this Vibe64 ${action} problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:`,
      repositoryTemporaryAiGitBoundary,
      saveWorkError.value
    ].filter(Boolean).join("\n\n"),
    policy: "workspace_write",
    title: `Resolve ${action}`
  });
}

function openTemporaryAiForRepositoryError({ error = "", title = "Resolve repository problem" } = {}) {
  temporaryAiWorkspace.value?.openTask?.({
    draft: [
      "Help resolve this Vibe64 repository problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:",
      repositoryTemporaryAiGitBoundary,
      String(error || "").trim()
    ].filter(Boolean).join("\n\n"),
    policy: "workspace_write",
    title
  });
}

watch(() => props.active, (active, wasActive) => {
  if (active && !wasActive) {
    activateRealSession();
  }
});

async function attachPreviewFile(file) {
  const uploaded = await composerInput.value?.attachFiles?.([file]);
  if (!Array.isArray(uploaded) || uploaded.length < 1) {
    throw new Error("Open the chat composer before attaching a preview file.");
  }
  return uploaded[0];
}
</script>

<style scoped>
.studio-autopilot {
  background: rgb(var(--v-theme-background));
  display: grid;
  grid-template-columns: minmax(20rem, 38%) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-home-shell-session-github-actor {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: inline-flex;
  font-size: 0.72rem;
  font-weight: 650;
  gap: 0.24rem;
  line-height: 1;
  max-width: 100%;
  min-width: 0;
  padding: 0 0.36rem;
  white-space: nowrap;
}

.studio-home-shell-session-github-actor span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.studio-home-shell-session-github-actor--inactive {
  color: rgba(var(--v-theme-on-surface), 0.46);
}

.studio-autopilot--chat-collapsed {
  grid-template-columns: 0 minmax(0, 1fr);
}

.studio-autopilot__chat-panel {
  background: rgb(var(--v-theme-surface));
  border-right: 1px solid rgba(var(--v-theme-outline), 0.14);
  container-name: studio-chat-pane;
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.studio-autopilot--chat-collapsed .studio-autopilot__chat-panel {
  visibility: hidden;
}

.studio-autopilot__session-header {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  box-sizing: border-box;
  display: flex;
  gap: 0.45rem;
  justify-content: space-between;
  min-height: 3rem;
  min-width: 0;
  overflow: hidden;
  padding: 0.4rem 0.55rem;
  width: 100%;
}

.studio-autopilot__session-header :deep(.studio-ai-sessions__toolbar) {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}

.studio-autopilot__session-header :deep(.studio-ai-sessions__tabs) {
  min-width: 0;
  overflow: hidden;
}

.studio-autopilot__header-actions,
.studio-autopilot__composer-actions,
.studio-autopilot__session-tool-header {
  align-items: center;
  display: flex;
  gap: 0.4rem;
}

.studio-autopilot__header-actions {
  flex: 0 0 auto;
}

.studio-autopilot__conversation {
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__activity {
  min-height: 1.8rem;
  min-width: 0;
}

.studio-autopilot__thinking {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.66);
  display: flex;
  font-size: 0.78rem;
  gap: 0.45rem;
  min-height: 1.8rem;
  padding: 0.15rem 0.85rem;
}

.studio-autopilot__thinking-mark {
  animation: studio-autopilot-pulse 1.2s ease-in-out infinite;
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  height: 0.42rem;
  width: 0.42rem;
}

.studio-autopilot__workspace-setup {
  border-top: 1px solid rgba(var(--v-theme-outline), 0.1);
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: grid;
  font-size: 0.78rem;
  gap: 0.35rem;
  max-width: 100%;
  min-width: 0;
  padding: 0.38rem 0.8rem;
}

.studio-autopilot__workspace-setup--failed {
  background: rgba(var(--v-theme-error), 0.055);
  color: rgb(var(--v-theme-on-surface));
}

.studio-autopilot__workspace-setup--ambiguous {
  background: rgba(var(--v-theme-warning), 0.08);
  color: rgb(var(--v-theme-on-surface));
}

.studio-autopilot__workspace-setup-summary,
.studio-autopilot__workspace-setup-actions {
  align-items: center;
  display: flex;
  gap: 0.42rem;
  max-width: 100%;
  min-width: 0;
}

.studio-autopilot__workspace-setup-summary strong {
  flex: 0 0 auto;
  font-size: inherit;
}

.studio-autopilot__workspace-setup-mark {
  background: rgb(var(--v-theme-success));
  border-radius: 50%;
  flex: 0 0 auto;
  height: 0.46rem;
  width: 0.46rem;
}

.studio-autopilot__workspace-setup--running .studio-autopilot__workspace-setup-mark {
  animation: studio-autopilot-pulse 1.2s ease-in-out infinite;
  background: rgb(var(--v-theme-primary));
}

.studio-autopilot__workspace-setup--failed .studio-autopilot__workspace-setup-mark {
  background: rgb(var(--v-theme-error));
}

.studio-autopilot__workspace-setup--ambiguous .studio-autopilot__workspace-setup-mark {
  background: rgb(var(--v-theme-warning));
}

.studio-autopilot__workspace-setup-current {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.studio-autopilot__workspace-setup-diagnostic {
  line-height: 1.35;
  margin: 0;
  max-height: 4.25rem;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.studio-autopilot__workspace-setup-actions {
  flex-wrap: wrap;
}

.studio-autopilot__composer {
  border-top: 1px solid rgba(var(--v-theme-outline), 0.1);
  box-sizing: border-box;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 4px;
  width: 100%;
}

.studio-autopilot__composer-actions {
  width: 100%;
}

.studio-autopilot__send--inactive {
  opacity: var(--v-disabled-opacity);
}

.studio-autopilot__send--steer {
  min-width: 4.25rem;
  padding-inline: 0.55rem;
}

.studio-autopilot__question-fields {
  display: grid;
  gap: 0.45rem;
  padding: 0.55rem 0.6rem 0;
}

.studio-autopilot__question-fields-header {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.7);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.78rem;
  gap: 0.25rem 0.5rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-autopilot__question-fields-header > span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.studio-autopilot__question-fields-header :deep(.v-btn) {
  margin-left: auto;
}

.studio-autopilot__question-field {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.studio-autopilot__question-choices {
  max-width: 100%;
  min-width: 0;
}

.studio-autopilot__question-choices :deep(.v-chip) {
  height: auto;
  max-width: 100%;
  min-width: 0;
  white-space: normal;
}

.studio-autopilot__question-choices :deep(.v-chip__content) {
  overflow-wrap: anywhere;
  white-space: normal;
}

.studio-autopilot__answer-choices {
  padding: 0.35rem 0.55rem 0;
}

.studio-autopilot__composer-spacer {
  flex: 1 1 auto;
}

@container studio-chat-pane (max-width: 30rem) {
  .studio-autopilot__save-work {
    min-width: 2.5rem;
    padding-inline: 0.5rem;
    width: 2.5rem;
  }

  .studio-autopilot__save-work :deep(.v-btn__content) {
    display: none;
  }
}

.studio-autopilot__project-panel,
.studio-autopilot__dashboard-shell,
.studio-autopilot__right-pane-page,
.studio-autopilot__session-tool-pane,
.studio-autopilot__session-tool-content {
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__project-panel {
  contain: strict;
  overflow: hidden;
  position: relative;
}

.studio-autopilot__right-pane-page {
  overflow: auto;
}

.studio-autopilot__session-tool-pane {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.studio-autopilot__session-tool-header {
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  min-height: 2.7rem;
  padding: 0.42rem 0.7rem;
}

.studio-autopilot__session-tool-content {
  overflow: hidden;
}

.studio-autopilot__preview-launch {
  height: 100%;
}

@keyframes studio-autopilot-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (min-width: 981px) {
  .studio-autopilot {
    gap: var(--studio-home-project-gap, 0.75rem);
    grid-template-columns:
      minmax(
        var(--studio-home-chat-column-min-width, 24rem),
        var(--studio-home-chat-column-width, 30rem)
      )
      minmax(0, 1fr);
  }

  .studio-autopilot--chat-collapsed {
    gap: 0;
    grid-template-columns: 0 minmax(0, 1fr);
  }
}

@media (max-width: 900px) {
  .studio-autopilot:not(.studio-autopilot--chat-collapsed) {
    grid-template-columns: minmax(17rem, 44%) minmax(0, 1fr);
  }
}
</style>
