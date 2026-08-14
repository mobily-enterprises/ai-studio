import { computed, onScopeDispose, proxyRefs, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  useVibe64SessionSelection
} from "@/composables/useVibe64SessionSelection.js";
import {
  VIBE64_CURRENT_SESSION_API_SUFFIX,
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionsQueryKey
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  createVibe64CurrentSessionPublisher
} from "@/lib/vibe64CurrentSessionPublisher.js";
import {
  vibe64SessionLimits,
  enrichVibe64SessionForDisplay,
  shortVibe64SessionId as shortSessionId,
  visibleVibe64Sessions
} from "@/lib/vibe64SessionPanelModel.js";
import {
  vibe64SessionDisplayTitle,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel,
  isClosedVibe64Session
} from "@/lib/vibe64SessionViewModel.js";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@/lib/vibe64SessionDebugLog.js";
import {
  vibe64RealtimeOriginPayload
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  vibe64SessionListRefreshRequested
} from "@/lib/vibe64SessionClientRefresh.js";

const SESSION_LIST_IGNORED_REALTIME_REASONS = new Set([
  "assistant-response-bundle",
  "codex-app-server-ready",
  "codex-app-server-agent-result",
  "codex-app-server-agent-result-invalid",
  "codex-app-server-agent-result-missing",
  "codex-app-server-agent-result-provider-failed",
  "codex-app-server-blocked",
  "codex-app-server-commentary",
  "codex-app-server-failed",
  "codex-app-server-final-assistant-message",
  "codex-app-server-live-progress",
  "codex-app-server-prompt-injected",
  "codex-app-server-reasoning-summary",
  "codex-app-server-running",
  "codex-app-server-terminal-assistant-message",
  "codex-app-server-terminal-thinking-message",
  "codex-app-server-terminal-user-message",
  "codex-app-server-turn-active",
  "codex-app-server-turn-claimed",
  "codex-app-server-turn-finalizing",
  "codex-app-server-turn-idle",
  "codex-app-server-turn-state",
  "codex-app-server-message-delivered",
  "codex-prompt-injected",
  "codex-context-replaced",
  "agent-terminal-started",
  "agent-terminal-closed",
  "launch-target-started",
  "launch-target-ready",
  "launch-target-closed",
  "launch-target-stopped"
]);
function sessionIdExistsInList(sessionId = "", nextSessions = []) {
  const normalizedSessionId = String(sessionId || "").trim();
  return Boolean(normalizedSessionId) && nextSessions.some((session) => session.sessionId === normalizedSessionId);
}

function shouldPreserveSelectedSessionDuringRefresh({
  createSessionRunning = false,
  currentSessionId = "",
  nextSessions = [],
  selectedSessionLoading = false,
  sessionListLoading = false
} = {}) {
  const normalizedSessionId = String(currentSessionId || "").trim();
  if (!normalizedSessionId || sessionIdExistsInList(normalizedSessionId, nextSessions)) {
    return false;
  }
  return Boolean(
    sessionListLoading ||
    createSessionRunning ||
    selectedSessionLoading
  );
}

function selectedSessionIdForCurrentAlias({
  createSessionRunning = false,
  selectedSessionId = "",
  selectedSessionLoading = false,
  sessionListLoaded = true,
  sessionListLoadError = "",
  sessionListLoading = false,
  sessions = []
} = {}) {
  if (
    !sessionListLoaded ||
    sessionListLoading ||
    String(sessionListLoadError || "").trim()
  ) {
    return null;
  }
  const normalizedSessionId = String(selectedSessionId || "").trim();
  if (sessionIdExistsInList(normalizedSessionId, sessions)) {
    return normalizedSessionId;
  }
  if (sessions.length > 0 || createSessionRunning || selectedSessionLoading) {
    return null;
  }
  return "";
}

function sessionChangedReason(payload = {}) {
  return String(payload?.reason || "").trim();
}

function sessionListRealtimeShouldRefresh({ payload = {} } = {}) {
  if (vibe64SessionListRefreshRequested(payload)) {
    return true;
  }
  const reason = sessionChangedReason(payload);
  return !reason || !SESSION_LIST_IGNORED_REALTIME_REASONS.has(reason);
}

function refetchEndpointResource(resource) {
  if (typeof resource?.query?.refetch === "function") {
    return resource.query.refetch({
      cancelRefetch: false
    });
  }
  return resource?.reload?.();
}

function useVibe64SessionData({
  onTitleChange = null
} = {}) {
  const notifyTitleChange = typeof onTitleChange === "function" ? onTitleChange : () => null;
  const projectSlug = useVibe64ProjectSlug();
  const paths = usePaths();
  const sessionSelection = useVibe64SessionSelection({
    projectSlug
  });

  const selectedSessionId = sessionSelection.selectedId;
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const currentSessionApiPath = computed(() => paths.api(VIBE64_CURRENT_SESSION_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const sessionListResource = useEndpointResource({
    fallbackLoadError: "Vibe64 sessions could not be loaded.",
    path: sessionsApiPath,
    queryKey: computed(() => vibe64SessionsQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value
    )),
    readQuery: {
      limit: 20
    },
    queryOptions: {
      refetchOnMount: false,
      refetchOnWindowFocus: false
    },
    requestRecoveryLabel: "Vibe64 sessions",
    realtime: {
      event: VIBE64_SESSION_CHANGED_EVENT,
      matches: sessionListRealtimeShouldRefresh
    }
  });
  const sessionList = proxyRefs({
    items: computed(() => {
      const payload = sessionListResource.data.value || {};
      return Array.isArray(payload.sessions) ? payload.sessions : [];
    }),
    loadError: sessionListResource.loadError,
    isInitialLoading: sessionListResource.isInitialLoading,
    isLoading: sessionListResource.isLoading,
    pages: computed(() => {
      const payload = sessionListResource.data.value;
      return payload && typeof payload === "object" && !Array.isArray(payload) ? [payload] : [];
    }),
    reload: sessionListResource.reload,
    resource: sessionListResource
  });
  const createSessionCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildRawPayload: () => vibe64RealtimeOriginPayload(),
    fallbackRunError: "Vibe64 session could not be created.",
    messages: {
      error: "Vibe64 session could not be created.",
      success: "Vibe64 session created."
    },
    onRunSuccess: (response) => {
      if (response?.sessionId) {
        selectSessionId(response.sessionId);
      }
      refreshSessionDataInBackground({
        includeList: true,
        reason: "create-session"
      });
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.create",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });
  const updateCurrentSessionCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_CURRENT_SESSION_API_SUFFIX,
    buildCommandOptions: (_model, { context }) => ({
      method: "PUT",
      path: String(context?.apiPath || "")
    }),
    buildRawPayload: (_model, { context }) => ({
      sessionId: String(context?.sessionId || "").trim()
    }),
    fallbackRunError: "The current session shortcut could not be updated.",
    messages: {
      error: "The current session shortcut could not be updated."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.current.update",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "PUT"
  });
  const currentSessionPublisher = createVibe64CurrentSessionPublisher({
    async publish({ apiPath, sessionId }) {
      const response = await updateCurrentSessionCommand.run({
        apiPath,
        sessionId
      });
      if (!response || response.ok === false) {
        throw new Error(
          String(response?.error || "The current session shortcut could not be updated.")
        );
      }
    },
    onError(error, publication) {
      vibe64SessionDebugLog("client.sessionData.currentSession.error", {
        error: vibe64SessionDebugError(error),
        sessionId: publication.sessionId
      });
    }
  });
  onScopeDispose(() => {
    currentSessionPublisher.stop();
  });
  const sessions = computed(() => visibleVibe64Sessions(sessionList.items || []));
  const creationOptions = computed(() => sessionList.pages?.[0]?.creation || {});
  const selectedListSession = computed(() => {
    return sessions.value.find((session) => session.sessionId === selectedSessionId.value) || null;
  });
  const selectedSession = computed(() => enrichVibe64SessionForDisplay(selectedListSession.value));
  const isSelectedSessionClosed = computed(() => isClosedVibe64Session(selectedSession.value || {}));
  const pageLoading = computed(() => Boolean(sessionList.isLoading));
  const limits = computed(() => vibe64SessionLimits({
    payloadLimits: sessionList.pages?.[0]?.limits || {},
    sessions: sessions.value
  }));
  const canCreateSession = computed(() => {
    if (typeof creationOptions.value.canCreate === "boolean") {
      return creationOptions.value.canCreate;
    }
    return limits.value.openSessionCount < limits.value.maxOpenSessions;
  });
  const createSessionTitle = computed(() => {
    if (creationOptions.value.disabledReason) {
      return String(creationOptions.value.disabledReason);
    }
    if (limits.value.openSessionCount >= limits.value.maxOpenSessions) {
      return `Studio allows up to ${limits.value.maxOpenSessions} active sessions.`;
    }
    return "Create a new Vibe64 session";
  });
  const selectedSessionTitle = computed(() => {
    return vibe64SessionDisplayTitle(selectedSession.value || {}) ||
      `Session ${shortSessionId(selectedSessionId.value)}`;
  });

  async function refreshSessionList() {
    return refetchEndpointResource(sessionListResource);
  }

  let refreshSessionDataInFlight = null;

  async function refreshSessionData(options = {}) {
    const reason = typeof options === "string" ? options : String(options?.reason || "");
    if (refreshSessionDataInFlight) {
      vibe64SessionDebugLog("client.sessionData.refresh.join", {
        reason,
        selectedSessionId: String(selectedSessionId.value || "")
      });
      return refreshSessionDataInFlight;
    }
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("client.sessionData.refresh.start", {
      reason,
      selectedSessionId: String(selectedSessionId.value || "")
    });
    refreshSessionDataInFlight = refreshSessionList();
    try {
      const result = await refreshSessionDataInFlight;
      vibe64SessionDebugLog("client.sessionData.refresh.done", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        reason,
        selectedSessionId: String(selectedSessionId.value || ""),
        sessionCount: sessions.value.length
      });
      return result;
    } catch (error) {
      vibe64SessionDebugLog("client.sessionData.refresh.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        reason,
        selectedSessionId: String(selectedSessionId.value || "")
      });
      throw error;
    } finally {
      refreshSessionDataInFlight = null;
    }
  }

  function refreshSessionDataInBackground(options = {}) {
    void refreshSessionData(options).catch(() => {
      // The endpoint resource and refresh debug event retain the failure for the UI and diagnostics.
    });
  }

  function selectSessionId(sessionId = "") {
    vibe64SessionDebugLog("client.sessionData.selectSession", {
      fromSessionId: String(selectedSessionId.value || ""),
      toSessionId: String(sessionId || "")
    });
    sessionSelection.select(sessionId);
  }

  function clearSelectedSession() {
    sessionSelection.clear();
  }

  async function createSession() {
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("client.sessionData.createSession.start");
    try {
      const response = await createSessionCommand.run();
      vibe64SessionDebugLog("client.sessionData.createSession.done", {
        ...vibe64SessionDebugSummary(response || {}),
        code: String(response?.code || response?.errors?.[0]?.code || ""),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        ok: response?.ok !== false
      });
      return response;
    } catch (error) {
      vibe64SessionDebugLog("client.sessionData.createSession.error", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error)
      });
      throw error;
    }
  }

  const selectionReconciliationState = computed(() => {
    const nextSessions = sessions.value;
    return {
      createSessionRunning: createSessionCommand.isRunning,
      currentSessionApiPath: currentSessionApiPath.value,
      nextSessions,
      selectedSessionId: String(selectedSessionId.value || ""),
      sessionIds: nextSessions.map((session) => session.sessionId).join("|"),
      sessionListInitialLoading: sessionList.isInitialLoading,
      sessionListLoaded: sessionList.pages.length > 0,
      sessionListLoadError: String(sessionList.loadError || ""),
      sessionListLoading: sessionList.isLoading
    };
  });

  watch(selectionReconciliationState, (state) => {
    const nextSessions = state.nextSessions;
    vibe64SessionDebugLog("client.sessionData.sessions.changed", {
      selectedSessionId: String(selectedSessionId.value || ""),
      sessionCount: nextSessions.length
    });
    if (
      state.sessionListInitialLoading ||
      state.sessionListLoadError ||
      shouldPreserveSelectedSessionDuringRefresh({
        createSessionRunning: state.createSessionRunning,
        currentSessionId: state.selectedSessionId,
        nextSessions,
        sessionListLoading: state.sessionListLoading
      })
    ) {
      return;
    }
    sessionSelection.selectAvailableId(nextSessions, {
      fallbackId: nextSessions.at(-1)?.sessionId || "",
      getId: (session) => session.sessionId
    });
  }, {
    immediate: true
  });

  watch(selectionReconciliationState, (state) => {
    const publicationSessionId = selectedSessionIdForCurrentAlias({
      createSessionRunning: state.createSessionRunning,
      selectedSessionId: state.selectedSessionId,
      sessionListLoaded: state.sessionListLoaded,
      sessionListLoadError: state.sessionListLoadError,
      sessionListLoading: state.sessionListLoading,
      sessions: state.nextSessions
    });
    if (publicationSessionId === null || !state.currentSessionApiPath) {
      return;
    }
    void currentSessionPublisher.request({
      apiPath: state.currentSessionApiPath,
      sessionId: publicationSessionId
    });
  }, {
    flush: "post",
    immediate: true
  });

  watch(selectedSessionTitle, (title) => {
    notifyTitleChange(title || "");
  }, {
    immediate: true
  });

  return {
    canCreateSession,
    clearSelectedSession,
    createSession,
    createSessionCommand,
    createSessionTitle,
    isSelectedSessionClosed,
    pageLoading,
    refreshSessionData,
    selectSessionId,
    selectedSession,
    selectedSessionId,
    selectedSessionTitle,
    sessionList,
    sessions,
    sessionsApiPath,
    shortSessionId,
    statusColor: vibe64SessionStatusColor,
    statusLabel: vibe64SessionStatusLabel,
    updateCurrentSessionCommand
  };
}

export {
  sessionListRealtimeShouldRefresh,
  selectedSessionIdForCurrentAlias,
  sessionIdExistsInList,
  shouldPreserveSelectedSessionDuringRefresh,
  useVibe64SessionData
};
