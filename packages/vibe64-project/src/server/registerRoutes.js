import {
  ACTION_APPLY_PROJECT_TEMPLATE,
  ACTION_CREATE_PROJECT,
  ACTION_LIST_PROJECTS,
  ACTION_LIST_PROJECT_TEMPLATES,
  ACTION_READ_ENV,
  ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_SAVE_ENV_USER_VALUES,
  ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_SELECT_PROJECT
} from "./actions.js";
import {
  projectCreateInputValidator,
  projectEnvReadInputValidator,
  projectEnvUserValuesInputValidator,
  projectSelectInputValidator,
  projectTemplateParamsValidator,
  previewApplicationIdentitiesInputValidator
} from "./inputSchemas.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(http, {
  projectContext = null,
  routeSurface = "",
  routeRelativePath = ""
} = {}) {
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 project routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-project"]
  });

  routes.actionRoute("GET", "/projects", {
    actionId: ACTION_LIST_PROJECTS,
    summary: "List selectable Vibe64 projects."
  });
  routes.actionRoute("POST", "/projects", {
    actionId: ACTION_CREATE_PROJECT,
    body: projectCreateInputValidator,
    buildInput: routes.requestBody,
    summary: "Create and select a Vibe64 project."
  });
  routes.actionRoute("POST", "/projects/select", {
    actionId: ACTION_SELECT_PROJECT,
    body: projectSelectInputValidator,
    buildInput: routes.requestBody,
    summary: "Select an existing Vibe64 project."
  });
  routes.actionRoute("GET", "/project-templates", {
    actionId: ACTION_LIST_PROJECT_TEMPLATES,
    buildInput: (request) => withUser(request),
    summary: "List trusted starter projects."
  });
  routes.actionRoute("POST", "/project-templates/:templateId/apply", {
    actionId: ACTION_APPLY_PROJECT_TEMPLATE,
    params: projectTemplateParamsValidator,
    buildInput: (request) => withUser(request, {
      ...routes.requestBody(request),
      templateId: request.params?.templateId
    }),
    summary: "Apply a trusted starter project."
  });
  routes.actionRoute("GET", "/env", {
    actionId: ACTION_READ_ENV,
    buildInput: routes.requestQuery,
    query: projectEnvReadInputValidator,
    summary: "Read project Env values."
  });
  routes.actionRoute("PUT", "/env/user-values", {
    actionId: ACTION_SAVE_ENV_USER_VALUES,
    body: projectEnvUserValuesInputValidator,
    buildInput: routes.requestBody,
    summary: "Save user-owned project Env values."
  });
  routes.actionRoute("GET", "/preview-identities", {
    actionId: ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
    summary: "Read project-local managed app identities."
  });
  routes.actionRoute("PUT", "/preview-identities", {
    actionId: ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
    body: previewApplicationIdentitiesInputValidator,
    buildInput: routes.requestBody,
    summary: "Save project-local managed app identities."
  });
}

function withUser(request, input = {}) {
  return request.vibe64User
    ? {
        ...input,
        vibe64User: request.vibe64User
      }
    : {
        ...input
      };
}

export { registerRoutes };
