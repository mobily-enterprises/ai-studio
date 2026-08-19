import {
  ACTION_CHECK_SESSION_UPDATES,
  ACTION_INSPECT_REPOSITORY_HISTORY,
  ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
  ACTION_INSPECT_REPOSITORY_VERSION_FILES,
  ACTION_ABANDON_SESSION,
  ACTION_BROADCAST_SESSION_PREVIEW_STATE,
  ACTION_BROADCAST_SESSION_VIEW_STATE,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_CHANGE_DIFF,
  ACTION_INSPECT_SESSION_CHANGES,
  ACTION_INSPECT_SESSION_WORK,
  ACTION_INTERRUPT_AGENT_TURN,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_SAVE_SESSION_WORK,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_UPDATE_CURRENT_SESSION,
  ACTION_UPDATE_SESSION_WORK
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

  routes.actionRoute("GET", "/repository/history", {
    actionId: ACTION_INSPECT_REPOSITORY_HISTORY,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        cursor: firstValue(query.cursor),
        limit: firstValue(query.limit),
        sessionId: firstValue(query.sessionId)
      });
    },
    summary: "Read a pinned page of project version history."
  });

  routes.actionRoute("GET", "/repository/history/:commit/files", {
    actionId: ACTION_INSPECT_REPOSITORY_VERSION_FILES,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        commit: request.params.commit,
        historySnapshotCommit: firstValue(query.historySnapshotCommit),
        limit: firstValue(query.limit),
        offset: firstValue(query.offset),
        sessionId: firstValue(query.sessionId)
      });
    },
    summary: "List files changed by one project version."
  });

  routes.actionRoute("GET", "/repository/history/:commit/diff", {
    actionId: ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        commit: request.params.commit,
        historySnapshotCommit: firstValue(query.historySnapshotCommit),
        lineLimit: firstValue(query.lineLimit),
        path: firstValue(query.path),
        sessionId: firstValue(query.sessionId)
      });
    },
    summary: "Read one file diff from a project version."
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

  routes.actionRoute("GET", "/sessions/:sessionId/work", {
    actionId: ACTION_INSPECT_SESSION_WORK,
    buildInput: (request) => withVibe64User(request, {
      sessionId: request.params.sessionId
    }),
    summary: "Inspect whether a Vibe64 session has work to save."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/changes", {
    actionId: ACTION_INSPECT_SESSION_CHANGES,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        limit: firstValue(query.limit),
        offset: firstValue(query.offset),
        sessionId: request.params.sessionId
      });
    },
    summary: "List the files that differ from this session's canonical project version."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/changes/diff", {
    actionId: ACTION_INSPECT_SESSION_CHANGE_DIFF,
    buildInput(request) {
      const query = routes.requestQuery(request);
      return withVibe64User(request, {
        lineLimit: firstValue(query.lineLimit),
        path: firstValue(query.path),
        sessionId: request.params.sessionId
      });
    },
    summary: "Read the bounded diff for one current project file."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/save", {
    actionId: ACTION_SAVE_SESSION_WORK,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Save session work to the project's canonical repository."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/updates/check", {
    actionId: ACTION_CHECK_SESSION_UPDATES,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Check whether this session has a newer saved project version."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/updates/apply", {
    actionId: ACTION_UPDATE_SESSION_WORK,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    }),
    summary: "Update this session (rebase) without publishing or discarding its work."
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
