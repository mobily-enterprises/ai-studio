import process from "node:process";

import {
  prepareAgentDatabaseCommand
} from "./agentDatabaseCommand.js";
import {
  prepareAgentEnvCommand
} from "./agentEnvCommand.js";
import {
  prepareAgentPreviewCommand
} from "./agentPreviewCommand.js";
import {
  prepareCodexGitCommand
} from "./codexGitCommand.js";

function record(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value = "") {
  return String(value ?? "").trim();
}

function commandBoundaryError(name = "") {
  const error = new Error(`Vibe64 could not prepare the session-scoped ${text(name) || "command"} boundary.`);
  error.code = "vibe64_agent_command_boundary_unavailable";
  error.boundary = text(name);
  return error;
}

async function prepareAgentSessionCommandEnvironment({
  agentDatabaseCommand = null,
  agentEnvCommand = null,
  agentPreviewCommand = null,
  env = process.env,
  gitCommand = null,
  gitEnvironment = env,
  prepareDatabaseCommand = prepareAgentDatabaseCommand,
  prepareEnvironmentCommand = prepareAgentEnvCommand,
  prepareGitCommand = prepareCodexGitCommand,
  preparePreviewCommand = prepareAgentPreviewCommand,
  project = {},
  runtime = null,
  sessionId = "",
  worktreePath = ""
} = {}) {
  const normalizedSessionId = text(sessionId);
  if (!gitCommand || !normalizedSessionId) {
    return {
      env: {},
      hostWrapperDir: "",
      ok: false,
      shimDirs: []
    };
  }
  const git = await prepareGitCommand({
    commandService: gitCommand,
    env: gitEnvironment,
    sessionId: normalizedSessionId,
    stateRoot: text(runtime?.stateRoot)
  });
  if (git?.ok !== true || !text(git.hostWrapperDir)) {
    throw commandBoundaryError("Git");
  }
  const steps = [{ name: "Git", result: git }];
  if (agentPreviewCommand) {
    steps.push({
      name: "preview",
      result: await preparePreviewCommand({
        commandService: agentPreviewCommand,
        env,
        project: record(project),
        sessionId: normalizedSessionId,
        worktreePath,
        wrapperHostDir: git.hostWrapperDir
      })
    });
  }
  if (agentEnvCommand) {
    steps.push({
      name: "environment",
      result: await prepareEnvironmentCommand({
        commandService: agentEnvCommand,
        sessionId: normalizedSessionId,
        wrapperHostDir: git.hostWrapperDir
      })
    });
  }
  if (agentDatabaseCommand) {
    steps.push({
      name: "database",
      result: await prepareDatabaseCommand({
        commandService: agentDatabaseCommand,
        sessionId: normalizedSessionId,
        wrapperHostDir: git.hostWrapperDir
      })
    });
  }
  const unavailable = steps.find((step) => step.result?.ok !== true);
  if (unavailable) {
    throw commandBoundaryError(unavailable.name);
  }
  return {
    env: Object.assign({}, ...steps.map((step) => record(step.result?.env))),
    hostWrapperDir: text(git.hostWrapperDir),
    ok: true,
    shimDirs: [text(git.hostWrapperDir)]
  };
}

export {
  prepareAgentSessionCommandEnvironment
};
