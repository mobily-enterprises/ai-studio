import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { createProjectActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";

const Vibe64ProjectProvider = defineFeature({
  id: "vibe64.project",
  domain: "vibe64-project",
  requires: {
    env: "runtime.env",
    http: "runtime.http"
  },
  provides: {
    project: "vibe64.project"
  },
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
  },
  setup({ env, http }) {
    const project = createService({
      env,
      projectContext: getStudioProjectContext()
    });
    registerRoutes(http, {
      project,
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
    return { project };
  },
  actions({ project }) {
    return createProjectActions({ project });
  }
});

export { Vibe64ProjectProvider };
