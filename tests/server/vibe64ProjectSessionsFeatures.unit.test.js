import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  Vibe64ProjectProvider
} from "../../packages/vibe64-project/src/server/Vibe64ProjectProvider.js";
import {
  Vibe64SessionsProvider
} from "../../packages/vibe64-sessions/src/server/Vibe64SessionsProvider.js";
import {
  createService as createSessionsService
} from "../../packages/vibe64-sessions/src/server/service.js";

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
  assert.equal(typeof Vibe64SessionsProvider.boot, "function");
  assert.equal(typeof Vibe64SessionsProvider.shutdown, "function");
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
  assert.equal(projectActions[0].actions.length, 10);
  assert.equal(projectRoutes.length, projectActions[0].actions.length + 1);
  assert.equal(
    projectRoutes.some(([method, path]) => method === "POST" && path.endsWith("/env/reveal")),
    true,
    "the owner-only secret reveal service route is registered beside captured actions"
  );
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
  assert.equal(typeof sessionOutputs.sessions.setRenewalActorResolver, "function");
  assert.doesNotThrow(() => sessionOutputs.sessions.setRenewalActorResolver(async () => null));
  assert.throws(
    () => sessionOutputs.sessions.setRenewalActorResolver({}),
    /must be a function or null/u
  );
  assert.equal(sessionActions.length, 1);
  assert.equal(sessionActions[0].contributorId, "vibe64.sessions");
  assert.equal(sessionActions[0].actions.length, 26);
  assert.equal(sessionRoutes.length, 26);
  assert.equal(sessionActions[0].actions.some((action) => Object.hasOwn(action, "dependencies")), false);
});

test("sessions start standalone renewal recovery without blocking Feature boot", async () => {
  let resumeCalls = 0;
  let renewalWorkClosed = false;
  const shutdownEvents = [];
  let finishRecovery;
  const recovery = new Promise((resolve) => {
    finishRecovery = resolve;
  });
  const sessions = {
    async closeSessionRenewalWork() {
      renewalWorkClosed = true;
      shutdownEvents.push("close-renewal-admission");
    },
    async resumeSessionRenewals() {
      resumeCalls += 1;
      return recovery;
    }
  };
  const bootResult = Vibe64SessionsProvider.boot({
    project: { targetRoot: "/tmp/selected-project" }
  }, {
    outputs: { sessions }
  });

  assert.equal(bootResult, undefined);
  assert.equal(resumeCalls, 1);
  let shutdownSettled = false;
  const shutdown = Vibe64SessionsProvider.shutdown({
    terminals: {
      async invalidateAgentRuntimes(input) {
        assert.deepEqual(input, { reason: "server-shutdown" });
        shutdownEvents.push("invalidate-agent-runtimes");
        finishRecovery();
        return { ok: true };
      }
    }
  }, {
    outputs: { sessions }
  }).then(() => {
    shutdownSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renewalWorkClosed, true);
  assert.deepEqual(shutdownEvents, [
    "close-renewal-admission",
    "invalidate-agent-runtimes"
  ]);
  await shutdown;
  assert.equal(shutdownSettled, true);

  Vibe64SessionsProvider.boot({
    project: { targetRoot: "/tmp/selected-project" }
  }, {
    outputs: { sessions }
  });
  assert.equal(resumeCalls, 1, "Feature shutdown permanently closes its recovery task");

  Vibe64SessionsProvider.boot({
    project: { targetRoot: "" }
  }, {
    outputs: {
      sessions: {
        async resumeSessionRenewals() {
          resumeCalls += 1;
        }
      }
    }
  });
  assert.equal(
    resumeCalls,
    1,
    "hosted boot recovery is owned by the catalog-aware Online boundary"
  );

  Vibe64SessionsProvider.boot({
    project: { targetRoot: "/tmp/selected-project" }
  }, {
    outputs: {
      sessions: {
        async resumeSessionRenewals() {
          throw new Error("Expected detached recovery failure");
        }
      }
    }
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.throws(
    () => createSessionsService({
      project: {},
      renewalActorResolver: {},
      terminals: {}
    }),
    /must be a function or null/u
  );
});

test("sessions reject a fulfilled but unsuccessful agent-runtime shutdown", async () => {
  const invalidation = {
    failed: [{ code: "test_runtime_exit_unverified" }],
    ok: false
  };
  await assert.rejects(
    () => Vibe64SessionsProvider.shutdown({
      terminals: {
        async invalidateAgentRuntimes(input) {
          assert.deepEqual(input, { reason: "server-shutdown" });
          return invalidation;
        }
      }
    }, {
      outputs: {
        sessions: {
          async closeSessionRenewalWork() {}
        }
      }
    }),
    (error) => (
      error instanceof AggregateError &&
      error.errors.some((failure) => (
        failure?.code === "vibe64_agent_runtime_shutdown_failed" &&
        failure.details === invalidation
      ))
    )
  );
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
