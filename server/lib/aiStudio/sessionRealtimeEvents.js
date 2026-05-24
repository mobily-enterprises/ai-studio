const AI_STUDIO_SESSION_CHANGED_EVENT = "ai-studio.session.changed";
const AI_STUDIO_SESSION_EVENT_ENTITY = "session";
const AI_STUDIO_SESSION_EVENT_SOURCE = "ai-studio";
const AI_STUDIO_SESSION_REALTIME_AUDIENCE = "all_clients";

function normalizeSessionId(value = "") {
  return String(value || "").trim();
}

function sessionIdFromResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  return normalizeSessionId(
    source.sessionId ||
    source.session?.sessionId ||
    source.session?.id ||
    ""
  );
}

function sessionIdFromServiceEvent({ result = {}, args = [] } = {}) {
  return sessionIdFromResult(result) || normalizeSessionId(args?.[0]);
}

function aiStudioSessionRealtimePayload({ result = {}, args = [] } = {}) {
  const sessionId = sessionIdFromResult(result) || normalizeSessionId(args?.[0]);
  return sessionId ? { sessionId } : {};
}

function aiStudioSessionChangedServiceEvent({
  operation = "updated"
} = {}) {
  return Object.freeze({
    type: "entity.changed",
    source: AI_STUDIO_SESSION_EVENT_SOURCE,
    entity: AI_STUDIO_SESSION_EVENT_ENTITY,
    operation,
    entityId: sessionIdFromServiceEvent,
    realtime: Object.freeze({
      event: AI_STUDIO_SESSION_CHANGED_EVENT,
      audience: AI_STUDIO_SESSION_REALTIME_AUDIENCE,
      payload: aiStudioSessionRealtimePayload
    })
  });
}

function createAiStudioSessionChangedPublisher({
  domainEvents = null,
  methodName = "",
  serviceToken = ""
} = {}) {
  const normalizedServiceToken = normalizeSessionId(serviceToken);
  const normalizedMethodName = normalizeSessionId(methodName);
  if (!domainEvents || typeof domainEvents.publish !== "function" || !normalizedServiceToken || !normalizedMethodName) {
    return async function publishNoop() {
      return null;
    };
  }

  return async function publishAiStudioSessionChanged(sessionId = "", {
    operation = "updated",
    reason = ""
  } = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return null;
    }

    return domainEvents.publish({
      source: AI_STUDIO_SESSION_EVENT_SOURCE,
      entity: AI_STUDIO_SESSION_EVENT_ENTITY,
      operation: normalizeSessionId(operation) || "updated",
      entityId: normalizedSessionId,
      scope: {
        kind: "global",
        id: null
      },
      occurredAt: new Date().toISOString(),
      meta: {
        service: {
          token: normalizedServiceToken,
          method: normalizedMethodName
        },
        realtime: {
          event: AI_STUDIO_SESSION_CHANGED_EVENT,
          payload: {
            ...(reason ? { reason } : {}),
            sessionId: normalizedSessionId
          }
        }
      }
    });
  };
}

export {
  AI_STUDIO_SESSION_CHANGED_EVENT,
  aiStudioSessionChangedServiceEvent,
  createAiStudioSessionChangedPublisher
};
