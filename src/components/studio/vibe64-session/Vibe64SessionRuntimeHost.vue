<template>
  <section
    class="studio-ai-session-runtime"
    :data-vibe64-session-runtime-id="props.sessionId"
  >
    <Vibe64AutopilotView
      :active="autopilotModeActive"
      :agent-connection-status="agentConnectionStatus"
      :chat-collapsed="props.chatCollapsed"
      :cancel-agent-message="cancelAgentMessage"
      :conversation-log="conversationLog"
      :github-actor-teleport-target="props.githubActorTeleportTarget"
      :interrupt-agent-turn="interruptAgentTurn"
      :page="guardedPage"
      :project-context="props.projectContext"
      :preview-toolbar-teleport-target="props.previewToolbarTeleportTarget"
      :refresh-session-data="refreshSessionData"
      :refresh-session-work="refreshWorkState"
      :retry-workspace-setup="retryWorkspaceSetup"
      :save-session-work="saveSessionWork"
      :session-abandon="dialogs.abandon"
      :session="selection.selectedSession"
      :sessions-api-path="sessionData.sessionsApiPath"
      :session-selection-closed="selection.isClosed"
      :session-toolbar="autopilotSessionToolbar"
      :send-agent-message="sendAgentMessage"
      :update-session-work="updateSessionWork"
      :work-state="workState"
      :project-pane="props.projectPane"
      @busy-change="setAutopilotBusy"
      @chat-attention="emitChatAttention"
      @project-attention="emitProjectAttention"
    >
      <template #ai-terminal="{ active: tabActive }">
        <Vibe64CodexSession
          class="studio-ai-sessions__tab-terminal"
          :allow-start="tabActive && codexTerminalCanStart"
          :display-mode="tabActive ? 'full' : 'headless'"
          :listen-when-hidden="!tabActive && Boolean(selectedAgentTerminalId)"
          :read-only="!tabActive"
          scope="session"
          :session="selection.selectedSession"
          :terminal="null"
          :visible="tabActive"
          @session-update="agentTerminal.sessionUpdate"
        />
      </template>

      <template #dashboard="dashboardSlotProps">
        <slot
          name="dashboard"
          :dashboard-context="dashboardSlotProps?.dashboardContext || {}"
        />
      </template>
    </Vibe64AutopilotView>

    <Vibe64SessionDialogs :dialogs="dialogs" :short-session-id="sessionData.shortSessionId" />
  </section>
</template>

<script setup>
import Vibe64AutopilotView from "@/components/studio/vibe64-session/Vibe64AutopilotView.vue";
import Vibe64CodexSession from "@/components/studio/Vibe64CodexSession.vue";
import Vibe64SessionDialogs from "@/components/studio/vibe64-session/Vibe64SessionDialogs.vue";
import {
  useVibe64SessionRuntimeHost
} from "@/composables/useVibe64SessionRuntimeHost.js";

const props = defineProps({
  active: {
    default: false,
    type: Boolean
  },
  chatCollapsed: {
    default: false,
    type: Boolean
  },
  githubActorTeleportTarget: {
    default: "",
    type: String
  },
  sessionData: {
    required: true,
    type: Object
  },
  sessionId: {
    required: true,
    type: String
  },
  toolbarSessions: {
    default: () => [],
    type: Array
  },
  projectPane: {
    default: "preview",
    type: String
  },
  previewToolbarTeleportTarget: {
    default: "",
    type: String
  },
  projectContext: {
    default: () => ({}),
    type: Object
  }
});

const emit = defineEmits([
  "busy-change",
  "chat-attention",
  "page-error-change",
  "work-state-change",
  "toolbar-controls-ready",
  "project-attention"
]);

const {
  agentConnectionStatus,
  autopilotModeActive,
  autopilotSessionToolbar,
  agentTerminal,
  cancelAgentMessage,
  codexTerminalCanStart,
  conversationLog,
  dialogs,
  emitChatAttention,
  emitProjectAttention,
  guardedPage,
  interruptAgentTurn,
  refreshSessionData,
  refreshWorkState,
  retryWorkspaceSetup,
  saveSessionWork,
  selectedAgentTerminalId,
  selection,
  setAutopilotBusy,
  sendAgentMessage,
  updateSessionWork,
  workState
} = useVibe64SessionRuntimeHost(props, emit);
</script>

<style scoped>
.studio-ai-session-runtime {
  display: grid;
  height: 100%;
  max-width: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-ai-sessions__tab-terminal {
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.studio-ai-sessions__tab-terminal :deep(.studio-ai-sessions__codex-terminal-shell),
.studio-ai-sessions__tab-terminal :deep(.studio-ai-sessions__codex-terminal) {
  height: 100%;
}
</style>
