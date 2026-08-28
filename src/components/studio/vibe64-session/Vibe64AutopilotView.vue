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
    <Teleport
      v-if="saveWorkHeaderVisible"
      :to="props.saveWorkTeleportTarget"
    >
      <v-btn
        :aria-busy="saveWorkSending ? 'true' : undefined"
        :aria-label="saveWorkHeaderAriaLabel"
        class="studio-autopilot__save-work"
        :color="saveWorkRequiresUpdate ? 'warning' : (saveWorkUnsaved ? 'primary' : undefined)"
        :disabled="saveWorkDisabled"
        :prepend-icon="saveWorkRequiresUpdate ? mdiSourcePull : mdiContentSaveOutline"
        size="small"
        :title="saveWorkTitle"
        type="button"
        variant="tonal"
        @click="requestSaveWork"
      >
        <span class="studio-autopilot__save-work-label">{{ saveWorkHeaderLabel }}</span>
      </v-btn>
    </Teleport>
    <section
      ref="mainChat"
      class="studio-autopilot__chat-panel"
      aria-label="Session chat"
      tabindex="-1"
    >
      <header class="studio-autopilot__session-header">
        <Vibe64SessionToolbar
          v-if="sessionToolbarVisible"
          :abandon="props.sessionAbandon"
          compact
          :create-visible="props.sessionToolbar.createSessionVisible === true"
          :max-visible-sessions="3"
          :selected-session-id="sessionId"
          :selection-closed="sessionAbandonDisabled"
          :toolbar="props.sessionToolbar"
          @select-session="activateRealSession"
        />

        <div class="studio-autopilot__header-actions studio-autopilot__header-actions--compact">
          <v-menu
            location="bottom end"
          >
            <template #activator="{ props: menuProps }">
              <v-badge
                :color="sessionRenewalActionPresentation.color || 'primary'"
                dot
                :model-value="sessionRenewalActionPresentation.attention === true"
                offset-x="5"
                offset-y="5"
              >
                <v-btn
                  ref="sessionActionsTrigger"
                  v-bind="menuProps"
                  :aria-label="sessionActionsLabel"
                  data-vibe64-session-actions
                  height="48"
                  :icon="mdiDotsVertical"
                  title="Session actions"
                  type="button"
                  variant="text"
                  width="48"
                />
              </v-badge>
            </template>
            <v-list aria-label="Session actions" density="compact" min-width="17rem">
              <v-list-item
                v-if="props.sessionRenewal?.visible"
                class="studio-autopilot__session-action-item"
                data-vibe64-session-renew-action
                :disabled="!assistantDirectAllowed"
                :prepend-icon="mdiAutorenew"
                :subtitle="assistantDirectAllowed ? sessionRenewalActionPresentation.reason : assistantRestrictionMessage"
                :title="sessionRenewalActionPresentation.label"
                @click="requestSessionRenewal(sessionActionsTrigger)"
              />
              <v-list-item
                class="studio-autopilot__session-action-item"
                data-vibe64-temporary-ai-action
                :disabled="!sessionId || !assistantDirectAllowed"
                :prepend-icon="mdiIncognito"
                :subtitle="assistantDirectAllowed ? 'Open a separate short-lived conversation' : assistantRestrictionMessage"
                title="Temporary AI"
                @click="openTemporaryAi"
              />
            </v-list>
          </v-menu>
        </div>
        <div class="studio-autopilot__header-actions studio-autopilot__header-actions--expanded">
          <v-badge
            v-if="props.sessionRenewal?.visible"
            :color="sessionRenewalActionPresentation.color || 'primary'"
            dot
            :model-value="sessionRenewalActionPresentation.attention === true"
            offset-x="5"
            offset-y="5"
          >
            <v-btn
              :aria-label="sessionRenewalActionPresentation.label"
              :color="sessionRenewalActionPresentation.color"
              data-vibe64-session-renew-action
              :disabled="!assistantDirectAllowed"
              height="48"
              :icon="mdiAutorenew"
              :title="assistantDirectAllowed ? sessionRenewalActionPresentation.reason : assistantRestrictionMessage"
              type="button"
              variant="text"
              width="48"
              @click="requestSessionRenewal($event.currentTarget)"
            />
          </v-badge>
          <v-btn
            aria-label="Open temporary AI"
            :disabled="!sessionId || !assistantDirectAllowed"
            height="48"
            :icon="mdiIncognito"
            :title="assistantDirectAllowed ? 'Open a temporary AI conversation' : assistantRestrictionMessage"
            type="button"
            variant="text"
            width="48"
            @click="openTemporaryAi"
          />
        </div>
      </header>

      <div
        v-if="saveWorkActivityVisible || workspaceSetupVisible"
        class="studio-autopilot__activity"
        aria-label="Session activity"
      >
        <Vibe64TerminalSurface
          v-if="saveWorkActivityVisible"
          body-mode="log"
          :collapsible="true"
          :error="saveWorkError"
          :error-title="`${saveWorkActivityLabel} needs attention`"
          :expanded="saveWorkExpanded"
          height="clamp(8rem, 22vh, 14rem)"
          mobile-takeover
          :open-error-details="true"
          :output="saveWorkOutput"
          :retryable="saveWorkRetryable"
          :show-close="false"
          :show-copy="Boolean(saveWorkOutput)"
          :show-interrupt="false"
          :stage="saveWorkStage"
          :starting="saveWorkSending"
          :status="saveWorkStatus"
          :subtitle="saveWorkActivityIsUpdate ? 'Replay current work on the latest saved version' : 'Canonical project Save'"
          :title="saveWorkActivityLabel"
          @copy="copyActivityOutput(saveWorkOutput)"
          @retry="retrySaveWork"
          @toggle-expanded="saveWorkExpanded = !saveWorkExpanded"
        >
          <template v-if="saveWorkError && saveWorkCanResolveWithTemporaryAi" #error-actions>
            <v-btn
              :aria-busy="repositoryRecoverySending ? 'true' : undefined"
              class="studio-autopilot__recovery-action"
              :disabled="repositoryRecoverySending || !assistantDirectAllowed"
              :prepend-icon="mdiRobotOutline"
              size="small"
              :title="assistantDirectAllowed ? 'Open temporary AI to resolve this repository problem' : assistantRestrictionMessage"
              type="button"
              variant="tonal"
              @click="fixRepositoryActionError"
            >
              {{ repositoryRecoverySending ? "Opening temporary AI…" : "Fix with temporary AI" }}
            </v-btn>
          </template>
        </Vibe64TerminalSurface>

        <Vibe64TerminalSurface
          v-if="workspaceSetupVisible"
          body-mode="log"
          :collapsible="true"
          :error="workspaceSetupNeedsAttention ? workspaceSetupDiagnostic : ''"
          error-title="Workspace preparation needs attention"
          :expanded="workspaceSetupExpanded"
          height="clamp(8rem, 22vh, 14rem)"
          mobile-takeover
          :open-error-details="workspaceSetupNeedsAttention"
          :output="workspaceSetupOutput"
          :retryable="workspaceSetupNeedsAttention && !workspaceSetupRetryDisabled"
          :show-close="false"
          :show-copy="Boolean(workspaceSetupOutput)"
          :show-interrupt="false"
          :stage="workspaceSetupCurrentLabel"
          :starting="workspaceSetupRunning || workspaceSetupRetrying"
          :status="workspaceSetupStatus"
          subtitle="Project dependency preparation"
          :title="workspaceSetupTitle"
          @copy="copyActivityOutput(workspaceSetupOutput)"
          @retry="retryWorkspaceSetup"
          @toggle-expanded="workspaceSetupExpanded = !workspaceSetupExpanded"
        >
          <template v-if="workspaceSetupNeedsAttention" #error-actions>
            <v-btn
              :aria-busy="workspaceSetupFixSending ? 'true' : undefined"
              class="studio-autopilot__recovery-action"
              :disabled="workspaceSetupAskDisabled"
              size="small"
              :title="assistantDirectAllowed ? 'Open temporary AI to resolve workspace preparation' : assistantRestrictionMessage"
              type="button"
              variant="tonal"
              @click="askCodexToFixWorkspaceSetup"
            >
              {{ workspaceSetupFixSending ? "Opening temporary AI…" : "Fix with temporary AI" }}
            </v-btn>
          </template>
        </Vibe64TerminalSurface>
      </div>

      <Vibe64ConversationLog
        :assistant-label="conversationAssistantLabel"
        class="studio-autopilot__conversation"
        :error="props.conversationLog?.error"
        :follow-latest-key="conversationFollowLatestKey"
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
        :welcome-message="emptyConversationWelcome"
        @cancel-turn="cancelOptimisticMessage"
        @edit-turn="editOptimisticMessage"
        @load-more="loadMoreChatTurns"
        @open-source-file="openSourceEditorFile"
        @reload="reloadChatPane"
        @resend-turn="resendOptimisticMessage"
      />

      <Vibe64PromptHints
        :assistant-label="composerAssistantLabel"
        :loading="!composerAssistantLabel && promptHintsVisible && promptHintsLoading"
        :status-id="thinkingStatusId"
        :suggestions="!composerAssistantLabel && promptHintsVisible ? promptHintSuggestions : []"
        @dismiss="dismissPromptHintsAndFocus"
        @focusout="handlePromptHintsFocusOut"
        @preview="previewPromptHint"
        @select="selectPromptHint"
      />

      <div
        class="studio-autopilot__composer"
        @focusout="handleComposerRegionFocusOut"
      >
        <Vibe64AutopilotPromptTextarea
          ref="composerInput"
          v-model="composerDraft"
          aria-label="Message AI assistant"
          :attachments-enabled="composerAttachmentsEnabled"
          :described-by="composerSupportStatusVisible ? thinkingStatusId : ''"
          :disabled="composerDisabled"
          :error-messages="composerError"
          :hint="composerAccessHint"
          persistent-hint
          :placeholder="composerPromptHintPlaceholder"
          :placeholder-affects-height="!composerPromptHintPreview"
          :rows="numberedQuestions.length ? 1 : 2"
          :session-id="sessionId"
          :submit-enabled="composerCanSubmit"
          tab-to-submit
          @attachment-state-change="updateComposerAttachmentState"
          @attachments-change="updateComposerAttachments"
          @blur="handleComposerBlur"
          @escape="dismissPromptHints"
          @focus="focusPromptHints"
          @input-activity="noteTypingActivity"
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
                  color="primary"
                  :prepend-icon="mdiPencilOutline"
                  size="small"
                  variant="tonal"
                  @click="dismissNumberedQuestions"
                >
                  Answer normally instead
                </v-btn>
              </div>
              <div
                v-for="question in numberedQuestions"
                :key="question.name"
                class="studio-autopilot__question-field"
              >
                <v-select
                  v-if="question.choices.length"
                  v-model="questionAnswers[question.name]"
                  class="studio-autopilot__question-select"
                  density="compact"
                  hide-details="auto"
                  item-title="selectLabel"
                  item-value="value"
                  :items="numberedQuestionSelectItems[question.name]"
                  :label="`[${question.number}] ${question.label}`"
                  :title="question.label"
                  variant="outlined"
                />
                <v-text-field
                  v-else
                  v-model="questionAnswers[question.name]"
                  autocomplete="off"
                  density="compact"
                  hide-details="auto"
                  :label="`[${question.number}] ${question.label}`"
                  :title="question.label"
                  variant="outlined"
                />
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
          <template #footer="{ attachmentState }">
            <div class="studio-autopilot__composer-actions">
              <Vibe64AssistantAccessPanel
                :access-error="assistantAccessError"
                :action-is-pending="assistantActionIsPending"
                :can-manage="assistantSuggestionsCanManage"
                :pending-action="assistantPendingAction"
                :pending-suggestions="assistantPendingSuggestions"
                :suggestions-error="assistantSuggestionsError"
                @approve="approveAssistantSuggestion"
                @discard="discardAssistantSuggestion"
                @reload="reloadAssistantAccess"
                @withdraw="withdrawAssistantSuggestion"
              />
              <Vibe64SessionAssistantMenu
                :access-label="assistantAccessLabel"
                :access-loading="assistantAccessLoading"
                :disabled="composerSending || agentActive || !assistantDirectAllowed"
                :disabled-reason="!assistantDirectAllowed ? assistantRestrictionMessage : ''"
                :session="props.session"
                :sessions-api-path="props.sessionsApiPath"
              />
              <v-btn
                v-if="composerAttachmentsSupported"
                aria-label="Attach files"
                class="studio-autopilot__composer-action"
                :disabled="!composerAttachmentsEnabled || !attachmentState.canAddFiles"
                :icon="mdiPaperclip"
                size="small"
                title="Attach files"
                type="button"
                variant="text"
                @click="composerInput?.openFilePicker?.()"
              />
              <v-btn
                v-if="composerAttachmentsSupported && previewAttachmentState.captureAvailable"
                aria-label="Attach visible preview"
                class="studio-autopilot__composer-action"
                :aria-busy="previewAttachmentState.captureBusy ? 'true' : undefined"
                :disabled="!composerAttachmentsEnabled || !attachmentState.canAddFiles || previewAttachmentState.captureBusy"
                :icon="mdiEyePlusOutline"
                size="small"
                title="Attach visible preview"
                type="button"
                variant="text"
                @click="captureVisiblePreview"
              />
              <v-btn
                v-if="composerAttachmentsSupported && previewAttachmentState.diagnosticsAvailable"
                aria-label="Attach console & network"
                class="studio-autopilot__composer-action"
                :aria-busy="previewAttachmentState.diagnosticsBusy ? 'true' : undefined"
                :disabled="!composerAttachmentsEnabled || !attachmentState.canAddFiles || previewAttachmentState.diagnosticsBusy"
                :icon="mdiConsoleNetworkOutline"
                size="small"
                title="Attach console and network diagnostics"
                type="button"
                variant="text"
                @click="attachPreviewDiagnostics"
              />
              <span class="studio-autopilot__composer-spacer" />
              <v-btn
                v-if="agentStopVisible"
                :aria-busy="interrupting ? 'true' : undefined"
                class="studio-autopilot__composer-action"
                color="error"
                :disabled="!agentStopEnabled"
                :prepend-icon="mdiStopCircleOutline"
                size="small"
                type="button"
                variant="tonal"
                @click="requestAgentInterrupt"
              >
                {{ interrupting ? "Stopping…" : "Stop" }}
              </v-btn>
              <v-btn
                ref="composerSendButton"
                :aria-busy="composerSending ? 'true' : undefined"
                :aria-label="composerSubmitActionAriaLabel"
                class="studio-autopilot__composer-action studio-autopilot__send-action"
                color="primary"
                :disabled="!composerCanSubmit || !attachmentState.canSubmit"
                :prepend-icon="composerSuggesting ? mdiAccountArrowRightOutline : (composerSubmitMode === 'send' ? mdiSend : (['steer', 'steering'].includes(composerSubmitMode) ? mdiArrowTopRight : undefined))"
                size="small"
                :title="composerSubmitActionTitle"
                type="button"
                variant="flat"
                @click="sendComposerMessage"
              >
                {{ composerSubmitActionLabel }}
              </v-btn>
            </div>
          </template>
        </Vibe64AutopilotPromptTextarea>
      </div>

      <Vibe64TemporaryAiWorkspace
        ref="temporaryAiWorkspace"
        :agent-settings="currentAgentSettings"
        :session-id="sessionId"
        :sessions-api-path="props.sessionsApiPath"
        @select-main-chat="showMainChat"
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
          :assistant-available="assistantDirectAllowed"
          :assistant-unavailable-message="assistantRestrictionMessage"
          :ask-codex-available="sourceEditorAskCodexAvailable"
          class="studio-autopilot__session-tool-content"
          :open-request="sourceEditorOpenRequest"
          :project-slug="projectSlug"
          :session-id="sessionId"
          :sessions-api-path="props.sessionsApiPath"
          @ask-codex-about-file="askCodexAboutSourceEditorFile"
        />
      </section>

      <section
        v-show="props.projectPane === 'dashboard' && rightPaneTab === 'database'"
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
        <Vibe64DatabaseWorkspace
          v-if="rightPaneTabMounted('database')"
          :active="props.projectPane === 'dashboard' && rightPaneTab === 'database'"
          :assistant-available="assistantDirectAllowed"
          :assistant-unavailable-message="assistantRestrictionMessage"
          class="studio-autopilot__session-tool-content"
          :project-slug="projectSlug"
          :session-id="sessionId"
          :sessions-api-path="props.sessionsApiPath"
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
          class="studio-autopilot__session-tool-content"
          :resolve-request-url="resolveStudioRequestUrl"
          :restore-request="systemRestoreRequest"
          :session-id="sessionId"
          @open-source-file-immersive="openSourceEditorFile"
          @open-source-file="openSourceEditorFile"
        />
      </section>

      <div
        v-show="props.projectPane !== 'dashboard'"
        class="studio-autopilot__right-pane-page"
        role="tabpanel"
      >
        <Vibe64OutputControls
          :ask-codex-to-fix-preview-identity="assistantDirectAllowed ? askCodexToFixPreviewIdentity : null"
          :attach-preview-file="attachPreviewFile"
          :prepare-preview-file="attachPreviewFileProducer"
          :auto-start-managed-preview="!props.sessionSelectionClosed"
          button-label="Run"
          button-size="small"
          button-variant="tonal"
          :busy="Boolean(props.page?.busy || props.page?.launchBusy)"
          class="studio-autopilot__preview-launch"
          embedded-preview
          :preview-displayed="rightPaneTab === 'preview' && props.projectPane === 'preview'"
          :session="props.session"
          :source-operations-suspended="sourceOperationsSuspended || agentActive"
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
            :aria-busy="saveWorkSending ? 'true' : undefined"
            color="primary"
            :disabled="saveWorkSending"
            type="button"
            variant="flat"
            @click="confirmSaveWork"
          >
            {{ saveWorkSending ? "Saving…" : "Save" }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, defineAsyncComponent, nextTick, ref, useId, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import {
  mdiAccountArrowRightOutline,
  mdiArrowLeft,
  mdiArrowTopRight,
  mdiAutorenew,
  mdiConsoleNetworkOutline,
  mdiContentSaveOutline,
  mdiDotsVertical,
  mdiEyePlusOutline,
  mdiGithub,
  mdiIncognito,
  mdiPaperclip,
  mdiPencilOutline,
  mdiRobotOutline,
  mdiSend,
  mdiSourcePull,
  mdiStopCircleOutline
} from "@mdi/js";
import Vibe64AssistantAccessPanel from "@/components/studio/vibe64-session/Vibe64AssistantAccessPanel.vue";
import Vibe64SessionAssistantMenu from "@/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import Vibe64PromptHints from "@/components/studio/vibe64-session/Vibe64PromptHints.vue";
import Vibe64ConversationLog from "@/components/studio/vibe64-session/Vibe64ConversationLog.vue";
import Vibe64TerminalSurface from "@/components/studio/Vibe64TerminalSurface.vue";
import Vibe64SessionSourceEditor from "@/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import Vibe64TemporaryAiWorkspace from "@/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue";
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";
import { writeClipboardText } from "@/lib/clipboard.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import {
  useVibe64AutopilotView,
  vibe64AutopilotViewEmits,
  vibe64AutopilotViewProps
} from "@/composables/useVibe64AutopilotView.js";
import {
  promptHintConversationFingerprint,
  useVibe64PromptHints
} from "@/composables/useVibe64PromptHints.js";
import {
  useVibe64SessionTypingPresence
} from "@/composables/useVibe64SessionTypingPresence.js";
import {
  useVibe64AssistantAccess
} from "@/composables/useVibe64AssistantAccess.js";
import {
  VIBE64_SESSION_CHANGED_EVENT
} from "@/lib/vibe64SessionRequestConfig.js";

const emit = defineEmits(vibe64AutopilotViewEmits);
const props = defineProps(vibe64AutopilotViewProps);
const sessionRenewalActionPresentation = computed(() => (
  props.sessionRenewal?.actionPresentation ||
  props.sessionRenewal?.advisoryPresentation || {
    attention: false,
    color: undefined,
    label: "Renew session",
    reason: "Renew this session with a reviewed handover."
  }
));
const sessionActionsLabel = computed(() => (
  sessionRenewalActionPresentation.value.attention
    ? `Session actions: ${sessionRenewalActionPresentation.value.label}`
    : "Session actions"
));
const sourceOperationsSuspended = computed(() => (
  props.sessionRenewal?.sourceOperationsSuspended === true
));
const Vibe64SystemWorldView = defineAsyncComponent(() => (
  import("@local/vibe64-system-graph/client").then((module) => module.loadVibe64SystemWorldView())
));
const Vibe64DatabaseWorkspace = defineAsyncComponent(() => (
  import("@local/vibe64-database-tools/client").then((module) => module.loadVibe64DatabaseWorkspace())
));
const composerInput = ref(null);
const composerSendButton = ref(null);
const mainChat = ref(null);
const sessionActionsTrigger = ref(null);
const temporaryAiWorkspace = ref(null);
const thinkingStatusId = `studio-autopilot-thinking-${useId()}`;
const composerAttachmentState = ref({
  count: 0,
  hasUnresolved: false,
  uploading: false
});
const selectedAssistantSessionId = computed(() => String(
  props.session?.sessionId || ""
).trim());
const openCodeProgressLabel = ref("");
const openCodeProviderLabel = computed(() => ({
  deepseek: "DeepSeek",
  "zai-coding-plan": "Z.AI"
})[String(props.session?.assistantSelection?.modelProviderId || "").trim()] || "OpenCode");

function visibleOpenCodeProgressLabel(progress = {}) {
  if (String(progress.tool || "").trim()) {
    return `${openCodeProviderLabel.value} is using a tool…`;
  }
  if (
    String(progress.partType || "").trim() === "reasoning" ||
    String(progress.type || "").includes("reasoning")
  ) {
    return `${openCodeProviderLabel.value} is reasoning…`;
  }
  if (String(progress.text || "").trim()) {
    return `${openCodeProviderLabel.value} is writing…`;
  }
  return `${openCodeProviderLabel.value} is working…`;
}

useRealtimeEvent({
  enabled: computed(() => Boolean(
    props.active &&
    !props.sessionSelectionClosed &&
    selectedAssistantSessionId.value &&
    props.session?.assistantSelection?.engineId === "opencode"
  )),
  event: VIBE64_SESSION_CHANGED_EVENT,
  matches: ({ payload = {} } = {}) => Boolean(
    String(payload.sessionId || payload.entityId || "").trim() === selectedAssistantSessionId.value &&
    (
      payload.assistantProgress ||
      [
        "opencode-server-message-delivered",
        "opencode-server-turn-active",
        "opencode-server-turn-idle"
      ].includes(payload.reason)
    )
  ),
  onEvent: ({ payload = {} } = {}) => {
    openCodeProgressLabel.value = payload.reason === "opencode-server-turn-idle"
      ? ""
      : visibleOpenCodeProgressLabel(payload.assistantProgress || {});
  }
});

watch([
  selectedAssistantSessionId,
  () => props.session?.assistantSelection?.engineId
], () => {
  openCodeProgressLabel.value = "";
}, { immediate: true });
const {
  accessError: assistantAccessError,
  accessLabel: assistantAccessLabel,
  actionIsPending: assistantActionIsPending,
  approveSuggestion: approveAssistantSuggestion,
  canManage: assistantSuggestionsCanManage,
  canRequestMessage: assistantCanRequestMessage,
  canUseAi: assistantCanUseAiState,
  discardSuggestion: discardAssistantSuggestion,
  initialAccessLoading: assistantAccessLoading,
  pendingAction: assistantPendingAction,
  pendingSuggestions: assistantPendingSuggestions,
  reload: reloadAssistantAccess,
  restrictionMessage: assistantRestrictionMessage,
  suggestMessage: suggestAssistantMessage,
  suggestionsError: assistantSuggestionsError,
  withdrawSuggestion: withdrawAssistantSuggestion
} = useVibe64AssistantAccess({
  active: computed(() => props.active && !props.sessionSelectionClosed),
  sessionId: selectedAssistantSessionId,
  sessionsApiPath: computed(() => readRefOrGetterValue(props.sessionsApiPath))
});

async function sendMainChatMessage(input = {}) {
  if (assistantCanRequestMessage.value) {
    return suggestAssistantMessage(input);
  }
  if (assistantCanUseAiState.value) {
    return props.sendAgentMessage(input);
  }
  throw new Error(assistantRestrictionMessage.value);
}

const {
  Vibe64OutputControls,
  assistantDirectAllowed,
  agentActive,
  agentStopEnabled,
  agentStopVisible,
  answerChoices,
  askCodexAboutSourceEditorFile,
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
  composerAcceptedAttachments,
  composerAttachmentsEnabled,
  composerAttachmentsSupported,
  composerCanSubmit,
  composerDisabled,
  composerDraft,
  composerError,
  composerHint,
  composerPlaceholder,
  composerSending,
  composerSubmitAriaLabel,
  composerSubmitLabel,
  composerSubmitMode,
  composerSubmitTitle,
  conversationLogVisible,
  conversationFollowLatestKey,
  conversationScrollKey,
  currentAgentSettings,
  dashboardSessionContext,
  dashboardRouteVisible,
  dashboardShellVisible,
  dismissNumberedQuestions,
  confirmSaveWork,
  editOptimisticMessage,
  emptyConversationWelcome,
  fixRepositoryActionError,
  fixRepositoryError,
  interrupting,
  loadMoreChatTurns,
  numberedQuestionSelectItems,
  numberedQuestions,
  openSourceEditorFile,
  previewAttachmentState,
  projectSlug,
  questionAnswers,
  reloadChatPane,
  repositoryRecoverySending,
  repositoryOperationActive,
  retrySaveWork,
  retryWorkspaceSetup,
  requestSaveWork,
  resendOptimisticMessage,
  requestAgentInterrupt,
  rightPaneTab,
  rightPaneTabMounted,
  saveWorkConfirmOpen,
  saveWorkActivityVisible,
  saveWorkActivityIsUpdate,
  saveWorkActivityLabel,
  saveWorkDisabled,
  saveWorkError,
  saveWorkExpanded,
  saveWorkHeaderAriaLabel,
  saveWorkHeaderLabel,
  saveWorkHeaderVisible,
  saveWorkCanResolveWithTemporaryAi,
  saveWorkOutput,
  saveWorkRetryable,
  saveWorkSending,
  saveWorkStage,
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
  structuredQuestionActive,
  submitComposerMessage,
  systemBackAvailable,
  systemRestoreRequest,
  thinkingLabel,
  thinkingVisible,
  updateComposerAttachments,
  updatePreviewAttachmentState,
  workspaceSetupAskDisabled,
  workspaceSetupCurrentLabel,
  workspaceSetupDiagnostic,
  workspaceSetupExpanded,
  workspaceSetupFixSending,
  workspaceSetupNeedsAttention,
  workspaceSetupOutput,
  workspaceSetupRetryDisabled,
  workspaceSetupRetrying,
  workspaceSetupRunning,
  workspaceSetupStatus,
  workspaceSetupTitle,
  workspaceSetupVisible
} = useVibe64AutopilotView(props, emit, {
  assistantCanRequestMessage,
  assistantCanUseAi: assistantCanUseAiState,
  assistantRestrictionMessage,
  requestTemporaryAi: startTemporaryAiTask,
  sendMainChatMessage
});
const composerSuggesting = computed(() => assistantCanRequestMessage.value && [
  "retry",
  "send",
  "sending",
  "steer",
  "steering"
].includes(composerSubmitMode.value));
const composerSubmitActionLabel = computed(() => {
  if (!composerSuggesting.value) {
    return composerSubmitMode.value === "send" ? "Send" : composerSubmitLabel.value;
  }
  return "Suggest to owner";
});
const composerSubmitActionAriaLabel = computed(() => (
  composerSuggesting.value ? "Request message from workspace owner" : composerSubmitAriaLabel.value
));
const composerSubmitActionTitle = computed(() => (
  composerSuggesting.value ? assistantRestrictionMessage.value : composerSubmitTitle.value
));
const composerAccessHint = computed(() => (
  assistantCanRequestMessage.value ? assistantRestrictionMessage.value : composerHint.value
));

const {
  blur: stopTypingOnBlur,
  noteInputActivity: noteTypingActivity,
  submit: stopTypingOnSubmit,
  typingLabel
} = useVibe64SessionTypingPresence({
  active: computed(() => props.active && !props.sessionSelectionClosed),
  projectSlug,
  sessionId,
  sessionsApiPath: computed(() => readRefOrGetterValue(props.sessionsApiPath))
});
const composerAssistantLabel = computed(() => (
  openCodeProgressLabel.value ||
  (thinkingVisible.value ? thinkingLabel.value : typingLabel.value)
));
watch(agentActive, (active) => {
  if (!active) {
    openCodeProgressLabel.value = "";
  }
}, { flush: "sync", immediate: true });
const conversationAssistantLabel = computed(() => (
  props.session?.assistantSelection?.engineId === "opencode" ? "OpenCode" : "Codex"
));

const promptHintsBlankConversation = computed(() => chatTurns.value.length < 1);
const promptHintsCanRequest = computed(() => Boolean(
  props.active &&
  !props.conversationLog?.loading &&
  !props.conversationLog?.error &&
  !props.sessionSelectionClosed &&
  sessionId.value &&
  sessionSourceRoot.value &&
  !agentActive.value &&
  !composerSending.value &&
  !interrupting.value &&
  !repositoryOperationActive.value &&
  !repositoryRecoverySending.value &&
  !saveWorkSending.value &&
  !workspaceSetupRunning.value &&
  !workspaceSetupRetrying.value &&
  !sourceOperationsSuspended.value &&
  (
    promptHintsBlankConversation.value || (
      props.agentConnectionStatus === "connected" &&
      assistantDirectAllowed.value
    )
  ) &&
  !structuredQuestionActive.value &&
  composerAttachmentState.value.count < 1 &&
  !composerAttachmentState.value.uploading &&
  !composerAttachmentState.value.hasUnresolved &&
  !previewAttachmentState.value.captureBusy &&
  !previewAttachmentState.value.diagnosticsBusy
));
const promptHintsConversationKey = computed(() => (
  promptHintConversationFingerprint(chatTurns.value)
));
const promptHintsExistingProject = computed(() => workspaceSetupStatus.value !== "unconfigured");
const {
  blurComposer: blurPromptHints,
  dismissPromptHints,
  focusComposer: focusPromptHints,
  loading: promptHintsLoading,
  preview: promptHintPreview,
  previewPromptHint,
  selectPromptHint,
  suggestions: promptHintSuggestions,
  visible: promptHintsVisible
} = useVibe64PromptHints({
  active: computed(() => props.active),
  blankConversation: promptHintsBlankConversation,
  canRequest: promptHintsCanRequest,
  conversationKey: promptHintsConversationKey,
  draft: composerDraft,
  existingProject: promptHintsExistingProject,
  onSelect: applyPromptHint,
  policy: computed(() => props.promptHintPolicy),
  sessionId,
  sessionsApiPath: computed(() => readRefOrGetterValue(props.sessionsApiPath))
});
const composerPromptHintPreview = computed(() => (
  promptHintsVisible.value &&
  !String(composerDraft.value || "").trim() &&
  promptHintPreview.value
    ? promptHintPreview.value
    : ""
));
const composerPromptHintPlaceholder = computed(() => (
  composerPromptHintPreview.value || composerPlaceholder.value
));
const composerSupportStatusVisible = computed(() => Boolean(
  composerAssistantLabel.value || promptHintsVisible.value
));

const dashboardContext = computed(() => ({
  ...(dashboardSessionContext.value || {}),
  assistantDirectAllowed: assistantDirectAllowed.value,
  assistantRestrictionMessage: assistantRestrictionMessage.value,
  requestUpdateWork: props.updateSessionWork,
  requestTemporaryAi: fixRepositoryError,
  sourceOperationsSuspended: sourceOperationsSuspended.value
}));

const sessionAbandonDisabled = computed(() => Boolean(
  props.sessionSelectionClosed ||
  props.sessionAbandon?.command?.isRunning ||
  workspaceSetupRunning.value ||
  workspaceSetupRetrying.value
));

async function sendComposerMessage() {
  if (composerInput.value?.attachmentsCanSubmit?.() === false) {
    return false;
  }
  stopTypingOnSubmit();
  const accepted = await submitComposerMessage();
  if (accepted && composerAcceptedAttachments.value) {
    composerInput.value?.clearAttachments?.();
  }
  return accepted;
}

function focusComposerSendButton() {
  const button = composerSendButton.value?.$el || composerSendButton.value;
  button?.focus?.();
}

function updateComposerAttachmentState(state = {}) {
  composerAttachmentState.value = {
    count: Number(state?.count || 0),
    hasUnresolved: state?.hasUnresolved === true,
    uploading: state?.uploading === true
  };
}

function focusTargetInside(target, selector) {
  return Boolean(target?.closest?.(selector));
}

function handleComposerBlur(event = {}) {
  stopTypingOnBlur();
  if (focusTargetInside(
    event.relatedTarget,
    "[data-vibe64-prompt-hints], .studio-autopilot__composer"
  )) {
    return;
  }
  blurPromptHints();
}

function handleComposerRegionFocusOut(event = {}) {
  if (
    event.currentTarget?.contains?.(event.relatedTarget) ||
    focusTargetInside(event.relatedTarget, "[data-vibe64-prompt-hints]")
  ) {
    return;
  }
  blurPromptHints();
}

function handlePromptHintsFocusOut(event = {}) {
  if (
    event.currentTarget?.contains?.(event.relatedTarget) ||
    focusTargetInside(event.relatedTarget, ".studio-autopilot-prompt-textarea")
  ) {
    return;
  }
  blurPromptHints();
}

function dismissPromptHintsAndFocus() {
  dismissPromptHints();
  composerInput.value?.focus?.({ preventScroll: true });
}

function applyPromptHint(text = "") {
  const suggestion = String(text || "").trim();
  if (!suggestion) {
    return false;
  }
  if (composerDraft.value !== suggestion) {
    composerInput.value?.preserveHeightForNextModelValue?.();
    composerDraft.value = suggestion;
  }
  void nextTick(() => {
    composerInput.value?.focus?.({ preventScroll: true });
  });
  return true;
}

function copyActivityOutput(output = "") {
  return writeClipboardText(output);
}

function openTemporaryAi() {
  if (!assistantDirectAllowed.value) {
    return false;
  }
  temporaryAiWorkspace.value?.showWorkspace?.();
  return true;
}

async function startTemporaryAiTask(options = {}) {
  if (!assistantDirectAllowed.value) {
    return false;
  }
  emit("chat-attention");
  const workspace = temporaryAiWorkspace.value;
  if (typeof workspace?.startTask !== "function") {
    return false;
  }
  return workspace.startTask(options);
}

function activateRealSession() {
  temporaryAiWorkspace.value?.closeWorkspace?.();
}

async function showMainChat() {
  activateRealSession();
  await nextTick();
  mainChat.value?.focus?.({ preventScroll: true });
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

async function attachPreviewFileProducer(options = {}) {
  const uploaded = await composerInput.value?.attachFileProducer?.(options);
  return Array.isArray(uploaded) && uploaded.length > 0 ? uploaded[0] : null;
}

function requestSessionRenewal(returnFocusTarget = null) {
  if (!assistantDirectAllowed.value) {
    return false;
  }
  props.sessionRenewal?.request?.({
    returnFocusTarget: returnFocusTarget?.$el || returnFocusTarget
  });
  return true;
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
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
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
  grid-row: 1;
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

.studio-autopilot__header-actions--compact {
  display: none;
}

@container studio-chat-pane (max-width: 32rem) {
  .studio-autopilot__header-actions--compact {
    display: flex;
  }

  .studio-autopilot__header-actions--expanded {
    display: none;
  }
}

.studio-autopilot__session-action-item {
  min-height: 3rem;
}

.studio-autopilot__conversation {
  grid-row: 3;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__activity {
  display: grid;
  gap: 0.3rem;
  grid-row: 2;
  max-height: min(44vh, 24rem);
  min-width: 0;
  overflow: auto;
  padding: 0.35rem 0.5rem;
}

.studio-autopilot__recovery-action {
  min-block-size: 3rem;
  min-inline-size: 11.75rem;
}

.studio-autopilot__composer {
  border-top: 1px solid rgba(var(--v-theme-outline), 0.1);
  box-sizing: border-box;
  grid-row: 5;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 4px;
  width: 100%;
}

.studio-autopilot__composer-actions {
  flex-wrap: wrap;
  width: 100%;
}

.studio-autopilot__send-action {
  min-width: 5.25rem;
  padding-inline: 0.55rem;
}

.studio-autopilot__question-fields {
  display: grid;
  gap: 0.3rem;
  padding: 0.3rem 0.45rem 0;
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
  min-width: 0;
}

.studio-autopilot__question-select {
  max-width: 100%;
  min-width: 0;
}

.studio-autopilot__answer-choices {
  padding: 0.35rem 0.55rem 0;
}

.studio-autopilot__composer-spacer {
  flex: 1 1 auto;
}

.studio-autopilot__save-work {
  flex: 0 0 auto;
  min-width: 5rem;
}

@media (max-width: 600px) {
  .studio-autopilot__save-work {
    min-width: 2.5rem;
    padding-inline: 0.5rem;
    width: 2.5rem;
  }

  .studio-autopilot__save-work-label {
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

@media (max-width: 980px) {
  .studio-autopilot:not(.studio-autopilot--chat-collapsed) {
    grid-template-columns: minmax(0, 1fr) 0;
  }

  .studio-autopilot:not(.studio-autopilot--chat-collapsed) .studio-autopilot__project-panel {
    visibility: hidden;
  }
}

@media (pointer: coarse) {
  .studio-autopilot__save-work {
    min-height: 3rem;
    min-width: 3rem;
  }

  .studio-autopilot__composer-action {
    min-height: 3rem;
    min-width: 3rem;
  }

  .studio-autopilot__composer-action.studio-autopilot__send-action {
    min-width: 5.25rem;
  }

  .studio-autopilot__recovery-action {
    min-height: 3rem;
  }
}

</style>
