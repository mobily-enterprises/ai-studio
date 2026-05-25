import { computed, ref, unref } from "vue";

import {
  startAiStudioCodexTerminal
} from "@/lib/aiStudioSessionApi.js";

const VISIBLE_BACKGROUND_TASK_STATUSES = new Set(["failed", "running"]);

function normalizeBackgroundTasks(session = {}) {
  return (Array.isArray(session?.presentation?.backgroundTasks) ? session.presentation.backgroundTasks : [])
    .filter((task) => task && typeof task === "object")
    .map((task) => ({
      ...task,
      error: String(task.error || "").trim(),
      id: String(task.id || "").trim(),
      label: String(task.label || task.id || "Background task").trim(),
      message: String(task.message || "").trim(),
      retry: task.retry && typeof task.retry === "object" ? task.retry : null,
      status: String(task.status || "").trim(),
      updatedAt: String(task.updatedAt || "").trim()
    }))
    .filter((task) => task.id && task.status);
}

function taskRetryAction(task = {}) {
  return String(task.retry?.clientAction || "").trim();
}

function taskRetryErrorMessage(error) {
  return String(error?.message || error || "Background task retry failed.").trim();
}

function useAiStudioBackgroundTasks({
  refreshSessionData = async () => null,
  session
} = {}) {
  const retryingBackgroundTaskId = ref("");
  const backgroundTaskError = ref("");
  const backgroundTasks = computed(() => normalizeBackgroundTasks(unref(session) || {}));
  const visibleBackgroundTasks = computed(() => backgroundTasks.value.filter((task) => {
    return VISIBLE_BACKGROUND_TASK_STATUSES.has(task.status);
  }));

  async function retryBackgroundTask(task = {}) {
    const sessionId = String(unref(session)?.sessionId || "").trim();
    const retryAction = taskRetryAction(task);
    if (!sessionId || !task.id || retryAction !== "start_codex_terminal") {
      return false;
    }
    backgroundTaskError.value = "";
    retryingBackgroundTaskId.value = task.id;
    try {
      const result = await startAiStudioCodexTerminal(sessionId);
      if (result?.ok === false) {
        throw new Error(result.error || "Codex could not be prepared.");
      }
      await refreshSessionData();
      return true;
    } catch (error) {
      backgroundTaskError.value = taskRetryErrorMessage(error);
      return false;
    } finally {
      retryingBackgroundTaskId.value = "";
    }
  }

  return {
    backgroundTaskError,
    backgroundTasks,
    retryBackgroundTask,
    retryingBackgroundTaskId,
    visibleBackgroundTasks
  };
}

export {
  normalizeBackgroundTasks,
  useAiStudioBackgroundTasks
};
