import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { ACTION_READ_STUDIO_HEALTH } from "./actions.js";
import { studioHealthQueryInputValidator } from "./inputSchemas.js";

function registerRoutes(app, {
  routeRelativePath = "studio/health",
  routeSurface = "app"
} = {}) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Studio health is available only to the local Vibe64 editor.",
    projectScoped: false,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "health"]
  });

  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_STUDIO_HEALTH,
    buildInput(request) {
      return {
        ...routes.requestQuery(request),
        ...(request.vibe64User ? { vibe64User: request.vibe64User } : {})
      };
    },
    query: studioHealthQueryInputValidator,
    summary: "Inspect Vibe64 host platform health."
  });
}

export { registerRoutes };
