import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

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

function getSessionService(app) {
  return app.make("feature.ai-studio-sessions.service");
}

function requireLocalAiStudioRequest(request, reply) {
  return requireLocalStudioRequest(request, reply, {
    message: "AI Studio session routes only accept loopback Studio requests."
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
    `${routeBase}/sessions`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-sessions"],
        summary: "List AI Studio sessions."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getSessionService(app).listSessions();
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
        tags: ["studio", "ai-studio-sessions"],
        summary: "Create an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getSessionService(app).createSession();
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
        tags: ["studio", "ai-studio-sessions"],
        summary: "Inspect an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getSessionService(app).inspectSession(request.params.sessionId);
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
        tags: ["studio", "ai-studio-sessions"],
        summary: "Run an AI Studio session action."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getSessionService(app).runSessionAction(
        request.params.sessionId,
        request.params.actionId,
        requestBodyObject(request)
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
        tags: ["studio", "ai-studio-sessions"],
        summary: "Advance an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getSessionService(app).advanceSession(request.params.sessionId);
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/abandon`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-sessions"],
        summary: "Abandon an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getSessionService(app).abandonSession(request.params.sessionId);
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );
}

export { registerRoutes };
