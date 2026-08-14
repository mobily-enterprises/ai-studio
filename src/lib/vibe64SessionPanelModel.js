import {
  isOpenVibe64Session,
  shortVibe64SessionId
} from "@/lib/vibe64SessionViewModel.js";
import {
  DEFAULT_MAX_OPEN_SESSIONS
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64SessionSourcePath
} from "@/lib/vibe64SessionPaths.js";

function visibleVibe64Sessions(sessions = []) {
  return sessions
    .filter(isOpenVibe64Session)
    .sort((left, right) => String(
      left.createdAt || left.manifest?.createdAt || left.sessionId || ""
    ).localeCompare(String(
      right.createdAt || right.manifest?.createdAt || right.sessionId || ""
    )));
}

function vibe64SessionLimits({ payloadLimits = {}, sessions = [] } = {}) {
  return {
    maxOpenSessions: Number(payloadLimits.maxOpenSessions || DEFAULT_MAX_OPEN_SESSIONS),
    openSessionCount: Number(
      payloadLimits.openSessionCount || sessions.filter(isOpenVibe64Session).length
    )
  };
}

function blockingVibe64SessionPageError({
  hasMountedRuntime = false,
  runtimePageError = "",
  selectedSession = null,
  selectedSessionLoadError = "",
  sessionListLoadError = "",
  sessions = []
} = {}) {
  const runtimeError = String(runtimePageError || "").trim();
  if (runtimeError) {
    return runtimeError;
  }
  const hasSelectedSession = Boolean(selectedSession?.sessionId || selectedSession);
  const listError = String(sessionListLoadError || "").trim();
  if (listError && !hasMountedRuntime && !hasSelectedSession && sessions.length < 1) {
    return listError;
  }
  const selectedError = String(selectedSessionLoadError || "").trim();
  return selectedError && !hasMountedRuntime && !hasSelectedSession ? selectedError : "";
}

function enrichVibe64SessionForDisplay(session = null) {
  if (!session) {
    return null;
  }
  const metadata = session.metadata || {};
  const source = vibe64SessionSourcePath(session);
  const sourceRemoved = String(metadata.source_removed || "").trim().toLowerCase() === "yes";
  return {
    ...session,
    sessionName: session.sessionName || metadata.label || "",
    source,
    sourceReady: !sourceRemoved && (session.sourceReady === true || Boolean(source)),
    sourceRemoved
  };
}

export {
  blockingVibe64SessionPageError,
  enrichVibe64SessionForDisplay,
  shortVibe64SessionId,
  vibe64SessionLimits,
  visibleVibe64Sessions
};
