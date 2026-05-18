import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  containerWorkspacePath,
  removeDockerContainer
} from "../containerRuntime.js";
import {
  gitToolchainMountArgs
} from "../gitToolchainMounts.js";
import {
  dockerCommand,
  hostUserDockerArgs,
  hostUserIdentityEnvArgs,
  shellQuote,
  stableHash
} from "../shellCommands.js";
import {
  AI_STUDIO_SKIP_STALE_TERMINAL_CLEANUP_ENV,
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_DAEMON_PID_LABEL
} from "../studioRuntimeIdentity.js";
import {
  normalizeText
} from "./core.js";

const execFileAsync = promisify(execFile);
const DEFAULT_REVIEW_PORT = 4100;

function normalizePort(value, fallback = DEFAULT_REVIEW_PORT) {
  const port = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : fallback;
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function dockerHasPublishedPort(port) {
  try {
    const result = await execFileAsync("docker", [
      "ps",
      "--filter",
      `publish=${port}`,
      "--format",
      "{{.ID}}"
    ], {
      maxBuffer: 1024 * 1024,
      timeout: 3000
    });
    return Boolean(String(result.stdout || "").trim());
  } catch {
    return false;
  }
}

async function reviewPortIsAvailable(port) {
  const [localAvailable, dockerPublished] = await Promise.all([
    canListenOnPort(port),
    dockerHasPublishedPort(port)
  ]);
  return localAvailable && !dockerPublished;
}

async function findAvailableReviewPort(preferredPort = DEFAULT_REVIEW_PORT) {
  const startPort = normalizePort(preferredPort);
  for (let port = startPort; port <= 65535; port += 1) {
    if (await reviewPortIsAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No localhost port is available at or after ${startPort}.`);
}

function normalizeUrlPath(value = "/") {
  const normalized = normalizeText(value) || "/";
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function normalizeStartupCommands({
  command = "",
  commands = []
} = {}) {
  const entries = Array.isArray(commands) && commands.length > 0
    ? commands
    : [
        {
          command,
          networkEnv: true
        }
      ];
  return entries
    .map((entry) => {
      const normalizedCommand = normalizeText(typeof entry === "string" ? entry : entry?.command);
      if (!normalizedCommand) {
        return null;
      }
      return {
        command: normalizedCommand,
        label: normalizeText(entry?.label),
        networkEnv: entry?.networkEnv !== false
      };
    })
    .filter(Boolean);
}

function startupCommandLines(commands = []) {
  return commands.flatMap((entry) => [
    entry.label ? `printf '\\n[studio] %s\\n' ${shellQuote(entry.label)}` : "",
    entry.networkEnv
      ? `printf '\\n[studio] $ HOST=%s PORT=%s %s\\n\\n' "$HOST" "$PORT" ${shellQuote(entry.command)}`
      : `printf '\\n[studio] $ %s\\n\\n' ${shellQuote(entry.command)}`,
    entry.command
  ].filter(Boolean));
}

function appReviewStartupScript({
  commands = [],
  port
} = {}) {
  const runCommand = [
    "set -e",
    "export HOST=0.0.0.0",
    `export PORT=${shellQuote(String(port))}`,
    ...startupCommandLines(commands)
  ].join("\n");
  return [
    "set -e",
    "mkdir -p /tmp/studio-home /tmp/npm-cache",
    "if [ \"$(id -u)\" = \"0\" ] && [ -n \"${AI_STUDIO_HOST_UID:-}\" ] && [ -n \"${AI_STUDIO_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    "  chown -R \"$AI_STUDIO_HOST_UID:$AI_STUDIO_HOST_GID\" /tmp/studio-home /tmp/npm-cache",
    "  docker_group_args=\"--clear-groups\"",
    "  if [ -S /var/run/docker.sock ]; then",
    "    docker_sock_gid=\"$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)\"",
    "    if [ -n \"$docker_sock_gid\" ]; then",
    "      docker_group_args=\"--groups $docker_sock_gid\"",
    "    fi",
    "  fi",
    `  exec setpriv --reuid "$AI_STUDIO_HOST_UID" --regid "$AI_STUDIO_HOST_GID" $docker_group_args env HOME=/tmp/studio-home npm_config_cache=/tmp/npm-cache bash -lc ${shellQuote(runCommand)}`,
    "fi",
    `exec env HOME=/tmp/studio-home npm_config_cache=/tmp/npm-cache bash -lc ${shellQuote(runCommand)}`
  ].join("\n");
}

function hostDockerArgs(enabled = false) {
  if (!enabled) {
    return [];
  }
  const args = [
    "-e",
    "DOCKER_HOST=unix:///var/run/docker.sock",
    "-e",
    `${AI_STUDIO_SKIP_STALE_TERMINAL_CLEANUP_ENV}=1`,
    "-v",
    "/var/run/docker.sock:/var/run/docker.sock"
  ];
  const userArgs = hostUserDockerArgs();
  if (userArgs.length === 2) {
    args.push("--user", userArgs[1]);
  }
  try {
    const socketStats = statSync("/var/run/docker.sock");
    args.push("--group-add", String(socketStats.gid));
  } catch {
    // Docker readiness is reported by the terminal command itself.
  }
  return args;
}

function reviewContainerName({
  adapterId = "generic",
  sessionId = "",
  terminalId = ""
} = {}) {
  return `ai-studio-${adapterId}-app-review-${stableHash(sessionId)}-${stableHash(terminalId)}`;
}

function appReviewTerminalArgs({
  adapterId = "generic",
  containerName = "",
  extraDockerArgs = [],
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  port,
  sessionId = "",
  startupCommands = [],
  targetRoot = "",
  terminalId = "",
  workdir = ""
} = {}) {
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    containerName,
    "--label",
    "ai-studio.kind=app-review-terminal",
    "--label",
    `ai-studio.adapter=${adapterId}`,
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    `ai-studio.session=${sessionId}`,
    "--label",
    `ai-studio.terminal=${terminalId}`,
    "--label",
    `ai-studio.target=${stableHash(targetRoot)}`,
    "-p",
    `127.0.0.1:${port}:${port}`,
    ...gitToolchainMountArgs(targetRoot),
    "-v",
    `${targetRoot}:/workspace`,
    "-v",
    `${targetRoot}:${targetRoot}`,
    ...extraDockerArgs,
    ...hostUserIdentityEnvArgs(),
    "-w",
    workdir,
    image,
    "bash",
    "-lc",
    appReviewStartupScript({
      commands: startupCommands,
      port
    })
  ];
}

async function createAiStudioAppReviewTerminalSpec({
  adapterId = "generic",
  image = STUDIO_BASE_TOOLCHAIN_IMAGE,
  preferredPort = DEFAULT_REVIEW_PORT,
  resolveReview = async () => ({}),
  session = {},
  targetRoot = ""
} = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before running the app."
    };
  }
  const resolvedTargetRoot = path.resolve(targetRoot || session.targetRoot || process.cwd());
  if (!containerWorkspacePath(resolvedTargetRoot, worktreePath)) {
    return {
      ok: false,
      message: "The session worktree is outside the target root."
    };
  }

  const port = await findAvailableReviewPort(preferredPort);
  const review = await resolveReview({
    port,
    session,
    targetRoot: resolvedTargetRoot,
    worktreePath
  });
  const startupCommands = normalizeStartupCommands(review);
  if (startupCommands.length === 0) {
    return {
      ok: false,
      message: "App review command is not configured."
    };
  }

  const urlPath = normalizeUrlPath(review.urlPath || "/");
  const appUrl = `http://127.0.0.1:${port}${urlPath}`;
  const workdir = normalizeText(review.workdir) || worktreePath;
  const extraDockerArgs = [
    ...(Array.isArray(review.extraDockerArgs) ? review.extraDockerArgs : []),
    ...hostDockerArgs(review.hostDocker === true)
  ];
  const metadata = {
    adapterId,
    appUrl,
    port,
    runRoot: workdir,
    scope: "session",
    sessionId: session.sessionId || "",
    urlPath,
    ...(review.metadata || {})
  };

  return {
    args: ({ id }) => appReviewTerminalArgs({
      adapterId,
      containerName: reviewContainerName({
        adapterId,
        sessionId: session.sessionId,
        terminalId: id
      }),
      extraDockerArgs,
      image,
      port,
      sessionId: session.sessionId,
      startupCommands,
      targetRoot: resolvedTargetRoot,
      terminalId: id,
      workdir
    }),
    command: "docker",
    commandPreview: ({ args }) => dockerCommand(args),
    cwd: resolvedTargetRoot,
    metadata,
    ok: true,
    onClose: async ({ id }) => {
      await removeDockerContainer(reviewContainerName({
        adapterId,
        sessionId: session.sessionId,
        terminalId: id
      }));
    },
    reuseRunning: true
  };
}

export {
  DEFAULT_REVIEW_PORT,
  appReviewStartupScript,
  createAiStudioAppReviewTerminalSpec,
  findAvailableReviewPort
};
