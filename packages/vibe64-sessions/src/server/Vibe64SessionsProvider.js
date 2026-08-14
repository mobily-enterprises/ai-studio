import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  createVibe64SessionChangedPublisher,
  vibe64SessionChangedServiceEvent
} from "@local/vibe64-core/server/sessionRealtimeEvents";
import {
  vibe64SessionViewChangedServiceEvent
} from "@local/vibe64-core/server/sessionViewRealtimeEvents";
const VIBE64_SESSIONS_SERVICE = "feature.vibe64-sessions.service";

class Vibe64SessionsProvider {
  static id = "feature.vibe64-sessions";

  static startsAfter = [
    "runtime.actions",
    "feature.vibe64-project",
    "feature.vibe64-terminals"
  ];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("Vibe64SessionsProvider requires application service()/actions().");
    }
    app.service(
      VIBE64_SESSIONS_SERVICE,
      (scope) => {
        const domainEvents = typeof scope.has === "function" && scope.has("domainEvents")
          ? scope.make("domainEvents")
          : null;
        return createService({
          projectService: scope.make("feature.vibe64-project.service"),
          publishSessionChanged: createVibe64SessionChangedPublisher({
            domainEvents,
            methodName: "sendAgentMessage",
            serviceToken: VIBE64_SESSIONS_SERVICE
          }),
          terminalService: scope.make("feature.vibe64-terminals.service")
        });
      },
      {
        events: {
          abandonSession: [vibe64SessionChangedServiceEvent()],
          broadcastSessionViewState: [vibe64SessionViewChangedServiceEvent()],
          createSession: [vibe64SessionChangedServiceEvent({
            operation: "created"
          })],
          interruptAgentTurn: [vibe64SessionChangedServiceEvent({
            reason: "session-agent-turn-interrupted"
          })],
          sendAgentMessage: [vibe64SessionChangedServiceEvent({
            reason: "session-agent-message-accepted"
          })]
        }
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.vibe64-sessions.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
  }
}

export { Vibe64SessionsProvider };
