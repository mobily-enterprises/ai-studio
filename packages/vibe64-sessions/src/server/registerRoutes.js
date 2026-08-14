import {
  ACTION_ABANDON_SESSION,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_DIFF,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_UPDATE_CURRENT_SESSION
} from "./actions.js";
import {
  agentMessageInputValidator,
  agentTurnInterruptInputValidator
} from "./inputSchemas.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(app, {
  projectContext = null,
  routeSurface = "",
  routeRelativePath = ""
} = {}) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 session routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-sessions"]
  });
  const service = () => app.make("feature.vibe64-sessions.service");

  routes.actionRoute("GET", "/sessions", {
    actionId: ACTION_LIST_SESSIONS,
    buildInput: (request) => withVibe64User(request, {
      archive: request.query?.archive || request.input?.query?.archive || ""
    }),
    summary: "List Vibe64 sessions."
  });

  routes.actionRoute("POST", "/sessions", {
    actionId: ACTION_CREATE_SESSION,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Create a Vibe64 chat session."
  });

  routes.actionRoute("PUT", "/sessions/current", {
    actionId: ACTION_UPDATE_CURRENT_SESSION,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Update the current Vibe64 session alias."
  });

  routes.actionRoute("GET", "/sessions/:sessionId", {
    actionId: ACTION_INSPECT_SESSION,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        projectSlug: firstValue(query.projectSlug),
        sessionId: request.params.sessionId
      });
    },
    summary: "Inspect a Vibe64 chat session."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/diff", {
    actionId: ACTION_INSPECT_SESSION_DIFF,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        full: firstValue(query.full),
        lineLimit: firstValue(query.lineLimit),
        sessionId: request.params.sessionId
      });
    },
    summary: "Inspect changes in a Vibe64 session source tree."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/conversation-log", {
    actionId: ACTION_READ_SESSION_CONVERSATION_LOG,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        beforeTurnId: firstValue(query.beforeTurnId || query.before),
        limit: firstValue(query.limit),
        sessionId: request.params.sessionId
      });
    },
    summary: "Read a Vibe64 session conversation."
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-message", {
    body: agentMessageInputValidator,
    summary: "Send a message to the Vibe64 assistant."
  }, (request) => service().sendAgentMessage(
    request.params.sessionId,
    withVibe64User(request, routes.requestBody(request))
  ));

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-turn/interrupt", {
    body: agentTurnInterruptInputValidator,
    summary: "Interrupt the active Vibe64 assistant turn."
  }, (request) => service().interruptAgentTurn(
    request.params.sessionId,
    withVibe64User(request, routes.requestBody(request))
  ));

  routes.serviceRoute("POST", "/sessions/:sessionId/view-state", {
    summary: "Publish a Vibe64 session view state."
  }, (request) => service().broadcastSessionViewState(request.params.sessionId, routes.requestBody(request)));

  routes.serviceRoute("POST", "/sessions/:sessionId/preview-state", {
    summary: "Publish the page displayed in a Vibe64 managed preview."
  }, (request) => service().broadcastSessionPreviewState(request.params.sessionId, routes.requestBody(request)));

  routes.actionRoute("POST", "/sessions/:sessionId/abandon", {
    actionId: ACTION_ABANDON_SESSION,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Close and archive a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/workspace-setup/retry", {
    actionId: ACTION_RETRY_WORKSPACE_SETUP,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Retry the declared Genesis workspace preparation recipe."
  });
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function withVibe64User(request, input = {}) {
  const {
    vibe64User: _ignored,
    ...safeInput
  } = input || {};
  void _ignored;
  return request.vibe64User
    ? {
        ...safeInput,
        vibe64User: request.vibe64User
      }
    : safeInput;
}

export { registerRoutes };
