import {
  projectCreateInputValidator,
  projectEnvReadInputValidator,
  projectEnvUserValuesInputValidator,
  projectsReadInputValidator,
  projectSelectInputValidator
} from "./inputSchemas.js";

const ACTION_CREATE_PROJECT = "feature.vibe64-project.projects.create";
const ACTION_LIST_PROJECTS = "feature.vibe64-project.projects.list";
const ACTION_SELECT_PROJECT = "feature.vibe64-project.projects.select";
const ACTION_READ_ENV = "feature.vibe64-project.env.read";
const ACTION_SAVE_ENV_USER_VALUES = "feature.vibe64-project.env.user-values.save";

function action(id, kind, input, execute) {
  return Object.freeze({
    id,
    version: 1,
    kind,
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input,
    output: null,
    idempotency: kind === "query" ? "none" : "optional",
    audit: {
      actionName: id
    },
    observability: {},
    execute
  });
}

const featureActions = Object.freeze([
  action(ACTION_LIST_PROJECTS, "query", projectsReadInputValidator, (input, context, deps) => {
    void input;
    void context;
    return deps.featureService.listProjects();
  }),
  action(ACTION_CREATE_PROJECT, "command", projectCreateInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.createProject(input);
  }),
  action(ACTION_SELECT_PROJECT, "command", projectSelectInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.selectProject(input);
  }),
  action(ACTION_READ_ENV, "query", projectEnvReadInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.readEnv(input);
  }),
  action(ACTION_SAVE_ENV_USER_VALUES, "command", projectEnvUserValuesInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.saveEnvUserValues(input);
  })
]);

export {
  ACTION_CREATE_PROJECT,
  ACTION_LIST_PROJECTS,
  ACTION_READ_ENV,
  ACTION_SAVE_ENV_USER_VALUES,
  ACTION_SELECT_PROJECT,
  featureActions
};
