import { studioHealthQueryInputValidator } from "./inputSchemas.js";

const ACTION_READ_STUDIO_HEALTH = "feature.studio-health.read";

const featureActions = Object.freeze([{
  id: ACTION_READ_STUDIO_HEALTH,
  version: 1,
  kind: "query",
  channels: ["api", "automation", "internal"],
  surfaces: ["app"],
  input: studioHealthQueryInputValidator,
  output: null,
  idempotency: "none",
  audit: { actionName: ACTION_READ_STUDIO_HEALTH },
  observability: {},
  execute(input, context, dependencies) {
    void context;
    return dependencies.featureService.inspect(input);
  }
}]);

export {
  ACTION_READ_STUDIO_HEALTH,
  featureActions
};
