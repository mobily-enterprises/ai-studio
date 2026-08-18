<template>
  <section
    v-if="temporary.open.value"
    class="vibe64-temporary-ai"
    aria-label="Temporary AI workspace"
  >
    <header class="vibe64-temporary-ai__header">
      <div class="vibe64-temporary-ai__identity">
        <v-icon :icon="mdiRobotOutline" size="20" />
        <div>
          <strong>Temporary AI</strong>
          <span>Not saved to session history</span>
        </div>
      </div>
      <div class="vibe64-temporary-ai__header-actions">
        <v-btn
          :prepend-icon="mdiPlus"
          size="small"
          type="button"
          variant="text"
          @click="temporary.openTask()"
        >
          New
        </v-btn>
        <v-btn
          aria-label="Hide temporary AI"
          :icon="mdiClose"
          size="small"
          title="Hide temporary AI"
          type="button"
          variant="text"
          @click="temporary.closeWorkspace"
        />
      </div>
    </header>

    <nav class="vibe64-temporary-ai__tabs" aria-label="Temporary AI tasks">
      <div
        v-for="task in temporary.tasks.value"
        :key="task.id"
        class="vibe64-temporary-ai__tab"
        :class="{ 'vibe64-temporary-ai__tab--active': task.id === temporary.activeTaskId.value }"
      >
        <button
          class="vibe64-temporary-ai__tab-select"
          type="button"
          @click="temporary.selectTask(task.id)"
        >
          <span>{{ task.title }}</span>
          <span v-if="task.busy" class="vibe64-temporary-ai__busy" aria-label="Assistant working" />
        </button>
        <v-btn
          :aria-label="`Close ${task.title}`"
          height="48"
          :icon="mdiClose"
          min-width="48"
          size="x-small"
          :title="`Close ${task.title}`"
          type="button"
          variant="text"
          @click="temporary.closeTask(task.id)"
        />
      </div>
    </nav>

    <template v-if="activeTask">
      <div class="vibe64-temporary-ai__mode">
        <v-chip
          :color="activeTask.policy === workspaceWritePolicy ? 'warning' : undefined"
          size="small"
          variant="tonal"
        >
          {{ activeTask.policy === workspaceWritePolicy ? "May edit this session" : "Read-only guidance" }}
        </v-chip>
        <v-btn
          :disabled="activeTask.busy"
          size="x-small"
          type="button"
          variant="text"
          @click="togglePolicy(activeTask)"
        >
          {{ activeTask.policy === workspaceWritePolicy ? "Make read-only" : "Allow edits" }}
        </v-btn>
      </div>

      <div class="vibe64-temporary-ai__messages" aria-live="polite">
        <div
          v-if="activeTask.messages.length === 0"
          class="vibe64-temporary-ai__empty"
        >
          Ask a focused question or investigate a problem without adding it to the main conversation.
        </div>
        <article
          v-for="message in activeTask.messages"
          :key="message.id"
          class="vibe64-temporary-ai__message"
          :class="`vibe64-temporary-ai__message--${message.role}`"
        >
          <strong>{{ message.role === "user" ? "You" : "Temporary AI" }}</strong>
          <p v-if="message.text">{{ message.text }}</p>
          <span v-else-if="message.status === 'inProgress'">Working…</span>
        </article>
      </div>

      <div v-if="activeTask.error" class="vibe64-temporary-ai__error" role="alert">
        {{ activeTask.error }}
      </div>

      <Vibe64AutopilotPromptTextarea
        :key="activeTask.id"
        ref="prompt"
        :model-value="activeTask.draft"
        aria-label="Message temporary AI"
        :attachments-enabled="Boolean(props.sessionId)"
        :disabled="activeTask.busy"
        placeholder="Ask temporary AI…"
        :rows="2"
        :session-id="props.sessionId"
        tab-to-submit
        @attachments-change="temporary.updateAttachments(activeTask.id, $event)"
        @submit="sendActiveTask"
        @tab-to-submit="focusSendButton"
        @update:model-value="temporary.updateDraft(activeTask.id, $event)"
      >
        <template #footer>
          <div class="vibe64-temporary-ai__composer-actions">
            <Vibe64AgentSettingsMenu
              :agent-settings="activeTask.agentSettings"
              :disabled="activeTask.busy"
              @update-setting="updateActiveAgentSetting"
            />
            <v-btn
              aria-label="Attach files"
              :disabled="activeTask.busy"
              :icon="mdiPaperclip"
              size="small"
              title="Attach files"
              type="button"
              variant="text"
              @click="prompt?.openFilePicker?.()"
            />
            <span class="vibe64-temporary-ai__spacer" />
            <v-btn
              v-if="activeTask.busy"
              color="error"
              :prepend-icon="mdiStopCircleOutline"
              size="small"
              type="button"
              variant="tonal"
              @click="temporary.stopTask(activeTask.id)"
            >
              Stop
            </v-btn>
            <v-btn
              v-else
              ref="sendButton"
              aria-label="Send to temporary AI"
              color="primary"
              :disabled="!activeTask.draft.trim()"
              :icon="mdiArrowUp"
              size="small"
              title="Send to temporary AI"
              type="button"
              variant="flat"
              @click="sendActiveTask"
            />
          </div>
        </template>
      </Vibe64AutopilotPromptTextarea>
    </template>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";
import {
  mdiArrowUp,
  mdiClose,
  mdiPaperclip,
  mdiPlus,
  mdiRobotOutline,
  mdiStopCircleOutline
} from "@mdi/js";

import Vibe64AgentSettingsMenu from "@/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import {
  TEMPORARY_AI_WORKSPACE_WRITE_POLICY,
  useVibe64TemporaryAi
} from "@/composables/useVibe64TemporaryAi.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const props = defineProps({
  agentSettings: {
    default: () => ({}),
    type: Object
  },
  sessionId: {
    default: "",
    type: String
  },
  sessionsApiPath: {
    default: "",
    type: [String, Object, Function]
  }
});

const prompt = ref(null);
const sendButton = ref(null);
const resolvedSessionsApiPath = computed(() => readRefOrGetterValue(props.sessionsApiPath));
const temporary = useVibe64TemporaryAi({
  agentSettings: computed(() => props.agentSettings),
  sessionId: computed(() => props.sessionId),
  sessionsApiPath: resolvedSessionsApiPath
});
const activeTask = temporary.activeTask;
const workspaceWritePolicy = TEMPORARY_AI_WORKSPACE_WRITE_POLICY;

async function sendActiveTask() {
  const taskId = activeTask.value?.id;
  if (!taskId) {
    return;
  }
  const sent = await temporary.send(taskId);
  if (sent) {
    prompt.value?.clearAttachments?.();
  }
}

function focusSendButton() {
  const button = sendButton.value?.$el || sendButton.value;
  button?.focus?.();
}

function togglePolicy(task = {}) {
  const policy = task.policy === workspaceWritePolicy ? "read" : workspaceWritePolicy;
  temporary.updatePolicy(task.id, policy);
}

function updateActiveAgentSetting(parameterId = "", value = "") {
  if (activeTask.value?.id) {
    temporary.updateAgentSetting(activeTask.value.id, parameterId, value);
  }
}

defineExpose({
  openTask: temporary.openTask
});
</script>

<style scoped>
.vibe64-temporary-ai {
  background: rgb(var(--v-theme-surface));
  border: 2px solid rgba(var(--v-theme-tertiary), 0.42);
  border-radius: 12px;
  bottom: 0.3rem;
  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.22);
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto auto;
  left: 0.3rem;
  min-height: 0;
  overflow: hidden;
  position: absolute;
  right: 0.3rem;
  top: 3.3rem;
  z-index: 12;
}

.vibe64-temporary-ai__header,
.vibe64-temporary-ai__identity,
.vibe64-temporary-ai__header-actions,
.vibe64-temporary-ai__composer-actions,
.vibe64-temporary-ai__mode {
  align-items: center;
  display: flex;
}

.vibe64-temporary-ai__header {
  background: rgba(var(--v-theme-tertiary), 0.09);
  border-bottom: 1px solid rgba(var(--v-theme-tertiary), 0.2);
  justify-content: space-between;
  padding: 0.45rem 0.55rem;
}

.vibe64-temporary-ai__identity {
  gap: 0.45rem;
}

.vibe64-temporary-ai__identity div {
  display: grid;
}

.vibe64-temporary-ai__identity span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
}

.vibe64-temporary-ai__tabs {
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  padding: 0.35rem 0.45rem 0;
}

.vibe64-temporary-ai__tab {
  align-items: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border: 1px solid transparent;
  border-radius: 8px 8px 0 0;
  color: inherit;
  display: inline-flex;
  flex: 0 0 auto;
  min-height: 3rem;
  padding-left: 0.25rem;
}

.vibe64-temporary-ai__tab-select {
  align-items: center;
  align-self: stretch;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  gap: 0.35rem;
  padding: 0.35rem 0.45rem;
}

.vibe64-temporary-ai__tab--active {
  background: rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-theme-tertiary), 0.35);
  font-weight: 650;
}

.vibe64-temporary-ai__busy {
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  height: 0.45rem;
  width: 0.45rem;
}

.vibe64-temporary-ai__mode {
  gap: 0.25rem;
  padding: 0.35rem 0.55rem;
}

.vibe64-temporary-ai__messages {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-height: 0;
  overflow-y: auto;
  padding: 0.55rem;
}

.vibe64-temporary-ai__empty {
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin: auto;
  max-width: 26rem;
  text-align: center;
}

.vibe64-temporary-ai__message {
  border-radius: 10px;
  display: grid;
  gap: 0.2rem;
  max-width: 92%;
  padding: 0.55rem 0.65rem;
}

.vibe64-temporary-ai__message--user {
  align-self: end;
  background: rgba(var(--v-theme-primary), 0.11);
}

.vibe64-temporary-ai__message--assistant {
  align-self: start;
  background: rgba(var(--v-theme-tertiary), 0.09);
}

.vibe64-temporary-ai__message p {
  margin: 0;
  white-space: pre-wrap;
}

.vibe64-temporary-ai__message span,
.vibe64-temporary-ai__error {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.82rem;
}

.vibe64-temporary-ai__error {
  color: rgb(var(--v-theme-error));
  padding: 0.3rem 0.55rem;
}

.vibe64-temporary-ai :deep(.studio-autopilot-prompt-textarea) {
  margin: 4px;
}

.vibe64-temporary-ai__composer-actions {
  gap: 0.2rem;
  width: 100%;
}

.vibe64-temporary-ai__spacer {
  flex: 1 1 auto;
}

@media (max-width: 720px) {
  .vibe64-temporary-ai {
    border: 0;
    border-radius: 0;
    inset: 0;
    z-index: 30;
  }
}
</style>
