import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { createTerminalActions } from "./actions.js";
import {
  createProjectRuntimeChangedPublisher,
  createTerminalSessionChangedPublisher
} from "./events.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  createService,
  startProjectRuntimeDormancyCleanupSchedule
} from "./service.js";

const LIVE_PREVIEW_ROUTING_ENV_KEYS = Object.freeze([
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV
]);

function terminalsProviderEnv(runtimeEnv = {}, liveEnv = process.env) {
  const env = {
    ...(runtimeEnv && typeof runtimeEnv === "object" && !Array.isArray(runtimeEnv) ? runtimeEnv : {})
  };
  for (const key of LIVE_PREVIEW_ROUTING_ENV_KEYS) {
    const value = String(liveEnv?.[key] || "").trim();
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

function createVibe64TerminalsFeature({ codexTerminalController = {} } = {}) {
  const cleanupSchedules = new WeakMap();
  return defineFeature({
    id: "vibe64.terminals",
    domain: "vibe64-terminals",
    requires: {
      env: "runtime.env",
      events: "runtime.events",
      fastify: "runtime.fastify",
      http: "runtime.http",
      logger: "runtime.logger",
      project: "vibe64.project"
    },
    provides: {
      terminals: "vibe64.terminals"
    },
    actionDefaults: {
      channels: ["api", "automation", "internal"],
      surfaces: ["app"]
    },
    setup({ env, events, fastify, http, logger, project }) {
      const sessionChanged = createTerminalSessionChangedPublisher(events);
      const terminals = createService({
        codexTerminalController,
        env: terminalsProviderEnv(env),
        logger,
        projectService: project,
        publishProjectRuntimeChanged: createProjectRuntimeChangedPublisher(events),
        publishSessionChanged: {
          agentTerminal: sessionChanged,
          agentTerminalClosed: sessionChanged,
          launchTarget: sessionChanged,
          launchTargetClosed: sessionChanged,
          launchTargetStopped: sessionChanged
        }
      });
      registerRoutes(http, {
        fastify,
        projectContext: getStudioProjectContext(),
        routeRelativePath: "vibe64",
        routeSurface: "app",
        terminals
      });
      return { terminals };
    },
    actions: ({ terminals }) => createTerminalActions({ terminals }),
    async boot({ logger }, { outputs }) {
      const schedule = startProjectRuntimeDormancyCleanupSchedule({
        logger,
        serviceFactory: () => outputs.terminals
      });
      cleanupSchedules.set(outputs.terminals, schedule);
      await schedule.runNow();
    },
    async shutdown(_dependencies, { outputs }) {
      cleanupSchedules.get(outputs.terminals)?.stop();
      cleanupSchedules.delete(outputs.terminals);
      await outputs.terminals.close();
    }
  });
}

const Vibe64TerminalsProvider = createVibe64TerminalsFeature();

export {
  Vibe64TerminalsProvider,
  createVibe64TerminalsFeature,
  terminalsProviderEnv
};
