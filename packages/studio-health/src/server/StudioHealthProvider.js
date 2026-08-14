import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import { resolveStudioAppRoot } from "@local/vibe64-core/server/studioRoots";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";

class StudioHealthProvider {
  static id = "feature.studio-health";

  static startsAfter = [
    "runtime.actions",
    "feature.vibe64-accounts",
    "feature.vibe64-project"
  ];

  register(app) {
    if (!app || typeof app.service !== "function" || typeof app.actions !== "function") {
      throw new Error("StudioHealthProvider requires application service()/actions().");
    }

    app.service("feature.studio-health.service", (scope) => createService({
      connectionsService: scope.make("feature.vibe64-connections.service"),
      projectService: scope.make("feature.vibe64-project.service"),
      studioRoot: resolveStudioAppRoot()
    }));
    app.actions(withActionDefaults(featureActions, {
      domain: "feature",
      dependencies: {
        featureService: "feature.studio-health.service"
      }
    }));
  }

  boot(app) {
    registerRoutes(app);
  }
}

export { StudioHealthProvider };
