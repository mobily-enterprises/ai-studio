import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService,
  resolveAiStudioTargetRoot
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class AiStudioProjectProvider {
  static id = "feature.ai-studio-project";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("AiStudioProjectProvider requires application service()/actions().");
    }

    const targetRoot = resolveAiStudioTargetRoot();

    app.service(
      "feature.ai-studio-project.service",
      () => {
        return createService({
          targetRoot
        });
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.ai-studio-project.service"
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

export { AiStudioProjectProvider };
