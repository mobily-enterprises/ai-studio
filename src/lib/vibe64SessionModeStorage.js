import {
  browserLocalStorage
} from "@/lib/browserLocalStorage.js";

const AI_STUDIO_SESSION_MODES = Object.freeze({
  AUTOPILOT: "autopilot",
  INSPECT: "inspect"
});
const DEFAULT_AI_STUDIO_SESSION_MODE = AI_STUDIO_SESSION_MODES.AUTOPILOT;
const SESSION_MODE_STORAGE_PREFIX = "ai-studio:session-mode:";

function normalizeAiStudioSessionMode(value = "", fallback = DEFAULT_AI_STUDIO_SESSION_MODE) {
  const mode = String(value || "").trim();
  switch (mode) {
    case AI_STUDIO_SESSION_MODES.AUTOPILOT:
    case AI_STUDIO_SESSION_MODES.INSPECT:
      return mode;
    default:
      return fallback;
  }
}

function aiStudioSessionModeStorageKey(sessionId = "") {
  const normalizedSessionId = String(sessionId || "").trim();
  return normalizedSessionId
    ? `${SESSION_MODE_STORAGE_PREFIX}${encodeURIComponent(normalizedSessionId)}`
    : "";
}

function readAiStudioSessionMode(sessionId = "", fallback = DEFAULT_AI_STUDIO_SESSION_MODE) {
  const storageKey = aiStudioSessionModeStorageKey(sessionId);
  if (!storageKey) {
    return normalizeAiStudioSessionMode("", fallback);
  }
  try {
    return normalizeAiStudioSessionMode(browserLocalStorage()?.getItem(storageKey), fallback);
  } catch {
    return normalizeAiStudioSessionMode("", fallback);
  }
}

function writeAiStudioSessionMode(sessionId = "", mode = DEFAULT_AI_STUDIO_SESSION_MODE) {
  const storageKey = aiStudioSessionModeStorageKey(sessionId);
  if (!storageKey) {
    return "";
  }
  const normalizedMode = normalizeAiStudioSessionMode(mode);
  try {
    browserLocalStorage()?.setItem(storageKey, normalizedMode);
  } catch {
    // Browser storage can be unavailable in private or constrained contexts.
  }
  return normalizedMode;
}

function aiStudioSessionModeFromRouteQuery(query = {}) {
  const rawMode = Array.isArray(query?.mode) ? query.mode[0] : query?.mode;
  return normalizeAiStudioSessionMode(rawMode, "");
}

function aiStudioSessionModeRouteQuery(query = {}, mode = DEFAULT_AI_STUDIO_SESSION_MODE) {
  const nextQuery = {
    ...query
  };
  if (normalizeAiStudioSessionMode(mode) === AI_STUDIO_SESSION_MODES.INSPECT) {
    nextQuery.mode = AI_STUDIO_SESSION_MODES.INSPECT;
  } else {
    delete nextQuery.mode;
  }
  return nextQuery;
}

function aiStudioSessionModeRouteSynced(query = {}, mode = DEFAULT_AI_STUDIO_SESSION_MODE) {
  const normalizedMode = normalizeAiStudioSessionMode(mode);
  const hasMode = Object.prototype.hasOwnProperty.call(query || {}, "mode");
  if (normalizedMode === AI_STUDIO_SESSION_MODES.INSPECT) {
    return query?.mode === AI_STUDIO_SESSION_MODES.INSPECT;
  }
  return !hasMode;
}

export {
  AI_STUDIO_SESSION_MODES,
  DEFAULT_AI_STUDIO_SESSION_MODE,
  aiStudioSessionModeFromRouteQuery,
  aiStudioSessionModeRouteQuery,
  aiStudioSessionModeRouteSynced,
  aiStudioSessionModeStorageKey,
  normalizeAiStudioSessionMode,
  readAiStudioSessionMode,
  writeAiStudioSessionMode
};
