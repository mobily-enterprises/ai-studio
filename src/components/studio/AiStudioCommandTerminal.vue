<template>
  <v-sheet rounded="lg" class="ai-command-terminal">
    <div class="ai-command-terminal__bar">
      <div>
        <div class="ai-command-terminal__title">Command terminal</div>
        <div class="ai-command-terminal__subtitle">
          {{ activeActionLabel || "Run adapter commands here." }}
        </div>
      </div>
      <div class="ai-command-terminal__actions">
        <v-btn
          :icon="expanded ? mdiChevronDown : mdiChevronUp"
          size="small"
          variant="text"
          @click="toggleExpanded"
        />
        <v-btn
          v-if="canRetry"
          color="primary"
          :loading="terminalStarting"
          size="small"
          variant="flat"
          @click="restartTerminal"
        >
          Retry
        </v-btn>
        <v-btn
          :disabled="!terminalSessionId || terminalExited"
          size="small"
          variant="text"
          @click="sendCtrlC"
        >
          Ctrl-C
        </v-btn>
        <v-btn
          :disabled="!terminalSessionId"
          size="small"
          variant="text"
          @click="closeTerminal"
        >
          Close
        </v-btn>
      </div>
    </div>

    <v-expand-transition>
      <div v-show="expanded" class="ai-command-terminal__body">
        <StudioErrorNotice
          v-if="terminalError"
          title="Command terminal needs attention"
          :error="terminalError"
          compact
          class="mb-2"
        />

        <div ref="terminalHost" class="ai-command-terminal__host" />

        <div class="ai-command-terminal__footer">
          <span>{{ terminalCommandPreview || "No command running." }}</span>
          <v-chip v-if="terminalStatus" size="x-small" variant="tonal">
            {{ terminalStatus }}
          </v-chip>
        </div>
      </div>
    </v-expand-transition>
  </v-sheet>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  mdiChevronDown,
  mdiChevronUp
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  aiStudioCommandTerminalWebSocketUrl,
  closeAiStudioCommandTerminal,
  startAiStudioCommandTerminal
} from "@/lib/studioApi.js";
import "@xterm/xterm/css/xterm.css";

const props = defineProps({
  action: {
    type: Object,
    default: null
  },
  session: {
    type: Object,
    default: null
  },
  startRequestKey: {
    type: [String, Number],
    default: ""
  }
});

const emit = defineEmits(["finished", "running-changed"]);

const terminalHost = ref(null);
const terminalSessionId = ref("");
const terminalStatus = ref("");
const terminalCommandPreview = ref("");
const terminalError = ref("");
const terminalExitCode = ref(null);
const terminalStarting = ref(false);
const terminalClosedByUser = ref(false);
const expanded = ref(true);

let terminalInstance = null;
let terminalFitAddon = null;
let terminalSocket = null;
let terminalSocketOpenPromise = null;
let terminalDataDisposable = null;
let terminalResizeHandler = null;
let terminalLatestOutput = "";
let terminalOutputOffset = 0;
let terminalSetupPromise = null;
let terminalStartPromise = null;
let finishedEmittedForTerminalId = "";
let handledStartRequestKey = "";

const FINISHED_TERMINAL_HOLD_MS = 500;
const MAX_TERMINAL_OUTPUT_LENGTH = 180000;

const sessionId = computed(() => props.session?.sessionId || "");
const actionId = computed(() => props.action?.id || "");
const activeActionLabel = computed(() => props.action?.label || "");
const terminalExited = computed(() => terminalStatus.value === "exited");
const canRetry = computed(() => Boolean(
  sessionId.value &&
  actionId.value &&
  (
    terminalError.value ||
    terminalClosedByUser.value ||
    (terminalExited.value && terminalExitCode.value !== 0)
  )
));

function terminalIsRunning(status = terminalStatus.value) {
  return status === "running" || status === "closing" || terminalStarting.value;
}

function emitRunningState() {
  emit("running-changed", terminalIsRunning());
}

function trimTerminalOutput(output) {
  const text = String(output || "");
  return text.length <= MAX_TERMINAL_OUTPUT_LENGTH
    ? text
    : text.slice(text.length - MAX_TERMINAL_OUTPUT_LENGTH);
}

async function setupTerminalUi() {
  if (terminalInstance) {
    return true;
  }
  if (terminalSetupPromise) {
    return terminalSetupPromise;
  }

  terminalSetupPromise = (async () => {
    await nextTick();
    if (!terminalHost.value) {
      return false;
    }
    terminalHost.value.replaceChildren();
    terminalInstance = new Terminal({
      convertEol: true,
      cursorBlink: false,
      disableStdin: false,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: {
        background: "#101216",
        foreground: "#f5f7fb"
      }
    });
    terminalFitAddon = new FitAddon();
    terminalInstance.loadAddon(terminalFitAddon);
    terminalInstance.open(terminalHost.value);
    terminalFitAddon.fit();
    terminalDataDisposable = terminalInstance.onData((data) => {
      void sendTerminalData(data);
    });
    terminalResizeHandler = () => {
      terminalFitAddon?.fit();
    };
    window.addEventListener("resize", terminalResizeHandler);
    writeTerminalOutput(terminalLatestOutput);
    return true;
  })();

  try {
    return await terminalSetupPromise;
  } finally {
    terminalSetupPromise = null;
  }
}

function closeTerminalSocket() {
  const socket = terminalSocket;
  terminalSocket = null;
  terminalSocketOpenPromise = null;
  if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
    socket.close();
  }
}

function disposeTerminalUi() {
  closeTerminalSocket();
  terminalDataDisposable?.dispose?.();
  terminalDataDisposable = null;
  if (terminalResizeHandler) {
    window.removeEventListener("resize", terminalResizeHandler);
    terminalResizeHandler = null;
  }
  terminalInstance?.dispose?.();
  terminalInstance = null;
  terminalFitAddon = null;
  terminalSetupPromise = null;
  terminalOutputOffset = 0;
}

function writeTerminalOutput(output) {
  terminalLatestOutput = trimTerminalOutput(output);
  if (!terminalInstance) {
    return;
  }
  if (terminalLatestOutput.length < terminalOutputOffset) {
    terminalOutputOffset = 0;
    terminalInstance.reset();
  }
  const chunk = terminalLatestOutput.slice(terminalOutputOffset);
  if (chunk) {
    terminalInstance.write(chunk);
    terminalOutputOffset = terminalLatestOutput.length;
  }
}

function appendTerminalOutput(chunk) {
  const outputChunk = String(chunk || "");
  if (!outputChunk) {
    return;
  }
  terminalLatestOutput = trimTerminalOutput(`${terminalLatestOutput}${outputChunk}`);
  if (terminalInstance) {
    terminalInstance.write(outputChunk);
    terminalOutputOffset = terminalLatestOutput.length;
  }
}

function scheduleFinished(exitCode, closeError = "") {
  if (!terminalSessionId.value || finishedEmittedForTerminalId === terminalSessionId.value) {
    return;
  }
  finishedEmittedForTerminalId = terminalSessionId.value;
  window.setTimeout(() => {
    emit("finished", {
      actionId: actionId.value,
      closeError: String(closeError || terminalError.value || ""),
      exitCode,
      sessionId: sessionId.value
    });
  }, FINISHED_TERMINAL_HOLD_MS);
}

function handleTerminalSocketMessage(rawMessage) {
  let message;
  try {
    message = JSON.parse(String(rawMessage || ""));
  } catch {
    terminalError.value = "Terminal stream returned an invalid message.";
    return;
  }

  if (message?.type === "snapshot") {
    const session = message.session || {};
    terminalStatus.value = session.status || terminalStatus.value || "";
    terminalExitCode.value = session.status === "exited" ? session.exitCode ?? null : null;
    terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
    terminalError.value = String(session.closeError || terminalError.value || "");
    writeTerminalOutput(session.output || "");
    emitRunningState();
    if (session.status === "exited") {
      scheduleFinished(session.exitCode, session.closeError);
    }
    return;
  }

  if (message?.type === "output") {
    appendTerminalOutput(message.chunk);
    return;
  }

  if (message?.type === "status") {
    terminalStatus.value = message.status || terminalStatus.value || "";
    terminalExitCode.value = message.status === "exited" ? message.exitCode ?? null : null;
    terminalError.value = String(message.closeError || terminalError.value || "");
    emitRunningState();
    if (message.status === "exited") {
      scheduleFinished(message.exitCode, message.closeError);
    }
    return;
  }

  if (message?.type === "error") {
    terminalError.value = String(message.error || "Terminal stream failed.");
  }
}

async function connectTerminalSocket() {
  if (!terminalSessionId.value || !sessionId.value) {
    return false;
  }
  if (terminalSocket?.readyState === WebSocket.OPEN) {
    return true;
  }
  if (terminalSocketOpenPromise) {
    return terminalSocketOpenPromise;
  }

  terminalSocketOpenPromise = new Promise((resolve) => {
    let settled = false;
    const socket = new WebSocket(aiStudioCommandTerminalWebSocketUrl(sessionId.value, terminalSessionId.value));
    terminalSocket = socket;
    const settle = (ready) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(ready);
    };
    socket.addEventListener("open", () => {
      terminalError.value = "";
      settle(true);
    });
    socket.addEventListener("message", (event) => {
      handleTerminalSocketMessage(event.data);
    });
    socket.addEventListener("error", () => {
      terminalError.value = "Terminal stream failed.";
      settle(false);
    });
    socket.addEventListener("close", () => {
      if (terminalSocket === socket) {
        terminalSocket = null;
      }
      terminalSocketOpenPromise = null;
      settle(false);
    });
  });

  return terminalSocketOpenPromise;
}

async function startTerminal() {
  if (!sessionId.value || !actionId.value) {
    return false;
  }
  if (terminalStartPromise) {
    return terminalStartPromise;
  }
  terminalStartPromise = (async () => {
    terminalStarting.value = true;
    emitRunningState();
    terminalError.value = "";
    expanded.value = true;
    if (!(await setupTerminalUi())) {
      terminalError.value = "Terminal view is not ready yet.";
      return false;
    }
    try {
      terminalClosedByUser.value = false;
      const session = await startAiStudioCommandTerminal(sessionId.value, actionId.value);
      if (session?.ok === false) {
        throw new Error(session.error || session.errors?.[0]?.message || "Command terminal failed to start.");
      }
      const nextTerminalSessionId = session.id || "";
      if (nextTerminalSessionId && nextTerminalSessionId !== terminalSessionId.value) {
        closeTerminalSocket();
        terminalLatestOutput = "";
        terminalOutputOffset = 0;
        finishedEmittedForTerminalId = "";
        terminalInstance?.reset?.();
      }
      terminalSessionId.value = session.id || "";
      terminalStatus.value = session.status || "running";
      terminalExitCode.value = session.status === "exited" ? session.exitCode ?? null : null;
      terminalCommandPreview.value = session.commandPreview || "";
      writeTerminalOutput(session.output || "");
      emitRunningState();
      return connectTerminalSocket();
    } catch (error) {
      terminalError.value = String(error?.message || error || "Command terminal failed to start.");
      return false;
    } finally {
      terminalStarting.value = false;
      emitRunningState();
    }
  })();

  try {
    return await terminalStartPromise;
  } finally {
    terminalStartPromise = null;
  }
}

async function sendTerminalData(data) {
  if (!terminalSessionId.value || terminalStatus.value === "exited") {
    return false;
  }
  if (!(await connectTerminalSocket()) || terminalSocket?.readyState !== WebSocket.OPEN) {
    terminalError.value = "Terminal stream is not connected.";
    return false;
  }
  terminalSocket.send(JSON.stringify({
    data: String(data || ""),
    type: "input"
  }));
  return true;
}

async function sendCtrlC() {
  await sendTerminalData("\u0003");
}

async function closeTerminal() {
  const existingTerminalId = terminalSessionId.value;
  terminalSessionId.value = "";
  terminalStatus.value = "";
  terminalExitCode.value = null;
  terminalClosedByUser.value = true;
  emitRunningState();
  closeTerminalSocket();
  if (existingTerminalId && sessionId.value) {
    await closeAiStudioCommandTerminal(sessionId.value, existingTerminalId).catch(() => null);
  }
}

async function restartTerminal() {
  await closeTerminal();
  terminalLatestOutput = "";
  terminalOutputOffset = 0;
  finishedEmittedForTerminalId = "";
  terminalClosedByUser.value = false;
  terminalInstance?.reset?.();
  await startTerminal();
}

function toggleExpanded() {
  expanded.value = !expanded.value;
  if (expanded.value) {
    void setupTerminalUi();
  }
}

watch(() => props.startRequestKey, async (nextKey) => {
  const normalizedKey = String(nextKey || "");
  if (!normalizedKey || normalizedKey === handledStartRequestKey) {
    return;
  }
  handledStartRequestKey = normalizedKey;
  await startTerminal();
});

watch(sessionId, () => {
  terminalSessionId.value = "";
  terminalStatus.value = "";
  terminalExitCode.value = null;
  terminalCommandPreview.value = "";
  terminalError.value = "";
  terminalLatestOutput = "";
  terminalOutputOffset = 0;
  finishedEmittedForTerminalId = "";
  terminalClosedByUser.value = false;
  terminalInstance?.reset?.();
  closeTerminalSocket();
  emitRunningState();
});

watch(terminalHost, (host) => {
  if (host) {
    void setupTerminalUi();
  }
}, {
  flush: "post"
});

defineExpose({
  start: startTerminal
});

onBeforeUnmount(() => {
  disposeTerminalUi();
  emit("running-changed", false);
});
</script>

<style scoped>
.ai-command-terminal {
  min-width: 0;
  padding: 0.75rem;
}

.ai-command-terminal__bar,
.ai-command-terminal__footer {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.ai-command-terminal__bar {
  margin-bottom: 0.5rem;
}

.ai-command-terminal__title {
  font-size: 0.85rem;
  font-weight: 700;
}

.ai-command-terminal__subtitle,
.ai-command-terminal__footer {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.75rem;
}

.ai-command-terminal__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
}

.ai-command-terminal__body {
  display: grid;
  gap: 0.5rem;
}

.ai-command-terminal__host {
  background: #101216;
  border: 2px solid rgba(var(--v-theme-outline), 0.38);
  border-radius: 6px;
  height: clamp(18rem, 38vh, 32rem);
  overflow: hidden;
  padding: 0.35rem;
}

.ai-command-terminal__footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .ai-command-terminal__bar,
  .ai-command-terminal__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .ai-command-terminal__host {
    height: min(58vh, 28rem);
  }
}
</style>
