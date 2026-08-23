import assert from "node:assert/strict";
import test from "node:test";

import {
  registerRoutes
} from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import {
  ACTION_CREATE_TEMPORARY_CONVERSATION,
  ACTION_START_TEMPORARY_CONVERSATION_TURN
} from "../../packages/vibe64-terminals/src/server/actions.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

function terminalControlRouteApp(service) {
  const registeredRoutes = [];
  const websocketRoutes = [];
  return {
    fastify: {
      get(path, options, handler) {
        websocketRoutes.push({
          handler,
          options,
          path
        });
      }
    },
    http: {
      router: {
        register(method, path, options, handler) {
          registeredRoutes.push({
            handler,
            method,
            options,
            path
          });
        }
      }
    },
    registeredRoutes,
    service,
    websocketRoutes
  };
}

async function runRoute(app, {
  body = {},
  method = "GET",
  path,
  params = {}
} = {}) {
  const route = findRegisteredRoute(app, {
    method,
    path
  });
  assert.ok(route, `Expected route ${method} ${path}`);
  const reply = testReply();
  await route.handler({
    input: {
      body
    },
    params
  }, reply);
  return reply;
}

test("terminal control routes expose snapshot, text checks, exact text, and narrow keys", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const writes = [];
      let output = "ready prompt";
      const createdAt = new Date(Date.now() - 4000).toISOString();
      const service = {
        closeAgentTerminal() {
          return {
            closed: true,
            ok: true
          };
        },
        async readAgentTerminal(_sessionId, terminalSessionId) {
          return {
            commandPreview: "codex",
            createdAt,
            id: terminalSessionId,
            inputVersion: writes.length,
            lastInputAt: "",
            lastOutputAt: createdAt,
            ok: true,
            output,
            outputVersion: 1,
            status: "running"
          };
        },
        async writeAgentTerminal(_sessionId, terminalSessionId, data) {
          writes.push({
            data,
            terminalSessionId
          });
          output += data;
          return this.readAgentTerminal(_sessionId, terminalSessionId);
        }
      };
      const app = terminalControlRouteApp(service);
      registerRoutes(app.http, {
        fastify: app.fastify,
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        terminals: app.service
      });
      assert.equal(findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/command-terminal/:terminalSessionId/control/text`
      }), null);
      const path = `${apiRouteBase}/vibe64/sessions/:sessionId/agent-terminal/:terminalSessionId`;
      const params = routeProjectParams({
        sessionId: "session-1",
        terminalSessionId: "terminal-1"
      });

    const quiet = await runRoute(app, {
      method: "GET",
      params,
      path: `${path}/control/quiet`
    });
    assert.equal(quiet.statusCode, 200);
    assert.equal(quiet.payload.quiet, true);
    assert.equal(quiet.payload.quietThresholdMs, 3000);

    const check = await runRoute(app, {
      body: {
        text: "ready prompt"
      },
      method: "POST",
      params,
      path: `${path}/control/check-text`
    });
    assert.equal(check.statusCode, 200);
    assert.equal(check.payload.containsText, true);
    assert.equal(check.payload.checkedTextLength, "ready prompt".length);

    const text = await runRoute(app, {
      body: {
        text: "echo hi\n"
      },
      method: "POST",
      params,
      path: `${path}/control/text`
    });
    assert.equal(text.statusCode, 200);
    assert.deepEqual(writes.at(-1), {
      data: "echo hi\n",
      terminalSessionId: "terminal-1"
    });

    const key = await runRoute(app, {
      body: {
        key: "escape"
      },
      method: "POST",
      params,
      path: `${path}/control/key`
    });
    assert.equal(key.statusCode, 200);
    assert.deepEqual(writes.at(-1), {
      data: "\u001b",
      terminalSessionId: "terminal-1"
    });
    });
  });
});

test("assistant terminal control text uses the server Vibe64 user instead of body spoofing", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const app = terminalControlRouteApp({
        async writeAgentTerminal(sessionId, terminalSessionId, data, input) {
          calls.push({
            data,
            input,
            sessionId,
            terminalSessionId
          });
          return {
            id: terminalSessionId,
            ok: true,
            output: data,
            status: "running"
          };
        }
      });
      registerRoutes(app.http, {
        fastify: app.fastify,
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        terminals: app.service
      });

      const serverUser = {
        email: "owner@example.com"
      };
      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/agent-terminal/:terminalSessionId/control/text`
      });
      assert.ok(route, "Expected assistant terminal text route");
      const reply = testReply();

      await route.handler({
        input: {
          body: {
            originId: "tab:owner",
            text: "Please push.\r",
            vibe64User: {
              email: "spoof@example.com"
            }
          }
        },
        params: routeProjectParams({
          sessionId: "session-1",
          terminalSessionId: "terminal-1"
        }),
        vibe64User: serverUser
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(calls, [
        {
          data: "Please push.\r",
          input: {
            originId: "tab:owner",
            sessionId: "session-1",
            terminalSessionId: "terminal-1",
            trackGitActor: true,
            vibe64User: serverUser
          },
          sessionId: "session-1",
          terminalSessionId: "terminal-1"
        }
      ]);
    });
  });
});

test("temporary AI creation and turns use the authenticated Vibe64 actor", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = terminalControlRouteApp({});
      registerRoutes(app.http, {
        fastify: app.fastify,
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        terminals: app.service
      });
      const vibe64User = {
        displayName: "Ada Account",
        preferredName: "Ada",
        username: "ada"
      };
      const calls = [];
      const executeAction = async (action) => {
        calls.push(action);
        return { ok: true };
      };
      const createRoute = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/temporary-conversations`
      });
      const turnRoute = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/temporary-conversations/:conversationId/turns`
      });
      assert.ok(createRoute);
      assert.ok(turnRoute);

      await createRoute.handler({
        body: {
          vibe64User: { username: "spoofed" }
        },
        executeAction,
        params: routeProjectParams({ sessionId: "session-1" }),
        vibe64User
      }, testReply());
      await turnRoute.handler({
        body: {
          message: "Explain the failure.",
          vibe64User: { username: "spoofed" }
        },
        executeAction,
        params: routeProjectParams({
          conversationId: "conversation-1",
          sessionId: "session-1"
        }),
        vibe64User
      }, testReply());

      assert.deepEqual(calls, [
        {
          actionId: ACTION_CREATE_TEMPORARY_CONVERSATION,
          input: {
            sessionId: "session-1",
            vibe64User
          }
        },
        {
          actionId: ACTION_START_TEMPORARY_CONVERSATION_TURN,
          input: {
            conversationId: "conversation-1",
            message: "Explain the failure.",
            sessionId: "session-1",
            vibe64User
          }
        }
      ]);
    });
  });
});
