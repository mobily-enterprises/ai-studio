import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import {
  aiStudioArtifactsInputValidator,
  codexAttachmentInputValidator,
  codexPromptHandoffInputValidator,
  codexThreadInputValidator
} from "./inputSchemas.js";
import {
  requireLocalStudioRequest
} from "../../../../server/lib/localStudioRequest.js";

function aiStudioStatusCode(response, { missingStatus = 404 } = {}) {
  const code = response?.errors?.[0]?.code || "";
  if (code === "ai_studio_session_not_found") {
    return missingStatus;
  }
  if (code.startsWith("ai_studio_invalid") || code === "ai_studio_project_type_missing") {
    return 400;
  }
  if (code === "ai_studio_action_disabled" || code === "ai_studio_step_not_ready") {
    return 409;
  }
  return response?.ok === false ? 400 : 200;
}

function getAiStudioService(app) {
  return app.make("feature.ai-studio.service");
}

function requireLocalAiStudioRequest(request, reply) {
  return requireLocalStudioRequest(request, reply, {
    message: "AI Studio routes only accept loopback Studio requests."
  });
}

function requestBodyObject(request) {
  const body = request.input?.body || request.body || {};
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveScopedApiBasePath({
    routeBase: "/",
    relativePath: routeRelativePath,
    strictParams: false
  });

  router.register(
    "GET",
    `${routeBase}/project-type`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Read the AI Studio project type."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).readProjectType();
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "PUT",
    `${routeBase}/project-type`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Set the AI Studio project type."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).saveProjectType(requestBodyObject(request));
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/sessions`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "List AI Studio sessions."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).listSessions();
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Create an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).createSession();
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/sessions/:sessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Inspect an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).inspectSession(request.params.sessionId);
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/actions/:actionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Run an AI Studio session action."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).runSessionAction(
        request.params.sessionId,
        request.params.actionId,
        requestBodyObject(request)
      );
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/command-terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Start an AI Studio command terminal."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).startCommandTerminal(
        request.params.sessionId,
        requestBodyObject(request)
      );
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/codex-terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Start an AI Studio Codex terminal."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).startCodexTerminal(request.params.sessionId);
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/codex-attachments`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Upload a temporary Codex attachment for an AI Studio session."
      },
      body: codexAttachmentInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).uploadCodexAttachment(
        request.params.sessionId,
        request.input.body || {}
      );
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/codex-thread`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Persist the active Codex thread for an AI Studio session."
      },
      body: codexThreadInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).saveCodexThread(
        request.params.sessionId,
        request.input.body || {}
      );
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/codex-prompt-handoff`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Persist the active Codex prompt handoff for an AI Studio session."
      },
      body: codexPromptHandoffInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).saveCodexPromptHandoff(
        request.params.sessionId,
        request.input.body || {}
      );
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/sessions/:sessionId/artifacts`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Read editable AI Studio artifacts."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).readArtifacts(request.params.sessionId);
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "PUT",
    `${routeBase}/sessions/:sessionId/artifacts`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Save editable AI Studio artifacts."
      },
      body: aiStudioArtifactsInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).saveArtifacts(
        request.params.sessionId,
        request.input.body || {}
      );
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/advance`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Advance an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).advanceSession(request.params.sessionId);
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/sessions/:sessionId/codex-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Read an AI Studio Codex terminal snapshot."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).readCodexTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(response?.ok === false ? 404 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/sessions/:sessionId/codex-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Close an AI Studio Codex terminal."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).closeCodexTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/sessions/:sessionId/command-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Read an AI Studio command terminal snapshot."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).readCommandTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(response?.ok === false ? 404 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/sessions/:sessionId/command-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Close an AI Studio command terminal."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).closeCommandTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/abandon`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio"],
        summary: "Abandon an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getAiStudioService(app).abandonSession(request.params.sessionId);
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );
}

export { registerRoutes };
