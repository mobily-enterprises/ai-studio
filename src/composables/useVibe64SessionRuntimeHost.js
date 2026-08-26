import { computed, nextTick, onBeforeUnmount, onMounted, proxyRefs, ref, unref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useVibe64ConversationLog } from "@/composables/useVibe64ConversationLog.js";
import { useVibe64MountedSessionData } from "@/composables/useVibe64MountedSessionData.js";
import { useVibe64SessionDialogs } from "@/composables/useVibe64SessionDialogs.js";
import { useVibe64SessionRenewal } from "@/composables/useVibe64SessionRenewal.js";
import { sessionRecordHasActiveAgentWork } from "@/lib/vibe64MountedSessionState.js";
import {
  isClosedVibe64Session,
  vibe64SessionDisplayTitle,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "@/lib/vibe64SessionViewModel.js";
import {
  agentSettingsInputFromContext,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { vibe64ApiError, vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";

const SESSION_WORK_TASK_IDS = ["codex_turn_checkpoint", "save-work", "update-session"];

async function focusRuntimeSessionChat(sessionId = "", root = globalThis.document) {
  const normalizedId = String(sessionId || "").trim();
  if (!normalizedId || !root?.querySelectorAll) {
    return false;
  }
  await nextTick();
  await nextTick();
  const runtime = [...root.querySelectorAll("[data-vibe64-session-runtime-id]")]
    .find((element) => element.getAttribute("data-vibe64-session-runtime-id") === normalizedId);
  const target = runtime?.querySelector?.(".studio-autopilot__chat-panel");
  target?.focus?.({ preventScroll: true });
  return Boolean(target);
}

function agentTurnControlPayloadFromContext(context = {}) {
  const source = context && typeof context === "object" && !Array.isArray(context) ? context : {};
  const {
    agentSettings: _agentSettings,
    sessionId: _sessionId,
    ...body
  } = source;
  return vibe64RealtimeOriginPayload({
    ...body,
    ...agentSettingsInputFromContext(source)
  });
}

function proxySessionDialogs(dialogs = {}) {
  return Object.fromEntries(
    Object.entries(dialogs).map(([name, dialog]) => [name, proxyRefs(dialog)])
  );
}

function runtimeHostToolbarSessions({
  activeAgentThinking = false,
  selectedSession = null,
  selectedSessionId = "",
  sessions = []
} = {}) {
  const currentId = String(selectedSessionId || "").trim();
  return (Array.isArray(sessions) ? sessions : []).map((session) => {
    const sessionId = String(session?.sessionId || "").trim();
    if (!sessionId) {
      return session;
    }
    const source = sessionId === currentId && selectedSession?.sessionId === sessionId
      ? selectedSession
      : session;
    const agentThinking = Boolean(
      (sessionId === currentId && activeAgentThinking) ||
      sessionRecordHasActiveAgentWork(source)
    );
    return Boolean(session?.agentThinking) === agentThinking
      ? session
      : { ...session, agentThinking };
  });
}

function runtimeHostAgentWorking({ selectedSession = null } = {}) {
  return sessionRecordHasActiveAgentWork(selectedSession);
}

function agentMessageAcceptanceSignal(controller) {
  return controller.signal;
}

function createVibe64SessionWorkRefreshQueue({ inspect } = {}) {
  if (typeof inspect !== "function") {
    throw new TypeError("Session work refresh requires an inspector.");
  }
  let active = null;
  let disposed = false;
  let refreshAfterActive = false;

  async function drain() {
    do {
      refreshAfterActive = false;
      await inspect({
        isCurrent: () => !disposed && !refreshAfterActive
      });
    } while (!disposed && refreshAfterActive);
  }

  function request() {
    if (disposed) {
      return Promise.resolve();
    }
    if (active) {
      refreshAfterActive = true;
      return active;
    }
    active = Promise.resolve().then(drain).finally(() => {
      active = null;
    });
    return active;
  }

  return Object.freeze({
    dispose() {
      disposed = true;
      refreshAfterActive = false;
    },
    request
  });
}

function runtimeHostWorkTaskRevision(session = {}) {
  return (Array.isArray(session?.backgroundTasks) ? session.backgroundTasks : [])
    .filter((task) => SESSION_WORK_TASK_IDS.includes(String(task?.id || "")))
    .map((task) => {
      const events = Array.isArray(task?.events) ? task.events : [];
      const latestEvent = events.at(-1) || {};
      return [
        String(task?.id || ""),
        String(task?.status || ""),
        String(task?.updatedAt || ""),
        String(events.length),
        String(latestEvent.at || ""),
        String(latestEvent.kind || ""),
        String(latestEvent.status || "")
      ].join(":");
    })
    .sort()
    .join("|");
}

function useVibe64SessionRuntimeHost(props, emit) {
  const selectedSessionId = computed(() => String(props.sessionId || "").trim());
  const selectedListSession = computed(() => {
    const sessions = unref(props.sessionData.sessions) || [];
    return sessions.find((session) => session.sessionId === selectedSessionId.value) || null;
  });
  const mounted = useVibe64MountedSessionData({
    sessionId: selectedSessionId,
    sessionsApiPath: props.sessionData.sessionsApiPath,
    summarySession: selectedListSession
  });
  const selectedSession = mounted.session;
  const selectedSessionClosed = computed(() => isClosedVibe64Session(selectedSession.value || {}));
  const selectedSessionTitle = computed(() => (
    vibe64SessionDisplayTitle(selectedSession.value || {}) ||
    `Session ${props.sessionData.shortSessionId(selectedSessionId.value)}`
  ));
  const toolbarSessions = computed(() => (
    props.toolbarSessions?.length
      ? props.toolbarSessions
      : unref(props.sessionData.sessions) || []
  ));
  const activeAgentWorking = computed(() => runtimeHostAgentWorking({
    selectedSession: selectedSession.value
  }));
  const workState = ref({
    checkedAt: "",
    error: "",
    loading: true,
    operation: null,
    unsaved: null
  });
  let workStateActive = true;

  async function inspectWorkState({ isCurrent }) {
    const sessionId = selectedSessionId.value;
    const sessionClosed = selectedSessionClosed.value;
    const requestIsCurrent = () => Boolean(
      workStateActive &&
      isCurrent() &&
      !sourceOperationsSuspended.value &&
      selectedSessionId.value === sessionId &&
      selectedSessionClosed.value === sessionClosed
    );
    if (sourceOperationsSuspended.value) {
      return;
    }
    if (!sessionId || sessionClosed) {
      if (requestIsCurrent()) {
        workState.value = {
          checkedAt: new Date().toISOString(),
          error: "",
          loading: false,
          operation: null,
          unsaved: null
        };
      }
      return;
    }
    if (
      requestIsCurrent() &&
      (workState.value.unsaved === null || workState.value.unsaved === undefined)
    ) {
      workState.value = {
        ...workState.value,
        loading: true
      };
    }
    try {
      const result = await getHttpWebClient().request(
        vibe64SessionPath(
          readRefOrGetterValue(props.sessionData.sessionsApiPath),
          sessionId,
          "/work"
        ),
        { method: "GET" }
      );
      if (result?.ok === false) {
        throw new Error(vibe64ApiResponseError(result, "Session work could not be inspected."));
      }
      if (requestIsCurrent()) {
        workState.value = {
          ...result,
          checkedAt: new Date().toISOString(),
          error: "",
          loading: false
        };
      }
    } catch (error) {
      if (requestIsCurrent()) {
        workState.value = {
          checkedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error || "Session work could not be inspected."),
          loading: false,
          operation: null,
          unsaved: null
        };
      }
    }
  }

  const workStateRefreshQueue = createVibe64SessionWorkRefreshQueue({
    inspect: inspectWorkState
  });

  async function refreshWorkState() {
    if (sourceOperationsSuspended.value) {
      return workState.value;
    }
    await workStateRefreshQueue.request();
    return workState.value;
  }

  async function refreshSessionData(options = {}) {
    const includeList = options?.includeList === true;
    if (!includeList) {
      return mounted.refresh(options);
    }
    return Promise.allSettled([
      mounted.refresh(options),
      props.sessionData.refreshSessionData(options)
    ]);
  }

  const dialogModels = useVibe64SessionDialogs({
    clearSelectedSession: props.sessionData.clearSelectedSession,
    isSelectedSessionClosed: selectedSessionClosed,
    refreshSessionData,
    selectedSessionId,
    selectedSessionTitle,
    sessionsApiPath: props.sessionData.sessionsApiPath
  });
  const renewalModel = useVibe64SessionRenewal({
    active: computed(() => Boolean(props.active)),
    focusSession: focusRuntimeSessionChat,
    refreshSessionData: props.sessionData.refreshSessionData,
    selectSession: props.sessionData.selectSessionId,
    selectedSession,
    selectedSessionId,
    sessionsApiPath: props.sessionData.sessionsApiPath
  });
  const sourceOperationsSuspended = renewalModel.sourceOperationsSuspended;
  const dialogs = proxySessionDialogs({
    abandon: dialogModels.abandon,
    renewal: renewalModel
  });
  const conversationLog = proxyRefs(useVibe64ConversationLog({
    active: computed(() => Boolean(selectedSessionId.value)),
    session: selectedSession
  }));
  const selection = proxyRefs({
    isClosed: selectedSessionClosed,
    selectedSession,
    selectedSessionDetailState: mounted.detailState,
    selectedSessionId,
    selectedSessionTitle,
    statusColor: vibe64SessionStatusColor,
    statusLabel: vibe64SessionStatusLabel
  });
  const autopilotSessionToolbar = proxyRefs({
    canCreateSession: props.sessionData.canCreateSession,
    createSession: props.sessionData.createSession,
    createSessionCommand: props.sessionData.createSessionCommand,
    createSessionRunning: props.sessionData.createSessionRunning,
    createSessionVisible: props.sessionData.createSessionVisible,
    createSessionTitle: props.sessionData.createSessionTitle,
    selectSession: props.sessionData.selectSessionId,
    sessions: computed(() => runtimeHostToolbarSessions({
      activeAgentThinking: activeAgentWorking.value,
      selectedSession: selectedSession.value,
      selectedSessionId: selectedSessionId.value,
      sessions: toolbarSessions.value
    })),
    shortSessionId: props.sessionData.shortSessionId
  });
  const pageError = computed(() => String(
    mounted.detailState.value?.error ||
    props.sessionData.sessionList?.loadError ||
    ""
  ));
  const guardedPage = computed(() => ({
    busy: Boolean(mounted.detailState.value?.loading || dialogModels.busy.value),
    copyText: async (value = "") => typeof navigator === "undefined"
      ? false
      : navigator.clipboard?.writeText?.(String(value || "")),
    error: pageError.value,
    launchBusy: Boolean(mounted.detailState.value?.loading)
  }));

  const interruptCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64SessionPath(
        readRefOrGetterValue(props.sessionData.sessionsApiPath),
        context?.sessionId,
        "/agent-turn/interrupt"
      )
    }),
    buildCommandPayload: (_payload, { context }) => agentTurnControlPayloadFromContext(context),
    fallbackRunError: "Assistant turn could not be interrupted.",
    messages: { error: "Assistant turn could not be interrupted." },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.agent-turn.interrupt",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const pendingMessageControllers = new Map();
  let messageRequestTail = Promise.resolve();

  async function interruptAgentTurn(input = "user_interrupt") {
    const sessionId = selectedSessionId.value;
    if (!sessionId) {
      return false;
    }
    const control = input && typeof input === "object" && !Array.isArray(input)
      ? input
      : { reason: String(input || "user_interrupt") };
    try {
      const result = await interruptCommand.run({ ...control, sessionId });
      await refreshSessionData().catch(() => null);
      return result?.ok !== false;
    } catch {
      await refreshSessionData().catch(() => null);
      return false;
    }
  }

  function sendAgentMessage(input = {}) {
    const sessionId = selectedSessionId.value;
    if (!sessionId) {
      return Promise.resolve(false);
    }
    const payload = input && typeof input === "object" && !Array.isArray(input)
      ? input
      : { message: String(input || "") };
    const body = agentTurnControlPayloadFromContext({ ...payload, sessionId });
    const messageId = String(body.messageId || "").trim();
    const controller = new AbortController();
    if (messageId) {
      pendingMessageControllers.set(messageId, controller);
    }
    const request = messageRequestTail.then(async () => {
      try {
        const signal = agentMessageAcceptanceSignal(controller);
        const result = await getHttpWebClient().request(
          vibe64SessionPath(
            readRefOrGetterValue(props.sessionData.sessionsApiPath),
            sessionId,
            "/agent-message"
          ),
          { body, method: "POST", signal }
        );
        if (result?.ok === false) {
          throw vibe64ApiError(result, "Message could not be sent.");
        }
        await refreshSessionData({ reason: "agent-message-accepted" }).catch(() => null);
        return true;
      } catch (error) {
        void refreshSessionData().catch(() => null);
        if (controller.signal.aborted) {
          return false;
        }
        throw error;
      } finally {
        if (messageId && pendingMessageControllers.get(messageId) === controller) {
          pendingMessageControllers.delete(messageId);
        }
      }
    });
    messageRequestTail = request.then(() => undefined, () => undefined);
    return request;
  }

  async function retryWorkspaceSetup() {
    const sessionId = selectedSessionId.value;
    if (!sessionId) {
      return false;
    }
    const result = await getHttpWebClient().request(
      vibe64SessionPath(
        readRefOrGetterValue(props.sessionData.sessionsApiPath),
        sessionId,
        "/workspace-setup/retry"
      ),
      {
        body: {},
        method: "POST"
      }
    );
    if (result?.ok === false) {
      throw new Error(result.error || "Workspace preparation could not be started.");
    }
    await refreshSessionData({ reason: "workspace-setup-retry" });
    return true;
  }

  async function saveSessionWork() {
    const sessionId = selectedSessionId.value;
    if (!sessionId) {
      return false;
    }
    const result = await getHttpWebClient().request(
      vibe64SessionPath(
        readRefOrGetterValue(props.sessionData.sessionsApiPath),
        sessionId,
        "/save"
      ),
      {
        body: vibe64RealtimeOriginPayload(),
        method: "POST"
      }
    );
    await Promise.allSettled([
      refreshSessionData({ reason: "session-work-save" }),
      refreshWorkState()
    ]);
    if (result?.ok === false && result?.code === "vibe64_session_save_update_required") {
      return result;
    }
    if (result?.ok === false) {
      throw vibe64ApiError(result, "Session work could not be saved.");
    }
    return result;
  }

  async function updateSessionWork() {
    const sessionId = selectedSessionId.value;
    if (!sessionId) {
      return false;
    }
    const result = await getHttpWebClient().request(
      vibe64SessionPath(
        readRefOrGetterValue(props.sessionData.sessionsApiPath),
        sessionId,
        "/updates/apply"
      ),
      {
        body: vibe64RealtimeOriginPayload(),
        method: "POST"
      }
    );
    await Promise.allSettled([
      refreshSessionData({ reason: "session-work-update" }),
      refreshWorkState()
    ]);
    if (result?.ok === false) {
      throw vibe64ApiError(result, "This session could not be updated.");
    }
    return result;
  }

  async function cancelAgentMessage(messageId = "") {
    const normalizedId = String(messageId || "").trim();
    const controller = pendingMessageControllers.get(normalizedId);
    if (!controller) {
      return false;
    }
    controller.abort();
    pendingMessageControllers.delete(normalizedId);
    return true;
  }

  function emitToolbarControls() {
    emit("toolbar-controls-ready", {
      controls: {
        abandon: dialogs.abandon
      },
      sessionId: selectedSessionId.value
    });
  }

  function emitBusy() {
    emit("busy-change", {
      agentThinking: activeAgentWorking.value,
      busy: guardedPage.value.busy,
      sessionId: selectedSessionId.value
    });
  }

  function emitProjectAttention() {
    emit("project-attention");
  }

  function emitChatAttention() {
    emit("chat-attention");
  }

  const agentTerminal = {
    sessionUpdate: () => refreshSessionData()
  };
  const selectedAgentTerminalId = computed(() => String(
    selectedSession.value?.agentSession?.terminal?.id ||
    selectedSession.value?.agentSession?.terminal?.terminalSessionId ||
    ""
  ));

  onMounted(() => {
    emitToolbarControls();
    emitBusy();
    emit("page-error-change", {
      error: pageError.value,
      sessionId: selectedSessionId.value
    });
    void refreshWorkState();
  });

  watch([activeAgentWorking, () => guardedPage.value.busy], emitBusy, { flush: "post" });
  watch(pageError, (error) => {
    emit("page-error-change", {
      error,
      sessionId: selectedSessionId.value
    });
  }, { flush: "post" });
  watch(workState, (state) => {
    emit("work-state-change", {
      sessionId: selectedSessionId.value,
      workState: { ...state }
    });
  }, { deep: true, flush: "post", immediate: true });
  watch(sourceOperationsSuspended, (suspended, wasSuspended) => {
    emit("source-operations-suspension-change", {
      sessionId: selectedSessionId.value,
      suspended: suspended === true
    });
    if (wasSuspended === true && suspended !== true) {
      void refreshWorkState();
    }
  }, {
    flush: "sync",
    immediate: true
  });
  watch(() => props.active, (active, previous) => {
    if (active && previous === false) {
      void mounted.reconcileMountedAgentSession("selected");
      void conversationLog.reload().catch(() => null);
    }
  });
  watch(() => {
    return `${selectedSessionId.value}:${selectedSessionClosed.value}:${runtimeHostWorkTaskRevision(selectedSession.value)}`;
  }, () => {
    void refreshWorkState();
  }, { flush: "post" });

  onBeforeUnmount(() => {
    workStateActive = false;
    workStateRefreshQueue.dispose();
    for (const controller of pendingMessageControllers.values()) {
      controller.abort();
    }
    pendingMessageControllers.clear();
  });

  return {
    agentConnectionStatus: mounted.agentConnectionStatus,
    agentTerminal,
    autopilotModeActive: computed(() => Boolean(props.active)),
    autopilotSessionToolbar,
    cancelAgentMessage,
    codexTerminalCanStart: computed(() => Boolean(
      props.active && selectedSession.value?.sessionId === selectedSessionId.value
    )),
    conversationLog,
    dialogs,
    emitChatAttention,
    emitProjectAttention,
    guardedPage,
    interruptAgentTurn,
    refreshSessionData,
    refreshWorkState,
    retryWorkspaceSetup,
    sessionRenewal: dialogs.renewal,
    saveSessionWork,
    selectedAgentTerminalId,
    selection,
    sendAgentMessage,
    setAutopilotBusy: () => null,
    updateSessionWork,
    workState
  };
}

export {
  agentMessageAcceptanceSignal,
  agentTurnControlPayloadFromContext,
  createVibe64SessionWorkRefreshQueue,
  focusRuntimeSessionChat,
  proxySessionDialogs,
  runtimeHostAgentWorking,
  runtimeHostToolbarSessions,
  runtimeHostWorkTaskRevision,
  useVibe64SessionRuntimeHost
};
