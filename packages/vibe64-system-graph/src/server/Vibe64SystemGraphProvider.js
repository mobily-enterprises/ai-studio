import { defineFeature } from "@jskit-ai/kernel/server/features";

import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";

const Vibe64SystemGraphProvider = defineFeature({
  id: "vibe64.system-graph",
  domain: "vibe64-system-graph",
  requires: {
    http: "runtime.http",
    project: "vibe64.project"
  },
  provides: {
    systemGraph: "vibe64.system-graph"
  },
  setup({ http, project }) {
    const systemGraph = createService({
      projectService: project
    });
    registerRoutes(http, {
      routeRelativePath: "vibe64",
      routeSurface: "app",
      systemGraph
    });
    return { systemGraph };
  }
});

export {
  Vibe64SystemGraphProvider
};
