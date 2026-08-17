import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_APPLY_PROJECT_TEMPLATE,
  ACTION_LIST_PROJECT_TEMPLATES,
  ACTION_READ_PROJECT_SETTINGS,
  ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
  ACTION_SAVE_ENV_USER_VALUES,
  ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES
} from "../../packages/vibe64-project/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-project/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

function routeHttp(app) {
  return app.http;
}

test("project settings routes own the development database choice outside Env", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(routeHttp(app), {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const readRoute = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/settings`
      });
      const saveRoute = findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/settings/development-database`
      });
      assert.ok(readRoute);
      assert.ok(saveRoute);
      assert.equal(findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/env/development-database`
      }), null);
      assert.deepEqual(saveRoute.options.body.schema.patch({ scope: "project" }), {
        errors: {},
        validatedObject: {
          scope: "project"
        }
      });
      const calls = [];
      const executeAction = async (action) => {
        calls.push(action);
        return { ok: true };
      };
      await readRoute.handler({
        input: {
          query: {}
        },
        params: routeProjectParams(),
        executeAction
      }, testReply());
      await saveRoute.handler({
        body: {
          scope: "project"
        },
        input: {
          body: {
            scope: "project"
          }
        },
        params: routeProjectParams(),
        executeAction
      }, testReply());
      assert.deepEqual(calls, [
        {
          actionId: ACTION_READ_PROJECT_SETTINGS,
          input: {}
        },
        {
          actionId: ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
          input: {
            scope: "project"
          }
        }
      ]);
    });
  });
});

test("Env user value route returns 400 for read-only provider Env writes", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(routeHttp(app), {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/env/user-values`
      });
      assert.ok(route);

      let executedAction = null;
      const reply = testReply();
      await route.handler({
        body: {
          environment: "dev",
          values: {
            AUTH_SUPABASE_URL: {
              secret: false,
              value: "https://override.supabase.co"
            }
          }
        },
        input: {
          body: {
            environment: "dev",
            values: {
              AUTH_SUPABASE_URL: {
                secret: false,
                value: "https://override.supabase.co"
              }
            }
          }
        },
        params: routeProjectParams(),
        async executeAction(action) {
          executedAction = action;
          return {
            code: "vibe64_env_value_not_editable",
            error: "AUTH_SUPABASE_URL is not editable as a user Env value.",
            errors: [
              {
                code: "vibe64_env_value_not_editable",
                message: "AUTH_SUPABASE_URL is not editable as a user Env value."
              }
            ],
            ok: false
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 400);
      assert.deepEqual(executedAction, {
        actionId: ACTION_SAVE_ENV_USER_VALUES,
        input: {
          environment: "dev",
          values: {
            AUTH_SUPABASE_URL: {
              secret: false,
              value: "https://override.supabase.co"
            }
          }
        }
      });
    });
  });
});

test("project template routes preserve Vibe64 user context", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const app = testRouteApp();
      registerRoutes(routeHttp(app), {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const vibe64User = {
        login: "ada",
        username: "ada"
      };
      const listRoute = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/project-templates`
      });
      const applyRoute = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/project-templates/:templateId/apply`
      });
      assert.ok(listRoute);
      assert.ok(applyRoute);
      assert.deepEqual(
        applyRoute.options.params.schema.patch(routeProjectParams({
          templateId: "jskit-database"
        })),
        {
          errors: {},
          validatedObject: {
            slug: "unit_project",
            templateId: "jskit-database"
          }
        }
      );

      await listRoute.handler({
        input: {
          query: {}
        },
        params: routeProjectParams(),
        vibe64User,
        async executeAction(action) {
          calls.push(action);
          return {
            ok: true,
            templates: []
          };
        }
      }, testReply());
      await applyRoute.handler({
        body: {},
        input: {
          body: {}
        },
        params: routeProjectParams({
          templateId: "jskit-database"
        }),
        vibe64User,
        async executeAction(action) {
          calls.push(action);
          return {
            ok: true
          };
        }
      }, testReply());

      assert.deepEqual(calls, [
        {
          actionId: ACTION_LIST_PROJECT_TEMPLATES,
          input: {
            vibe64User
          }
        },
        {
          actionId: ACTION_APPLY_PROJECT_TEMPLATE,
          input: {
            templateId: "jskit-database",
            vibe64User
          }
        }
      ]);
    });
  });
});

test("managed app identity routes expose direct project-local GET and PUT operations", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const identities = [{
        name: "admin",
        type: "email",
        value: "admin@example.test"
      }];
      const app = testRouteApp();
      registerRoutes(routeHttp(app), {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const readRoute = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/preview-identities`
      });
      const saveRoute = findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/preview-identities`
      });
      assert.ok(readRoute);
      assert.ok(saveRoute);
      assert.deepEqual(saveRoute.options.body.schema.patch({ identities }), {
        errors: {},
        validatedObject: {
          identities
        }
      });

      const readReply = testReply();
      const saveReply = testReply();
      await readRoute.handler({
        params: routeProjectParams(),
        async executeAction(action) {
          calls.push(action);
          return {
            identities,
            ok: true
          };
        }
      }, readReply);
      await saveRoute.handler({
        input: {
          body: {
            identities
          }
        },
        params: routeProjectParams(),
        async executeAction(action) {
          calls.push(action);
          return {
            identities: action.input.identities,
            ok: true
          };
        }
      }, saveReply);

      assert.equal(readReply.statusCode, 200);
      assert.equal(saveReply.statusCode, 200);
      assert.deepEqual(calls, [
        {
          actionId: ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
          input: {}
        },
        {
          actionId: ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
          input: {
            identities
          }
        }
      ]);
    });
  });
});
