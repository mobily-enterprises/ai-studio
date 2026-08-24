import { computed, onScopeDispose, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  vibe64SessionCheckUpdatesPath,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  DEFAULT_VISIBLE_SESSION_LIMIT,
  visibleVibe64ToolbarSessions
} from "@/lib/vibe64SessionToolbarVisibility.js";
import {
  repositoryStatusRealtimeNeedsCanonicalCheck,
  repositoryStatusRealtimeShouldRefresh,
  repositoryStatusSessionId
} from "@/lib/vibe64RepositoryRealtime.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_STALE_AFTER_MS = 60_000;
const DEFAULT_STALE_CHECK_INTERVAL_MS = 15_000;
const DEFAULT_CANONICAL_CHECK_INTERVAL_MS = 30_000;
function createVibe64SessionRepositoryStatusQueue({
  maxConcurrency = DEFAULT_MAX_CONCURRENCY,
  now = () => Date.now(),
  onState = () => null,
  requestWork,
  staleAfterMs = DEFAULT_STALE_AFTER_MS
} = {}) {
  if (typeof requestWork !== "function") {
    throw new TypeError("Session repository status requires a work inspector.");
  }
  const concurrency = Math.max(1, Number(maxConcurrency || 0));
  const records = new Map();
  const pending = new Map();
  const activeSessions = new Set();
  const canonicalUpdatePending = new Set();
  const refreshAfterActive = new Set();
  const waiters = new Set();
  let active = 0;
  let disposed = false;

  function settled() {
    if (active || pending.size) {
      return;
    }
    for (const resolve of waiters) {
      resolve();
    }
    waiters.clear();
  }

  function observe(sessionId = "", workState = null) {
    const id = String(sessionId || "").trim();
    if (!id) {
      return;
    }
    const state = workState && typeof workState === "object" ? { ...workState } : {};
    const checkedAt = String(state.checkedAt || "").trim();
    records.set(id, {
      checkedAtMs: checkedAt ? Date.parse(checkedAt) || now() : now(),
      workState: state
    });
  }

  function emit(sessionId, workState) {
    const state = canonicalUpdatePending.has(sessionId)
      ? {
          ...workState,
          updateAvailable: true,
          updateStatusPending: true
        }
      : workState;
    observe(sessionId, state);
    onState({ sessionId, workState: state });
  }

  function markUpdatePending(sessionId = "") {
    const id = String(sessionId || "").trim();
    if (!id) {
      return;
    }
    const prior = records.get(id)?.workState || {};
    canonicalUpdatePending.add(id);
    emit(id, {
      ...prior,
      checkedAt: "",
      error: "",
      loading: false,
      updateAvailable: true,
      updateStatusPending: true
    });
  }

  function clearUpdatePending(sessionId = "") {
    canonicalUpdatePending.delete(String(sessionId || "").trim());
  }

  function markCanonicalCheckUnavailable(sessionId = "", error = "") {
    const id = String(sessionId || "").trim();
    if (!id) {
      return;
    }
    const prior = records.get(id)?.workState || {};
    emit(id, {
      ...prior,
      checkedAt: new Date(now()).toISOString(),
      error: String(error || "Repository update status is unavailable."),
      loading: false
    });
  }

  function fresh(sessionId) {
    const checkedAtMs = records.get(sessionId)?.checkedAtMs || 0;
    return checkedAtMs > 0 && now() - checkedAtMs < staleAfterMs;
  }

  async function inspect(sessionId) {
    active += 1;
    activeSessions.add(sessionId);
    const prior = records.get(sessionId)?.workState || null;
    if (!prior) {
      emit(sessionId, {
        checkedAt: "",
        error: "",
        loading: true,
        operation: null,
        unsaved: null
      });
    }
    try {
      const result = await requestWork(sessionId);
      if (disposed) {
        return;
      }
      if (result?.ok === false) {
        throw new Error(String(result?.message || result?.error || "Session work could not be inspected."));
      }
      emit(sessionId, {
        ...result,
        checkedAt: new Date(now()).toISOString(),
        error: "",
        loading: false
      });
    } catch (error) {
      if (disposed) {
        return;
      }
      emit(sessionId, {
        checkedAt: new Date(now()).toISOString(),
        error: error instanceof Error ? error.message : String(error || "Session work could not be inspected."),
        loading: false,
        operation: null,
        unsaved: null
      });
    } finally {
      active -= 1;
      activeSessions.delete(sessionId);
      if (refreshAfterActive.delete(sessionId) && !disposed) {
        pending.set(sessionId, true);
      }
      drain();
      settled();
    }
  }

  function drain() {
    if (disposed) {
      pending.clear();
      settled();
      return;
    }
    while (active < concurrency && pending.size) {
      const [sessionId] = pending.entries().next().value;
      pending.delete(sessionId);
      void inspect(sessionId);
    }
  }

  function enqueue(sessionIds = [], { force = false } = {}) {
    for (const rawSessionId of sessionIds) {
      const sessionId = String(rawSessionId || "").trim();
      if (!sessionId || pending.has(sessionId) || (!force && fresh(sessionId))) {
        continue;
      }
      if (activeSessions.has(sessionId)) {
        if (force) {
          refreshAfterActive.add(sessionId);
        }
        continue;
      }
      pending.set(sessionId, true);
    }
    drain();
  }

  function removeExcept(sessionIds = []) {
    const retained = new Set(sessionIds.map((sessionId) => String(sessionId || "").trim()).filter(Boolean));
    for (const sessionId of records.keys()) {
      if (!retained.has(sessionId)) {
        records.delete(sessionId);
        pending.delete(sessionId);
        refreshAfterActive.delete(sessionId);
        canonicalUpdatePending.delete(sessionId);
      }
    }
  }

  function dispose() {
    disposed = true;
    pending.clear();
    refreshAfterActive.clear();
    canonicalUpdatePending.clear();
    settled();
  }

  function waitForIdle() {
    if (!active && !pending.size) {
      return Promise.resolve();
    }
    return new Promise((resolve) => waiters.add(resolve));
  }

  return {
    dispose,
    clearUpdatePending,
    enqueue,
    markCanonicalCheckUnavailable,
    markUpdatePending,
    observe,
    removeExcept,
    waitForIdle
  };
}

function useVibe64SessionRepositoryStatusRegistry({
  maxVisibleSessions = DEFAULT_VISIBLE_SESSION_LIMIT,
  onState = () => null,
  selectedSessionId,
  sessionSourceOperationsSuspended = () => false,
  sessions,
  sessionsApiPath
} = {}) {
  const visibleSessions = computed(() => visibleVibe64ToolbarSessions({
    limit: maxVisibleSessions,
    selectedSessionId: readRefOrGetterValue(selectedSessionId),
    sessions: readRefOrGetterValue(sessions) || []
  }));
  const visibleSessionIds = computed(() => visibleSessions.value
    .map((session) => String(session?.sessionId || "").trim())
    .filter(Boolean));
  const selectedId = computed(() => String(readRefOrGetterValue(selectedSessionId) || "").trim());
  const apiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || "").trim());
  const suspendedVisibleSessionIds = computed(() => visibleSessionIds.value.filter((sessionId) => (
    sessionSourceOperationsSuspended(sessionId) === true
  )));
  const canonicalChecks = new Map();
  const canonicalAccessRevisions = new Map();
  const forcedCanonicalFollowups = new Set();
  let disposed = false;

  function sourceOperationsSuspended(sessionId = "") {
    const id = String(sessionId || "").trim();
    return Boolean(id && sessionSourceOperationsSuspended(id) === true);
  }

  function canonicalAccessRevision(sessionId = "") {
    return Number(canonicalAccessRevisions.get(sessionId) || 0);
  }

  function advanceCanonicalAccessRevision(sessionId = "") {
    const id = String(sessionId || "").trim();
    if (!id) {
      return 0;
    }
    const revision = canonicalAccessRevision(id) + 1;
    canonicalAccessRevisions.set(id, revision);
    return revision;
  }
  const queue = createVibe64SessionRepositoryStatusQueue({
    onState,
    async requestWork(sessionId) {
      return getHttpWebClient().request(vibe64SessionPath(
        apiPath.value,
        sessionId,
        "/work"
      ), { method: "GET" });
    }
  });

  function inspectVisible({ force = false, includeSelected = false, sessionId = "" } = {}) {
    if (!apiPath.value) {
      return;
    }
    const requestedId = String(sessionId || "").trim();
    const ids = visibleSessionIds.value.filter((id) => (
      !sourceOperationsSuspended(id) &&
      (includeSelected || id !== selectedId.value) && (!requestedId || id === requestedId)
    ));
    queue.enqueue(ids, { force });
  }

  async function checkCanonical(sessionId = "", { force = false } = {}) {
    const id = String(sessionId || "").trim();
    if (disposed || !id || !apiPath.value || sourceOperationsSuspended(id)) {
      return null;
    }
    const accessRevision = canonicalAccessRevision(id);
    if (canonicalChecks.has(id)) {
      const active = canonicalChecks.get(id);
      if (active.accessRevision === accessRevision) {
        if (force && active.force !== true) {
          forcedCanonicalFollowups.add(id);
        }
        return active.promise;
      }
    }
    let request;
    const requestIsCurrent = () => Boolean(
      !disposed &&
      !sourceOperationsSuspended(id) &&
      canonicalAccessRevision(id) === accessRevision &&
      canonicalChecks.get(id)?.promise === request
    );
    request = getHttpWebClient().request(vibe64SessionCheckUpdatesPath(
      apiPath.value,
      id
    ), {
      body: { force },
      method: "POST"
    }).then((result) => {
      if (!requestIsCurrent()) {
        return null;
      }
      if (result?.ok === false) {
        throw new Error(String(
          result?.message || result?.error || "Repository update status is unavailable."
        ));
      }
      queue.clearUpdatePending(id);
      inspectVisible({ force: true, includeSelected: true, sessionId: id });
      return result;
    }).catch((error) => {
      if (requestIsCurrent()) {
        queue.markCanonicalCheckUnavailable(id, error instanceof Error
          ? error.message
          : String(error || "Repository update status is unavailable."));
      }
      return null;
    }).finally(() => {
      if (canonicalChecks.get(id)?.promise !== request) {
        return;
      }
      canonicalChecks.delete(id);
      if (
        !disposed &&
        !sourceOperationsSuspended(id) &&
        forcedCanonicalFollowups.delete(id)
      ) {
        void checkCanonical(id, { force: true });
      }
    });
    canonicalChecks.set(id, { accessRevision, force, promise: request });
    return request;
  }

  watch(() => [apiPath.value, selectedId.value, ...visibleSessionIds.value], () => {
    queue.removeExcept(visibleSessionIds.value);
    inspectVisible();
    void checkCanonical(selectedId.value);
  }, { immediate: true });

  let priorSuspendedSessionIds = new Set();
  watch(suspendedVisibleSessionIds, (sessionIds) => {
    const nextSuspendedSessionIds = new Set(sessionIds);
    for (const sessionId of new Set([
      ...priorSuspendedSessionIds,
      ...nextSuspendedSessionIds
    ])) {
      const wasSuspended = priorSuspendedSessionIds.has(sessionId);
      const suspended = nextSuspendedSessionIds.has(sessionId);
      if (wasSuspended === suspended) {
        continue;
      }
      advanceCanonicalAccessRevision(sessionId);
      forcedCanonicalFollowups.delete(sessionId);
      if (!suspended && visibleSessionIds.value.includes(sessionId)) {
        void checkCanonical(sessionId, { force: true });
      }
    }
    priorSuspendedSessionIds = nextSuspendedSessionIds;
  }, {
    flush: "sync",
    immediate: true
  });

  useRealtimeEvent({
    enabled: computed(() => visibleSessionIds.value.length > 0),
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => Boolean(
      visibleSessionIds.value.includes(repositoryStatusSessionId(payload)) &&
      !sourceOperationsSuspended(repositoryStatusSessionId(payload)) &&
      repositoryStatusRealtimeShouldRefresh(payload)
    ),
    onEvent: ({ payload = {} } = {}) => {
      const sessionId = repositoryStatusSessionId(payload);
      if (sourceOperationsSuspended(sessionId)) {
        return;
      }
      inspectVisible({
        force: true,
        includeSelected: true,
        sessionId
      });
      if (repositoryStatusRealtimeNeedsCanonicalCheck(payload)) {
        queue.markUpdatePending(sessionId);
        void checkCanonical(sessionId, { force: true });
      }
    }
  });

  useRealtimeEvent({
    enabled: computed(() => visibleSessionIds.value.length > 0),
    event: VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => visibleSessionIds.value.includes(
      repositoryStatusSessionId(payload)
    ) && !sourceOperationsSuspended(repositoryStatusSessionId(payload)),
    onEvent: ({ payload = {} } = {}) => inspectVisible({
      force: true,
      includeSelected: true,
      sessionId: repositoryStatusSessionId(payload)
    })
  });

  const interval = typeof window === "undefined"
    ? null
    : window.setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          return;
        }
        inspectVisible();
      }, DEFAULT_STALE_CHECK_INTERVAL_MS);
  const canonicalInterval = typeof window === "undefined"
    ? null
    : window.setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState === "hidden") {
          return;
        }
        void checkCanonical(selectedId.value);
      }, DEFAULT_CANONICAL_CHECK_INTERVAL_MS);

  onScopeDispose(() => {
    disposed = true;
    if (interval !== null) {
      window.clearInterval(interval);
    }
    if (canonicalInterval !== null) {
      window.clearInterval(canonicalInterval);
    }
    canonicalChecks.clear();
    canonicalAccessRevisions.clear();
    forcedCanonicalFollowups.clear();
    queue.dispose();
  });

  return {
    inspectVisible,
    observe: queue.observe,
    visibleSessionIds
  };
}

export {
  createVibe64SessionRepositoryStatusQueue,
  useVibe64SessionRepositoryStatusRegistry
};
