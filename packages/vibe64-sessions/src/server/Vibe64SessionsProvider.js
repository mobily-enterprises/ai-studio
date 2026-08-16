import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createSessionActions } from "./actions.js";
import { createSessionChangedPublisher } from "./events.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";

const Vibe64SessionsProvider = defineFeature({
  id: "vibe64.sessions",
  domain: "vibe64-sessions",
  requires: {
    events: "runtime.events",
    http: "runtime.http",
    project: "vibe64.project",
    terminals: "vibe64.terminals"
  },
  provides: {
    sessions: "vibe64.sessions"
  },
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
  },
  setup({ events, http, project, terminals }) {
    const sessions = createService({
      project,
      publishSessionChanged: createSessionChangedPublisher(events),
      terminals
    });
    registerRoutes(http, {
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
    return { sessions };
  },
  actions({ sessions }) {
    return createSessionActions({ sessions });
  }
});

export { Vibe64SessionsProvider };
