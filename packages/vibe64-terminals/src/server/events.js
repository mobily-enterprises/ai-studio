import { createVibe64ProjectChangedPublisher } from "@local/vibe64-project/server/actions";

function createProjectRuntimeChangedPublisher(events) {
  const publishProjectChanged = createVibe64ProjectChangedPublisher({ events });
  return async function publishProjectRuntimeChanged(result = {}, { action = "" } = {}) {
    const source = result || {};
    const projectSlug = String(source.projectSlug || "").trim();
    if (source.ok === false || !projectSlug || !source.runtime) {
      return null;
    }
    return publishProjectChanged({ action, projectSlug, runtime: source.runtime }, { reason: action });
  };
}

export {
  createProjectRuntimeChangedPublisher
};
