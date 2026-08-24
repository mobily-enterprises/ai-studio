<template>
  <section
    v-if="temporary.open.value"
    ref="workspace"
    class="vibe64-temporary-ai"
    aria-label="Temporary AI workspace"
    tabindex="-1"
  >
    <nav
      class="vibe64-temporary-ai__tabs"
      aria-label="Main and temporary conversations"
    >
      <div class="vibe64-temporary-ai__tab vibe64-temporary-ai__tab--main">
        <button
          class="vibe64-temporary-ai__tab-select"
          data-temporary-ai-main-chat
          type="button"
          @click="emit('select-main-chat')"
        >
          Main chat
        </button>
      </div>
      <div
        v-for="task in temporary.tasks.value"
        :key="task.id"
        class="vibe64-temporary-ai__tab"
        :class="{ 'vibe64-temporary-ai__tab--active': task.id === temporary.activeTaskId.value }"
      >
        <button
          :ref="(element) => setTaskTabButton(task.id, element)"
          :aria-current="task.id === temporary.activeTaskId.value ? 'page' : undefined"
          class="vibe64-temporary-ai__tab-select"
          :data-temporary-ai-task-id="task.id"
          type="button"
          @click="temporary.selectTask(task.id)"
        >
          <span>{{ task.title }}</span>
          <span v-if="task.busy" class="vibe64-temporary-ai__busy" aria-label="Assistant working" />
        </button>
        <v-btn
          :aria-label="`Close ${task.title}`"
          class="vibe64-temporary-ai__tab-close"
          height="32"
          :icon="mdiClose"
          min-width="32"
          size="x-small"
          :title="`Close ${task.title}`"
          type="button"
          variant="text"
          @click="temporary.closeTask(task.id)"
        />
      </div>
      <v-btn
        aria-label="New temporary AI task"
        class="vibe64-temporary-ai__new-task"
        height="32"
        :icon="mdiPlus"
        min-width="32"
        size="x-small"
        title="New temporary AI task"
        type="button"
        variant="text"
        @click="temporary.openTask()"
      />
      <span class="vibe64-temporary-ai__tabs-spacer" />
      <v-btn
        v-if="activeTask"
        :aria-label="activeTask.policy === workspaceWritePolicy
          ? 'Read/write: temporary AI may edit this session'
          : 'Read-only: temporary AI cannot edit this session'"
        class="vibe64-temporary-ai__policy"
        :color="activeTask.policy === workspaceWritePolicy ? 'warning' : undefined"
        :disabled="activeTask.busy"
        height="28"
        min-width="40"
        size="x-small"
        :title="activeTask.policy === workspaceWritePolicy
          ? 'R/W: temporary AI may edit this session. Click to make it read-only.'
          : 'R/O: temporary AI cannot edit this session. Click to allow edits.'"
        type="button"
        variant="tonal"
        @click="togglePolicy(activeTask)"
      >
        {{ activeTask.policy === workspaceWritePolicy ? "R/W" : "R/O" }}
      </v-btn>
    </nav>

    <template v-if="activeTask">
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
          <div
            v-if="message.role === 'assistant' && message.progressUpdates?.length"
            class="vibe64-temporary-ai__progress"
            aria-label="Temporary AI progress"
          >
            <span
              v-for="update in message.progressUpdates"
              :key="update.id"
              class="vibe64-temporary-ai__progress-update"
            >
              {{ update.text }}
            </span>
          </div>
          <p v-if="message.text">{{ message.text }}</p>
          <span v-else-if="['starting', 'inProgress'].includes(message.status)">Working…</span>
          <span v-else-if="message.status === 'interrupted'">Stopped.</span>
          <span v-else-if="message.status === 'failed'">Temporary AI stopped with an error.</span>
        </article>
      </div>

      <div
        v-if="activeTask.error || activeTask.busy"
        class="vibe64-temporary-ai__feedback"
      >
        <div v-if="activeTask.error" class="vibe64-temporary-ai__error" role="alert">
          {{ activeTask.error }}
        </div>
        <div
          v-if="activeTask.busy"
          class="vibe64-temporary-ai__activity"
          aria-live="polite"
          role="status"
        >
          <span class="vibe64-temporary-ai__activity-mark" aria-hidden="true" />
          <span>{{ activeTaskActivityLabel }}</span>
        </div>
      </div>

      <Vibe64AutopilotPromptTextarea
        v-for="task in temporary.tasks.value"
        v-show="task.id === activeTask.id"
        :key="task.id"
        :ref="(element) => setTaskPrompt(task.id, element)"
        :model-value="task.draft"
        aria-label="Message temporary AI"
        :attachments-enabled="Boolean(props.sessionId)"
        :disabled="task.busy"
        placeholder="Ask temporary AI…"
        :rows="2"
        :session-id="props.sessionId"
        tab-to-submit
        @attachments-change="temporary.updateAttachments(task.id, $event)"
        @submit="sendTask(task.id)"
        @tab-to-submit="focusSendButton"
        @update:model-value="temporary.updateDraft(task.id, $event)"
      >
        <template #footer="{ attachmentState }">
          <div class="vibe64-temporary-ai__composer-actions">
            <Vibe64AgentSettingsMenu
              :agent-settings="task.agentSettings"
              :disabled="task.busy"
              @update-setting="updateActiveAgentSetting"
            />
            <v-btn
              aria-label="Attach files"
              :disabled="task.busy || !attachmentState.canAddFiles"
              :icon="mdiPaperclip"
              size="small"
              title="Attach files"
              type="button"
              variant="text"
              @click="taskPrompt(task.id)?.openFilePicker?.()"
            />
            <span class="vibe64-temporary-ai__spacer" />
            <v-btn
              v-if="task.busy"
              color="error"
              :prepend-icon="mdiStopCircleOutline"
              size="small"
              type="button"
              variant="tonal"
              @click="temporary.stopTask(task.id)"
            >
              Stop
            </v-btn>
            <v-btn
              v-else
              :ref="(element) => setTaskSendButton(task.id, element)"
              aria-label="Send to temporary AI"
              color="primary"
              :disabled="!task.draft.trim() || !attachmentState.canSubmit"
              :icon="mdiArrowUp"
              size="small"
              title="Send to temporary AI"
              type="button"
              variant="flat"
              @click="sendTask(task.id)"
            />
          </div>
        </template>
      </Vibe64AutopilotPromptTextarea>
    </template>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import {
  mdiArrowUp,
  mdiClose,
  mdiPaperclip,
  mdiPlus,
  mdiStopCircleOutline
} from "@mdi/js";

import Vibe64AgentSettingsMenu from "@/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import {
  TEMPORARY_AI_WORKSPACE_WRITE_POLICY,
  useVibe64TemporaryAi
} from "@/composables/useVibe64TemporaryAi.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const emit = defineEmits(["select-main-chat"]);
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

const workspace = ref(null);
const taskTabButtons = new Map();
const taskPrompts = new Map();
const taskSendButtons = new Map();
const resolvedSessionsApiPath = computed(() => readRefOrGetterValue(props.sessionsApiPath));
const temporaryAiFeedback = useUiFeedback({
  source: "vibe64.temporary-ai.feedback"
});
const temporary = useVibe64TemporaryAi({
  agentSettings: computed(() => props.agentSettings),
  onTaskFinished(task = {}) {
    if (task.status === "completed") {
      temporaryAiFeedback.success(`${task.title} finished. Review the result before continuing.`);
      return;
    }
    temporaryAiFeedback.error(task.error, `${task.title} stopped with an error.`);
  },
  sessionId: computed(() => props.sessionId),
  sessionsApiPath: resolvedSessionsApiPath
});
const activeTask = temporary.activeTask;
const activeTaskActivityLabel = computed(() => {
  const updates = activeTask.value?.messages?.at(-1)?.progressUpdates;
  return updates?.at(-1)?.text || "Temporary AI is working...";
});
const workspaceWritePolicy = TEMPORARY_AI_WORKSPACE_WRITE_POLICY;

function taskPrompt(taskId = "") {
  return taskPrompts.get(String(taskId || "")) || null;
}

function setTaskPrompt(taskId = "", element = null) {
  const normalizedTaskId = String(taskId || "");
  if (!normalizedTaskId) {
    return;
  }
  if (element) {
    taskPrompts.set(normalizedTaskId, element);
    return;
  }
  taskPrompts.delete(normalizedTaskId);
}

function setTaskSendButton(taskId = "", element = null) {
  const normalizedTaskId = String(taskId || "");
  if (!normalizedTaskId) {
    return;
  }
  if (element) {
    taskSendButtons.set(normalizedTaskId, element);
    return;
  }
  taskSendButtons.delete(normalizedTaskId);
}

async function sendTask(taskId = "") {
  const currentPrompt = taskPrompt(taskId);
  if (!taskId || currentPrompt?.attachmentsCanSubmit?.() === false) {
    return;
  }
  const sent = await temporary.send(taskId);
  if (sent) {
    currentPrompt?.clearAttachments?.();
  }
  return sent;
}

async function startTask(options = {}) {
  const started = temporary.startTask(options);
  const taskId = temporary.activeTaskId.value;
  await revealTaskTab(taskId, { focus: true });
  const result = await started;
  if (result?.started) {
    taskPrompt(taskId)?.clearAttachments?.();
  }
  return result;
}

function showWorkspace() {
  const task = temporary.showWorkspace();
  void revealTaskTab(temporary.activeTaskId.value);
  return task;
}

function setTaskTabButton(taskId = "", element = null) {
  const normalizedTaskId = String(taskId || "");
  if (!normalizedTaskId) {
    return;
  }
  if (element) {
    taskTabButtons.set(normalizedTaskId, element);
    return;
  }
  taskTabButtons.delete(normalizedTaskId);
}

function afterBrowserPaint() {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => resolve());
  });
}

async function revealTaskTab(taskId = "", { focus = false } = {}) {
  const normalizedTaskId = String(taskId || "");
  if (!normalizedTaskId) {
    return false;
  }
  await nextTick();
  await afterBrowserPaint();
  const button = taskTabButtons.get(normalizedTaskId);
  button?.scrollIntoView?.({
    block: "nearest",
    inline: "nearest"
  });
  if (focus) {
    const target = button || workspace.value;
    target?.focus?.({ preventScroll: true });
  }
  return Boolean(button);
}

function focusSendButton() {
  const sendButton = taskSendButtons.get(activeTask.value?.id);
  const button = sendButton?.$el || sendButton;
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

watch(() => temporary.activeTaskId.value, (taskId) => {
  void revealTaskTab(taskId);
}, { flush: "post" });

defineExpose({
  closeWorkspace: temporary.closeWorkspace,
  openTask: temporary.openTask,
  startTask,
  showWorkspace
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
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  left: 0.3rem;
  min-height: 0;
  overflow: hidden;
  position: absolute;
  right: 0.3rem;
  top: 3.3rem;
  z-index: 12;
}

.vibe64-temporary-ai__composer-actions {
  align-items: center;
  display: flex;
}

.vibe64-temporary-ai__tabs {
  align-items: center;
  background: rgba(var(--v-theme-tertiary), 0.06);
  border-bottom: 1px solid rgba(var(--v-theme-tertiary), 0.18);
  display: flex;
  gap: 0.25rem;
  overflow-x: auto;
  padding: 0.25rem 0.35rem;
}

.vibe64-temporary-ai__tab {
  align-items: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border: 1px solid transparent;
  border-radius: 999px;
  color: inherit;
  display: inline-flex;
  flex: 0 0 auto;
  min-height: 2rem;
  padding-left: 0.15rem;
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
  padding: 0.2rem 0.35rem 0.2rem 0.55rem;
}

.vibe64-temporary-ai:focus-visible,
.vibe64-temporary-ai__tab-select:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.vibe64-temporary-ai__tab--active {
  background: rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-theme-tertiary), 0.35);
  font-weight: 650;
}

.vibe64-temporary-ai__tab--main {
  background: rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-theme-tertiary), 0.22);
  inset-inline-start: 0;
  position: sticky;
  z-index: 1;
}

.vibe64-temporary-ai__new-task {
  flex: 0 0 auto;
}

.vibe64-temporary-ai__tabs-spacer {
  flex: 1 1 auto;
}

.vibe64-temporary-ai__policy {
  flex: 0 0 auto;
  font-weight: 700;
}

.vibe64-temporary-ai__busy {
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  height: 0.45rem;
  width: 0.45rem;
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

.vibe64-temporary-ai__progress {
  display: grid;
  gap: 0.18rem;
  margin: 0.15rem 0;
}

.vibe64-temporary-ai__progress-update {
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: block;
  font-size: 0.78rem;
  line-height: 1.35;
}

.vibe64-temporary-ai__message span,
.vibe64-temporary-ai__error {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.82rem;
}

.vibe64-temporary-ai__feedback {
  min-width: 0;
}

.vibe64-temporary-ai__error {
  color: rgb(var(--v-theme-error));
  padding: 0.3rem 0.55rem;
}

.vibe64-temporary-ai__activity {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.66);
  display: flex;
  font-size: 0.78rem;
  gap: 0.45rem;
  min-height: 1.8rem;
  padding: 0.15rem 0.55rem;
}

.vibe64-temporary-ai__activity-mark {
  animation: vibe64-temporary-ai-pulse 1.2s ease-in-out infinite;
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  flex: 0 0 auto;
  height: 0.42rem;
  width: 0.42rem;
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

@keyframes vibe64-temporary-ai-pulse {
  0%,
  100% {
    opacity: 0.35;
  }

  50% {
    opacity: 1;
  }
}

@media (max-width: 720px) {
  .vibe64-temporary-ai {
    border: 0;
    border-radius: 0;
    inset: 0;
    z-index: 30;
  }
}

@media (pointer: coarse) {
  .vibe64-temporary-ai__tab-select,
  .vibe64-temporary-ai__new-task,
  .vibe64-temporary-ai__policy,
  .vibe64-temporary-ai__tab-close,
  .vibe64-temporary-ai__composer-actions .v-btn {
    min-height: 3rem !important;
    min-width: 3rem !important;
  }
}
</style>
