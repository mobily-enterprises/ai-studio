import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import {
  ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
  ACTION_LOGOUT_ACCOUNT,
  ACTION_READ_ACCOUNTS,
  ACTION_READ_ACCOUNT_AUTH_SESSION,
  ACTION_START_ACCOUNT_AUTH
} from "./actions.js";
import {
  accountIdInputValidator,
  accountAuthSessionInputValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator
} from "./inputSchemas.js";
import {
  requireLocalStudioRequest
} from "../../../../server/lib/localStudioRequest.js";
import {
  aiStudioStatusCode,
  requestBodyObject
} from "../../../../server/lib/aiStudio/serverResponses.js";

function requireLocalAccountsRequest(request, reply) {
  return requireLocalStudioRequest(request, reply, {
    message: "AI Studio account routes only accept loopback Studio requests."
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
    routeBase,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-accounts"],
        summary: "Read AI Studio account readiness."
      },
      query: accountsReadInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAccountsRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_READ_ACCOUNTS,
        input: request.input.query || {}
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/auth`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-accounts"],
        summary: "Start an AI Studio account login flow."
      },
      body: accountAuthStartInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAccountsRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_START_ACCOUNT_AUTH,
        input: requestBodyObject(request)
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/logout`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-accounts"],
        summary: "Log out an AI Studio account."
      },
      body: accountIdInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAccountsRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_LOGOUT_ACCOUNT,
        input: requestBodyObject(request)
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/auth/:sessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-accounts"],
        summary: "Read an AI Studio account login session."
      },
      params: accountAuthSessionInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAccountsRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_READ_ACCOUNT_AUTH_SESSION,
        input: {
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/auth/:sessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-accounts"],
        summary: "Cancel an AI Studio account login session."
      },
      params: accountAuthSessionInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAccountsRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
        input: {
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );
}

export { registerRoutes };
