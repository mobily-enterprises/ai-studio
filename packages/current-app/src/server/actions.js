import {
  currentAppQueryInputValidator
} from "./inputSchemas.js";

const ACTION_READ_CURRENT_APP = "feature.current-app.read";

const featureActions = Object.freeze([{
  id: ACTION_READ_CURRENT_APP,
  version: 1,
  kind: "query",
  channels: ["api", "automation", "internal"],
  surfaces: ["app"],
  input: currentAppQueryInputValidator,
  output: null,
  idempotency: "none",
  audit: {
    actionName: ACTION_READ_CURRENT_APP
  },
  observability: {},
  execute(input, context, dependencies) {
    void context;
    return dependencies.featureService.inspectCurrentApp(input);
  }
}]);

export {
  ACTION_READ_CURRENT_APP,
  featureActions
};
