import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class AiStudioTerminalsProvider {
  static id = "feature.ai-studio-terminals";

  static dependsOn = [
    "runtime.actions",
    "feature.ai-studio-project"
  ];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("AiStudioTerminalsProvider requires application service()/actions().");
    }

    app.service(
      "feature.ai-studio-terminals.service",
      (scope) => {
        return createService({
          projectService: scope.make("feature.ai-studio-project.service")
        });
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.ai-studio-terminals.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "ai-studio",
      routeSurface: "home"
    });
  }
}

export { AiStudioTerminalsProvider };
