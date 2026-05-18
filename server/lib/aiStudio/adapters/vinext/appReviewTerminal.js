import {
  createAiStudioAppReviewTerminalSpec
} from "../../appReviewTerminal.js";
import {
  VINEXT_REVIEW_MODE_CONFIG
} from "./constants.js";
import {
  detectPackageManager,
  packageBinCommand,
  readPackageJson
} from "./packageManager.js";

function configValues(config = {}) {
  return config?.values && typeof config.values === "object" ? config.values : config;
}

function reviewMode(config = {}) {
  const mode = String(configValues(config)[VINEXT_REVIEW_MODE_CONFIG] || "production").trim();
  return mode === "development" ? "development" : "production";
}

async function createVinextReviewDescriptor({
  config = {},
  port,
  worktreePath = ""
} = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const mode = reviewMode(config);
  const buildCommand = packageBinCommand(packageManager.name, "vinext", ["build"]);
  const serverCommand = mode === "development"
    ? packageBinCommand(packageManager.name, "vinext", ["dev", "--hostname", "0.0.0.0", "--port", String(port)])
    : packageBinCommand(packageManager.name, "vinext", ["start", "--hostname", "0.0.0.0", "--port", String(port)]);

  return {
    commands: [
      mode === "production"
        ? {
            command: buildCommand,
            label: "Building Vinext app.",
            networkEnv: false
          }
        : null,
      {
        command: serverCommand,
        label: "Starting Vinext review server.",
        networkEnv: true
      }
    ].filter(Boolean),
    metadata: {
      buildCommand: mode === "production" ? buildCommand : "",
      commandSource: "vinext",
      mode,
      packageManager: packageManager.name,
      serverCommand
    },
    urlPath: "/"
  };
}

function createVinextAppReviewTerminalSpec({
  context = {},
  session = {},
  targetRoot = ""
} = {}) {
  return createAiStudioAppReviewTerminalSpec({
    adapterId: "vinext",
    resolveReview: ({ port, worktreePath }) => createVinextReviewDescriptor({
      config: context.config || session.config || {},
      port,
      worktreePath
    }),
    session,
    targetRoot
  });
}

export {
  createVinextAppReviewTerminalSpec,
  createVinextReviewDescriptor
};
