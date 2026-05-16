import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import { artifactsInputValidator } from "./inputSchemas.js";
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
  return response?.ok === false ? 400 : 200;
}

function getArtifactsService(app) {
  return app.make("feature.ai-studio-artifacts.service");
}

function requireLocalAiStudioRequest(request, reply) {
  return requireLocalStudioRequest(request, reply, {
    message: "AI Studio artifact routes only accept loopback Studio requests."
  });
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
    `${routeBase}/sessions/:sessionId/artifacts`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-artifacts"],
        summary: "Read editable AI Studio artifacts."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getArtifactsService(app).readArtifacts(request.params.sessionId);
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
        tags: ["studio", "ai-studio-artifacts"],
        summary: "Save editable AI Studio artifacts."
      },
      body: artifactsInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await getArtifactsService(app).saveArtifacts(
        request.params.sessionId,
        request.input.body || {}
      );
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );
}

export { registerRoutes };
