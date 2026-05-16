import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService,
  resolveAiStudioTargetRoot
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class AiStudioProvider {
  static id = "feature.ai-studio";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("AiStudioProvider requires application singleton()/service()/actions().");
    }

    const targetRoot = resolveAiStudioTargetRoot();

    app.service(
      "feature.ai-studio.service",
      (_scope) => {
        return createService({
          targetRoot
        });
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.ai-studio.service"
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

export { AiStudioProvider };
