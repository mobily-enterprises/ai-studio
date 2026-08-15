import {
  studioApiPath
} from "@/lib/studioUrls.js";
import {
  vibe64ProjectQueryScope
} from "@/lib/vibe64ProjectScope.js";

const TARGET_PROJECT_API_SUFFIX = "/studio/current-app";
const VIBE64_PROJECT_CREATE_API_SUFFIX = "/vibe64/projects";
const VIBE64_ENV_API_SUFFIX = "/vibe64/env";
const VIBE64_ENV_USER_VALUES_API_SUFFIX = "/vibe64/env/user-values";
const VIBE64_PREVIEW_IDENTITIES_API_SUFFIX = "/vibe64/preview-identities";
const VIBE64_PROJECT_SELECT_API_SUFFIX = "/vibe64/projects/select";
const VIBE64_PROJECT_TEMPLATES_API_SUFFIX = "/vibe64/project-templates";
const VIBE64_CONNECTIONS_CHANGED_EVENT = "vibe64.connections.changed";
const VIBE64_PROJECT_CHANGED_EVENT = "vibe64.project.changed";

const TARGET_PROJECT_ENDPOINT = studioApiPath("studio/current-app");
const STUDIO_HEALTH_ENDPOINT = studioApiPath("studio/health");
const VIBE64_ENDPOINT = studioApiPath("vibe64");
const PROJECT_SELECTION_ENDPOINT = `${VIBE64_ENDPOINT}/projects`;
const PROJECT_TEMPLATES_ENDPOINT = `${VIBE64_ENDPOINT}/project-templates`;
const ENV_ENDPOINT = `${VIBE64_ENDPOINT}/env`;
const ENV_USER_VALUES_ENDPOINT = `${ENV_ENDPOINT}/user-values`;
const PREVIEW_IDENTITIES_ENDPOINT = `${VIBE64_ENDPOINT}/preview-identities`;

function projectTemplatesQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "project-templates"];
}

function projectSelectionQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "projects"];
}

function envQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "env"];
}

function previewIdentitiesQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "preview-identities"];
}

function targetProjectQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "target-project"];
}

function studioHealthQueryKey(surfaceId, ownershipFilter) {
  return ["vibe64", surfaceId, ownershipFilter, "studio-health"];
}

export {
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  VIBE64_PROJECT_CREATE_API_SUFFIX,
  VIBE64_PROJECT_CHANGED_EVENT,
  VIBE64_PROJECT_SELECT_API_SUFFIX,
  VIBE64_PROJECT_TEMPLATES_API_SUFFIX,
  VIBE64_ENV_API_SUFFIX,
  VIBE64_ENV_USER_VALUES_API_SUFFIX,
  VIBE64_PREVIEW_IDENTITIES_API_SUFFIX,
  PROJECT_SELECTION_ENDPOINT,
  PROJECT_TEMPLATES_ENDPOINT,
  ENV_ENDPOINT,
  ENV_USER_VALUES_ENDPOINT,
  PREVIEW_IDENTITIES_ENDPOINT,
  TARGET_PROJECT_API_SUFFIX,
  TARGET_PROJECT_ENDPOINT,
  STUDIO_HEALTH_ENDPOINT,
  projectSelectionQueryKey,
  projectTemplatesQueryKey,
  envQueryKey,
  previewIdentitiesQueryKey,
  targetProjectQueryKey,
  studioHealthQueryKey
};
