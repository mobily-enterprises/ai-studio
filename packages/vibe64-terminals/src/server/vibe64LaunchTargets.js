import path from "node:path";

import {
  inspectVibe64Launch,
  inspectVibe64WorkspaceSetup
} from "@local/vibe64-genesis/server";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  createVibe64WebLaunchTargetTerminalSpec
} from "@local/studio-terminal-core/server/launchTargetTerminal";

const VIBE64_RUNTIME_PACKS = Object.freeze({
  bubblewrap: ["bubblewrap"],
  bun: ["bun"],
  composer: ["composer"],
  git: ["git"],
  mariadb: ["mariadb"],
  mysql: ["mysql"],
  nodejs: ["node26"],
  php: ["php"],
  playwright: ["playwright"],
  postgresql: ["postgresql"],
  ripgrep: ["ripgrep"],
  shell: []
});

function normalizedRuntimeRequirements(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function vibe64RuntimePacks(values = []) {
  const requirements = normalizedRuntimeRequirements(values);
  const unsupported = requirements.filter((requirement) => !Object.hasOwn(VIBE64_RUNTIME_PACKS, requirement));
  return {
    available: unsupported.length === 0,
    disabledReason: unsupported.length === 0
      ? ""
      : `Vibe64 does not provide a pinned runtime for: ${unsupported.join(", ")}.`,
    runtimes: [...new Set(requirements.flatMap((requirement) => VIBE64_RUNTIME_PACKS[requirement] || []))],
    unsupported
  };
}

function vibe64LaunchTargetView(target = {}) {
  const runtime = vibe64RuntimePacks(target.runtimeRequirements);
  const previewIdentityRuntime = vibe64RuntimePacks(target.previewIdentity?.runtimes);
  const available = target.available !== false && runtime.available && previewIdentityRuntime.available;
  return {
    available,
    ...(target.default === true ? { defaultPreview: true } : {}),
    disabledReason: available
      ? ""
      : String(
        target.disabledReason ||
        runtime.disabledReason ||
        previewIdentityRuntime.disabledReason ||
        "This launch target is unavailable."
      ).trim(),
    id: String(target.id || "").trim(),
    label: String(target.label || target.id || "").trim()
  };
}

function vibe64LaunchSourceRoot(context = {}) {
  return sessionSourcePath(context.session || {});
}

async function inspectVibe64ForContext(context = {}, inspect, unconfigured) {
  const sourceRoot = vibe64LaunchSourceRoot(context);
  if (!sourceRoot) {
    return unconfigured;
  }
  try {
    return await inspect({
      environment: {
        ...(context.runtime?.promptEnvironment || process.env),
        ...(context.projectEnvironment || {})
      },
      projectRoot: sourceRoot
    });
  } catch (error) {
    if (String(error?.code || "").trim() === "STACK_REQUIRED") {
      return unconfigured;
    }
    throw error;
  }
}

async function inspectVibe64LaunchForContext(context = {}, {
  inspect = inspectVibe64Launch
} = {}) {
  return inspectVibe64ForContext(context, inspect, {
    status: "unconfigured",
    targets: []
  });
}

async function inspectVibe64WorkspaceSetupForContext(context = {}, {
  inspect = inspectVibe64WorkspaceSetup
} = {}) {
  return inspectVibe64ForContext(context, inspect, {
    recipeHash: "",
    status: "unconfigured",
    steps: []
  });
}

async function listVibe64LaunchTargets(context = {}, options = {}) {
  const launch = await inspectVibe64LaunchForContext(context, options);
  return (Array.isArray(launch?.targets) ? launch.targets : [])
    .map(vibe64LaunchTargetView)
    .filter((target) => target.id && target.label);
}

function vibe64LaunchCommand(argv = [], {
  host = "127.0.0.1",
  port = ""
} = {}) {
  return (Array.isArray(argv) ? argv : [])
    .map((argument) => String(argument)
      .replaceAll("{host}", String(host))
      .replaceAll("{port}", String(port)))
    .map(shellQuote)
    .join(" ");
}

function vibe64LaunchDescriptor(target = {}, {
  host = "127.0.0.1",
  port,
  worktreePath
} = {}) {
  const runtime = vibe64RuntimePacks(target.runtimeRequirements);
  const previewIdentityRuntime = vibe64RuntimePacks(target.previewIdentity?.runtimes);
  return {
    commands: (Array.isArray(target.steps) ? target.steps : []).map((step) => {
      const command = vibe64LaunchCommand(step.argv, { host, port });
      return {
        command,
        commandPreview: command,
        label: String(step.label || "").trim(),
        networkEnv: step.role === "server"
      };
    }),
    metadata: {
      vibe64LaunchSource: String(target.source || "").trim(),
      vibe64RuntimeRequirements: normalizedRuntimeRequirements(target.runtimeRequirements)
    },
    previewIdentity: target.previewIdentity
      ? {
          ...target.previewIdentity,
          runtimes: previewIdentityRuntime.runtimes
        }
      : null,
    readiness: target.readiness || null,
    runtimes: runtime.runtimes,
    urlPath: String(target.urlPath || "/").trim() || "/",
    workdir: path.resolve(worktreePath, String(target.workdir || ".").trim() || ".")
  };
}

async function createVibe64LaunchTargetTerminalSpec({
  context = {},
  launchTargetId = ""
} = {}, options = {}) {
  const launch = await inspectVibe64LaunchForContext(context, options);
  const target = (Array.isArray(launch?.targets) ? launch.targets : [])
    .find((entry) => entry.id === String(launchTargetId || "").trim());
  if (!target) {
    return {
      ok: false,
      message: `Unknown Vibe64 launch target: ${String(launchTargetId || "").trim() || "(empty)"}.`
    };
  }
  const targetView = vibe64LaunchTargetView(target);
  if (!targetView.available) {
    return {
      ok: false,
      message: targetView.disabledReason
    };
  }
  return createVibe64WebLaunchTargetTerminalSpec({
    launchTarget: targetView,
    preferredPort: target.preferredPort || undefined,
    resolveLaunch: ({ port, worktreePath }) => vibe64LaunchDescriptor(target, {
      port,
      worktreePath
    }),
    session: context.session || {}
  });
}

export {
  VIBE64_RUNTIME_PACKS,
  createVibe64LaunchTargetTerminalSpec,
  vibe64LaunchCommand,
  vibe64LaunchDescriptor,
  vibe64LaunchTargetView,
  vibe64RuntimePacks,
  inspectVibe64LaunchForContext,
  inspectVibe64WorkspaceSetupForContext,
  listVibe64LaunchTargets
};
