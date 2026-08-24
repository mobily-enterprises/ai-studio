import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import {
  defaultVibe64AgentSettings,
  normalizeVibe64AgentSettings
} from "@local/vibe64-runtime/shared";

import { chatMessagePayload } from "@/lib/vibe64ChatMessage.js";
import {
  vibe64AgentAttachmentDeletePath,
  vibe64TemporaryConversationPath,
  vibe64TemporaryConversationsPath,
  vibe64TemporaryConversationStopPath,
  vibe64TemporaryConversationTurnsPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const TEMPORARY_AI_POLL_INTERVAL_MS = 650;
const TEMPORARY_AI_WORKSPACE_WRITE_POLICY = "workspace_write";

function temporaryAiId(prefix = "temporary") {
  return `${prefix}_${crypto.randomUUID()}`;
}

function temporaryAiText(value = "") {
  return String(value || "").trim();
}

function temporaryAiRequestError(response = {}, fallback = "Temporary AI request failed.") {
  return Object.assign(new Error(vibe64ApiResponseError(response, fallback)), {
    code: temporaryAiText(response.code),
    conversationExpired: response.conversationExpired === true
  });
}

function temporaryAiTurnIsActive(status = "") {
  return ["starting", "inProgress"].includes(temporaryAiText(status));
}

function temporaryAiProgressUpdates(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((update = {}, index) => ({
    id: temporaryAiText(update.id) || `progress:${index + 1}`,
    text: temporaryAiText(update.text)
  })).filter((update) => update.text);
}

function temporaryAiTurnMessages(messages = [], runId = "", update = {}) {
  return messages.map((message) => (
    message.runId === runId && message.role === "assistant"
      ? { ...message, ...update }
      : message
  ));
}

function useVibe64TemporaryAi({
  agentSettings = () => defaultVibe64AgentSettings(),
  onTaskFinished = null,
  sessionId,
  sessionsApiPath
} = {}) {
  const tasks = ref([]);
  const activeTaskId = ref("");
  const open = ref(false);
  const pollTimers = new Map();
  const closingTaskIds = new Set();
  let nextTaskNumber = 1;

  const activeTask = computed(() => (
    tasks.value.find((task) => task.id === activeTaskId.value) || tasks.value[0] || null
  ));

  function currentSessionId() {
    return temporaryAiText(readRefOrGetterValue(sessionId));
  }

  function currentSessionsApiPath() {
    return temporaryAiText(readRefOrGetterValue(sessionsApiPath));
  }

  function updateTask(taskId = "", update = {}) {
    tasks.value = tasks.value.map((task) => (
      task.id === taskId ? { ...task, ...update } : task
    ));
    return tasks.value.find((task) => task.id === taskId) || null;
  }

  function reportTaskFinished(taskId = "") {
    if (typeof onTaskFinished !== "function") {
      return;
    }
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    try {
      onTaskFinished(Object.freeze({
        error: temporaryAiText(task.error),
        id: task.id,
        status: temporaryAiText(task.status),
        title: temporaryAiText(task.title) || "Temporary AI"
      }));
    } catch {
      // Feedback must never interfere with the completed task state.
    }
  }

  function openTask({
    dedupeKey = "",
    draft = "",
    policy = "read",
    title = ""
  } = {}) {
    const number = nextTaskNumber;
    nextTaskNumber += 1;
    const task = {
      agentSettings: normalizeVibe64AgentSettings(readRefOrGetterValue(agentSettings)),
      attachments: [],
      busy: false,
      conversationId: "",
      dedupeKey: temporaryAiText(dedupeKey),
      draft: temporaryAiText(draft),
      error: "",
      id: temporaryAiId("temporary-ai"),
      messages: [],
      ownedAttachmentIds: [],
      pendingMessageId: "",
      policy: policy === TEMPORARY_AI_WORKSPACE_WRITE_POLICY
        ? TEMPORARY_AI_WORKSPACE_WRITE_POLICY
        : "read",
      runId: "",
      status: "ready",
      title: temporaryAiText(title) || `Temporary ${number}`
    };
    tasks.value = [...tasks.value, task];
    activeTaskId.value = task.id;
    open.value = true;
    return task;
  }

  async function startTask(options = {}) {
    const input = options && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};
    const message = temporaryAiText(input.message || input.draft);
    if (!message || !currentSessionId() || !currentSessionsApiPath()) {
      return Object.freeze({
        ok: false,
        reused: false,
        started: false,
        taskId: ""
      });
    }
    const dedupeKey = temporaryAiText(input.dedupeKey);
    const existingTask = dedupeKey
      ? [...tasks.value].reverse().find((task) => (
          task.dedupeKey === dedupeKey && (
            task.busy || (
              task.status === "failed" &&
              temporaryAiText(task.draft) &&
              temporaryAiText(task.pendingMessageId)
            )
          )
        ))
      : null;
    if (existingTask) {
      selectTask(existingTask.id);
      const started = existingTask.busy ? false : await send(existingTask.id);
      return Object.freeze({
        ok: existingTask.busy || started,
        reused: true,
        started,
        taskId: existingTask.id
      });
    }
    const task = openTask({
      ...input,
      dedupeKey,
      draft: message
    });
    const started = await send(task.id);
    return Object.freeze({
      ok: started,
      reused: false,
      started,
      taskId: task.id
    });
  }

  function selectTask(taskId = "") {
    if (tasks.value.some((task) => task.id === taskId)) {
      activeTaskId.value = taskId;
      open.value = true;
    }
  }

  function showWorkspace() {
    if (tasks.value.length === 0) {
      return openTask();
    }
    if (!tasks.value.some((task) => task.id === activeTaskId.value)) {
      activeTaskId.value = tasks.value[0].id;
    }
    open.value = true;
    return activeTask.value;
  }

  function updateDraft(taskId = "", draft = "") {
    updateTask(taskId, {
      draft: String(draft || ""),
      pendingMessageId: ""
    });
  }

  function updateAgentSetting(taskId = "", parameterId = "", value = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    updateTask(taskId, {
      agentSettings: normalizeVibe64AgentSettings({
        ...task.agentSettings,
        [parameterId]: value
      })
    });
  }

  function updatePolicy(taskId = "", policy = "read") {
    updateTask(taskId, {
      policy: policy === TEMPORARY_AI_WORKSPACE_WRITE_POLICY
        ? TEMPORARY_AI_WORKSPACE_WRITE_POLICY
        : "read"
    });
  }

  function updateAttachments(taskId = "", attachments = []) {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task) {
      return;
    }
    const current = Array.isArray(attachments) ? attachments : [];
    const ids = current
      .map((attachment) => temporaryAiText(attachment?.attachmentId))
      .filter(Boolean);
    updateTask(taskId, {
      attachments: current,
      ownedAttachmentIds: [...new Set(ids)]
    });
  }

  async function request(path = "", options = {}) {
    const response = await getHttpWebClient().request(path, options);
    if (response?.ok === false) {
      throw temporaryAiRequestError(response);
    }
    return response;
  }

  async function ensureConversation(task = {}) {
    if (task.conversationId) {
      return task.conversationId;
    }
    const response = await request(
      vibe64TemporaryConversationsPath(currentSessionsApiPath(), currentSessionId()),
      {
        body: {
          agentSettings: task.agentSettings,
          policy: task.policy
        },
        method: "POST"
      }
    );
    updateTask(task.id, { conversationId: response.conversationId });
    return response.conversationId;
  }

  function stopPolling(taskId = "") {
    clearTimeout(pollTimers.get(taskId));
    pollTimers.delete(taskId);
  }

  async function pollTask(taskId = "") {
    stopPolling(taskId);
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task?.conversationId || !task.runId || closingTaskIds.has(taskId)) {
      return;
    }
    try {
      const response = await request(
        vibe64TemporaryConversationPath(
          currentSessionsApiPath(),
          currentSessionId(),
          task.conversationId
        ),
        { method: "GET" }
      );
      const text = temporaryAiText(response.message || response.rawText);
      const status = temporaryAiText(response.status) || "completed";
      const messages = temporaryAiTurnMessages(task.messages, task.runId, {
        progressUpdates: temporaryAiProgressUpdates(response.progressUpdates),
        status,
        text
      });
      const active = temporaryAiTurnIsActive(status);
      updateTask(taskId, {
        busy: active,
        conversationId: response.conversationExpired === true ? "" : task.conversationId,
        error: active ? "" : temporaryAiText(response.error),
        messages,
        runId: response.conversationExpired === true ? "" : task.runId,
        status
      });
      if (active) {
        pollTimers.set(taskId, setTimeout(() => void pollTask(taskId), TEMPORARY_AI_POLL_INTERVAL_MS));
      } else {
        reportTaskFinished(taskId);
      }
    } catch (error) {
      const message = temporaryAiText(error?.message || error) || "Temporary AI response could not be read.";
      updateTask(taskId, {
        busy: false,
        conversationId: error?.conversationExpired === true ? "" : task.conversationId,
        error: message,
        messages: temporaryAiTurnMessages(task.messages, task.runId, {
          status: "failed"
        }),
        runId: error?.conversationExpired === true ? "" : task.runId,
        status: "failed"
      });
      reportTaskFinished(taskId);
    }
  }

  async function send(taskId = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task || task.busy) {
      return false;
    }
    const payload = chatMessagePayload(task.draft, task.attachments);
    if (!payload?.message) {
      return false;
    }
    const messageId = task.pendingMessageId || temporaryAiId("message");
    updateTask(taskId, {
      busy: true,
      draft: "",
      error: "",
      pendingMessageId: messageId,
      status: "starting"
    });
    let conversationId = task.conversationId;
    try {
      conversationId = await ensureConversation(task);
      const response = await request(
        vibe64TemporaryConversationTurnsPath(
          currentSessionsApiPath(),
          currentSessionId(),
          conversationId
        ),
        {
          body: {
            agentSettings: task.agentSettings,
            ...(payload.attachmentIds?.length ? { attachmentIds: payload.attachmentIds } : {}),
            messageId,
            message: payload.message,
            policy: task.policy,
            promptLabel: task.title
          },
          method: "POST"
        }
      );
      const messages = [
        ...task.messages,
        {
          id: messageId,
          role: "user",
          status: "completed",
          text: payload.displayMessage
        },
        {
          id: temporaryAiId("message"),
          role: "assistant",
          runId: response.runId,
          status: response.status || "inProgress",
          progressUpdates: [],
          text: ""
        }
      ];
      updateTask(taskId, {
        attachments: [],
        busy: true,
        conversationId,
        messages,
        ownedAttachmentIds: [],
        pendingMessageId: "",
        runId: response.runId,
        status: response.status || "inProgress"
      });
      void pollTask(taskId);
      return true;
    } catch (error) {
      updateTask(taskId, {
        busy: false,
        conversationId: error?.conversationExpired === true ? "" : conversationId,
        draft: task.draft,
        error: temporaryAiText(error?.message || error) || "Temporary AI message could not be sent.",
        pendingMessageId: messageId,
        runId: error?.conversationExpired === true ? "" : task.runId,
        status: "failed"
      });
      reportTaskFinished(taskId);
      return false;
    }
  }

  async function stopTask(taskId = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task?.conversationId || !task.runId || !task.busy) {
      return false;
    }
    stopPolling(taskId);
    await request(
      vibe64TemporaryConversationStopPath(
        currentSessionsApiPath(),
        currentSessionId(),
        task.conversationId
      ),
      {
        body: { runId: task.runId },
        method: "POST"
      }
    );
    updateTask(taskId, {
      busy: false,
      messages: temporaryAiTurnMessages(task.messages, task.runId, {
        status: "interrupted"
      }),
      status: "interrupted"
    });
    return true;
  }

  async function closeTask(taskId = "") {
    const task = tasks.value.find((candidate) => candidate.id === taskId);
    if (!task || closingTaskIds.has(taskId)) {
      return;
    }
    closingTaskIds.add(taskId);
    stopPolling(taskId);
    try {
      if (task.busy && task.conversationId && task.runId) {
        await stopTask(taskId).catch(() => null);
      }
      if (task.conversationId) {
        await request(
          vibe64TemporaryConversationPath(
            currentSessionsApiPath(),
            currentSessionId(),
            task.conversationId
          ),
          { method: "DELETE" }
        ).catch(() => null);
      }
    } finally {
      closingTaskIds.delete(taskId);
      tasks.value = tasks.value.filter((candidate) => candidate.id !== taskId);
      if (activeTaskId.value === taskId) {
        activeTaskId.value = tasks.value[0]?.id || "";
      }
      if (tasks.value.length === 0) {
        open.value = false;
      }
    }
  }

  function closeWorkspace() {
    open.value = false;
  }

  function cleanupOnPageExit() {
    const currentSession = currentSessionId();
    const apiPath = currentSessionsApiPath();
    for (const task of tasks.value) {
      if (task.conversationId) {
        void fetch(resolveStudioRequestUrl(vibe64TemporaryConversationPath(
          apiPath,
          currentSession,
          task.conversationId
        )), {
          credentials: "same-origin",
          keepalive: true,
          method: "DELETE"
        });
      }
      for (const attachmentId of task.ownedAttachmentIds) {
        void fetch(resolveStudioRequestUrl(vibe64AgentAttachmentDeletePath(
          apiPath,
          currentSession,
          attachmentId
        )), {
          credentials: "same-origin",
          keepalive: true,
          method: "DELETE"
        });
      }
    }
  }

  onMounted(() => window.addEventListener("beforeunload", cleanupOnPageExit));
  onBeforeUnmount(() => {
    window.removeEventListener("beforeunload", cleanupOnPageExit);
    cleanupOnPageExit();
    for (const task of tasks.value) {
      stopPolling(task.id);
    }
  });

  return {
    activeTask,
    activeTaskId,
    closeTask,
    closeWorkspace,
    open,
    openTask,
    selectTask,
    send,
    showWorkspace,
    startTask,
    stopTask,
    tasks,
    updateAgentSetting,
    updateAttachments,
    updateDraft,
    updatePolicy
  };
}

export {
  TEMPORARY_AI_WORKSPACE_WRITE_POLICY,
  temporaryAiTurnIsActive,
  useVibe64TemporaryAi
};
