<template>
  <v-sheet rounded="lg" class="codex-terminal">
    <div class="codex-terminal__bar">
      <div class="codex-terminal__title">
        <v-icon :icon="mdiConsoleLine" size="18" />
        <span>Codex</span>
        <v-chip size="x-small" variant="tonal">{{ terminalStatusLabel }}</v-chip>
      </div>
      <div class="codex-terminal__actions">
        <v-btn
          v-if="codexPrompt"
          :disabled="!canUseTerminal || terminalStarting"
          :loading="injectingPrompt"
          :prepend-icon="mdiSend"
          size="small"
          variant="tonal"
          @click="injectPrompt"
        >
          {{ promptActionLabel }}
        </v-btn>
        <v-btn
          :disabled="!canUseTerminal || terminalStarting"
          :loading="terminalStarting"
          :prepend-icon="mdiPower"
          size="small"
          variant="tonal"
          @click="ensureTerminalReady"
        >
          Start
        </v-btn>
        <v-btn
          :icon="expanded ? mdiChevronDown : mdiChevronUp"
          size="small"
          variant="text"
          @click="toggleExpanded"
        />
      </div>
    </div>

    <v-expand-transition>
      <div v-show="expanded" class="codex-terminal__body">
        <v-alert v-if="terminalError" type="error" variant="tonal" density="compact" class="mb-2">
          {{ terminalError }}
        </v-alert>

        <div ref="terminalHost" class="codex-terminal__host" />

        <div class="codex-terminal__footer">
          <span class="codex-terminal__command">{{ terminalCommandPreview }}</span>
          <div class="codex-terminal__footer-actions">
            <v-btn
              :disabled="!terminalSelectedText"
              size="small"
              variant="text"
              @click="copyTerminalSelection"
            >
              Copy
            </v-btn>
            <v-btn
              :disabled="!terminalSessionId"
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

        <p v-if="copyStatus" class="text-caption text-medium-emphasis mb-0">{{ copyStatus }}</p>
      </div>
    </v-expand-transition>
  </v-sheet>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  mdiChevronDown,
  mdiChevronUp,
  mdiConsoleLine,
  mdiPower,
  mdiSend
} from "@mdi/js";
import {
  closeIssueSessionCodexTerminal,
  readIssueSessionCodexTerminal,
  saveIssueSessionCodexThread,
  startIssueSessionCodexTerminal,
  writeIssueSessionCodexTerminal
} from "@/lib/studioApi.js";
import {
  extractCodexThreadId,
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import "@xterm/xterm/css/xterm.css";

const props = defineProps({
  session: {
    type: Object,
    default: null
  },
  visible: {
    type: Boolean,
    default: true
  }
});
const emit = defineEmits(["output"]);

const terminalHost = ref(null);
const terminalSessionId = ref("");
const terminalStatus = ref("");
const terminalCommandPreview = ref("");
const terminalError = ref("");
const terminalStarting = ref(false);
const terminalSelectedText = ref("");
const copyStatus = ref("");
const expanded = ref(true);
const injectingPrompt = ref(false);
const autoInjectedPromptKey = ref("");
const autoPromptInjected = ref(false);
const componentMounted = ref(false);
const codexThreadId = ref("");
const codexThreadCaptureRequired = ref(false);
const codexThreadCaptureStarted = ref(false);

let terminalInstance = null;
let terminalFitAddon = null;
let terminalDataDisposable = null;
let terminalSelectionDisposable = null;
let terminalPollTimer = null;
let terminalInputPollTimer = null;
let terminalResizeHandler = null;
let terminalOutputOffset = 0;
let terminalStartPromise = null;
let codexThreadCapturePromise = null;
let codexThreadSavePromise = null;
let terminalHasOutput = false;
let terminalLatestOutput = "";
let terminalLastOutputAt = 0;
let terminalStartedAt = 0;

const DEFAULT_CODEX_THREAD_COMMAND = "echo $CODEX_THREAD_ID";
const CODEX_BOOT_MIN_AGE_MS = 1800;
const CODEX_BOOT_QUIET_MS = 900;
const CODEX_BOOT_TIMEOUT_MS = 12000;
const CODEX_KEY_PAUSE_MS = 180;
const TERMINAL_VISIBLE_POLL_INTERVAL_MS = 100;
const TERMINAL_HIDDEN_POLL_INTERVAL_MS = 1000;
const TERMINAL_INPUT_POLL_DELAY_MS = 15;

const sessionId = computed(() => props.session?.sessionId || "");
const canUseTerminal = computed(() => Boolean(sessionId.value && props.session?.worktree));
const codexMode = computed(() => String(props.session?.codex?.mode || ""));
const codexPrompt = computed(() => {
  const promptField = String(props.session?.codex?.promptField || "");
  return promptField ? String(props.session?.[promptField] || "") : "";
});
const codexPromptInjectionKey = computed(() => {
  if (codexMode.value !== "inject_prompt" || !codexPrompt.value || !sessionId.value) {
    return "";
  }
  return `${sessionId.value}:${hashText(codexPrompt.value)}`;
});
const promptActionLabel = computed(() => autoPromptInjected.value ? "Re-inject Prompt" : "Inject Prompt");
const terminalStatusLabel = computed(() => {
  if (!canUseTerminal.value) {
    return "waiting";
  }
  return terminalStatus.value || "idle";
});

function defaultExpanded() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return true;
  }
  return !window.matchMedia("(max-width: 700px)").matches;
}

function fallbackCopyText(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function applyCodexThreadState(session = {}) {
  if (session.codexThreadId) {
    codexThreadId.value = String(session.codexThreadId || "");
    codexThreadCaptureRequired.value = false;
    codexThreadCaptureStarted.value = false;
    return;
  }
  if (session.needsThreadCapture === true) {
    codexThreadCaptureRequired.value = true;
  }
}

async function copyText(value, label) {
  const text = String(value || "");
  if (!text) {
    return false;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else if (!fallbackCopyText(text)) {
      throw new Error("Clipboard API is unavailable.");
    }
    copyStatus.value = `${label} copied.`;
    return true;
  } catch (copyError) {
    copyStatus.value = String(copyError?.message || copyError || "Copy failed.");
    return false;
  }
}

function updateTerminalSelection() {
  terminalSelectedText.value = terminalInstance?.hasSelection?.()
    ? terminalInstance.getSelection()
    : "";
  return terminalSelectedText.value;
}

async function copyTerminalSelection() {
  await copyText(updateTerminalSelection(), "Selection");
}

function disposeTerminalUi() {
  if (terminalPollTimer) {
    window.clearInterval(terminalPollTimer);
    terminalPollTimer = null;
  }
  if (terminalInputPollTimer) {
    window.clearTimeout(terminalInputPollTimer);
    terminalInputPollTimer = null;
  }
  if (terminalDataDisposable) {
    terminalDataDisposable.dispose();
    terminalDataDisposable = null;
  }
  if (terminalSelectionDisposable) {
    terminalSelectionDisposable.dispose();
    terminalSelectionDisposable = null;
  }
  if (terminalResizeHandler) {
    window.removeEventListener("resize", terminalResizeHandler);
    terminalResizeHandler = null;
  }
  if (terminalInstance) {
    terminalInstance.dispose();
    terminalInstance = null;
  }
  terminalFitAddon = null;
  terminalOutputOffset = 0;
  terminalHasOutput = false;
  terminalLatestOutput = "";
  terminalLastOutputAt = 0;
  terminalStartedAt = 0;
  terminalSelectedText.value = "";
}

async function setupTerminalUi() {
  if (terminalInstance) {
    return;
  }
  expanded.value = true;
  await nextTick();
  if (!terminalHost.value) {
    return;
  }
  terminalInstance = new Terminal({
    convertEol: true,
    cursorBlink: true,
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
  terminalSelectionDisposable = terminalInstance.onSelectionChange(() => {
    updateTerminalSelection();
  });
  terminalResizeHandler = () => {
    terminalFitAddon?.fit();
  };
  window.addEventListener("resize", terminalResizeHandler);
}

function writeTerminalOutput(output) {
  emit("output", String(output || ""));
  if (!terminalInstance) {
    return;
  }
  const nextOutput = String(output || "");
  if (nextOutput !== terminalLatestOutput) {
    terminalLatestOutput = nextOutput;
    terminalLastOutputAt = Date.now();
    terminalHasOutput = stripTerminalControlSequences(nextOutput).trim().length > 0;
  }
  void captureCodexThreadFromOutput(nextOutput);
  if (nextOutput.length < terminalOutputOffset) {
    terminalOutputOffset = 0;
    terminalInstance.reset();
  }
  const chunk = nextOutput.slice(terminalOutputOffset);
  if (chunk) {
    terminalInstance.write(chunk);
    terminalOutputOffset = nextOutput.length;
  }
}

async function pollTerminal() {
  if (!terminalSessionId.value || !sessionId.value) {
    return;
  }
  try {
    const session = await readIssueSessionCodexTerminal(sessionId.value, terminalSessionId.value);
    applyCodexThreadState(session);
    terminalStatus.value = session.status || "";
    terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
    writeTerminalOutput(session.output);
    if (session.status === "exited" && terminalPollTimer) {
      window.clearInterval(terminalPollTimer);
      terminalPollTimer = null;
    }
  } catch (pollError) {
    terminalError.value = String(pollError?.message || pollError || "Terminal polling failed.");
  }
}

function terminalPollInterval() {
  return props.visible ? TERMINAL_VISIBLE_POLL_INTERVAL_MS : TERMINAL_HIDDEN_POLL_INTERVAL_MS;
}

function restartTerminalPollTimer() {
  if (!terminalSessionId.value || terminalStatus.value === "exited") {
    return;
  }
  if (terminalPollTimer) {
    window.clearInterval(terminalPollTimer);
  }
  terminalPollTimer = window.setInterval(() => {
    void pollTerminal();
  }, terminalPollInterval());
}

function scheduleInputPoll() {
  if (terminalInputPollTimer || !terminalSessionId.value || terminalStatus.value === "exited") {
    return;
  }
  terminalInputPollTimer = window.setTimeout(() => {
    terminalInputPollTimer = null;
    void pollTerminal();
  }, TERMINAL_INPUT_POLL_DELAY_MS);
}

async function ensureTerminalReady() {
  if (!canUseTerminal.value) {
    terminalError.value = "Create the session worktree before starting Codex.";
    return false;
  }
  if (terminalStartPromise) {
    return terminalStartPromise;
  }
  terminalStartPromise = startTerminalOnce();
  try {
    return await terminalStartPromise;
  } finally {
    terminalStartPromise = null;
  }
}

async function startTerminalOnce() {
  expanded.value = true;
  await setupTerminalUi();
  if (terminalSessionId.value) {
    terminalFitAddon?.fit();
    return true;
  }

  terminalStarting.value = true;
  terminalError.value = "";
  try {
    const session = await startIssueSessionCodexTerminal(sessionId.value);
    if (session?.ok === false) {
      throw new Error(session.error || session.errors?.[0]?.message || "Codex terminal failed to start.");
    }
    applyCodexThreadState(session);
    terminalSessionId.value = session.id || "";
    terminalStartedAt = Date.now();
    terminalStatus.value = session.status || "running";
    terminalCommandPreview.value = session.commandPreview || "";
    writeTerminalOutput(session.output);
    restartTerminalPollTimer();
    await pollTerminal();
    void ensureCodexThreadReady({ forceRetry: true });
    return true;
  } catch (startError) {
    terminalError.value = String(startError?.message || startError || "Codex terminal failed to start.");
    return false;
  } finally {
    terminalStarting.value = false;
  }
}

async function sendTerminalData(data) {
  if (!terminalSessionId.value || terminalStatus.value === "exited") {
    return false;
  }
  try {
    await writeIssueSessionCodexTerminal(sessionId.value, terminalSessionId.value, data);
    scheduleInputPoll();
    return true;
  } catch (sendError) {
    terminalError.value = String(sendError?.message || sendError || "Terminal input failed.");
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function sendCodexShellCommand(command) {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    return false;
  }

  const keySequence = [
    "\u001b",
    "\u0015",
    "!",
    normalizedCommand,
    "\u001b",
    "\r"
  ];
  for (const keyInput of keySequence) {
    if (!(await sendTerminalData(keyInput))) {
      return false;
    }
    await delay(CODEX_KEY_PAUSE_MS);
  }
  return true;
}

async function captureCodexThreadFromOutput(output) {
  if (!codexThreadCaptureRequired.value || codexThreadId.value || !sessionId.value) {
    return false;
  }
  if (codexThreadSavePromise) {
    return codexThreadSavePromise;
  }
  const threadId = extractCodexThreadId(output);
  if (!threadId) {
    return false;
  }

  codexThreadSavePromise = (async () => {
    const response = await saveIssueSessionCodexThread(sessionId.value, threadId);
    if (response?.ok === false) {
      throw new Error(response.error || response.errors?.[0]?.message || "Codex thread id could not be saved.");
    }
    codexThreadId.value = response.codexThreadId || threadId;
    codexThreadCaptureRequired.value = false;
    copyStatus.value = "Codex session captured.";
    return true;
  })();

  try {
    return await codexThreadSavePromise;
  } catch (saveError) {
    terminalError.value = String(saveError?.message || saveError || "Codex thread id could not be saved.");
    return false;
  } finally {
    codexThreadSavePromise = null;
  }
}

function waitForCodexThreadId() {
  if (codexThreadId.value || !codexThreadCaptureRequired.value) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (codexThreadId.value || !codexThreadCaptureRequired.value) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt > 12000) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 250);
  });
}

function canCaptureCodexThread() {
  return Boolean(
    terminalSessionId.value &&
    sessionId.value &&
    codexThreadCaptureRequired.value &&
    !codexThreadId.value &&
    terminalStatus.value !== "exited"
  );
}

function codexBootLooksReady() {
  if (!terminalStartedAt || !terminalHasOutput) {
    return false;
  }
  const now = Date.now();
  return now - terminalStartedAt >= CODEX_BOOT_MIN_AGE_MS &&
    now - terminalLastOutputAt >= CODEX_BOOT_QUIET_MS;
}

async function waitForCodexBootReady() {
  if (codexBootLooksReady()) {
    return true;
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (codexBootLooksReady()) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt > CODEX_BOOT_TIMEOUT_MS) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 250);
  });
}

async function ensureCodexThreadReady({ forceRetry = false } = {}) {
  if (codexThreadId.value || !codexThreadCaptureRequired.value) {
    return true;
  }
  if (codexThreadCapturePromise) {
    return codexThreadCapturePromise;
  }

  codexThreadCapturePromise = (async () => {
    if (!canCaptureCodexThread()) {
      return false;
    }
    if (!codexThreadCaptureStarted.value || forceRetry) {
      await waitForCodexBootReady();
      codexThreadCaptureStarted.value = true;
      const sent = await sendCodexShellCommand(DEFAULT_CODEX_THREAD_COMMAND);
      if (!sent) {
        codexThreadCaptureStarted.value = false;
        return false;
      }
    }
    await pollTerminal();
    const ready = await waitForCodexThreadId();
    if (!ready) {
      terminalError.value = "Waiting for Codex thread id before injecting prompt.";
    }
    return ready;
  })();

  try {
    return await codexThreadCapturePromise;
  } finally {
    codexThreadCapturePromise = null;
  }
}

async function injectPrompt() {
  if (!codexPrompt.value) {
    return false;
  }
  injectingPrompt.value = true;
  try {
    if (await ensureTerminalReady() && await ensureCodexThreadReady({ forceRetry: true })) {
      const sent = await sendTerminalData(`\u001b[200~${codexPrompt.value}\u001b[201~\r`);
      if (sent) {
        autoPromptInjected.value = true;
        copyStatus.value = "Prompt injected into Codex.";
      }
      return sent;
    }
    return false;
  } finally {
    injectingPrompt.value = false;
  }
}

async function injectPromptAutomatically() {
  const injectionKey = codexPromptInjectionKey.value;
  if (!componentMounted.value || !injectionKey || autoInjectedPromptKey.value === injectionKey) {
    return;
  }
  autoInjectedPromptKey.value = injectionKey;
  autoPromptInjected.value = false;
  if (!(await injectPrompt()) && autoInjectedPromptKey.value === injectionKey) {
    autoInjectedPromptKey.value = "";
  }
}

async function sendCtrlC() {
  await sendTerminalData("\u0003");
}

async function closeTerminal() {
  const existingTerminalId = terminalSessionId.value;
  terminalSessionId.value = "";
  terminalStatus.value = "";
  terminalCommandPreview.value = "";
  codexThreadCaptureRequired.value = false;
  codexThreadCaptureStarted.value = false;
  disposeTerminalUi();
  if (existingTerminalId && sessionId.value) {
    await closeIssueSessionCodexTerminal(sessionId.value, existingTerminalId).catch(() => null);
  }
}

function toggleExpanded() {
  expanded.value = !expanded.value;
  if (expanded.value) {
    void ensureTerminalReady();
  }
}

watch(sessionId, async (nextSessionId, previousSessionId) => {
  if (previousSessionId && previousSessionId !== nextSessionId) {
    await closeTerminal();
  }
  autoInjectedPromptKey.value = "";
  autoPromptInjected.value = false;
  expanded.value = defaultExpanded();
  if (expanded.value && canUseTerminal.value) {
    void ensureTerminalReady();
  }
  void injectPromptAutomatically();
});

watch(canUseTerminal, (ready) => {
  if (ready && expanded.value) {
    void ensureTerminalReady();
  }
  if (ready) {
    void injectPromptAutomatically();
  }
});

watch(codexPromptInjectionKey, (nextPromptKey) => {
  if (nextPromptKey) {
    expanded.value = true;
    void injectPromptAutomatically();
  }
});

watch(() => props.visible, async (visible) => {
  restartTerminalPollTimer();
  if (!visible) {
    return;
  }
  await nextTick();
  terminalFitAddon?.fit();
  if (expanded.value && canUseTerminal.value) {
    void ensureTerminalReady();
  }
});

onMounted(() => {
  componentMounted.value = true;
  expanded.value = defaultExpanded();
  if (expanded.value && canUseTerminal.value) {
    void ensureTerminalReady();
  }
  void injectPromptAutomatically();
});

onBeforeUnmount(() => {
  void closeTerminal();
});
</script>

<style scoped>
.codex-terminal {
  min-width: 0;
  padding: 0.25rem 0 0;
}

.codex-terminal__bar,
.codex-terminal__footer {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
  min-width: 0;
}

.codex-terminal__title,
.codex-terminal__actions,
.codex-terminal__footer-actions {
  align-items: center;
  display: flex;
  gap: 0.4rem;
  min-width: 0;
}

.codex-terminal__title span {
  font-weight: 650;
}

.codex-terminal__body {
  padding-top: 0.5rem;
}

.codex-terminal__host {
  background: #101216;
  border-radius: 6px;
  height: clamp(34rem, 68vh, 52rem);
  overflow: hidden;
  padding: 0.35rem;
}

.codex-terminal__footer {
  padding-top: 0.35rem;
}

.codex-terminal__command {
  color: rgb(var(--v-theme-on-surface-variant));
  flex: 1 1 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.72rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .codex-terminal__bar,
  .codex-terminal__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .codex-terminal__actions,
  .codex-terminal__footer-actions {
    justify-content: flex-start;
    overflow-x: auto;
  }

  .codex-terminal__host {
    height: min(70vh, 42rem);
  }
}
</style>
