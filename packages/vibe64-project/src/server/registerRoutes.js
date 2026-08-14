import {
  projectCreateInputValidator,
  projectEnvReadInputValidator,
  projectEnvUserValuesInputValidator,
  projectSelectInputValidator,
  projectTemplateApplyInputValidator,
  projectTemplateParamsValidator,
  projectTemplatesReadInputValidator,
  previewApplicationIdentitiesInputValidator
} from "./inputSchemas.js";
import {
  ACTION_CREATE_PROJECT,
  ACTION_LIST_PROJECTS,
  ACTION_READ_ENV,
  ACTION_SAVE_ENV_USER_VALUES,
  ACTION_SELECT_PROJECT
} from "./actions.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(app, {
  projectContext = null,
  routeSurface = "",
  routeRelativePath = ""
} = {}) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 project routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-project"]
  });
  const service = () => app.make("feature.vibe64-project.service");

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
  routes.serviceRoute("GET", "/project-templates", {
    query: projectTemplatesReadInputValidator,
    summary: "List project foundations."
  }, (request) => service().readProjectTemplates(withUser(request, routes.requestQuery(request))));
  routes.serviceRoute("GET", "/project-foundation", {
    summary: "Read the installed Genesis foundation."
  }, () => service().readProjectFoundation());
  routes.serviceRoute("POST", "/project-templates/:templateId/apply", {
    body: projectTemplateApplyInputValidator,
    params: projectTemplateParamsValidator,
    summary: "Apply a project foundation."
  }, (request) => service().applyProjectTemplate(
    request.params?.templateId,
    withUser(request, routes.requestBody(request))
  ));
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
  routes.serviceRoute("GET", "/preview-identities", {
    summary: "Read project-local managed app identities."
  }, () => service().readPreviewApplicationIdentities());
  routes.serviceRoute("PUT", "/preview-identities", {
    body: previewApplicationIdentitiesInputValidator,
    summary: "Save project-local managed app identities."
  }, (request) => service().savePreviewApplicationIdentities(routes.requestBody(request)));
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
