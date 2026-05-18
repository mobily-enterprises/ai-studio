import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService,
  resolveAiStudioAccountsRoot
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class AiStudioAccountsProvider {
  static id = "feature.ai-studio-accounts";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("AiStudioAccountsProvider requires application service()/actions().");
    }

    const targetRoot = resolveAiStudioAccountsRoot();

    app.service(
      "feature.ai-studio-accounts.service",
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
          featureService: "feature.ai-studio-accounts.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "ai-studio/accounts",
      routeSurface: "home"
    });
  }
}

export { AiStudioAccountsProvider };
