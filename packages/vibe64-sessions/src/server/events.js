import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";

const VIBE64_SESSION_CHANGED_EVENT = "vibe64.session.changed";
const VIBE64_SESSION_VIEW_CHANGED_EVENT = "vibe64.session.view.changed";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sessionId(value = {}) {
  const source = record(value);
  const session = record(source.session);
  return String(source.sessionId || source.id || session.sessionId || session.id || "").trim();
}

function originId(...values) {
  for (const value of values) {
    const source = record(value);
    const origin = String(source.originId || record(source.input).originId || "").trim();
    if (origin) {
      return origin;
    }
  }
  return "";
}

function normalizedClientRefresh(value = {}) {
  const source = record(value);
  return {
    ...(source.includeLaunchTargets === true ? { includeLaunchTargets: true } : {}),
    ...(source.includeList === true ? { includeList: true } : {})
  };
}

function sessionRealtimePayload(result = {}, input = {}, reason = "", payload = null) {
  const id = sessionId(result) || sessionId(input);
  const origin = originId(result, input);
  const resultSession = record(record(result).session);
  const session = Object.keys(resultSession).length > 0
    ? resultSession
    : record(result);
  const revision = Number(session.revision);
  const status = String(session.status || "").trim();
  const resultRefresh = normalizedClientRefresh(record(result).clientRefresh);
  const additionalPayload = record(payload);
  const additionalRefresh = normalizedClientRefresh(additionalPayload.clientRefresh);
  const {
    clientRefresh: _clientRefresh,
    ...additionalFields
  } = additionalPayload;
  void _clientRefresh;
  const clientRefresh = {
    ...resultRefresh,
    ...additionalRefresh
  };
  return {
    ...(id ? { sessionId: id } : {}),
    ...(Number.isSafeInteger(revision) && revision >= 0 ? { revision } : {}),
    ...(status ? { status } : {}),
    ...additionalFields,
    ...(Object.keys(clientRefresh).length > 0 ? { clientRefresh } : {}),
    ...(origin ? { originId: origin } : {}),
    ...(reason ? { reason } : {})
  };
}

function viewStateRealtimePayload(value = {}) {
  const viewState = record(value);
  return {
    originId: String(viewState.originId || "").trim(),
    projectPane: String(viewState.projectPane || "").trim(),
    projectSlug: String(viewState.projectSlug || "").trim(),
    routeFullPath: String(viewState.routeFullPath || "").trim(),
    sessionId: sessionId(viewState),
    updatedAt: String(viewState.updatedAt || "").trim()
  };
}

function sessionChangedActionEvent({ operation = "updated", reason = "" } = {}) {
  return createEntityChangedActionEvent({
    source: "vibe64",
    entity: "session",
    operation,
    entityId: ({ input, result }) => result?.ok === false
      ? null
      : sessionId(result) || sessionId(input),
    realtime: {
      audience: "all_clients",
      event: VIBE64_SESSION_CHANGED_EVENT,
      payload: ({ input, result }) => sessionRealtimePayload(result, input, reason)
    }
  });
}

function sessionViewChangedActionEvent() {
  return createEntityChangedActionEvent({
    source: "vibe64",
    entity: "session_view",
    operation: "updated",
    entityId: ({ result }) => {
      const id = sessionId(record(result).viewState);
      return id ? `${id}:view` : null;
    },
    realtime: {
      audience: "all_clients",
      event: VIBE64_SESSION_VIEW_CHANGED_EVENT,
      payload: ({ result }) => viewStateRealtimePayload(record(result).viewState)
    }
  });
}

function createSessionChangedPublisher(events) {
  if (!events || typeof events.publish !== "function") {
    throw new TypeError("createSessionChangedPublisher requires runtime.events.");
  }
  return async function publishSessionChanged(sessionIdValue = "", {
    operation = "updated",
    originId: eventOriginId = "",
    payload = null,
    reason = "",
    session = null
  } = {}) {
    const id = String(sessionIdValue || "").trim();
    if (!id) {
      return null;
    }
    return events.publish(Object.freeze({
      type: "entity.changed",
      source: "vibe64",
      entity: "session",
      operation: String(operation || "updated").trim() || "updated",
      entityId: id,
      scope: Object.freeze({
        kind: "global",
        id: null
      }),
      occurredAt: new Date().toISOString(),
      realtime: Object.freeze({
        audience: "all_clients",
        event: VIBE64_SESSION_CHANGED_EVENT,
        payload: Object.freeze(sessionRealtimePayload(
          session || { sessionId: id },
          { originId: eventOriginId, sessionId: id },
          reason,
          payload
        ))
      })
    }));
  };
}

export {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSION_VIEW_CHANGED_EVENT,
  createSessionChangedPublisher,
  sessionChangedActionEvent,
  sessionViewChangedActionEvent
};
