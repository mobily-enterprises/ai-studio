import {
  ACTION_ABANDON_SESSION,
  ACTION_BROADCAST_SESSION_PREVIEW_STATE,
  ACTION_BROADCAST_SESSION_VIEW_STATE,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_DIFF,
  ACTION_INTERRUPT_AGENT_TURN,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_UPDATE_CURRENT_SESSION
} from "./actions.js";
import {
  agentMessageInputValidator,
  agentTurnInterruptInputValidator
} from "./inputSchemas.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(http, {
  projectContext = null,
  routeSurface = "",
  routeRelativePath = ""
} = {}) {
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 session routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-sessions"]
  });

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

  routes.actionRoute("POST", "/sessions/:sessionId/agent-message", {
    actionId: ACTION_SEND_AGENT_MESSAGE,
    body: agentMessageInputValidator,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Send a message to the Vibe64 assistant."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-turn/interrupt", {
    actionId: ACTION_INTERRUPT_AGENT_TURN,
    body: agentTurnInterruptInputValidator,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Interrupt the active Vibe64 assistant turn."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/view-state", {
    actionId: ACTION_BROADCAST_SESSION_VIEW_STATE,
    buildInput: (request) => ({
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Publish a Vibe64 session view state."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/preview-state", {
    actionId: ACTION_BROADCAST_SESSION_PREVIEW_STATE,
    buildInput: (request) => ({
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Publish the page displayed in a Vibe64 managed preview."
  });

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
