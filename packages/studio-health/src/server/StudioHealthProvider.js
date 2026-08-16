import { defineFeature } from "@jskit-ai/kernel/server/features";

import { resolveStudioAppRoot } from "@local/vibe64-core/server/studioRoots";
import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";

const StudioHealthProvider = defineFeature({
  id: "vibe64.studio-health",
  domain: "vibe64-studio-health",
  requires: {
    connections: "vibe64.connections",
    http: "runtime.http",
    project: "vibe64.project"
  },
  provides: {
    studioHealth: "vibe64.studio-health"
  },
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
  },
  setup({ connections, http, project }) {
    const studioHealth = createService({
      connectionsService: connections,
      projectService: project,
      studioRoot: resolveStudioAppRoot()
    });
    registerRoutes(http);
    return { studioHealth };
  },
  actions({ studioHealth }) {
    return createActions({ studioHealth });
  }
});

export { StudioHealthProvider };
