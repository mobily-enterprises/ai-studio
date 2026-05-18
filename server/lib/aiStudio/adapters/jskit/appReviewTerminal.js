import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadAppConfigFromAppRoot } from "@jskit-ai/kernel/server/support";

import {
  createAiStudioAppReviewTerminalSpec
} from "../../appReviewTerminal.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";
import {
  jskitDatabaseDockerArgsForTarget,
  readDatabaseHostFromDotEnv
} from "./setupMariaDbRuntime.js";

const DEFAULT_REVIEW_BUILD_COMMAND = "npm run build";
const DEFAULT_REVIEW_SERVER_COMMAND = "npm run server";
const DEFAULT_REVIEW_PORT = 4100;
const REVIEW_COMMAND_CONFIG = ".jskit/config/testrun_command";
const REVIEW_PORT_CONFIG = ".jskit/config/server_port_for_user_review";
const REVIEW_HOST_DOCKER_CONFIG = ".jskit/config/devel_app_test_host_docker";

function enabledConfigValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Boolean(normalized) && !["0", "false", "no", "off"].includes(normalized);
}

async function readOptionalConfigFile(root, relativePath, fallback = "") {
  try {
    const value = String(await readFile(path.join(root, relativePath), "utf8")).trim();
    return value || fallback;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw new Error(`Cannot read ${relativePath}: ${String(error?.message || error)}`);
  }
}

function normalizePort(value) {
  const port = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : DEFAULT_REVIEW_PORT;
}

async function resolveReviewConfig(worktreePath) {
  const [reviewCommand, hostDockerValue, portValue] = await Promise.all([
    readOptionalConfigFile(worktreePath, REVIEW_COMMAND_CONFIG, ""),
    readOptionalConfigFile(worktreePath, REVIEW_HOST_DOCKER_CONFIG, ""),
    readOptionalConfigFile(worktreePath, REVIEW_PORT_CONFIG, String(DEFAULT_REVIEW_PORT))
  ]);
  const hostDocker = enabledConfigValue(hostDockerValue);
  if (reviewCommand) {
    return {
      buildCommand: "",
      commandSource: REVIEW_COMMAND_CONFIG,
      hostDocker,
      hostDockerSource: hostDocker ? REVIEW_HOST_DOCKER_CONFIG : "",
      preferredPort: normalizePort(portValue),
      serverCommand: "",
      testrunCommand: reviewCommand
    };
  }

  const [buildCommand, serverCommand] = await Promise.all([
    readOptionalConfigFile(worktreePath, "config/build_command", DEFAULT_REVIEW_BUILD_COMMAND),
    readOptionalConfigFile(worktreePath, "config/server_command", DEFAULT_REVIEW_SERVER_COMMAND)
  ]);
  return {
    buildCommand,
    commandSource: "fallback_split_commands",
    hostDocker,
    hostDockerSource: hostDocker ? REVIEW_HOST_DOCKER_CONFIG : "",
    preferredPort: normalizePort(portValue),
    serverCommand,
    testrunCommand: `${buildCommand};${serverCommand}`
  };
}

async function defaultAppPath(worktreePath) {
  try {
    const appConfig = await loadAppConfigFromAppRoot({
      appRoot: worktreePath
    });
    const surfaceDefaultId = String(appConfig?.surfaceDefaultId || "").trim().replace(/^\/+/u, "");
    return surfaceDefaultId ? `/${surfaceDefaultId}` : "/";
  } catch {
    return "/";
  }
}

async function createJskitReviewDescriptor({
  config,
  databaseHost = "",
  targetRoot = "",
  worktreePath = ""
} = {}) {
  return {
    command: config.testrunCommand,
    extraDockerArgs: jskitDatabaseDockerArgsForTarget(databaseHost, targetRoot),
    hostDocker: config.hostDocker,
    metadata: {
      buildCommand: config.buildCommand,
      commandSource: config.commandSource,
      databaseHost,
      hostDocker: config.hostDocker,
      hostDockerSource: config.hostDockerSource,
      serverCommand: config.serverCommand,
      testrunCommand: config.testrunCommand
    },
    urlPath: await defaultAppPath(worktreePath)
  };
}

async function createJskitAppReviewTerminalSpec({
  session = {},
  targetRoot = ""
} = {}) {
  const worktreePath = String(session.metadata?.worktree_path || "").trim();
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before running the app."
    };
  }
  const [config, databaseHost] = await Promise.all([
    resolveReviewConfig(worktreePath),
    readDatabaseHostFromDotEnv(worktreePath)
  ]);
  const reviewTargetRoot = targetRoot || session.targetRoot || "";
  return createAiStudioAppReviewTerminalSpec({
    adapterId: "jskit",
    image: JSKIT_TOOLCHAIN_IMAGE,
    preferredPort: config.preferredPort,
    resolveReview: ({ worktreePath: reviewWorktreePath }) => createJskitReviewDescriptor({
      config,
      databaseHost,
      targetRoot: reviewTargetRoot,
      worktreePath: reviewWorktreePath
    }),
    session,
    targetRoot: reviewTargetRoot
  });
}

export {
  createJskitAppReviewTerminalSpec,
  createJskitReviewDescriptor,
  REVIEW_COMMAND_CONFIG,
  REVIEW_HOST_DOCKER_CONFIG,
  REVIEW_PORT_CONFIG
};
