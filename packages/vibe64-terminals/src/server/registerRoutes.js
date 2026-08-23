import {
  agentAttachmentInputValidator,
  launchTargetInputValidator,
  previewIdentityInputValidator,
  terminalControlKeyInputValidator,
  terminalControlTextInputValidator
} from "./inputSchemas.js";
import {
  ACTION_OPEN_LAUNCH_TARGET,
  ACTION_CREATE_TEMPORARY_CONVERSATION,
  ACTION_DELETE_AGENT_ATTACHMENT,
  ACTION_DELETE_TEMPORARY_CONVERSATION,
  ACTION_READ_TEMPORARY_CONVERSATION,
  ACTION_SELECT_PREVIEW_IDENTITY,
  ACTION_START_LAUNCH_TARGET_TERMINAL,
  ACTION_START_TEMPORARY_CONVERSATION_TURN,
  ACTION_STOP_TEMPORARY_CONVERSATION,
  ACTION_UPLOAD_AGENT_ATTACHMENT
} from "./actions.js";
import {
  CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES
} from "./codexAttachments.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { registerTerminalWebSocketRoute } from "@local/vibe64-core/server/terminalWebSocketRoutes";
import {
  terminalKeyInput,
  terminalSessionContainsText,
  terminalSessionControlSnapshot
} from "@local/vibe64-execution/server/terminalSessions";

const VIBE64_TERMINALS_UNAVAILABLE = "Vibe64 terminal service is unavailable.";

function registerRoutes(
  http,
  {
    fastify,
    projectContext = null,
    routeSurface = "",
    routeRelativePath = "",
    terminals
  } = {}
) {
  if (!terminals || typeof terminals !== "object") {
    throw new TypeError(VIBE64_TERMINALS_UNAVAILABLE);
  }
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 terminal routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-terminals"]
  });
  const terminalService = () => terminals;

  routes.serviceRoute("GET", "/codex-terminal", {
    summary: "Read global Vibe64 Codex terminal status."
  }, () => {
    return terminalService().globalCodexTerminalState();
  });

  routes.serviceRoute("POST", "/codex-terminal", {
    summary: "Start a global Vibe64 Codex terminal."
  }, () => {
    return terminalService().startGlobalCodexTerminal();
  });

  routes.serviceRoute("POST", "/agent-sessions/reconcile", {
    summary: "Reconnect assistant sessions for the current project."
  }, () => {
    return terminalService().reconcileOpenAgentSessions();
  });

  routes.serviceRoute("POST", "/project-runtime/open", {
    summary: "Mark the current Vibe64 project runtime open."
  }, (request) => {
    return terminalService().openProjectRuntime(routes.requestBody(request));
  });

  routes.serviceRoute("POST", "/project-runtime/close", {
    summary: "Close all Vibe64 runtime processes for the current project."
  }, (request) => {
    return terminalService().closeProjectRuntime(routes.requestBody(request));
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/launch-targets", {
    summary: "Read Vibe64 launch target status."
  }, (request) => {
    return terminalService().launchTargetStatus(request.params.sessionId, {
      ...requestPublicRouting(request)
    });
  });

  routes.actionRoute("POST", "/sessions/:sessionId/launch-terminal", {
    actionId: ACTION_START_LAUNCH_TARGET_TERMINAL,
    body: launchTargetInputValidator,
    buildInput: (request) => withVibe64User(request, bodyWithSessionId(routes)(request)),
    summary: "Start an Vibe64 launch target terminal."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/launch-target/open", {
    actionId: ACTION_OPEN_LAUNCH_TARGET,
    buildInput: sessionInput,
    summary: "Open the latest Vibe64 launch target."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/preview-identity", {
    actionId: ACTION_SELECT_PREVIEW_IDENTITY,
    body: previewIdentityInputValidator,
    buildInput(request) {
      const body = routes.requestBody(request);
      return {
        identityName: String(body.identityName || ""),
        mode: body.mode,
        ...requestPublicRouting(request),
        sessionId: request.params.sessionId
      };
    },
    summary: "Select the application identity for this preview browser."
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-terminal", {
    summary: "Start a Vibe64 AI terminal."
  }, (request) => {
    return terminalService().startAgentTerminal(
      request.params.sessionId,
      withVibe64User(request, routes.requestBody(request))
    );
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-session", {
    summary: "Prepare the Vibe64 assistant session."
  }, (request) => {
    return terminalService().ensureAgentSession(
      request.params.sessionId,
      withVibe64User(request, routes.requestBody(request))
    );
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-attachments", {
    actionId: ACTION_UPLOAD_AGENT_ATTACHMENT,
    body: agentAttachmentInputValidator,
    bodyLimit: CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES,
    buildInput: bodyWithSessionId(routes),
    summary: "Upload a temporary assistant attachment for a Vibe64 session."
  });

  routes.actionRoute("DELETE", "/sessions/:sessionId/agent-attachments/:attachmentId", {
    actionId: ACTION_DELETE_AGENT_ATTACHMENT,
    buildInput: (request) => ({
      attachmentId: request.params.attachmentId,
      sessionId: request.params.sessionId
    }),
    summary: "Delete one temporary assistant attachment."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations", {
    actionId: ACTION_CREATE_TEMPORARY_CONVERSATION,
    buildInput: (request) => withVibe64User(request, bodyWithSessionId(routes)(request)),
    summary: "Create an ephemeral Vibe64 assistant conversation."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/temporary-conversations/:conversationId", {
    actionId: ACTION_READ_TEMPORARY_CONVERSATION,
    buildInput: temporaryConversationInput,
    summary: "Read an ephemeral Vibe64 assistant conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations/:conversationId/turns", {
    actionId: ACTION_START_TEMPORARY_CONVERSATION_TURN,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      ...temporaryConversationInput(request)
    }),
    summary: "Start a turn in an ephemeral Vibe64 assistant conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations/:conversationId/stop", {
    actionId: ACTION_STOP_TEMPORARY_CONVERSATION,
    buildInput: (request) => ({
      ...routes.requestBody(request),
      ...temporaryConversationInput(request)
    }),
    summary: "Stop an ephemeral Vibe64 assistant conversation."
  });

  routes.actionRoute("DELETE", "/sessions/:sessionId/temporary-conversations/:conversationId", {
    actionId: ACTION_DELETE_TEMPORARY_CONVERSATION,
    buildInput: temporaryConversationInput,
    summary: "Delete an ephemeral Vibe64 assistant conversation."
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeLaunchTargetTerminal(sessionId, terminalSessionId),
    path: "/sessions/:sessionId/launch-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readLaunchTargetTerminal(sessionId, terminalSessionId),
    readSummary: "Read an Vibe64 launch target terminal snapshot.",
    closeSummary: "Close an Vibe64 launch target terminal.",
    write: (sessionId, terminalSessionId, data) => terminalService().writeLaunchTargetTerminal(sessionId, terminalSessionId, data)
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/launch-terminal/:terminalSessionId/stop", {
    statusCode: 200,
    summary: "Stop an Vibe64 launch target terminal without deleting its log."
  }, (request) => {
    const input = terminalRouteInput(request);
    return terminalService().stopLaunchTargetTerminal(input.sessionId, input.terminalSessionId);
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeAgentTerminal(sessionId, terminalSessionId),
    control: true,
    path: "/sessions/:sessionId/agent-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readAgentTerminal(sessionId, terminalSessionId),
    readSummary: "Read a Vibe64 AI terminal snapshot.",
    closeSummary: "Close a Vibe64 AI terminal.",
    write: (sessionId, terminalSessionId, data, input) => terminalService().writeAgentTerminal(sessionId, terminalSessionId, data, input)
  });

  registerGlobalTerminalSnapshotRoutes(routes, {
    close: (terminalSessionId) => terminalService().closeGlobalCodexTerminal(terminalSessionId),
    control: true,
    path: "/codex-terminal/:terminalSessionId",
    read: (terminalSessionId) => terminalService().readGlobalCodexTerminal(terminalSessionId),
    readSummary: "Read a global Vibe64 Codex terminal snapshot.",
    closeSummary: "Close a global Vibe64 Codex terminal.",
    write: (terminalSessionId, data) => terminalService().writeGlobalCodexTerminal(terminalSessionId, data)
  });

  registerVibe64TerminalWebSocketRoutes(fastify, routes, terminals, {
    projectContext
  });
}

function bodyWithSessionId(routes) {
  return function buildBodyWithSessionId(request) {
    return {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    };
  };
}

function sessionInput(request) {
  return {
    sessionId: request.params.sessionId
  };
}

function temporaryConversationInput(request) {
  return {
    conversationId: request.params.conversationId,
    sessionId: request.params.sessionId
  };
}

function withVibe64User(request, input = {}) {
  const vibe64User = request.vibe64User || null;
  const {
    vibe64User: _ignoredVibe64User,
    ...safeInput
  } = input || {};
  void _ignoredVibe64User;
  if (!vibe64User) {
    return safeInput;
  }
  return {
    ...safeInput,
    vibe64User
  };
}

function firstForwardedHeader(value = "") {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").split(",")[0]?.trim() || "";
}

function requestPublicRouting(request = {}) {
  return {
    publicHost: firstForwardedHeader(request.headers?.["x-forwarded-host"]) || request.headers?.host || "",
    publicProtocol: firstForwardedHeader(request.headers?.["x-forwarded-proto"]) || request.protocol || ""
  };
}

function firstRequestValue(value = "") {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

function requestQueryValue(request, key) {
  return firstRequestValue(request?.query?.[key] ?? request?.input?.query?.[key] ?? "");
}

function terminalControlInputFields(body = {}) {
  const originId = firstRequestValue(body?.originId);
  return {
    ...(originId ? { originId } : {}),
    trackGitActor: true
  };
}

function terminalRouteInput(request, input = {}) {
  return withVibe64User(request, {
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
    sessionId: request.params.sessionId,
    terminalSessionId: request.params.terminalSessionId
  });
}

function globalTerminalRouteInput(request, input = {}) {
  return {
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
    terminalSessionId: request.params.terminalSessionId
  };
}

function registerTerminalSnapshotRoutes(routes, {
  close,
  closeSummary,
  control = false,
  path,
  read,
  readSummary,
  write = null
}) {
  routes.serviceRoute("GET", path, {
    failureStatus: 404,
    successStatus: 200,
    summary: readSummary
  }, (request) => {
    const input = terminalRouteInput(request);
    return read(input.sessionId, input.terminalSessionId, input);
  });

  routes.serviceRoute("DELETE", path, {
    statusCode: 200,
    summary: closeSummary
  }, (request) => {
    const input = terminalRouteInput(request);
    return close(input.sessionId, input.terminalSessionId, input);
  });

  if (control) {
    registerTerminalControlRoutes(routes, {
      inputForRequest: terminalRouteInput,
      path,
      read: (input) => read(input.sessionId, input.terminalSessionId, input),
      write: write
        ? (input, data) => write(input.sessionId, input.terminalSessionId, data, input)
        : null
    });
  }
}

function registerGlobalTerminalSnapshotRoutes(routes, {
  close,
  closeSummary,
  control = false,
  path,
  read,
  readSummary,
  write = null
}) {
  routes.serviceRoute("GET", path, {
    failureStatus: 404,
    successStatus: 200,
    summary: readSummary
  }, (request) => {
    const input = globalTerminalRouteInput(request);
    return read(input.terminalSessionId);
  });

  routes.serviceRoute("DELETE", path, {
    statusCode: 200,
    summary: closeSummary
  }, (request) => {
    const input = globalTerminalRouteInput(request);
    return close(input.terminalSessionId);
  });

  if (control) {
    registerTerminalControlRoutes(routes, {
      inputForRequest: globalTerminalRouteInput,
      path,
      read: (input) => read(input.terminalSessionId),
      write: write
        ? (input, data) => write(input.terminalSessionId, data)
        : null
    });
  }
}

function registerTerminalControlRoutes(routes, {
  inputForRequest,
  path,
  read,
  write
}) {
  routes.serviceRoute("GET", `${path}/control/snapshot`, {
    failureStatus: 404,
    successStatus: 200,
    summary: "Read a terminal control snapshot."
  }, async (request) => {
    return terminalSessionControlSnapshot(await read(inputForRequest(request)));
  });

  routes.serviceRoute("GET", `${path}/control/quiet`, {
    failureStatus: 404,
    successStatus: 200,
    summary: "Read whether a terminal has been quiet recently."
  }, async (request) => {
    return terminalSessionControlSnapshot(await read(inputForRequest(request)));
  });

  routes.serviceRoute("POST", `${path}/control/check-text`, {
    body: terminalControlTextInputValidator,
    failureStatus: 404,
    successStatus: 200,
    summary: "Check whether a terminal snapshot contains literal text."
  }, async (request) => {
    return terminalSessionContainsText(
      await read(inputForRequest(request)),
      routes.requestBody(request).text
    );
  });

  if (!write) {
    return;
  }

  routes.serviceRoute("POST", `${path}/control/text`, {
    body: terminalControlTextInputValidator,
    failureStatus: 404,
    successStatus: 200,
    summary: "Send exact text to a terminal."
  }, async (request) => {
    const body = routes.requestBody(request);
    return terminalSessionControlSnapshot(
      await write(inputForRequest(request, terminalControlInputFields(body)), body.text)
    );
  });

  routes.serviceRoute("POST", `${path}/control/key`, {
    body: terminalControlKeyInputValidator,
    failureStatus: 404,
    successStatus: 200,
    summary: "Send a narrow supported key to a terminal."
  }, async (request) => {
    const body = routes.requestBody(request);
    const key = body.key;
    const input = terminalKeyInput(key);
    if (!input) {
      return {
        ok: false,
        error: `Unsupported terminal key: ${String(key || "")}`
      };
    }
    return terminalSessionControlSnapshot(await write(inputForRequest(request, terminalControlInputFields(body)), input));
  });
}

function registerVibe64TerminalWebSocketRoutes(fastify, routes, terminals, {
  projectContext = null
} = {}) {
  registerTerminalWebSocketRoute(fastify, {
    projectContext,
    routePath: `${routes.routeBase}/codex-terminal/:terminalSessionId/ws`,
    service: terminals,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { subscriber, terminalSessionId }) {
      return service.subscribeGlobalCodexTerminal(terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, terminalSessionId }) {
      return service.resizeGlobalCodexTerminal(terminalSessionId, { cols, rows });
    },
    write(service, { data, terminalSessionId }) {
      return service.writeGlobalCodexTerminal(terminalSessionId, data);
    }
  });

  registerTerminalWebSocketRoute(fastify, {
    projectContext,
    routePath: `${routes.routeBase}/sessions/:sessionId/agent-terminal/:terminalSessionId/ws`,
    service: terminals,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeAgentTerminal(sessionId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, sessionId, terminalSessionId }) {
      return service.resizeAgentTerminal(sessionId, terminalSessionId, { cols, rows });
    },
    write(service, { data, request, sessionId, terminalSessionId }) {
      return service.writeAgentTerminal(sessionId, terminalSessionId, data, {
        originId: requestQueryValue(request, "originId"),
        request
      });
    }
  });

  registerTerminalWebSocketRoute(fastify, {
    projectContext,
    routePath: `${routes.routeBase}/sessions/:sessionId/launch-terminal/:terminalSessionId/ws`,
    service: terminals,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeLaunchTargetTerminal(sessionId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, sessionId, terminalSessionId }) {
      return service.resizeLaunchTargetTerminal(sessionId, terminalSessionId, { cols, rows });
    },
    write(service, { data, sessionId, terminalSessionId }) {
      return service.writeLaunchTargetTerminal(sessionId, terminalSessionId, data);
    }
  });

}

export { registerRoutes };
