import { ref, unref, watch } from "vue";
import {
  DEFAULT_AI_STUDIO_SESSION_MODE,
  aiStudioSessionModeFromRouteQuery,
  aiStudioSessionModeRouteQuery,
  aiStudioSessionModeRouteSynced,
  normalizeAiStudioSessionMode,
  readAiStudioSessionMode,
  writeAiStudioSessionMode
} from "@/lib/aiStudioSessionModeStorage.js";

function useAiStudioSessionMode({
  route = null,
  router = null,
  selectedSessionId
} = {}) {
  const modeBySessionId = new Map();
  let initialRouteMode = aiStudioSessionModeFromRouteQuery(route?.query || {});
  const sessionMode = ref(DEFAULT_AI_STUDIO_SESSION_MODE);

  function selectedId() {
    return String(unref(selectedSessionId) || "").trim();
  }

  function modeForSession(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      return DEFAULT_AI_STUDIO_SESSION_MODE;
    }
    if (modeBySessionId.has(normalizedSessionId)) {
      return modeBySessionId.get(normalizedSessionId);
    }
    if (initialRouteMode) {
      const routeMode = initialRouteMode;
      initialRouteMode = "";
      modeBySessionId.set(normalizedSessionId, writeAiStudioSessionMode(normalizedSessionId, routeMode));
      return modeBySessionId.get(normalizedSessionId);
    }
    const storedMode = readAiStudioSessionMode(normalizedSessionId);
    modeBySessionId.set(normalizedSessionId, storedMode);
    return storedMode;
  }

  function syncRouteMode(mode = DEFAULT_AI_STUDIO_SESSION_MODE) {
    if (!selectedId() || typeof router?.replace !== "function") {
      return;
    }
    if (aiStudioSessionModeRouteSynced(route?.query || {}, mode)) {
      return;
    }
    void router.replace({
      query: aiStudioSessionModeRouteQuery(route?.query || {}, mode)
    });
  }

  function applySelectedSessionMode() {
    const sessionId = selectedId();
    sessionMode.value = modeForSession(sessionId);
    syncRouteMode(sessionMode.value);
  }

  function setSessionMode(mode = DEFAULT_AI_STUDIO_SESSION_MODE) {
    const sessionId = selectedId();
    if (!sessionId) {
      return;
    }
    const normalizedMode = writeAiStudioSessionMode(sessionId, normalizeAiStudioSessionMode(mode));
    modeBySessionId.set(sessionId, normalizedMode);
    sessionMode.value = normalizedMode;
    syncRouteMode(normalizedMode);
  }

  watch(() => selectedId(), applySelectedSessionMode, {
    immediate: true
  });

  return {
    sessionMode,
    setSessionMode
  };
}

export {
  useAiStudioSessionMode
};
