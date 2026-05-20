<template>
  <v-sheet rounded="lg" class="studio-ai-sessions studio-screen__panel">
    <div class="studio-ai-sessions__header">
      <StudioErrorNotice
        v-if="page.error"
        title="AI Studio sessions could not load"
        :error="page.error"
        compact
      />

      <AiStudioSessionToolbar
        :abandon="dialogs.abandon"
        :busy="interactionBusy"
        :selected-session-id="selection.selectedSessionId"
        :selection-closed="selection.isClosed"
        :toolbar="toolbar"
      />
    </div>

    <Teleport
      defer
      to="#studio-home-app-bar-actions"
    >
      <div
        v-if="selection.selectedSession"
        class="studio-ai-sessions__app-bar-actions"
      >
        <v-btn
          class="studio-ai-sessions__inspect-button"
          :prepend-icon="inspectButtonIcon"
          size="small"
          variant="tonal"
          @click="toggleInspectMode"
        >
          {{ inspectButtonLabel }}
        </v-btn>

        <template v-if="sessionMode === 'inspect'">
          <AiStudioLaunchControls
            :busy="interactionBusy"
            :session="selection.selectedSession"
          />
          <AiStudioShellControls
            :busy="interactionBusy"
            :session="selection.selectedSession"
          />
        </template>
      </div>
    </Teleport>

    <v-progress-linear
      v-if="page.loading && !selection.selectedSession"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <v-sheet
      v-else-if="!selection.selectedSession"
      rounded="lg"
      border
      class="studio-ai-sessions__empty"
    >
      <p class="text-body-2 text-medium-emphasis mb-0">No sessions yet.</p>
    </v-sheet>

    <div
      v-else
      class="studio-ai-sessions__layout"
      :class="`studio-ai-sessions__layout--${sessionMode}`"
    >
      <AiStudioAutopilotView
        v-show="sessionMode === 'autopilot'"
        :actions="actions"
        :codex-terminal="codexTerminal"
        :page="guardedPage"
        :refresh-session-data="sessionData.refreshSessionData"
        :session="selection.selectedSession"
        @busy-change="setAutopilotBusy"
        @codex-waiting-change="setAutopilotCodexWaiting"
      />

      <AiStudioSessionWorkspace
        v-show="sessionMode === 'inspect'"
        :actions="actions"
        :dialogs="dialogs"
        :issue-request="issueRequest"
        :page="guardedPage"
        :review="review"
        :selection="selection"
        :timeline="timeline"
        @update-issue-request-text="issueRequest.text = $event"
      />

      <Teleport
        defer
        to="#studio-autopilot-codex-terminal-host"
        :disabled="!autopilotCodexTerminalDocked"
      >
        <AiStudioSessionTerminals
          :codex-terminal="codexTerminal"
          :command-terminal="commandTerminal"
          :display-mode="codexTerminalDisplayMode"
          :session="selection.selectedSession"
        />
      </Teleport>
    </div>

    <AiStudioSessionDialogs
      :dialogs="dialogs"
      :short-session-id="toolbar.shortSessionId"
      @update-draft-open="dialogs.draftEditor.open = $event"
      @update-draft-values="dialogs.draftEditor.values = $event"
      @update-input-values="dialogs.input.values = $event"
    />
  </v-sheet>
</template>

<script setup>
import { computed, proxyRefs, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  mdiClose,
  mdiTune
} from "@mdi/js";
import AiStudioLaunchControls from "@/components/studio/AiStudioLaunchControls.vue";
import AiStudioAutopilotView from "@/components/studio/ai-studio-session/AiStudioAutopilotView.vue";
import AiStudioSessionDialogs from "@/components/studio/ai-studio-session/AiStudioSessionDialogs.vue";
import AiStudioSessionTerminals from "@/components/studio/ai-studio-session/AiStudioSessionTerminals.vue";
import AiStudioSessionToolbar from "@/components/studio/ai-studio-session/AiStudioSessionToolbar.vue";
import AiStudioSessionWorkspace from "@/components/studio/ai-studio-session/AiStudioSessionWorkspace.vue";
import AiStudioShellControls from "@/components/studio/AiStudioShellControls.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  useAiStudioSessionData
} from "@/composables/useAiStudioSessionData.js";
import {
  useAiStudioSessionWorkflow
} from "@/composables/useAiStudioSessionWorkflow.js";

const emit = defineEmits(["title-change"]);
const route = useRoute();
const router = useRouter();

const sessionData = useAiStudioSessionData({
  onTitleChange(title) {
    emit("title-change", title);
  }
});
const sessionWorkflow = useAiStudioSessionWorkflow({
  sessionData
});

const actions = proxyRefs(sessionWorkflow.actions);
const codexTerminal = proxyRefs(sessionWorkflow.codexTerminal);
const commandTerminal = proxyRefs(sessionWorkflow.commandTerminal);
const dialogs = {
  abandon: proxyRefs(sessionWorkflow.dialogs.abandon),
  diff: proxyRefs(sessionWorkflow.dialogs.diff),
  draftEditor: proxyRefs(sessionWorkflow.dialogs.draftEditor),
  input: proxyRefs(sessionWorkflow.dialogs.input)
};
const issueRequest = proxyRefs(sessionWorkflow.issueRequest);
const page = proxyRefs(sessionWorkflow.page);
const review = proxyRefs(sessionWorkflow.review);
const selection = proxyRefs({
  facts: sessionData.sessionFacts,
  isClosed: sessionData.isSelectedSessionClosed,
  selectedSession: sessionData.selectedSession,
  selectedSessionId: sessionData.selectedSessionId,
  selectedSessionTitle: sessionData.selectedSessionTitle,
  statusColor: sessionData.statusColor,
  statusLabel: sessionData.statusLabel
});
const timeline = proxyRefs({
  rewindCommand: sessionWorkflow.timeline.rewindCommand,
  rewindToStep: sessionWorkflow.timeline.rewindToStep,
  steps: sessionData.timelineSteps
});
const toolbar = proxyRefs({
  canCreateSession: sessionData.canCreateSession,
  createSessionCommand: sessionData.createSessionCommand,
  createSessionTitle: sessionData.createSessionTitle,
  selectSession: sessionWorkflow.selectSession,
  sessions: sessionData.sessions,
  shortSessionId: sessionData.shortSessionId
});

const sessionMode = computed(() => route.query.mode === "inspect" ? "inspect" : "autopilot");
const inspectButtonIcon = computed(() => sessionMode.value === "inspect" ? mdiClose : mdiTune);
const inspectButtonLabel = computed(() => sessionMode.value === "inspect" ? "Quit inspect" : "Inspect");
const autopilotBusy = ref(false);
const autopilotCodexWaiting = ref(false);
const autopilotCodexTerminalDocked = computed(() => sessionMode.value === "autopilot" && autopilotCodexWaiting.value);
const codexTerminalDisplayMode = computed(() => {
  if (sessionMode.value === "inspect") {
    return "full";
  }
  return autopilotCodexTerminalDocked.value ? "compact" : "headless";
});
const interactionBusy = computed(() => Boolean(page.busy || autopilotBusy.value));
const guardedPage = computed(() => ({
  busy: interactionBusy.value,
  copyStatus: page.copyStatus,
  copyText: page.copyText,
  error: page.error,
  loading: page.loading
}));

function setAutopilotBusy(busy) {
  autopilotBusy.value = Boolean(busy);
}

function setAutopilotCodexWaiting(waiting) {
  autopilotCodexWaiting.value = Boolean(waiting);
}

function setSessionMode(mode = "autopilot") {
  const query = {
    ...route.query
  };
  if (mode === "inspect") {
    query.mode = "inspect";
  } else {
    delete query.mode;
  }
  void router.replace({
    query
  });
}

function toggleInspectMode() {
  setSessionMode(sessionMode.value === "inspect" ? "autopilot" : "inspect");
}

watch(() => selection.selectedSessionId, () => {
  autopilotBusy.value = false;
  autopilotCodexWaiting.value = false;
});
</script>

<style scoped>
.studio-ai-sessions {
  display: grid;
  gap: 0.85rem;
  min-height: 0;
}

.studio-ai-sessions__empty {
  padding: 0.9rem;
}

.studio-ai-sessions__header {
  display: grid;
  gap: 0.65rem;
}

.studio-ai-sessions__layout {
  align-items: flex-start;
  display: grid;
  gap: 0.9rem;
  min-height: 0;
}

.studio-ai-sessions__layout--autopilot {
  grid-template-columns: minmax(0, 1fr);
}

.studio-ai-sessions__layout--inspect {
  grid-template-columns: minmax(18rem, 0.7fr) minmax(30rem, 1.3fr);
}

@media (max-width: 980px) {
  .studio-ai-sessions__layout {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 981px) {
  .studio-ai-sessions {
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
    overflow: hidden;
  }

  .studio-ai-sessions__layout {
    align-items: stretch;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
}

.studio-ai-sessions__app-bar-actions {
  align-items: center;
  display: flex;
  gap: 0.35rem;
  justify-content: flex-end;
  min-width: 0;
}

.studio-ai-sessions__inspect-button {
  flex: 0 0 auto;
}

@media (max-width: 600px) {
  .studio-ai-sessions__app-bar-actions {
    gap: 0.25rem;
  }

  .studio-ai-sessions__inspect-button {
    min-width: 0;
    padding-inline: 0.55rem;
  }
}
</style>
