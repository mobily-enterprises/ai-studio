import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createVibe64LaunchTargetTerminalSpec,
  vibe64LaunchCommand,
  vibe64LaunchDescriptor,
  vibe64RuntimePacks,
  inspectVibe64LaunchForContext,
  inspectVibe64WorkspaceSetupForContext,
  listVibe64LaunchTargets
} from "../../packages/vibe64-terminals/src/server/vibe64LaunchTargets.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  listLaunchTargets,
  workspaceSetupLaunchDisabledReason
} from "../../packages/vibe64-terminals/src/server/launchTargetTerminal.js";

function launchInspection(targets = []) {
  return {
    components: ["unit"],
    diagnostics: [],
    resources: [],
    runtimeRequirements: [...new Set(targets.flatMap((target) => target.runtimeRequirements || []))],
    stackHash: "sha256:unit",
    status: targets.length ? "ready" : "unconfigured",
    targets
  };
}

function launchTarget(overrides = {}) {
  return {
    available: true,
    default: true,
    disabledReason: null,
    id: "app",
    label: "Run app",
    preferredPort: 49000 + crypto.randomInt(500),
    readiness: {
      kind: "http",
      method: "GET",
      path: "/api/health",
      status: 200
    },
    runtimeRequirements: ["nodejs"],
    source: "project",
    steps: [{
      argv: ["npm", "run", "dev", "--", "--host={host}", "--port={port}"],
      label: "Start app",
      role: "server"
    }],
    urlPath: "/catalogue",
    workdir: ".",
    ...overrides
  };
}

async function launchContext(t) {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-genesis-launch-"));
  t.after(() => rm(temporaryRoot, {
    force: true,
    recursive: true
  }));
  const projectContextRoot = path.join(temporaryRoot, "namespace");
  const sourceRoot = path.join(
    projectContextRoot,
    "sessions",
    "active",
    "session-unit",
    "source"
  );
  await mkdir(sourceRoot, {
    recursive: true
  });
  return {
    projectEnvironment: {
      DB_PASSWORD: "managed-project-value"
    },
    runtime: {
      adapter: null,
      promptEnvironment: {
        DB_PASSWORD: "do-not-return-this"
      }
    },
    session: {
      metadata: {
        repository_mode: "local_source",
        source_kind: "session_clone",
        source_path: sourceRoot,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      projectContextRoot,
      sessionId: "session-unit",
      sessionRoot: path.join(temporaryRoot, "state", "session-unit")
    },
    targetRoot: projectContextRoot
  };
}

test("Vibe64 abstract runtimes map only through Vibe64-owned pinned packs", () => {
  assert.deepEqual(vibe64RuntimePacks(["nodejs", "php", "composer"]), {
    available: true,
    disabledReason: "",
    runtimes: ["node26", "php", "composer"],
    unsupported: []
  });
  assert.deepEqual(vibe64RuntimePacks(["future-runtime"]), {
    available: false,
    disabledReason: "Vibe64 does not provide a pinned runtime for: future-runtime.",
    runtimes: [],
    unsupported: ["future-runtime"]
  });
  assert.deepEqual(vibe64RuntimePacks(["playwright"]).runtimes, ["playwright"]);
});

test("Vibe64 launch argv substitution remains shell-safe", () => {
  assert.equal(
    vibe64LaunchCommand([
      "tool",
      "--host={host}",
      "--port",
      "{port}",
      "$(touch /tmp/not-run)",
      "it's-safe"
    ], {
      host: "127.0.0.1",
      port: 4123
    }),
    "tool --host=127.0.0.1 --port 4123 '$(touch /tmp/not-run)' 'it'\\''s-safe'"
  );
});

test("Vibe64 launch descriptors map preview identity runtimes through Vibe64's pinned runtime packs", () => {
  const previewIdentity = {
    command: [".vibe64/preview-identity"],
    identityTypes: ["user"],
    runtimes: ["nodejs"]
  };
  const descriptor = vibe64LaunchDescriptor(launchTarget({
    previewIdentity
  }), {
    port: 4123,
    worktreePath: "/tmp/vibe64-genesis-launch"
  });

  assert.deepEqual(descriptor.previewIdentity, {
    ...previewIdentity,
    runtimes: ["node26"]
  });
  assert.deepEqual(descriptor.readiness, {
    kind: "http",
    method: "GET",
    path: "/api/health",
    status: 200
  });
});

test("neutral sessions list explicit Vibe64 targets without exposing resource values", async (t) => {
  const context = await launchContext(t);
  let received = null;
  const targets = await listVibe64LaunchTargets(context, {
    inspect(input) {
      received = input;
      return launchInspection([
        launchTarget(),
        launchTarget({
          available: false,
          default: false,
          disabledReason: "MySQL needs one of: DB_PASSWORD.",
          id: "blocked",
          label: "Blocked app"
        })
      ]);
    }
  });

  assert.equal(received.projectRoot, context.session.metadata.source_path);
  assert.equal(received.environment.DB_PASSWORD, "managed-project-value");
  assert.deepEqual(targets, [{
    available: true,
    defaultPreview: true,
    disabledReason: "",
    id: "app",
    label: "Run app"
  }, {
    available: false,
    disabledReason: "MySQL needs one of: DB_PASSWORD.",
    id: "blocked",
    label: "Blocked app"
  }]);
  assert.doesNotMatch(JSON.stringify(targets), /do-not-return-this/u);
});

test("missing Genesis Stack leaves managed preview unconfigured", async (t) => {
  const context = await launchContext(t);
  const launch = await inspectVibe64LaunchForContext(context, {
    inspect: async () => {
      const error = new Error("Run genesis init first.");
      error.code = "STACK_REQUIRED";
      throw error;
    }
  });

  assert.deepEqual(launch, {
    status: "unconfigured",
    targets: []
  });
});

test("missing Genesis Stack leaves workspace preparation unconfigured", async (t) => {
  const context = await launchContext(t);
  const setup = await inspectVibe64WorkspaceSetupForContext(context, {
    inspect: async () => {
      const error = new Error("Run genesis init first.");
      error.code = "STACK_REQUIRED";
      throw error;
    }
  });

  assert.deepEqual(setup, {
    recipeHash: "",
    status: "unconfigured",
    steps: []
  });
});

test("managed preview blocks only workspace preparation that cannot run", () => {
  assert.equal(workspaceSetupLaunchDisabledReason({
    workspaceSetup: {
      currentLabel: "Install dependencies",
      status: "running"
    }
  }), "");
  assert.equal(workspaceSetupLaunchDisabledReason({
    workspaceSetup: {
      diagnostic: "npm install failed",
      status: "failed"
    }
  }), "npm install failed");
  assert.equal(workspaceSetupLaunchDisabledReason({
    workspaceSetup: {
      status: "succeeded"
    }
  }), "");

  const declaredSetup = {
    recipeHash: "sha256:recipe",
    status: "ready"
  };
  assert.equal(workspaceSetupLaunchDisabledReason({
    workspaceSetup: {
      status: "unconfigured"
    }
  }, declaredSetup), "");
  assert.equal(workspaceSetupLaunchDisabledReason({
    workspaceSetup: {
      recipeHash: "sha256:old-recipe",
      status: "succeeded"
    }
  }, declaredSetup), "");
  assert.equal(workspaceSetupLaunchDisabledReason({
    workspaceSetup: {
      recipeHash: "sha256:recipe",
      status: "succeeded"
    }
  }, declaredSetup), "");
  assert.equal(workspaceSetupLaunchDisabledReason({
    workspaceSetup: {
      diagnostic: "stale failure",
      recipeHash: "sha256:old-recipe",
      status: "failed"
    }
  }, {
    status: "unconfigured"
  }), "");
});

test("a pending workspace recipe remains launchable so the start request can prepare it", async (t) => {
  const context = await launchContext(t);
  context.session.workspaceSetup = {
    status: "unconfigured"
  };

  assert.deepEqual(await listLaunchTargets(context, {
    inspectLaunch: () => launchInspection([launchTarget()]),
    inspectWorkspaceSetup: () => ({
      recipeHash: "sha256:install",
      status: "ready",
      steps: [{
        argv: ["npm", "install"],
        label: "Install dependencies",
        runtimeRequirements: ["nodejs"],
        workdir: "."
      }]
    })
  }), [{
    available: true,
    defaultPreview: true,
    disabledReason: "",
    id: "app",
    label: "Run app"
  }]);
});

test("an upgraded workspace recipe can be prepared without trusting its old identity", async (t) => {
  const context = await launchContext(t);
  context.session.workspaceSetup = {
    recipeHash: "sha256:retired-contract",
    status: "succeeded"
  };

  assert.deepEqual(await listLaunchTargets(context, {
    inspectLaunch: () => launchInspection([launchTarget()]),
    inspectWorkspaceSetup: () => ({
      recipeHash: "sha256:current-contract",
      status: "ready",
      steps: [{
        argv: ["npm", "install"],
        label: "Install dependencies",
        runtimeRequirements: ["nodejs"],
        workdir: "."
      }]
    })
  }), [{
    available: true,
    defaultPreview: true,
    disabledReason: "",
    id: "app",
    label: "Run app"
  }]);
});

test("a failed current workspace recipe disables launch until it is retried", async (t) => {
  const context = await launchContext(t);
  context.session.workspaceSetup = {
    diagnostic: "npm install failed",
    recipeHash: "sha256:current-contract",
    status: "failed"
  };

  assert.deepEqual(await listLaunchTargets(context, {
    inspectLaunch: () => launchInspection([launchTarget()]),
    inspectWorkspaceSetup: () => ({
      recipeHash: "sha256:current-contract",
      status: "ready",
      steps: [{
        argv: ["npm", "install"],
        label: "Install dependencies",
        runtimeRequirements: ["nodejs"],
        workdir: "."
      }]
    })
  }), [{
    available: false,
    defaultPreview: true,
    disabledReason: "npm install failed",
    id: "app",
    label: "Run app"
  }]);
});

test("neutral sessions translate Vibe64 targets through the existing Vibe64 preview terminal", async (t) => {
  const context = await launchContext(t);
  const sourceSubdirectory = path.join(context.session.metadata.source_path, "web");
  await mkdir(sourceSubdirectory);
  const target = launchTarget({
    steps: [{
      argv: ["npm", "run", "prepare"],
      label: "Prepare app",
      role: "prepare"
    }, {
      argv: ["npm", "run", "dev", "--", "--host={host}", "--port={port}"],
      label: "Start app",
      role: "server"
    }],
    workdir: "web"
  });
  const spec = await createVibe64LaunchTargetTerminalSpec({
    context,
    launchTargetId: target.id
  }, {
    inspect: () => launchInspection([target])
  });
  t.after(() => spec.releasePortReservation?.());

  assert.equal(spec.ok, true);
  assert.equal(spec.cwd, sourceSubdirectory);
  assert.deepEqual(spec.runtimes, ["node26"]);
  assert.equal(spec.metadata.vibe64LaunchSource, "project");
  assert.equal(spec.metadata.urlPath, "/catalogue");
  assert.match(spec.commandPreview, /npm run prepare/u);
  assert.match(spec.commandPreview, /--host=127\.0\.0\.1/u);
  assert.match(spec.commandPreview, new RegExp(`--port=${spec.metadata.port}`, "u"));
  assert.match(spec.args().join(" "), /VIBE64_LAUNCH_READY_V1/u);
  assert.match(spec.args().join(" "), /api\/health/u);
  assert.deepEqual(spec.metadata.readiness, target.readiness);
});

test("neutral launch rejects a target without an exact readiness declaration", async (t) => {
  const context = await launchContext(t);
  const target = launchTarget({ readiness: null });
  const spec = await createVibe64LaunchTargetTerminalSpec({
    context,
    launchTargetId: target.id
  }, {
    inspect: () => launchInspection([target])
  });

  assert.deepEqual(spec, {
    ok: false,
    message: "Launch target must declare one valid HTTP readiness predicate."
  });
});

test("unsupported Vibe64 runtimes disable a target before terminal creation", async (t) => {
  const context = await launchContext(t);
  const target = launchTarget({
    runtimeRequirements: ["future-runtime"]
  });

  assert.deepEqual(await listVibe64LaunchTargets(context, {
    inspect: () => launchInspection([target])
  }), [{
    available: false,
    defaultPreview: true,
    disabledReason: "Vibe64 does not provide a pinned runtime for: future-runtime.",
    id: "app",
    label: "Run app"
  }]);
  assert.deepEqual(await createVibe64LaunchTargetTerminalSpec({
    context,
    launchTargetId: target.id
  }, {
    inspect: () => launchInspection([target])
  }), {
    ok: false,
    message: "Vibe64 does not provide a pinned runtime for: future-runtime."
  });
});
