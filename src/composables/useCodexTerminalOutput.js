import { ref, unref } from "vue";

import {
  STUDIO_CONTEXT_END_MARKER,
  STUDIO_CONTEXT_START_MARKER,
  stripStudioContextBlocksForDisplay,
  terminalSnapshotOutputForDisplay,
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import { createCodexPromptEchoFilters } from "@/lib/codexPromptEchoFilters.js";
import {
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

const CODEX_ACTIVITY_QUIET_MS = 2200;
const TERMINAL_STREAM_QUIET_MS = 650;
const CODEX_ACTIVITY_BUFFER_LENGTH = 8192;
const TERMINAL_REPAINT_VISIBLE_TEXT_LIMIT = 12;
const TERMINAL_ESCAPE_CHARACTER = String.fromCharCode(27);
const TERMINAL_OUTPUT_TAIL_LENGTH = 256 * 1024;
const TERMINAL_DISPLAY_UPDATE_INTERVAL_MS = 80;
const TERMINAL_OUTPUT_OBSERVER_INTERVAL_MS = 120;
const TERMINAL_CURSOR_POSITION_PATTERN = new RegExp(`${TERMINAL_ESCAPE_CHARACTER}\\[\\d+;\\d+H`, "u");
const CODEX_WORKING_TEXT_MARKERS = Object.freeze([
  "Working (",
  "Waiting for background terminal",
  "background terminal running"
]);
const CODEX_IDLE_TEXT_MARKERS = Object.freeze([
  "tab to queue message"
]);
const CODEX_ACTIVITY_TEXT_MARKERS = Object.freeze([
  ...CODEX_WORKING_TEXT_MARKERS,
  ...CODEX_IDLE_TEXT_MARKERS
]);

function trimTerminalOutputTail(output) {
  const terminalOutput = String(output || "");
  if (terminalOutput.length <= TERMINAL_OUTPUT_TAIL_LENGTH) {
    return {
      output: terminalOutput,
      trimmedLength: 0
    };
  }
  const trimmedLength = terminalOutput.length - TERMINAL_OUTPUT_TAIL_LENGTH;
  return {
    output: terminalOutput.slice(trimmedLength),
    trimmedLength
  };
}

function textIncludesAny(value = "", markers = []) {
  const source = String(value || "");
  return markers.some((marker) => source.includes(marker));
}

function codexWorkingStateFromText(value = "") {
  const source = String(value || "");
  if (source.includes("background terminal running")) {
    return true;
  }
  const latestWorkingMarker = Math.max(
    ...CODEX_WORKING_TEXT_MARKERS.map((marker) => source.lastIndexOf(marker))
  );
  const latestIdleMarker = Math.max(
    ...CODEX_IDLE_TEXT_MARKERS.map((marker) => source.lastIndexOf(marker))
  );
  if (latestIdleMarker >= 0 && latestIdleMarker > latestWorkingMarker) {
    return false;
  }
  if (latestWorkingMarker >= 0) {
    return true;
  }
  return null;
}

function terminalChunkHasControlSequences(value = "") {
  const source = String(value || "");
  for (let index = 0; index < source.length; index += 1) {
    const code = source.charCodeAt(index);
    if (
      (code >= 0 && code <= 8) ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      (code >= 127 && code <= 159)
    ) {
      return true;
    }
  }
  return false;
}

function terminalOutputVisibleText(value = "") {
  if (!terminalChunkHasControlSequences(value)) {
    return String(value || "");
  }
  return stripTerminalControlSequences(value);
}

function terminalOutputLooksLikeSmallCursorRepaint(value = "") {
  const source = String(value || "");
  return source.length <= 256 &&
    source.includes(`${TERMINAL_ESCAPE_CHARACTER}[?2026`) &&
    source.includes(`${TERMINAL_ESCAPE_CHARACTER}[K`) &&
    TERMINAL_CURSOR_POSITION_PATTERN.test(source);
}

function terminalOutputIsSmallCursorRepaint(value = "", visibleText = terminalOutputVisibleText(value)) {
  const trimmedVisibleText = String(visibleText || "").trim();
  if (
    !trimmedVisibleText ||
    trimmedVisibleText.length > TERMINAL_REPAINT_VISIBLE_TEXT_LIMIT ||
    trimmedVisibleText.includes("\n")
  ) {
    return false;
  }
  return terminalOutputLooksLikeSmallCursorRepaint(value);
}

function stripStudioContextBlocksIfPresent(output) {
  const source = String(output || "");
  if (
    !source.includes(STUDIO_CONTEXT_START_MARKER) &&
    !source.includes(STUDIO_CONTEXT_END_MARKER)
  ) {
    return source;
  }
  return stripStudioContextBlocksForDisplay(source);
}

function useCodexTerminalOutput({
  appendDisplay,
  displayActive = true,
  emitBusyChanged,
  onOutputChanged,
  shouldNotifyOutputChanged,
  sessionId,
  writeDisplay
} = {}) {
  const codexBusy = ref(false);
  const codexWorking = ref(false);
  const terminalStreaming = ref(false);
  const promptEchoFilters = createCodexPromptEchoFilters();

  let terminalDisplayTimer = null;
  let terminalOutputChangedTimer = null;
  let codexActivityBuffer = "";
  let codexIdleTimer = null;
  let terminalStreamingTimer = null;
  let codexBusyOutputVersion = 0;
  let terminalHasOutput = false;
  let terminalOutputTail = "";
  let terminalOutputTailStartOffset = 0;
  let terminalLastOutputAt = 0;
  let terminalOutputVersion = 0;
  let pendingDisplayChunk = "";
  let pendingDisplayMode = "";

  function displayIsActive() {
    return Boolean(unref(displayActive));
  }

  function outputObserverIsActive() {
    return typeof onOutputChanged === "function" &&
      (typeof shouldNotifyOutputChanged !== "function" || shouldNotifyOutputChanged() !== false);
  }

  function displayTerminalOutput(output = terminalOutputTail) {
    return stripStudioContextBlocksIfPresent(promptEchoFilters.apply(output, {
      outputStartOffset: terminalOutputTailStartOffset
    }));
  }

  function clearCodexIdleTimer() {
    if (!codexIdleTimer) {
      return;
    }
    globalThis.clearTimeout(codexIdleTimer);
    codexIdleTimer = null;
  }

  function emitCodexActivityChanged() {
    const payload = {
      busy: codexBusy.value,
      sessionId: unref(sessionId),
      streaming: terminalStreaming.value,
      working: codexWorking.value
    };
    vibe64SessionDebugLog("client.codexTerminal.activity", payload);
    emitBusyChanged?.(payload);
  }

  function clearTerminalStreamingTimer() {
    if (!terminalStreamingTimer) {
      return;
    }
    globalThis.clearTimeout(terminalStreamingTimer);
    terminalStreamingTimer = null;
  }

  function setTerminalStreaming(nextStreaming) {
    const streaming = Boolean(nextStreaming);
    if (terminalStreaming.value === streaming) {
      return;
    }
    vibe64SessionDebugLog("client.codexTerminal.streaming", {
      sessionId: unref(sessionId),
      streaming
    });
    terminalStreaming.value = streaming;
    emitCodexActivityChanged();
  }

  function markTerminalStreaming() {
    setTerminalStreaming(true);
    clearTerminalStreamingTimer();
    terminalStreamingTimer = globalThis.setTimeout(() => {
      terminalStreamingTimer = null;
      setTerminalStreaming(false);
    }, TERMINAL_STREAM_QUIET_MS);
  }

  function setCodexBusy(nextBusy) {
    const busy = Boolean(nextBusy);
    if (codexBusy.value === busy) {
      return;
    }
    codexBusy.value = busy;
    emitCodexActivityChanged();
  }

  function setCodexWorking(nextWorking) {
    const working = Boolean(nextWorking);
    if (codexWorking.value === working) {
      return;
    }
    codexWorking.value = working;
    emitCodexActivityChanged();
  }

  function clearCodexWorking() {
    setCodexWorking(false);
  }

  function updateCodexWorkingFromOutput(output = "", {
    replace = false
  } = {}) {
    const nextBuffer = replace
      ? String(output || "")
      : `${codexActivityBuffer}${String(output || "")}`;
    codexActivityBuffer = nextBuffer.slice(-CODEX_ACTIVITY_BUFFER_LENGTH);
    if (!textIncludesAny(codexActivityBuffer, CODEX_ACTIVITY_TEXT_MARKERS)) {
      return;
    }

    const visibleActivityText = stripTerminalControlSequences(codexActivityBuffer);
    const nextWorking = codexWorkingStateFromText(visibleActivityText);
    if (nextWorking === null) {
      return;
    }
    setCodexWorking(nextWorking);
  }

  function markCodexBusy() {
    clearCodexIdleTimer();
    codexBusyOutputVersion = terminalOutputVersion;
    setCodexBusy(true);
  }

  function clearCodexBusy() {
    clearCodexIdleTimer();
    codexBusyOutputVersion = terminalOutputVersion;
    setCodexBusy(false);
  }

  function scheduleCodexIdleWhenQuiet() {
    if (!codexBusy.value || terminalOutputVersion <= codexBusyOutputVersion) {
      return;
    }
    clearCodexIdleTimer();
    codexIdleTimer = globalThis.setTimeout(() => {
      codexIdleTimer = null;
      clearCodexBusy();
    }, CODEX_ACTIVITY_QUIET_MS);
  }

  function noteTerminalActivityWithoutOutput() {
    terminalOutputVersion += 1;
    terminalLastOutputAt = Date.now();
    scheduleCodexIdleWhenQuiet();
  }

  function clearTerminalDisplayTimer() {
    if (!terminalDisplayTimer) {
      return;
    }
    globalThis.clearTimeout(terminalDisplayTimer);
    terminalDisplayTimer = null;
  }

  function clearPendingDisplay() {
    pendingDisplayChunk = "";
    pendingDisplayMode = "";
  }

  function displayChunkCanAppendRaw(outputChunk = "") {
    const chunk = String(outputChunk || "");
    return Boolean(
      chunk &&
      !promptEchoFilters.hasPending() &&
      !chunk.includes(STUDIO_CONTEXT_START_MARKER) &&
      !chunk.includes(STUDIO_CONTEXT_END_MARKER)
    );
  }

  function writeDisplayNow() {
    clearTerminalDisplayTimer();
    clearPendingDisplay();
    if (displayIsActive()) {
      writeDisplay?.(displayTerminalOutput(terminalOutputTail));
    }
  }

  function flushTerminalDisplay() {
    terminalDisplayTimer = null;
    if (!displayIsActive()) {
      clearPendingDisplay();
      return;
    }
    if (pendingDisplayMode === "append" && appendDisplay) {
      appendDisplay(pendingDisplayChunk);
      clearPendingDisplay();
      return;
    }
    clearPendingDisplay();
    writeDisplay?.(displayTerminalOutput(terminalOutputTail));
  }

  function scheduleTerminalDisplayFlush() {
    if (terminalDisplayTimer) {
      return;
    }
    terminalDisplayTimer = globalThis.setTimeout(() => {
      flushTerminalDisplay();
    }, TERMINAL_DISPLAY_UPDATE_INTERVAL_MS);
  }

  function scheduleTerminalDisplayAppend(outputChunk) {
    if (!displayIsActive()) {
      return;
    }
    if (pendingDisplayMode === "replace") {
      scheduleTerminalDisplayFlush();
      return;
    }
    pendingDisplayMode = "append";
    pendingDisplayChunk += String(outputChunk || "");
    scheduleTerminalDisplayFlush();
  }

  function scheduleTerminalDisplayWrite() {
    if (!displayIsActive()) {
      return;
    }
    pendingDisplayMode = "replace";
    pendingDisplayChunk = "";
    scheduleTerminalDisplayFlush();
  }

  function clearTerminalOutputChanged() {
    if (!terminalOutputChangedTimer) {
      return;
    }
    globalThis.clearTimeout(terminalOutputChangedTimer);
    terminalOutputChangedTimer = null;
  }

  function notifyTerminalOutputChangedNow(output = terminalOutputTail) {
    clearTerminalOutputChanged();
    if (!outputObserverIsActive()) {
      return;
    }
    onOutputChanged(output);
  }

  function flushTerminalOutput() {
    const shouldNotifyObserver = Boolean(terminalOutputChangedTimer && outputObserverIsActive());
    clearTerminalOutputChanged();
    if (shouldNotifyObserver) {
      onOutputChanged(terminalOutputTail);
    }
    writeDisplayNow();
  }

  function scheduleTerminalOutputChanged() {
    if (!outputObserverIsActive() || terminalOutputChangedTimer) {
      return;
    }
    terminalOutputChangedTimer = globalThis.setTimeout(() => {
      terminalOutputChangedTimer = null;
      if (outputObserverIsActive()) {
        onOutputChanged(terminalOutputTail);
      }
    }, TERMINAL_OUTPUT_OBSERVER_INTERVAL_MS);
  }

  function noteTerminalTextOutput({
    visibleText = ""
  } = {}) {
    terminalOutputVersion += 1;
    terminalLastOutputAt = Date.now();
    terminalHasOutput = terminalHasOutput || String(visibleText || "").trim().length > 0;
    scheduleCodexIdleWhenQuiet();
  }

  function replaceTerminalOutputTail(nextOutput, {
    emitImmediately = false,
    visibleText = ""
  } = {}) {
    const previousOutput = terminalOutputTail;
    const trimmedTail = trimTerminalOutputTail(nextOutput);
    terminalOutputTail = trimmedTail.output;
    terminalOutputTailStartOffset = trimmedTail.trimmedLength;
    if (terminalOutputTail !== previousOutput) {
      noteTerminalTextOutput({
        visibleText
      });
      updateCodexWorkingFromOutput(terminalOutputTail, {
        replace: true
      });
    }
    if (emitImmediately) {
      notifyTerminalOutputChangedNow(terminalOutputTail);
      writeDisplayNow();
    } else {
      scheduleTerminalOutputChanged();
      scheduleTerminalDisplayWrite();
    }
  }

  function appendTerminalOutputTail(outputChunk, {
    visibleText = ""
  } = {}) {
    const previousTailLength = terminalOutputTail.length;
    const nextOutput = outputChunk.length >= TERMINAL_OUTPUT_TAIL_LENGTH
      ? outputChunk
      : `${terminalOutputTail}${outputChunk}`;
    const trimmedTail = trimTerminalOutputTail(nextOutput);
    terminalOutputTail = trimmedTail.output;
    terminalOutputTailStartOffset += outputChunk.length >= TERMINAL_OUTPUT_TAIL_LENGTH
      ? previousTailLength + outputChunk.length - terminalOutputTail.length
      : trimmedTail.trimmedLength;
    noteTerminalTextOutput({
      visibleText
    });
    updateCodexWorkingFromOutput(outputChunk);
    scheduleTerminalOutputChanged();
  }

  function writeTerminalOutput(output) {
    const terminalOutput = terminalSnapshotOutputForDisplay(output);
    const visibleText = terminalOutputVisibleText(terminalOutput);
    replaceTerminalOutputTail(visibleText.trim() ? terminalOutput : "", {
      emitImmediately: true,
      visibleText
    });
  }

  function appendTerminalOutput(chunk) {
    const outputChunk = String(chunk || "");
    if (!outputChunk) {
      return;
    }
    markTerminalStreaming();
    if (terminalOutputLooksLikeSmallCursorRepaint(outputChunk)) {
      noteTerminalActivityWithoutOutput();
      if (displayChunkCanAppendRaw(outputChunk)) {
        scheduleTerminalDisplayAppend(outputChunk);
      }
      return;
    }
    const visibleText = terminalOutputVisibleText(outputChunk);
    if (!visibleText.trim() || terminalOutputIsSmallCursorRepaint(outputChunk, visibleText)) {
      noteTerminalActivityWithoutOutput();
      if (displayChunkCanAppendRaw(outputChunk)) {
        scheduleTerminalDisplayAppend(outputChunk);
      }
      return;
    }
    appendTerminalOutputTail(outputChunk, {
      visibleText
    });
    if (displayChunkCanAppendRaw(outputChunk)) {
      scheduleTerminalDisplayAppend(outputChunk);
    } else {
      scheduleTerminalDisplayWrite();
    }
  }

  function resetTerminalOutput({
    emit = false
  } = {}) {
    clearTerminalDisplayTimer();
    clearTerminalOutputChanged();
    clearPendingDisplay();
    clearTerminalStreamingTimer();
    setTerminalStreaming(false);
    clearCodexBusy();
    clearCodexWorking();
    codexActivityBuffer = "";
    terminalHasOutput = false;
    terminalOutputTail = "";
    terminalOutputTailStartOffset = 0;
    terminalLastOutputAt = 0;
    terminalOutputVersion += 1;
    if (emit) {
      notifyTerminalOutputChangedNow("");
    }
    if (displayIsActive()) {
      writeDisplay?.("");
    }
  }

  return {
    addPromptEchoFilter: promptEchoFilters.add,
    appendTerminalOutput,
    clearCodexBusy,
    clearCodexWorking,
    clearPromptEchoFilters: promptEchoFilters.clear,
    codexBusy,
    codexWorking,
    flushTerminalOutput,
    getTerminalOutput: () => terminalOutputTail,
    hasTerminalOutput: () => terminalHasOutput,
    lastTerminalOutputAt: () => terminalLastOutputAt,
    markCodexBusy,
    removePromptEchoFilter: promptEchoFilters.remove,
    resetTerminalOutput,
    terminalStreaming,
    writeTerminalOutput
  };
}

export {
  useCodexTerminalOutput
};
