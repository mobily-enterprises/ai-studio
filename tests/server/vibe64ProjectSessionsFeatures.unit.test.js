import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  Vibe64ProjectProvider
} from "../../packages/vibe64-project/src/server/Vibe64ProjectProvider.js";
import {
  Vibe64SessionsProvider
} from "../../packages/vibe64-sessions/src/server/Vibe64SessionsProvider.js";

test("project and sessions expose only named Feature capabilities", () => {
  assert.equal(Vibe64ProjectProvider.id, "vibe64.project");
  assert.deepEqual(Vibe64ProjectProvider.requires, {
    env: "runtime.env",
    http: "runtime.http",
    actionCatalogue: "runtime.actions"
  });
  assert.deepEqual(Vibe64ProjectProvider.provides, {
    project: "vibe64.project"
  });
  assert.equal(Vibe64ProjectProvider.boot, null);

  assert.equal(Vibe64SessionsProvider.id, "vibe64.sessions");
  assert.deepEqual(Vibe64SessionsProvider.requires, {
    events: "runtime.events",
    http: "runtime.http",
    project: "vibe64.project",
    terminals: "vibe64.terminals",
    actionCatalogue: "runtime.actions"
  });
  assert.deepEqual(Vibe64SessionsProvider.provides, {
    sessions: "vibe64.sessions"
  });
  assert.equal(Vibe64SessionsProvider.boot, null);
});

test("project and sessions register routes and captured actions during setup", async () => {
  const projectActions = [];
  const projectRoutes = [];
  const projectOutputs = await Vibe64ProjectProvider.setup({
    actionCatalogue: {
      register(contributor) {
        projectActions.push(contributor);
      }
    },
    env: {},
    http: {
      router: {
        register(...args) {
          projectRoutes.push(args);
        }
      }
    }
  }, {});

  assert.equal(typeof projectOutputs.project.createRuntime, "function");
  assert.equal(projectActions.length, 1);
  assert.equal(projectActions[0].contributorId, "vibe64.project");
  assert.equal(projectActions[0].actions.length, 11);
  assert.equal(projectRoutes.length, 11);
  assert.equal(projectActions[0].actions.some((action) => Object.hasOwn(action, "dependencies")), false);

  const sessionActions = [];
  const sessionRoutes = [];
  const sessionOutputs = await Vibe64SessionsProvider.setup({
    actionCatalogue: {
      register(contributor) {
        sessionActions.push(contributor);
      }
    },
    events: {
      async publish() {}
    },
    http: {
      router: {
        register(...args) {
          sessionRoutes.push(args);
        }
      }
    },
    project: {},
    terminals: {}
  }, {});

  assert.equal(typeof sessionOutputs.sessions.createSession, "function");
  assert.equal(sessionActions.length, 1);
  assert.equal(sessionActions[0].contributorId, "vibe64.sessions");
  assert.equal(sessionActions[0].actions.length, 12);
  assert.equal(sessionRoutes.length, 12);
  assert.equal(sessionActions[0].actions.some((action) => Object.hasOwn(action, "dependencies")), false);
});

test("project and sessions package declarations contain no scaffold or container metadata", async () => {
  for (const packagePath of [
    "packages/vibe64-project/package.json",
    "packages/vibe64-sessions/package.json"
  ]) {
    const source = await readFile(packagePath, "utf8");
    const declaration = JSON.parse(source);
    assert.equal(Object.hasOwn(declaration.jskit, "mutations"), false);
    assert.doesNotMatch(source, /containerTokens|scaffoldMode|scaffoldShape/u);
  }
});
