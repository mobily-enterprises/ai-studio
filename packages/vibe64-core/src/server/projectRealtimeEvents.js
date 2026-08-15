const VIBE64_PROJECT_CHANGED_EVENT = "vibe64.project.changed";
const VIBE64_PROJECT_EVENT_ENTITY = "project";
const VIBE64_PROJECT_EVENT_SOURCE = "vibe64";
const VIBE64_PROJECT_REALTIME_AUDIENCE = "all_clients";

function normalizeProjectValue(value = "") {
  return String(value || "").trim();
}

function projectSlugFromInput(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  return normalizeProjectValue(source.slug || source.projectSlug || source.name || "");
}

function projectRecordFromResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  const currentProject = source.currentProject && typeof source.currentProject === "object" && !Array.isArray(source.currentProject)
    ? source.currentProject
    : null;
  const project = source.project && typeof source.project === "object" && !Array.isArray(source.project)
    ? source.project
    : null;
  return currentProject || project || null;
}

function projectSlugFromResult(result = {}) {
  const project = projectRecordFromResult(result);
  return normalizeProjectValue(
    result?.projectSlug ||
    result?.slug ||
    project?.slug ||
    project?.name ||
    ""
  );
}

function projectSlugFromServiceEvent({ result = {}, args = [] } = {}) {
  return projectSlugFromResult(result) || projectSlugFromInput(args?.[0]) || "projects";
}

function vibe64ProjectRealtimePayload({ result = {}, args = [] } = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  const project = projectRecordFromResult(result);
  const projectSlug = projectSlugFromResult(result) || projectSlugFromInput(args?.[0]);
  return {
    ...(projectSlug ? { projectSlug } : {}),
    ...(project?.projectRoot ? { projectRoot: normalizeProjectValue(project.projectRoot) } : {}),
    ...(source.targetRoot ? { targetRoot: normalizeProjectValue(source.targetRoot) } : {}),
    ...(typeof source.hasSelection === "boolean" ? { hasSelection: source.hasSelection } : {})
  };
}

function vibe64ProjectChangedServiceEvent({
  operation = "updated"
} = {}) {
  return Object.freeze({
    type: "entity.changed",
    source: VIBE64_PROJECT_EVENT_SOURCE,
    entity: VIBE64_PROJECT_EVENT_ENTITY,
    operation,
    entityId: projectSlugFromServiceEvent,
    realtime: Object.freeze({
      event: VIBE64_PROJECT_CHANGED_EVENT,
      audience: VIBE64_PROJECT_REALTIME_AUDIENCE,
      payload: vibe64ProjectRealtimePayload
    })
  });
}

function projectRuntimeEventEntityId({ result = {} } = {}) {
  if (result?.ok === false || !result?.runtime) {
    return null;
  }
  return projectSlugFromResult(result);
}

function projectRuntimeEventReason({ result = {}, args = [] } = {}) {
  return normalizeProjectValue(result?.reason || args?.[0]?.reason || "");
}

function projectRuntimeRealtimePayload({ result = {} } = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  return {
    ...(source.projectSlug ? { projectSlug: normalizeProjectValue(source.projectSlug) } : {}),
    ...(source.targetRoot ? {
      projectRoot: normalizeProjectValue(source.targetRoot),
      targetRoot: normalizeProjectValue(source.targetRoot)
    } : {}),
    ...(source.runtime && typeof source.runtime === "object" && !Array.isArray(source.runtime)
      ? { runtime: source.runtime }
      : {}),
    ...(source.runtime?.open === false ? { message: "Project is closed." } : {})
  };
}

function vibe64ProjectRuntimeChangedServiceEvent({
  action = ""
} = {}) {
  return Object.freeze({
    type: "entity.changed",
    source: VIBE64_PROJECT_EVENT_SOURCE,
    entity: VIBE64_PROJECT_EVENT_ENTITY,
    operation: "updated",
    entityId: projectRuntimeEventEntityId,
    action: normalizeProjectValue(action),
    reason: projectRuntimeEventReason,
    realtime: Object.freeze({
      event: VIBE64_PROJECT_CHANGED_EVENT,
      audience: VIBE64_PROJECT_REALTIME_AUDIENCE,
      payload: projectRuntimeRealtimePayload
    })
  });
}

export {
  VIBE64_PROJECT_CHANGED_EVENT,
  vibe64ProjectChangedServiceEvent,
  vibe64ProjectRuntimeChangedServiceEvent
};
