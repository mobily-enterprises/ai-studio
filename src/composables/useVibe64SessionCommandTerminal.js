import { computed, nextTick, ref, unref } from "vue";
import {
  aiStudioSessionDebugDurationMs,
  aiStudioSessionDebugLog,
  aiStudioSessionDebugSummary
} from "@/lib/aiStudioSessionDebugLog.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function useAiStudioSessionCommandTerminal({
  currentNext = () => null,
  refreshSessionData,
  selectedSession,
  selectedSessionId
} = {}) {
  const action = ref(null);
  const input = ref({});
  const running = ref(false);
  const startKey = ref("");
  const pendingStartedAt = ref(0);

  const visible = computed(() => Boolean(action.value || running.value));

  function clear() {
    if (action.value || running.value) {
      aiStudioSessionDebugLog("client.sessionCommandTerminal.clear", {
        actionId: String(action.value?.id || ""),
        running: running.value,
        sessionId: String(unref(selectedSessionId) || "")
      });
    }
    action.value = null;
    input.value = {};
    running.value = false;
    startKey.value = "";
    pendingStartedAt.value = 0;
  }

  function start(nextAction = {}) {
    const commandStartedAt = Date.now();
    aiStudioSessionDebugLog("client.sessionCommandTerminal.start", {
      ...aiStudioSessionDebugSummary(readRefOrGetterValue(selectedSession) || {}),
      actionId: String(nextAction.id || ""),
      advanceOnSuccess: nextAction.advanceOnSuccess === true,
      sessionId: String(unref(selectedSessionId) || "")
    });
    action.value = nextAction;
    input.value = {};
    pendingStartedAt.value = commandStartedAt;
    startKey.value = `${unref(selectedSessionId)}:${nextAction.id}:${commandStartedAt}`;
  }

  async function refreshAfterSettled({
    actionId = "",
    exitCode = null
  } = {}) {
    const startedAtMs = pendingStartedAt.value || Date.now();
    aiStudioSessionDebugLog("client.sessionCommandTerminal.settled.start", {
      actionId: String(actionId || ""),
      exitCode,
      sessionId: String(unref(selectedSessionId) || "")
    });
    running.value = false;
    await refreshSessionData();
    await nextTick();

    const next = readRefOrGetterValue(currentNext);
    aiStudioSessionDebugLog("client.sessionCommandTerminal.settled.afterRefresh", {
      ...aiStudioSessionDebugSummary(readRefOrGetterValue(selectedSession) || {}),
      actionId: String(actionId || ""),
      durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
      exitCode,
      nextEnabled: next?.enabled === true,
      nextVisible: next?.visible === true,
      sessionId: String(unref(selectedSessionId) || "")
    });

    pendingStartedAt.value = 0;
  }

  function handleClosed() {
    aiStudioSessionDebugLog("client.sessionCommandTerminal.closed", {
      actionId: String(action.value?.id || ""),
      sessionId: String(unref(selectedSessionId) || "")
    });
    clear();
  }

  async function handleFinished(event = {}) {
    if (event.sessionId && event.sessionId !== unref(selectedSessionId)) {
      aiStudioSessionDebugLog("client.sessionCommandTerminal.finished.ignored", {
        actionId: String(event.actionId || ""),
        eventSessionId: String(event.sessionId || ""),
        selectedSessionId: String(unref(selectedSessionId) || "")
      });
      return;
    }
    aiStudioSessionDebugLog("client.sessionCommandTerminal.finished", {
      actionId: String(event.actionId || ""),
      eventSessionId: String(event.sessionId || ""),
      exitCode: event.exitCode ?? null,
      selectedSessionId: String(unref(selectedSessionId) || "")
    });
    await refreshAfterSettled({
      actionId: event.actionId,
      exitCode: event.exitCode
    });
  }

  async function handleRunningChanged(nextRunning) {
    const wasRunning = running.value;
    running.value = Boolean(nextRunning);
    aiStudioSessionDebugLog("client.sessionCommandTerminal.runningChanged", {
      actionId: String(action.value?.id || ""),
      nextRunning: running.value,
      sessionId: String(unref(selectedSessionId) || ""),
      wasRunning
    });
    if (running.value || !wasRunning) {
      return;
    }
    await refreshAfterSettled({
      actionId: action.value?.id || ""
    });
  }

  return {
    action,
    clear,
    closed: handleClosed,
    finished: handleFinished,
    input,
    running,
    runningChanged: handleRunningChanged,
    start,
    startKey,
    visible
  };
}

export {
  useAiStudioSessionCommandTerminal
};
