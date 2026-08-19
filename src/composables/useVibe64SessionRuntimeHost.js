import { computed, onBeforeUnmount, onMounted, proxyRefs, ref, unref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useVibe64ConversationLog } from "@/composables/useVibe64ConversationLog.js";
import { useVibe64MountedSessionData } from "@/composables/useVibe64MountedSessionData.js";
import { useVibe64SessionDialogs } from "@/composables/useVibe64SessionDialogs.js";
import { useVibe64SessionViewSync } from "@/composables/useVibe64SessionViewSync.js";
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
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";

const AGENT_MESSAGE_ACCEPT_TIMEOUT_MS = 10_000;

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

function agentMessageAcceptanceSignal(controller, { waitingForWorkspaceSetup = false } = {}) {
  if (waitingForWorkspaceSetup) {
    return controller.signal;
  }
  const timeout = AbortSignal.timeout(AGENT_MESSAGE_ACCEPT_TIMEOUT_MS);
  return typeof AbortSignal.any === "function"
    ? AbortSignal.any([controller.signal, timeout])
    : timeout;
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

  async function refreshWorkState() {
    const sessionId = selectedSessionId.value;
    if (!sessionId || selectedSessionClosed.value) {
      workState.value = {
        checkedAt: new Date().toISOString(),
        error: "",
        loading: false,
        operation: null,
        unsaved: null
      };
      return workState.value;
    }
    workState.value = {
      ...workState.value,
      loading: true
    };
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
      workState.value = {
        ...result,
        checkedAt: new Date().toISOString(),
        error: "",
        loading: false
      };
    } catch (error) {
      workState.value = {
        checkedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error || "Session work could not be inspected."),
        loading: false,
        operation: null,
        unsaved: null
      };
    }
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

  useVibe64SessionViewSync({
    enabled: computed(() => Boolean(props.active && selectedSessionId.value)),
    sessionId: selectedSessionId,
    sessionsApiPath: props.sessionData.sessionsApiPath,
    viewState: computed(() => selectedSession.value?.uiSync?.viewState || null)
  });

  const dialogModels = useVibe64SessionDialogs({
    clearSelectedSession: props.sessionData.clearSelectedSession,
    isSelectedSessionClosed: selectedSessionClosed,
    refreshSessionData,
    selectedSessionId,
    selectedSessionTitle,
    sessionsApiPath: props.sessionData.sessionsApiPath
  });
  const dialogs = proxySessionDialogs({
    abandon: dialogModels.abandon
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
        const waitingForWorkspaceSetup = selectedSession.value?.workspaceSetup?.status === "running";
        const signal = agentMessageAcceptanceSignal(controller, {
          waitingForWorkspaceSetup
        });
        const result = await getHttpWebClient().request(
          vibe64SessionPath(
            readRefOrGetterValue(props.sessionData.sessionsApiPath),
            sessionId,
            "/agent-message"
          ),
          { body, method: "POST", signal }
        );
        void refreshSessionData().catch(() => null);
        if (result?.ok === false) {
          throw new Error(vibe64ApiResponseError(result, "Message could not be sent."));
        }
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
    if (result?.ok === false) {
      throw new Error(vibe64ApiResponseError(result, "Session work could not be saved."));
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
      throw new Error(vibe64ApiResponseError(result, "This session could not be updated."));
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
  watch(() => props.active, (active, previous) => {
    if (active && previous === false) {
      void mounted.reconcileMountedAgentSession("selected");
      void conversationLog.reload().catch(() => null);
    }
  });
  watch(() => {
    const task = (Array.isArray(selectedSession.value?.backgroundTasks)
      ? selectedSession.value.backgroundTasks
      : []).find((entry) => ["codex_turn_checkpoint", "save-work", "update-session"].includes(entry?.id));
    return `${selectedSessionId.value}:${task?.updatedAt || ""}`;
  }, () => {
    void refreshWorkState();
  }, { flush: "post" });

  onBeforeUnmount(() => {
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
    emitProjectAttention,
    guardedPage,
    interruptAgentTurn,
    refreshSessionData,
    refreshWorkState,
    retryWorkspaceSetup,
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
  proxySessionDialogs,
  runtimeHostAgentWorking,
  runtimeHostToolbarSessions,
  useVibe64SessionRuntimeHost
};
