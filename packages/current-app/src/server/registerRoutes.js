import {
  currentAppQueryInputValidator
} from "./inputSchemas.js";
import {
  ACTION_READ_CURRENT_APP
} from "./actions.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(http, {
  projectContext = null,
  routeSurface = "",
  routeRelativePath = ""
} = {}) {
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Current-app Studio routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "current-app"]
  });

  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_CURRENT_APP,
    buildInput: routes.requestQuery,
    query: currentAppQueryInputValidator,
    summary: "Inspect the current project's Vibe64 launch targets."
  });
}

export { registerRoutes };
