import process from "node:process";

import {
  gitToolchainMountArgs
} from "./gitToolchainMounts.js";
import {
  targetRuntimeNetworkDockerArgs
} from "./aiStudio/runtimeContainers.js";
import {
  STUDIO_DAEMON_PID_LABEL,
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_TOOL_HOME_VOLUME,
  studioDockerLabel
} from "./studioRuntimeIdentity.js";

const STUDIO_TOOLCHAIN_CONTAINER_LABEL = studioDockerLabel("kind", "toolchain");

function normalizeToolchainOptions(options = {}) {
  return Array.isArray(options)
    ? {
        extraArgs: options
      }
    : options;
}

function buildDoctorToolchainArgs(commandArgs, options = {}) {
  const {
    extraArgs = [],
    image = STUDIO_BASE_TOOLCHAIN_IMAGE,
    targetRoot = ""
  } = normalizeToolchainOptions(options);
  const workspaceMountArgs = targetRoot
    ? [
        "-v",
        `${targetRoot}:/workspace`,
        ...gitToolchainMountArgs(targetRoot)
      ]
    : [];
  return [
    "run",
    "--rm",
    "-v",
    `${STUDIO_TOOL_HOME_VOLUME}:/home/studio`,
    "-e",
    "HOME=/home/studio",
    "--label",
    STUDIO_TOOLCHAIN_CONTAINER_LABEL,
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    ...workspaceMountArgs,
    ...(targetRoot ? targetRuntimeNetworkDockerArgs(targetRoot) : []),
    "-w",
    "/workspace",
    ...extraArgs,
    image,
    ...commandArgs
  ];
}

function buildDoctorTerminalArgs(commandArgs, options = {}) {
  const normalizedOptions = normalizeToolchainOptions(options);
  return buildDoctorToolchainArgs(commandArgs, {
    ...normalizedOptions,
    extraArgs: ["-it", ...(normalizedOptions.extraArgs || [])]
  });
}

export {
  buildDoctorTerminalArgs,
  buildDoctorToolchainArgs,
  STUDIO_TOOLCHAIN_CONTAINER_LABEL
};
