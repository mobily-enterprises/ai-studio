<template>
  <section class="studio-autopilot">
    <div class="studio-autopilot__stage">
      <v-progress-circular
        v-if="running"
        class="studio-autopilot__cog"
        color="primary"
        indeterminate
        :size="148"
        :width="8"
      >
        <v-icon :icon="mdiCog" size="64" />
      </v-progress-circular>

      <v-icon
        v-else-if="failure"
        color="warning"
        :icon="mdiAlertCircleOutline"
        size="72"
      />

      <v-icon
        v-else
        color="primary"
        :icon="mdiCog"
        size="72"
      />

      <div class="studio-autopilot__status">
        <h2>{{ statusText }}</h2>
      </div>

      <form
        v-if="readyForIssue && issueRequest.formVisible"
        class="studio-autopilot__issue-form"
        @submit.prevent="issueRequest.sendPrompt"
      >
        <v-textarea
          :model-value="issueRequest.text"
          auto-grow
          class="studio-autopilot__issue-input"
          :disabled="page.busy"
          :error-messages="issueRequest.error ? [issueRequest.error] : []"
          hint="Discuss issue and define scope"
          label="Describe what you would like to do"
          persistent-hint
          rows="5"
          variant="outlined"
          @update:model-value="emit('update-issue-request-text', $event)"
        />

        <div class="studio-autopilot__actions">
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!issueRequest.canSubmit"
            :loading="issueRequest.submitting"
            :prepend-icon="mdiSend"
            :title="issueRequest.submitTitle"
            type="submit"
          >
            Discuss issue
          </v-btn>
        </div>
      </form>

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
import { computed } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCog,
  mdiPlay,
  mdiRefresh,
  mdiSend
} from "@mdi/js";
import {
  useAiStudioAutopilotController
} from "@/composables/useAiStudioAutopilotController.js";

const props = defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  issueRequest: {
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
const emit = defineEmits(["update-issue-request-text"]);

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
