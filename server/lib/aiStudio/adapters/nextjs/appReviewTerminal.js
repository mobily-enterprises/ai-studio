import {
  createAiStudioAppReviewTerminalSpec
} from "../../appReviewTerminal.js";
import {
  detectPackageManager,
  packageBinCommand,
  readPackageJson
} from "../../nodePackage.js";
import {
  NEXTJS_REVIEW_MODE_CONFIG
} from "./constants.js";
import {
  nextjsRuntimeDockerArgs
} from "./databaseRuntime.js";

function configValues(config = {}) {
  return config?.values && typeof config.values === "object" ? config.values : config;
}

function reviewMode(config = {}) {
  const mode = String(configValues(config)[NEXTJS_REVIEW_MODE_CONFIG] || "production").trim();
  return mode === "development" ? "development" : "production";
}

async function createNextjsReviewDescriptor({
  config = {},
  port,
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const mode = reviewMode(config);
  const buildCommand = packageBinCommand(packageManager.name, "next", ["build"]);
  const serverCommand = mode === "development"
    ? packageBinCommand(packageManager.name, "next", ["dev", "-H", "0.0.0.0", "-p", String(port)])
    : packageBinCommand(packageManager.name, "next", ["start", "-H", "0.0.0.0", "-p", String(port)]);

  return {
    commands: [
      mode === "production"
        ? {
            command: buildCommand,
            label: "Building Next.js app.",
            networkEnv: false
          }
        : null,
      {
        command: serverCommand,
        label: "Starting Next.js review server.",
        networkEnv: true
      }
    ].filter(Boolean),
    extraDockerArgs: nextjsRuntimeDockerArgs({
      config,
      targetRoot
    }),
    metadata: {
      buildCommand: mode === "production" ? buildCommand : "",
      commandSource: "next",
      mode,
      packageManager: packageManager.name,
      serverCommand
    },
    urlPath: "/"
  };
}

function createNextjsAppReviewTerminalSpec({
  context = {},
  session = {},
  targetRoot = ""
} = {}) {
  const reviewTargetRoot = targetRoot || session.targetRoot || "";
  return createAiStudioAppReviewTerminalSpec({
    adapterId: "nextjs",
    resolveReview: ({ port, worktreePath }) => createNextjsReviewDescriptor({
      config: context.config || session.config || {},
      port,
      targetRoot: reviewTargetRoot,
      worktreePath
    }),
    session,
    targetRoot: reviewTargetRoot
  });
}

export {
  createNextjsAppReviewTerminalSpec,
  createNextjsReviewDescriptor
};
