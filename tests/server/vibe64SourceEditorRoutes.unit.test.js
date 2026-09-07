import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";

import { registerRoutes } from "../../packages/vibe64-source-editor/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

test("star routes accept only trusted identity and download responses are private attachments", async () => {
  await withLocalRequestBypass(async () => withRouteProject(async ({ apiRouteBase, projectContext }) => {
    const calls = [];
    const stream = Readable.from([Buffer.from([0, 255, 7])]);
    const app = testRouteApp();
    registerRoutes(app.http, {
      projectContext, routeRelativePath: "vibe64", routeSurface: "app",
      sourceEditor: {
        async readTree() { return { ok: true }; },
        async readStarredFiles(input) { calls.push(input); return { ok: true, files: [] }; },
        async setStarredFile(input) { calls.push(input); return { ok: true, paths: [input.path] }; },
        async downloadFile() { return { ok: true, name: "résumé (1).bin", fileHandle: {
          createReadStream(options) { assert.deepEqual(options, { autoClose: true }); return stream; }
        } }; }
      }
    });
    const base = `${apiRouteBase}/vibe64/sessions/:sessionId/source-editor`;
    const actor = { username: "ada", uid: 1001 };
    const params = routeProjectParams({ sessionId: "session-1" });
    await findRegisteredRoute(app, { method: "POST", path: `${base}/stars` }).handler({
      params, vibe64User: actor, input: { body: { path: "src/app.js", starred: true, vibe64User: { username: "bob" } } }
    }, testReply());
    assert.deepEqual(calls[0], { sessionId: "session-1", path: "src/app.js", starred: true, vibe64User: actor });
    await findRegisteredRoute(app, { method: "GET", path: `${base}/stars` }).handler({ params, vibe64User: actor }, testReply());
    assert.deepEqual(calls[1], { sessionId: "session-1", vibe64User: actor });
    const reply = { ...testReply(), headers: {}, header(key, value) { this.headers[key] = value; return this; } };
    await findRegisteredRoute(app, { method: "GET", path: `${base}/download` }).handler({ params, input: { query: { path: "résumé (1).bin" } } }, reply);
    assert.equal(reply.payload, stream);
    assert.equal(reply.headers["Content-Disposition"], "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9%20%281%29.bin");
    assert.equal(reply.headers["Content-Type"], "application/octet-stream");
    assert.equal(reply.headers["Cache-Control"], "private, no-store");
  }));
});

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

test("source file creation publishes a created refresh after the durable write", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const created = {
        file: { path: "src/new.js" },
        fileChange: {
          hash: "hash-1",
          originId: "tab-1",
          path: "src/new.js",
          projectSlug: "unit_project",
          sessionId: "session-1"
        },
        ok: true
      };
      const sourceEditor = {
        async createFile(input) {
          calls.push(["create", input]);
          return created;
        },
        async readTree() {
          return { ok: true, tree: [] };
        }
      };
      const app = testRouteApp();
      registerRoutes(app.http, {
        async publishFileChanged(result, options) {
          calls.push(["publish", result, options]);
        },
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        sourceEditor
      });
      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/source-editor/file`
      });

      const reply = testReply();
      await route.handler({
        input: {
          body: {
            originId: "tab-1",
            path: "src/new.js",
            projectSlug: "unit_project"
          }
        },
        params: routeProjectParams({ sessionId: "session-1" })
      }, reply);

      assert.equal(reply.payload, created);
      assert.deepEqual(calls, [
        ["create", {
          originId: "tab-1",
          path: "src/new.js",
          projectSlug: "unit_project",
          sessionId: "session-1"
        }],
        ["publish", created, { operation: "created" }]
      ]);
    });
  });
});
