const REPOSITORY_STATUS_SESSION_REASONS = new Set([
  "codex-turn-checkpoint-failed",
  "codex-turn-checkpoint-updated",
  "repository-canonical-changed",
  "session-repository-checked",
  "session-save-completed",
  "session-save-failed",
  "session-save-started",
  "session-update-completed",
  "session-update-failed",
  "session-update-started",
  "session-work-saved",
  "session-work-updated"
]);

const REPOSITORY_CANONICAL_RECHECK_REASONS = new Set([
  "repository-canonical-changed",
  "session-save-failed",
  "session-update-failed"
]);

function repositoryStatusSessionId(payload = {}) {
  return String(payload?.sessionId || payload?.session?.sessionId || "").trim();
}

function repositoryStatusRealtimeShouldRefresh(payload = {}) {
  return REPOSITORY_STATUS_SESSION_REASONS.has(String(payload?.reason || "").trim());
}

function repositoryStatusRealtimeNeedsCanonicalCheck(payload = {}) {
  return REPOSITORY_CANONICAL_RECHECK_REASONS.has(String(payload?.reason || "").trim());
}

export {
  repositoryStatusRealtimeNeedsCanonicalCheck,
  repositoryStatusRealtimeShouldRefresh,
  repositoryStatusSessionId
};
