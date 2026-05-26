const AI_STUDIO_SESSION_DEBUG_MARKER = "AI_STUDIO_SESSION_DEBUG";

function aiStudioSessionDebugError(error = {}) {
  return {
    code: String(error?.code || ""),
    message: String(error?.message || error || ""),
    name: String(error?.name || ""),
    status: Number.isInteger(error?.status) ? error.status : null
  };
}

function aiStudioSessionDebugDurationMs(startedAtMs) {
  return Math.max(0, Date.now() - Number(startedAtMs || Date.now()));
}

function aiStudioSessionDebugLog(event = "", details = {}) {
  const timestamp = new Date().toISOString();
  const entry = {
    marker: AI_STUDIO_SESSION_DEBUG_MARKER,
    timestamp,
    event: String(event || ""),
    ...(details && typeof details === "object" && !Array.isArray(details) ? details : {})
  };
  entry.marker = AI_STUDIO_SESSION_DEBUG_MARKER;
  entry.timestamp = timestamp;

  const logger = globalThis.console;
  if (!logger || typeof logger.info !== "function") {
    return entry;
  }

  try {
    logger.info(`[${AI_STUDIO_SESSION_DEBUG_MARKER}] ${JSON.stringify(entry)}`);
  } catch {
    logger.info(`[${AI_STUDIO_SESSION_DEBUG_MARKER}] ${timestamp} ${entry.event}`);
  }
  return entry;
}

function aiStudioSessionDebugSummary(session = {}) {
  return {
    currentStep: String(session?.currentStep || ""),
    nextEnabled: session?.next?.enabled === true,
    nextStepId: String(session?.next?.stepId || ""),
    sessionId: String(session?.sessionId || ""),
    status: String(session?.status || ""),
    stepStatus: String(session?.stepMachine?.status || "")
  };
}

export {
  AI_STUDIO_SESSION_DEBUG_MARKER,
  aiStudioSessionDebugDurationMs,
  aiStudioSessionDebugError,
  aiStudioSessionDebugLog,
  aiStudioSessionDebugSummary
};
