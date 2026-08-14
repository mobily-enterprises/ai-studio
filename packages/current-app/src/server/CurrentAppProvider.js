import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  jskitRuntimeEnv
} from "@local/vibe64-core/server/jskitRuntimeEnv";

class CurrentAppProvider {
  static id = "feature.current-app";

  static startsAfter = [
    "runtime.actions",
    "feature.vibe64-project"
  ];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("CurrentAppProvider requires application service()/actions().");
    }

    const providerEnv = jskitRuntimeEnv(app);
    app.service(
      "feature.current-app.service",
      (scope) => createService({
        env: providerEnv,
        projectService: scope.make("feature.vibe64-project.service")
      })
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.current-app.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "studio/current-app",
      routeSurface: "app"
    });
  }
}

export { CurrentAppProvider };
