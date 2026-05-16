import {
  projectTypeInputValidator,
  projectTypeReadInputValidator
} from "./inputSchemas.js";

const ACTION_READ_PROJECT_TYPE = "feature.ai-studio-project.project-type.read";
const ACTION_SAVE_PROJECT_TYPE = "feature.ai-studio-project.project-type.save";

const featureActions = Object.freeze([
  {
    id: ACTION_READ_PROJECT_TYPE,
    version: 1,
    kind: "query",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: projectTypeReadInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_READ_PROJECT_TYPE
    },
    observability: {},
    async execute(input, context, deps) {
      void input;
      void context;
      return deps.featureService.readProjectType();
    }
  },
  {
    id: ACTION_SAVE_PROJECT_TYPE,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["home"],
    input: projectTypeInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_SAVE_PROJECT_TYPE
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.saveProjectType(input);
    }
  }
]);

export {
  ACTION_READ_PROJECT_TYPE,
  ACTION_SAVE_PROJECT_TYPE,
  featureActions
};
