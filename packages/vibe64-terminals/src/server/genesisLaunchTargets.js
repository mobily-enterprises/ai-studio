import path from "node:path";

import {
  inspectGenesisLaunch,
  inspectGenesisWorkspaceSetup
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

const GENESIS_RUNTIME_PACKS = Object.freeze({
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

function genesisRuntimePacks(values = []) {
  const requirements = normalizedRuntimeRequirements(values);
  const unsupported = requirements.filter((requirement) => !Object.hasOwn(GENESIS_RUNTIME_PACKS, requirement));
  return {
    available: unsupported.length === 0,
    disabledReason: unsupported.length === 0
      ? ""
      : `Vibe64 does not provide a pinned runtime for: ${unsupported.join(", ")}.`,
    runtimes: [...new Set(requirements.flatMap((requirement) => GENESIS_RUNTIME_PACKS[requirement] || []))],
    unsupported
  };
}

function genesisLaunchTargetView(target = {}) {
  const runtime = genesisRuntimePacks(target.runtimeRequirements);
  const available = target.available !== false && runtime.available;
  return {
    available,
    ...(target.default === true ? { defaultPreview: true } : {}),
    disabledReason: available
      ? ""
      : String(target.disabledReason || runtime.disabledReason || "This launch target is unavailable.").trim(),
    id: String(target.id || "").trim(),
    label: String(target.label || target.id || "").trim()
  };
}

function genesisLaunchProjectRoot(context = {}) {
  return sessionSourcePath(context.session || {});
}

async function inspectGenesisForContext(context = {}, inspect, unconfigured) {
  const projectRoot = genesisLaunchProjectRoot(context);
  if (!projectRoot) {
    return unconfigured;
  }
  try {
    return await inspect({
      environment: {
        ...(context.runtime?.promptEnvironment || process.env),
        ...(context.projectEnvironment || {})
      },
      projectRoot
    });
  } catch (error) {
    if (String(error?.code || "").trim() === "STACK_REQUIRED") {
      return unconfigured;
    }
    throw error;
  }
}

async function inspectGenesisLaunchForContext(context = {}, {
  inspect = inspectGenesisLaunch
} = {}) {
  return inspectGenesisForContext(context, inspect, {
    status: "unconfigured",
    targets: []
  });
}

async function inspectGenesisWorkspaceSetupForContext(context = {}, {
  inspect = inspectGenesisWorkspaceSetup
} = {}) {
  return inspectGenesisForContext(context, inspect, {
    recipeHash: "",
    status: "unconfigured",
    steps: []
  });
}

async function listGenesisLaunchTargets(context = {}, options = {}) {
  const launch = await inspectGenesisLaunchForContext(context, options);
  return (Array.isArray(launch?.targets) ? launch.targets : [])
    .map(genesisLaunchTargetView)
    .filter((target) => target.id && target.label);
}

function genesisLaunchCommand(argv = [], {
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

function genesisLaunchDescriptor(target = {}, {
  host = "127.0.0.1",
  port,
  worktreePath
} = {}) {
  const runtime = genesisRuntimePacks(target.runtimeRequirements);
  return {
    commands: (Array.isArray(target.steps) ? target.steps : []).map((step) => {
      const command = genesisLaunchCommand(step.argv, { host, port });
      return {
        command,
        commandPreview: command,
        label: String(step.label || "").trim(),
        networkEnv: step.role === "server"
      };
    }),
    metadata: {
      genesisLaunchSource: String(target.source || "").trim(),
      genesisRuntimeRequirements: normalizedRuntimeRequirements(target.runtimeRequirements)
    },
    previewIdentity: target.previewIdentity || null,
    runtimes: runtime.runtimes,
    urlPath: String(target.urlPath || "/").trim() || "/",
    workdir: path.resolve(worktreePath, String(target.workdir || ".").trim() || ".")
  };
}

async function createGenesisLaunchTargetTerminalSpec({
  context = {},
  launchTargetId = ""
} = {}, options = {}) {
  const launch = await inspectGenesisLaunchForContext(context, options);
  const target = (Array.isArray(launch?.targets) ? launch.targets : [])
    .find((entry) => entry.id === String(launchTargetId || "").trim());
  if (!target) {
    return {
      ok: false,
      message: `Unknown Genesis launch target: ${String(launchTargetId || "").trim() || "(empty)"}.`
    };
  }
  const targetView = genesisLaunchTargetView(target);
  if (!targetView.available) {
    return {
      ok: false,
      message: targetView.disabledReason
    };
  }
  return createVibe64WebLaunchTargetTerminalSpec({
    launchTarget: targetView,
    preferredPort: target.preferredPort || undefined,
    resolveLaunch: ({ port, worktreePath }) => genesisLaunchDescriptor(target, {
      port,
      worktreePath
    }),
    session: context.session || {},
    targetRoot: context.session?.targetRoot || context.targetRoot || ""
  });
}

export {
  GENESIS_RUNTIME_PACKS,
  createGenesisLaunchTargetTerminalSpec,
  genesisLaunchCommand,
  genesisLaunchDescriptor,
  genesisLaunchTargetView,
  genesisRuntimePacks,
  inspectGenesisLaunchForContext,
  inspectGenesisWorkspaceSetupForContext,
  listGenesisLaunchTargets
};
