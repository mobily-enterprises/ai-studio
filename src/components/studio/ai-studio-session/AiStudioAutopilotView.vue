<template>
  <section class="studio-autopilot">
    <div class="studio-autopilot__stage">
      <div
        v-show="issueDiscussion.waiting"
        class="studio-autopilot__codex-terminal-stage"
      >
        <div
          id="studio-autopilot-codex-terminal-host"
          class="studio-autopilot__codex-terminal-host"
        />
        <div class="studio-autopilot__codex-terminal-overlay">
          <strong>Prompt injected into Codex.</strong>
          <span>Asking Codex to define the issue...</span>
        </div>
      </div>

      <v-progress-circular
        v-if="!issueDiscussion.waiting && displayRunning"
        class="studio-autopilot__cog"
        color="primary"
        indeterminate
        :size="148"
        :width="8"
      >
        <v-icon :icon="mdiCog" size="64" />
      </v-progress-circular>

      <v-icon
        v-else-if="!issueDiscussion.waiting && failure"
        color="warning"
        :icon="mdiAlertCircleOutline"
        size="72"
      />

      <v-icon
        v-else-if="!issueDiscussion.waiting"
        color="primary"
        :icon="mdiCog"
        size="72"
      />

      <div class="studio-autopilot__status">
        <h2>{{ displayStatusText }}</h2>
      </div>

      <form
        v-if="readyForIssue && issueDiscussion.inputVisible"
        class="studio-autopilot__issue-form"
        @submit.prevent="issueDiscussion.submitInitialRequest"
      >
        <v-textarea
          v-model="issueDiscussion.requestText"
          auto-grow
          class="studio-autopilot__issue-input"
          :disabled="page.busy"
          :error-messages="issueDiscussion.failure ? [issueDiscussion.failure] : []"
          hint="Discuss issue and define scope"
          label="Describe what you would like to do"
          persistent-hint
          rows="5"
          variant="outlined"
        />

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!issueDiscussion.canSubmit"
            :loading="issueDiscussion.waiting"
            :prepend-icon="mdiSend"
            title="Ask Codex to define the issue."
            type="submit"
          >
            Discuss issue
          </v-btn>
        </div>
      </form>

      <form
        v-else-if="readyForIssue && issueDiscussion.questioning"
        class="studio-autopilot__issue-form"
        @submit.prevent="issueDiscussion.submitQuestionAnswers"
      >
        <div class="studio-autopilot__questions">
          <div
            v-for="question in issueDiscussion.questions"
            :key="question.id"
            class="studio-autopilot__question"
          >
            <p>{{ question.text }}</p>
            <v-textarea
              v-model="question.answer"
              auto-grow
              class="studio-autopilot__issue-input"
              :disabled="page.busy"
              label="Your answer"
              rows="2"
              variant="outlined"
            />
          </div>
        </div>

        <v-alert
          v-if="issueDiscussion.failure"
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ issueDiscussion.failure }}
        </v-alert>

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            :disabled="!issueDiscussion.canSubmitAnswers"
            :loading="issueDiscussion.waiting"
            :prepend-icon="mdiSend"
            type="submit"
            variant="flat"
          >
            Continue
          </v-btn>

          <v-btn
            :disabled="issueDiscussion.waiting"
            :prepend-icon="mdiClose"
            type="button"
            variant="tonal"
            @click="issueDiscussion.cancelQuestions"
          >
            Cancel
          </v-btn>
        </div>
      </form>

      <form
        v-else-if="readyForIssue && issueDiscussion.reviewing"
        class="studio-autopilot__issue-form"
        @submit.prevent="issueDiscussion.acceptIssueDraft"
      >
        <v-text-field
          v-model="issueDiscussion.draftTitle"
          class="studio-autopilot__issue-input"
          :disabled="issueDiscussion.saving"
          label="Issue title"
          variant="outlined"
        />

        <v-textarea
          v-model="issueDiscussion.draftBody"
          auto-grow
          class="studio-autopilot__issue-input"
          :disabled="issueDiscussion.saving"
          label="Issue body"
          rows="8"
          variant="outlined"
        />

        <v-alert
          v-if="issueDiscussion.failure"
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ issueDiscussion.failure }}
        </v-alert>

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            :disabled="!issueDiscussion.canAccept"
            :loading="issueDiscussion.saving"
            :prepend-icon="mdiCheck"
            type="submit"
            variant="flat"
          >
            Accept it
          </v-btn>

          <v-btn
            :disabled="issueDiscussion.saving"
            :prepend-icon="mdiRefresh"
            type="button"
            variant="tonal"
            @click="issueDiscussion.rejectIssueDraft"
          >
            Back to the drawing board
          </v-btn>
        </div>
      </form>

      <v-alert
        v-else-if="readyForIssue && issueDiscussion.failure"
        class="studio-autopilot__issue-form"
        type="warning"
        variant="tonal"
        density="compact"
      >
        {{ issueDiscussion.failure }}
      </v-alert>

      <div v-else-if="failure" class="studio-autopilot__failure">
        <v-alert
          type="warning"
          variant="tonal"
          density="compact"
        >
          {{ failure.error }}
        </v-alert>

        <pre v-if="failure.output" class="studio-autopilot__output">{{ failure.output }}</pre>

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            :loading="running"
            :prepend-icon="mdiRefresh"
            variant="flat"
            @click="retry"
          >
            Retry
          </v-btn>
        </div>
      </div>

      <div v-else class="studio-autopilot__actions">
        <v-btn
          v-if="!running && !readyForIssue"
          class="studio-autopilot__start-button"
          color="primary"
          :disabled="!canStart"
          :prepend-icon="mdiPlay"
          variant="flat"
          @click="start"
        >
          Let's start
        </v-btn>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, proxyRefs, watch } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheck,
  mdiClose,
  mdiCog,
  mdiPlay,
  mdiRefresh,
  mdiSend
} from "@mdi/js";
import {
  useAiStudioAutopilotController
} from "@/composables/useAiStudioAutopilotController.js";
import {
  useAiStudioAutopilotIssueDiscussion
} from "@/composables/useAiStudioAutopilotIssueDiscussion.js";

const emit = defineEmits(["busy-change", "codex-waiting-change"]);

const props = defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  codexTerminal: {
    default: () => ({}),
    type: Object
  },
  page: {
    default: () => ({}),
    type: Object
  },
  refreshSessionData: {
    default: async () => null,
    type: Function
  },
  session: {
    default: null,
    type: Object
  }
});

const {
  canStart,
  failure,
  readyForIssue,
  retry,
  running,
  start,
  statusText
} = useAiStudioAutopilotController({
  actions: props.actions,
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
});

const issueDiscussion = proxyRefs(useAiStudioAutopilotIssueDiscussion({
  actions: props.actions,
  codexTerminal: props.codexTerminal,
  readyForIssue,
  refreshSessionData: () => props.refreshSessionData(),
  session: computed(() => props.session)
}));
const displayStatusText = computed(() => readyForIssue.value
  ? issueDiscussion.statusText
  : statusText.value);
const displayRunning = computed(() => Boolean(
  running.value ||
  issueDiscussion.saving
));
const autopilotBusy = computed(() => Boolean(
  running.value ||
  issueDiscussion.waiting ||
  issueDiscussion.saving
));

function emitCodexWaitingState() {
  emit("codex-waiting-change", Boolean(issueDiscussion.waiting));
}

function emitBusyState() {
  emit("busy-change", autopilotBusy.value);
}

function emitAutopilotState() {
  emitCodexWaitingState();
  emitBusyState();
}

onMounted(emitAutopilotState);

watch(() => issueDiscussion.waiting, () => {
  emitCodexWaitingState();
}, {
  flush: "post"
});

watch(autopilotBusy, () => {
  emitBusyState();
}, {
  flush: "post"
});
</script>

<style scoped>
.studio-autopilot {
  align-items: stretch;
  display: grid;
  gap: 1rem;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__stage {
  align-items: center;
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
  border-radius: 8px;
  display: grid;
  gap: 1rem;
  justify-items: center;
  min-height: 22rem;
  padding: 1.25rem;
  text-align: center;
}

.studio-autopilot__cog :deep(.v-icon) {
  animation: studio-autopilot-cog-spin 1.7s linear infinite;
}

.studio-autopilot__status {
  display: grid;
  gap: 0.25rem;
}

.studio-autopilot__status h2 {
  font-size: 1.2rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.15;
  margin: 0;
}

.studio-autopilot__status p {
  color: rgb(var(--v-theme-on-surface-variant));
  margin: 0;
}

.studio-autopilot__codex-terminal-stage {
  display: grid;
  justify-self: center;
  max-width: min(64rem, 100%);
  min-height: 30rem;
  place-items: stretch;
  position: relative;
  text-align: left;
  width: 100%;
}

.studio-autopilot__codex-terminal-host {
  display: grid;
  min-height: 0;
  text-align: left;
}

.studio-autopilot__codex-terminal-host :deep(.studio-ai-sessions__terminals) {
  opacity: 0.3;
  text-align: left;
  transform: scale(0.5);
  transform-origin: center center;
}

.studio-autopilot__codex-terminal-host :deep(.codex-terminal),
.studio-autopilot__codex-terminal-host :deep(.codex-terminal__stage),
.studio-autopilot__codex-terminal-host :deep(.codex-terminal__host),
.studio-autopilot__codex-terminal-host :deep(.xterm) {
  text-align: left;
}

.studio-autopilot__codex-terminal-overlay {
  align-items: center;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(20, 30, 46, 0.16);
  border-radius: 8px;
  box-shadow: 0 1rem 2.5rem rgba(13, 24, 42, 0.18);
  color: #182235;
  display: flex;
  flex-direction: column;
  font-size: 1rem;
  gap: 0.35rem;
  justify-content: center;
  left: 50%;
  line-height: 1.35;
  max-width: min(26rem, calc(100% - 2rem));
  padding: 1rem 1.25rem;
  pointer-events: none;
  position: absolute;
  text-align: center;
  top: 50%;
  transform: translate(-50%, -50%);
  width: max-content;
}

.studio-autopilot__codex-terminal-overlay strong {
  font-size: 1.1rem;
}

.studio-autopilot__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: center;
}

.studio-autopilot__start-button {
  font-size: 1.65rem;
  font-weight: 760;
  min-height: 5.75rem;
  min-width: min(30rem, 100%);
  padding-inline: 3.5rem;
}

.studio-autopilot__issue-form,
.studio-autopilot__failure {
  display: grid;
  gap: 0.75rem;
  max-width: 44rem;
  width: 100%;
}

.studio-autopilot__issue-input {
  text-align: left;
}

.studio-autopilot__questions {
  display: grid;
  gap: 0.9rem;
}

.studio-autopilot__question {
  display: grid;
  gap: 0.45rem;
  text-align: left;
}

.studio-autopilot__question p {
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.35;
  margin: 0;
}

.studio-autopilot__output {
  background: #101216;
  border-radius: 8px;
  color: #f5f7fb;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.82rem;
  line-height: 1.45;
  margin: 0;
  max-height: 18rem;
  overflow: auto;
  padding: 0.85rem;
  text-align: left;
  white-space: pre-wrap;
}

@keyframes studio-autopilot-cog-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (min-width: 981px) {
  .studio-autopilot {
    align-content: start;
    overflow-y: auto;
    padding-right: 0.25rem;
    scrollbar-gutter: stable;
  }
}
</style>
