import {
  gitSafeDirectoryArgs
} from "./gitToolchainMounts.js";
import {
  buildDoctorToolchainArgs
} from "./doctorToolchain.js";
import {
  runHostCommand
} from "./shellCommands.js";

const DEFAULT_DOCTOR_COMMAND_TIMEOUT_MS = 20_000;

function doctorGitCommandArgs(targetRoot, args = []) {
  return ["git", ...gitSafeDirectoryArgs(targetRoot), ...args];
}

async function runDoctorToolchain(commandArgs = [], {
  extraArgs = [],
  targetRoot,
  timeout = DEFAULT_DOCTOR_COMMAND_TIMEOUT_MS
} = {}) {
  return runHostCommand("docker", buildDoctorToolchainArgs(commandArgs, {
    extraArgs,
    targetRoot
  }), {
    timeout
  });
}

async function runDoctorGit(targetRoot, args = [], options = {}) {
  return runDoctorToolchain(doctorGitCommandArgs(targetRoot, args), {
    targetRoot,
    ...options
  });
}

async function runDoctorGh(targetRoot, args = [], options = {}) {
  return runDoctorToolchain(["gh", ...args], {
    targetRoot,
    ...options
  });
}

export {
  doctorGitCommandArgs,
  runDoctorGh,
  runDoctorGit,
  runDoctorToolchain
};
