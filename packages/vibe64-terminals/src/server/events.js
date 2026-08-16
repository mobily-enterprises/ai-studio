const VIBE64_SESSION_CHANGED_EVENT = "vibe64.session.changed";
const VIBE64_PROJECT_CHANGED_EVENT = "vibe64.project.changed";

function requireEvents(events) {
  if (!events || typeof events.publish !== "function") {
    throw new TypeError("Vibe64 terminal events require runtime.events.");
  }
  return events;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sessionPayload(sessionId = "", input = {}) {
  const source = record(input);
  const session = record(source.session);
  const revision = Number(session.revision);
  const status = String(session.status || "").trim();
  const originId = String(source.originId || "").trim();
  const additional = record(source.payload);
  return {
    sessionId: String(sessionId || "").trim(),
    ...(Number.isSafeInteger(revision) && revision >= 0 ? { revision } : {}),
    ...(status ? { status } : {}),
    ...additional,
    ...(originId ? { originId } : {}),
    ...(source.reason ? { reason: String(source.reason).trim() } : {})
  };
}

function createTerminalSessionChangedPublisher(events) {
  const publisher = requireEvents(events);
  return async function publishTerminalSessionChanged(sessionId = "", input = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      return null;
    }
    return publisher.publish(Object.freeze({
      type: "entity.changed",
      source: "vibe64",
      entity: "session",
      operation: String(input.operation || "updated").trim() || "updated",
      entityId: normalizedSessionId,
      scope: Object.freeze({ kind: "global", id: null }),
      occurredAt: new Date().toISOString(),
      realtime: Object.freeze({
        audience: "all_clients",
        event: VIBE64_SESSION_CHANGED_EVENT,
        payload: Object.freeze(sessionPayload(normalizedSessionId, input))
      })
    }));
  };
}

function createProjectRuntimeChangedPublisher(events) {
  const publisher = requireEvents(events);
  return async function publishProjectRuntimeChanged(result = {}, { action = "" } = {}) {
    const source = record(result);
    const projectSlug = String(source.projectSlug || "").trim();
    if (source.ok === false || !projectSlug || !source.runtime) {
      return null;
    }
    const payload = Object.freeze({
      projectSlug,
      ...(source.targetRoot ? {
        projectRoot: String(source.targetRoot).trim(),
        targetRoot: String(source.targetRoot).trim()
      } : {}),
      runtime: source.runtime,
      ...(source.runtime?.open === false ? { message: "Project is closed." } : {})
    });
    return publisher.publish(Object.freeze({
      type: "entity.changed",
      source: "vibe64",
      entity: "project",
      operation: "updated",
      entityId: projectSlug,
      action: String(action || "").trim(),
      scope: Object.freeze({ kind: "global", id: null }),
      occurredAt: new Date().toISOString(),
      realtime: Object.freeze({
        audience: "all_clients",
        event: VIBE64_PROJECT_CHANGED_EVENT,
        payload
      })
    }));
  };
}

export {
  VIBE64_PROJECT_CHANGED_EVENT,
  VIBE64_SESSION_CHANGED_EVENT,
  createProjectRuntimeChangedPublisher,
  createTerminalSessionChangedPublisher
};
