import assert from "node:assert/strict";
import test from "node:test";

import { registerRoutes } from "../../packages/vibe64-source-editor/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

test("source explanation routes use the authenticated Vibe64 actor", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const sourceEditor = {
        async explainSelection(input) {
          calls.push(input);
          return { explanation: {}, ok: true };
        },
        async readTree() {
          return { ok: true, tree: [] };
        }
      };
      const app = testRouteApp();
      registerRoutes(app.http, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        sourceEditor
      });
      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/source-editor/explanations`
      });
      assert.ok(route);
      const vibe64User = {
        email: "ada@example.com",
        username: "ada"
      };
      const body = {
        endColumn: 8,
        endLine: 3,
        path: "src/app.js",
        startColumn: 1,
        startLine: 2,
        vibe64User: {
          username: "spoofed"
        }
      };

      await route.handler({
        input: { body },
        params: routeProjectParams({ sessionId: "session-1" }),
        vibe64User
      }, testReply());

      assert.deepEqual(calls, [{
        endColumn: 8,
        endLine: 3,
        force: false,
        originId: undefined,
        path: "src/app.js",
        sessionId: "session-1",
        startColumn: 1,
        startLine: 2,
        vibe64User
      }]);
    });
  });
});
