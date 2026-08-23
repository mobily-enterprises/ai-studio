import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_SERVICE_DATA_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import {
  createProjectRuntimeChangedPublisher,
  createTerminalSessionChangedPublisher
} from "../../packages/vibe64-terminals/src/server/events.js";
import {
  Vibe64TerminalsProvider,
  createVibe64TerminalsFeature,
  terminalsProviderEnv
} from "../../packages/vibe64-terminals/src/server/Vibe64TerminalsProvider.js";

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-terminals-provider-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function failingCodexAuthPreflight() {
  throw new Error("test Codex authentication unavailable");
}

function featureDependencies({ env = {}, project, published = [] } = {}) {
  return {
    actionCatalogue: {
      register() {}
    },
    env,
    events: {
      async publish(event) {
        published.push(event);
        return event;
      }
    },
    fastify: {
      get() {}
    },
    http: {
      router: {
        register() {}
      }
    },
    logger: {
      error() {},
      info() {},
      warn() {}
    },
    project
  };
}

test("terminals feature declares only named AI-first capabilities", () => {
  assert.equal(Vibe64TerminalsProvider.id, "vibe64.terminals");
  assert.deepEqual(Vibe64TerminalsProvider.provides, {
    terminals: "vibe64.terminals"
  });
  assert.deepEqual(Vibe64TerminalsProvider.requires, {
    env: "runtime.env",
    events: "runtime.events",
    fastify: "runtime.fastify",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    actionCatalogue: "runtime.actions"
  });
  assert.equal(Object.hasOwn(Vibe64TerminalsProvider, "register"), false);
});

test("terminals provider overlays only live preview routing values", () => {
  assert.deepEqual(terminalsProviderEnv({
    [VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV]: "stale.example.test",
    KEEP_ME: "runtime",
    SECRET_VALUE: "runtime-secret"
  }, {
    [VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV]: "previews.users.localhost:4000",
    [VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV]: "http",
    [VIBE64_PUBLIC_PROTOCOL_ENV]: "http",
    [VIBE64_PUBLIC_USER_DOMAIN_ENV]: "users.localhost:4000",
    SECRET_VALUE: "live-secret"
  }), {
    [VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV]: "previews.users.localhost:4000",
    [VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV]: "http",
    [VIBE64_PUBLIC_PROTOCOL_ENV]: "http",
    [VIBE64_PUBLIC_USER_DOMAIN_ENV]: "users.localhost:4000",
    KEEP_ME: "runtime",
    SECRET_VALUE: "runtime-secret"
  });
});

test("terminals feature creates the direct API from runtime env", async () => {
  await withTemporaryRoot(async (root) => {
    const serviceDataRoot = path.join(root, "services");
    const targetRoot = path.join(root, "project");
    const runtimeRoot = path.join(root, "runtime");
    await mkdir(targetRoot, { recursive: true });
    await mkdir(runtimeRoot, { recursive: true });
    const feature = createVibe64TerminalsFeature({
      codexTerminalController: {
        codexAuthPreflight: failingCodexAuthPreflight
      }
    });
    const outputs = await feature.setup(featureDependencies({
      env: {
        [VIBE64_SERVICE_DATA_ROOT_ENV]: serviceDataRoot
      },
      project: {
        async createRuntime() {
          return { adapter: {}, projectConfig: {}, stateRoot: runtimeRoot };
        },
        currentProjectRuntimeRoot() {
          return runtimeRoot;
        },
        currentTargetRoot() {
          return targetRoot;
        },
        async readCurrentProject() {
          return {
            slug: "project"
          };
        },
        async readEnv() {
          return {
            env: {
              records: []
            },
            ok: true
          };
        },
        runInProjectContext(_slug, operation) {
          return operation();
        },
        async saveEnvUserValues() {
          return {
            ok: true
          };
        }
      }
    }), { profile: "test" });

    assert.equal(typeof outputs.terminals.setProductionEnvironmentProvider, "function");
    const result = await outputs.terminals.startGlobalCodexTerminal();
    assert.equal(result.ok, false);
    assert.match(result.error, /test Codex authentication unavailable/u);
    assert.doesNotMatch(result.error, /toolchain|image/u);
    await feature.shutdown(featureDependencies({ project: {} }), {
      outputs,
      profile: "test"
    });
  });
});

test("terminal events publish direct session and project events without service receipts", async () => {
  const published = [];
  const events = {
    async publish(event) {
      published.push(event);
      return event;
    }
  };
  await createTerminalSessionChangedPublisher(events)("session-1", {
    reason: "launch-target-started"
  });
  await createProjectRuntimeChangedPublisher(events)({
    ok: true,
    projectSlug: "dogandgroom",
    runtime: { open: true },
    targetRoot: "/project"
  }, {
    action: "runtime-opened"
  });

  assert.equal(published[0].realtime.event, "vibe64.session.changed");
  assert.equal(published[0].realtime.payload.reason, "launch-target-started");
  assert.equal(published[1].realtime.event, "vibe64.project.changed");
  assert.equal(published[1].action, "runtime-opened");
  assert.equal(Object.hasOwn(published[0], "meta"), false);
  assert.equal(Object.hasOwn(published[1], "meta"), false);
});

test("terminals feature owns dormancy startup and shutdown", async () => {
  let closeCalls = 0;
  let cleanupCalls = 0;
  const terminals = {
    async close() {
      closeCalls += 1;
    },
    async closeDormantProjectRuntimes() {
      cleanupCalls += 1;
      return { closedCount: 0, failed: [], ok: true, projectCount: 0 };
    }
  };
  const feature = createVibe64TerminalsFeature();
  const dependencies = {
    logger: {
      error() {},
      info() {},
      warn() {}
    }
  };
  await feature.boot(dependencies, { outputs: { terminals }, profile: "test" });
  await feature.shutdown(dependencies, { outputs: { terminals }, profile: "test" });

  assert.equal(cleanupCalls, 1);
  assert.equal(closeCalls, 1);
});
