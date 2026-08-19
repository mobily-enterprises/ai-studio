import { computed, onScopeDispose, reactive, ref, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import {
  vibe64RepositoryHistoryPath,
  vibe64RepositoryVersionDiffPath,
  vibe64RepositoryVersionFilesPath,
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  vibe64SessionChangeDiffPath,
  vibe64SessionCheckUpdatesPath,
  vibe64SessionChangesPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  repositoryStatusRealtimeNeedsCanonicalCheck,
  repositoryStatusRealtimeShouldRefresh,
  repositoryStatusSessionId
} from "@/lib/vibe64RepositoryRealtime.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

function message(error, fallback) {
  return error instanceof Error ? error.message : String(error || fallback);
}

async function requestJson(path, options = {}) {
  if (!path) {
    throw new Error("Repository information is not available yet.");
  }
  const result = await getHttpWebClient().request(path, {
    method: "GET",
    ...options
  });
  if (result?.ok === false) {
    const error = new Error(vibe64ApiResponseError(result, "Repository information could not be loaded."));
    error.code = String(result.code || result.errors?.[0]?.code || "").trim();
    error.response = result;
    throw error;
  }
  return result;
}

function useVibe64RepositoryWorkspace(dashboardContext, { view = "changes" } = {}) {
  const selectedCurrentPath = ref("");
  const selectedVersion = ref(null);
  const selectedVersionPath = ref("");
  const changes = reactive({ error: "", loading: false, loadingMore: false, payload: null });
  const currentDiff = reactive({ error: "", loading: false, payload: null });
  const history = reactive({
    error: "",
    loading: false,
    nextCursor: "",
    payload: null,
    versions: []
  });
  const versionFiles = reactive({ error: "", loading: false, loadingMore: false, payload: null });
  const versionDiff = reactive({ error: "", loading: false, payload: null });
  const updates = reactive({
    applying: false,
    canonicalChangePending: false,
    checking: false,
    error: "",
    errorCode: "",
    payload: null
  });
  const saving = ref(false);
  const requestRevisions = Object.create(null);
  const updateChecks = new Map();
  const forcedUpdateFollowups = new Set();
  let disposed = false;

  const context = computed(() => dashboardContext.value || {});
  const activeView = computed(() => String(readRefOrGetterValue(view) || "changes") === "history"
    ? "history"
    : "changes");
  const sessionId = computed(() => String(context.value.sessionId || context.value.session?.sessionId || "").trim());
  const sessionsApiPath = computed(() => String(
    readRefOrGetterValue(context.value.sessionsApiPath) || ""
  ).trim());

  function requestContextKey() {
    return `${sessionsApiPath.value}\0${sessionId.value}`;
  }

  function beginRequest(name) {
    const revision = Number(requestRevisions[name] || 0) + 1;
    requestRevisions[name] = revision;
    return {
      contextKey: requestContextKey(),
      name,
      revision
    };
  }

  function requestIsCurrent(request) {
    return !disposed && request?.contextKey === requestContextKey() &&
      requestRevisions[request.name] === request.revision;
  }

  function invalidateRequests() {
    for (const name of [
      "applyUpdates",
      "changes",
      "currentDiff",
      "history",
      "updates",
      "versionDiff",
      "versionFiles"
    ]) {
      requestRevisions[name] = Number(requestRevisions[name] || 0) + 1;
    }
  }

  function updateCheckIsNewer(candidate = {}, current = {}) {
    const candidateCheck = candidate && typeof candidate === "object" ? candidate : {};
    const currentCheck = current && typeof current === "object" ? current : {};
    const candidateTime = Date.parse(String(candidateCheck.checkedAt || ""));
    const currentTime = Date.parse(String(currentCheck.checkedAt || ""));
    if (!Number.isFinite(candidateTime)) {
      return !currentCheck.checkedAt;
    }
    return !Number.isFinite(currentTime) || candidateTime >= currentTime;
  }

  async function selectCurrentFile(file) {
    const path = String(file?.path || "").trim();
    selectedCurrentPath.value = path;
    currentDiff.error = "";
    currentDiff.payload = null;
    if (!path || !sessionId.value) {
      return;
    }
    const request = beginRequest("currentDiff");
    currentDiff.loading = true;
    try {
      const result = await requestJson(vibe64SessionChangeDiffPath(
        sessionsApiPath.value,
        sessionId.value,
        path
      ));
      if (requestIsCurrent(request) && selectedCurrentPath.value === path) {
        currentDiff.payload = result;
      }
    } catch (error) {
      if (requestIsCurrent(request)) {
        currentDiff.error = message(error, "This file difference could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        currentDiff.loading = false;
      }
    }
  }

  async function loadChanges({ append = false } = {}) {
    changes.error = "";
    if (!append) {
      changes.payload = null;
      selectedCurrentPath.value = "";
      currentDiff.payload = null;
    }
    if (!sessionId.value) {
      return;
    }
    const request = beginRequest("changes");
    changes.loading = !append;
    changes.loadingMore = append;
    try {
      const previousFiles = append ? changes.payload?.files || [] : [];
      const result = await requestJson(vibe64SessionChangesPath(
        sessionsApiPath.value,
        sessionId.value,
        { offset: previousFiles.length }
      ));
      if (!requestIsCurrent(request)) {
        return;
      }
      changes.payload = append
        ? { ...result, files: [...previousFiles, ...(result.files || [])] }
        : result;
      if (!append && typeof context.value.refreshSessionWork === "function") {
        await context.value.refreshSessionWork();
      }
      const first = !append ? changes.payload?.files?.[0] : null;
      if (first) {
        await selectCurrentFile(first);
      }
    } catch (error) {
      if (requestIsCurrent(request)) {
        changes.error = message(error, "Current changes could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        changes.loading = false;
        changes.loadingMore = false;
      }
    }
  }

  async function selectVersion(version) {
    selectedVersion.value = version || null;
    selectedVersionPath.value = "";
    versionFiles.error = "";
    versionFiles.payload = null;
    versionDiff.payload = null;
    if (!version?.commit || !history.payload?.historySnapshotCommit) {
      return;
    }
    const request = beginRequest("versionFiles");
    versionFiles.loading = true;
    try {
      const result = await requestJson(vibe64RepositoryVersionFilesPath(
        sessionsApiPath.value,
        version.commit,
        {
          historySnapshotCommit: history.payload.historySnapshotCommit,
          sessionId: sessionId.value
        }
      ));
      if (!requestIsCurrent(request) || selectedVersion.value?.commit !== version.commit) {
        return;
      }
      versionFiles.payload = result;
      const first = versionFiles.payload?.files?.[0];
      if (first) {
        await selectVersionFile(first);
      }
    } catch (error) {
      if (requestIsCurrent(request)) {
        versionFiles.error = message(error, "This version could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        versionFiles.loading = false;
      }
    }
  }

  async function loadMoreVersionFiles() {
    if (
      versionFiles.loading ||
      versionFiles.loadingMore ||
      !versionFiles.payload?.truncated ||
      !selectedVersion.value?.commit ||
      !history.payload?.historySnapshotCommit
    ) {
      return;
    }
    versionFiles.loadingMore = true;
    versionFiles.error = "";
    const request = beginRequest("versionFiles");
    try {
      const previousFiles = versionFiles.payload.files || [];
      const result = await requestJson(vibe64RepositoryVersionFilesPath(
        sessionsApiPath.value,
        selectedVersion.value.commit,
        {
          historySnapshotCommit: history.payload.historySnapshotCommit,
          offset: previousFiles.length,
          sessionId: sessionId.value
        }
      ));
      if (!requestIsCurrent(request)) {
        return;
      }
      versionFiles.payload = {
        ...result,
        files: [...previousFiles, ...(result.files || [])]
      };
    } catch (error) {
      if (requestIsCurrent(request)) {
        versionFiles.error = message(error, "More files from this version could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        versionFiles.loadingMore = false;
      }
    }
  }

  async function selectVersionFile(file) {
    const path = String(file?.path || "").trim();
    selectedVersionPath.value = path;
    versionDiff.error = "";
    versionDiff.payload = null;
    if (!path || !selectedVersion.value?.commit || !history.payload?.historySnapshotCommit) {
      return;
    }
    const request = beginRequest("versionDiff");
    const versionCommit = selectedVersion.value.commit;
    versionDiff.loading = true;
    try {
      const result = await requestJson(vibe64RepositoryVersionDiffPath(
        sessionsApiPath.value,
        selectedVersion.value.commit,
        path,
        {
          historySnapshotCommit: history.payload.historySnapshotCommit,
          sessionId: sessionId.value
        }
      ));
      if (
        requestIsCurrent(request) &&
        selectedVersion.value?.commit === versionCommit &&
        selectedVersionPath.value === path
      ) {
        versionDiff.payload = result;
      }
    } catch (error) {
      if (requestIsCurrent(request)) {
        versionDiff.error = message(error, "This file difference could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        versionDiff.loading = false;
      }
    }
  }

  async function loadHistory({ append = false } = {}) {
    history.error = "";
    if (!sessionId.value) {
      history.payload = null;
      history.versions = [];
      history.nextCursor = "";
      return;
    }
    const request = beginRequest("history");
    history.loading = true;
    try {
      const result = await requestJson(vibe64RepositoryHistoryPath(sessionsApiPath.value, {
        cursor: append ? history.nextCursor : "",
        sessionId: sessionId.value
      }));
      if (!requestIsCurrent(request)) {
        return;
      }
      history.payload = append && history.payload
        ? { ...result, versions: [...history.versions, ...(result.versions || [])] }
        : result;
      history.versions = history.payload.versions || [];
      history.nextCursor = result.nextCursor || "";
      if (!append && result.updateCheck && updateCheckIsNewer(result.updateCheck, updates.payload)) {
        updates.payload = {
          ...result.updateCheck,
          cached: true
        };
      }
    } catch (error) {
      if (requestIsCurrent(request)) {
        history.error = message(error, "Version history could not be loaded.");
      }
    } finally {
      if (requestIsCurrent(request)) {
        history.loading = false;
      }
    }
  }

  async function checkForUpdates({ force = true } = {}) {
    if (!sessionId.value || updates.applying) {
      return false;
    }
    const contextKey = requestContextKey();
    const active = updateChecks.get(contextKey);
    if (active) {
      if (force && active.force !== true) {
        forcedUpdateFollowups.add(contextKey);
      }
      return active.promise;
    }
    const request = beginRequest("updates");
    updates.checking = true;
    updates.error = "";
    updates.errorCode = "";
    const promise = (async () => {
      try {
        const previousHistorySnapshot = String(history.payload?.historySnapshotCommit || "").trim();
        const result = await requestJson(vibe64SessionCheckUpdatesPath(
        sessionsApiPath.value,
        sessionId.value
        ), {
          body: { force },
          method: "POST"
        });
        if (!requestIsCurrent(request)) {
          return false;
        }
        updates.payload = result;
        updates.canonicalChangePending = false;
        if (activeView.value === "changes") {
          await loadChanges();
        } else if (
          !history.payload ||
          String(result.canonicalCommit || "").trim() !== previousHistorySnapshot
        ) {
          await loadHistory();
        }
        return result;
      } catch (error) {
        if (requestIsCurrent(request)) {
          updates.error = message(error, "Updates could not be checked.");
          updates.errorCode = String(error?.code || "").trim();
          if (activeView.value === "changes") {
            await loadChanges();
          }
        }
        return false;
      } finally {
        if (requestIsCurrent(request)) {
          updates.checking = false;
        }
        const registered = updateChecks.get(contextKey);
        if (registered?.promise === promise) {
          updateChecks.delete(contextKey);
        }
        if (!disposed && forcedUpdateFollowups.delete(contextKey) && contextKey === requestContextKey()) {
          void checkForUpdates({ force: true });
        }
      }
    })();
    updateChecks.set(contextKey, { force, promise });
    return promise;
  }

  async function applyUpdates() {
    const requestUpdateWork = context.value.requestUpdateWork;
    if (
      !sessionId.value ||
      updates.checking ||
      updates.applying ||
      !(updates.canonicalChangePending || updates.payload?.updateAvailable === true) ||
      typeof requestUpdateWork !== "function"
    ) {
      return false;
    }
    updates.applying = true;
    updates.error = "";
    updates.errorCode = "";
    const request = beginRequest("applyUpdates");
    try {
      const result = await requestUpdateWork();
      if (!requestIsCurrent(request)) {
        return false;
      }
      if (result === false || result?.ok === false) {
        throw new Error("This session could not be updated.");
      }
      updates.payload = result;
      updates.canonicalChangePending = false;
      if (activeView.value === "history") {
        await loadHistory();
      } else {
        await loadChanges();
      }
      return result;
    } catch (error) {
      if (requestIsCurrent(request)) {
        updates.error = message(error, "This session could not be updated.");
        updates.errorCode = String(error?.code || "").trim();
      }
      return false;
    } finally {
      if (requestIsCurrent(request)) {
        updates.applying = false;
      }
    }
  }

  async function saveWork() {
    const requestSaveWork = context.value.requestSaveWork;
    if (
      !sessionId.value ||
      saving.value ||
      updates.checking ||
      updates.applying ||
      updates.canonicalChangePending ||
      updates.error ||
      !updates.payload ||
      updates.payload?.updateAvailable === true ||
      changes.error ||
      changes.loading ||
      changes.payload?.unsaved !== true ||
      typeof requestSaveWork !== "function"
    ) {
      return false;
    }
    saving.value = true;
    try {
      return await requestSaveWork();
    } finally {
      saving.value = false;
    }
  }

  watch(
    [sessionsApiPath, sessionId, activeView],
    async ([apiPath]) => {
      invalidateRequests();
      changes.error = "";
      changes.loading = false;
      changes.loadingMore = false;
      changes.payload = null;
      currentDiff.error = "";
      currentDiff.loading = false;
      currentDiff.payload = null;
      history.error = "";
      history.loading = false;
      history.nextCursor = "";
      history.payload = null;
      history.versions = [];
      selectedCurrentPath.value = "";
      selectedVersion.value = null;
      selectedVersionPath.value = "";
      versionDiff.error = "";
      versionDiff.loading = false;
      versionDiff.payload = null;
      versionFiles.error = "";
      versionFiles.loading = false;
      versionFiles.loadingMore = false;
      versionFiles.payload = null;
      updates.applying = false;
      updates.checking = false;
      updates.error = "";
      updates.errorCode = "";
      updates.payload = null;
      updates.canonicalChangePending = false;
      if (apiPath && sessionId.value) {
        const initialContext = requestContextKey();
        if (activeView.value === "history") {
          await loadHistory();
          if (disposed || initialContext !== requestContextKey()) {
            return;
          }
        }
        void checkForUpdates({ force: false });
      }
    },
    { immediate: true }
  );

  useRealtimeEvent({
    enabled: computed(() => Boolean(sessionId.value)),
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => (
      repositoryStatusSessionId(payload) === sessionId.value &&
      repositoryStatusRealtimeShouldRefresh(payload)
    ),
    onEvent: ({ payload = {} } = {}) => {
      const reason = String(payload?.reason || "").trim();
      const checkCanonical = repositoryStatusRealtimeNeedsCanonicalCheck(payload) || [
        "session-repository-checked",
        "session-save-completed",
        "session-update-completed"
      ].includes(reason);
      if (repositoryStatusRealtimeNeedsCanonicalCheck(payload)) {
        updates.canonicalChangePending = true;
      }
      if (activeView.value === "history" && reason === "session-save-completed") {
        void loadHistory();
      } else if (activeView.value === "changes" && !checkCanonical) {
        void loadChanges();
      }
      if (checkCanonical) {
        void checkForUpdates({ force: repositoryStatusRealtimeNeedsCanonicalCheck(payload) });
      }
    }
  });

  onScopeDispose(() => {
    disposed = true;
    invalidateRequests();
    updateChecks.clear();
    forcedUpdateFollowups.clear();
  });

  useRealtimeEvent({
    enabled: computed(() => Boolean(sessionId.value) && activeView.value === "changes"),
    event: VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => repositoryStatusSessionId(payload) === sessionId.value,
    onEvent: () => {
      void loadChanges();
    }
  });

  return {
    applyUpdates,
    changes,
    checkForUpdates,
    currentDiff,
    history,
    loadChanges,
    loadHistory,
    loadMoreVersionFiles,
    saveWork,
    saving,
    selectCurrentFile,
    selectedCurrentPath,
    selectedVersion,
    selectedVersionPath,
    selectVersion,
    selectVersionFile,
    sessionId,
    updates,
    versionDiff,
    versionFiles
  };
}

export {
  useVibe64RepositoryWorkspace
};
