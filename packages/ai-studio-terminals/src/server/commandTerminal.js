import path from "node:path";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  resizeTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  removeDockerContainer
} from "../../../../server/lib/containerRuntime.js";
import {
  aiStudioError
} from "../../../../server/lib/aiStudio/core.js";
import {
  aiStudioSessionDebugDurationMs,
  aiStudioSessionDebugError,
  aiStudioSessionDebugLog,
  aiStudioSessionDebugSummary
} from "../../../../server/lib/aiStudio/sessionDebugLog.js";
import {
  ensureTargetRuntimeNetwork
} from "../../../../server/lib/aiStudio/runtimeContainers.js";
import {
  studioUserStartupScript
} from "../../../../server/lib/studioToolHome.js";
import {
  aiStudioResult,
  commandTerminalNamespace,
  normalizePlainObject,
  pathInsideOrEqual,
  stableHash,
  terminalTargetRoot
} from "./terminalShared.js";
import {
  COMMAND_RESULT_ENV,
  createCommandResultFileSync,
  readCommandResultFile,
  removeCommandResultFile
} from "./commandTerminalResults.js";
import {
  projectTerminalEnvironment,
  terminalEnvironmentFingerprint
} from "./terminalEnvironment.js";
import {
  ensureAdapterRuntimeContainers
} from "./terminalRuntimeContainers.js";
import {
  resolveTerminalToolchainImage
} from "./terminalToolchainImage.js";
import {
  targetToolchainTerminalArgs
} from "./targetToolchainTerminal.js";

function actionById(session = {}, actionId = "") {
  return (Array.isArray(session.actions) ? session.actions : [])
    .find((action) => action.id === actionId) || null;
}

function actionRunsInCommandTerminal(action = {}) {
  return action.dispatchRoute === "command-terminal" || action.type === "command";
}

function commandTerminalContainerName({
  sessionId = "",
  terminalId = ""
} = {}) {
  return `ai-studio-command-${stableHash(sessionId)}-${stableHash(terminalId)}`;
}

function resolveCommandWorkdir(targetRoot = "", cwd = "") {
  const normalizedCwd = String(cwd || "").trim();
  if (!normalizedCwd) {
    return targetRoot;
  }
  return path.isAbsolute(normalizedCwd)
    ? path.resolve(normalizedCwd)
    : path.resolve(targetRoot, normalizedCwd);
}

function commandTerminalArgs({
  args = [],
  command = "",
  containerName = "",
  env = {},
  image,
  mounts = [],
  resultFile = {},
  sessionId = "",
  targetRoot = "",
  terminalId = "",
  workdir = ""
} = {}) {
  return targetToolchainTerminalArgs({
    commandArgs: [
      "bash",
      "-lc",
      studioUserStartupScript([command, ...args])
    ],
    containerName,
    env,
    image,
    kind: "command-terminal",
    mounts: [
      {
        source: resultFile.directory,
        target: resultFile.directory
      },
      ...mounts
    ],
    sessionId,
    targetRoot,
    terminalId,
    workdir
  });
}

async function writeActionTerminalResult({
  advanceOnSuccess = false,
  afterSuccessfulCommand = async () => null,
  action = {},
  exitCode,
  input = {},
  resultFile = {},
  runtime,
  session = {},
  spec = {}
} = {}) {
  const startedAtMs = Date.now();
  aiStudioSessionDebugLog("server.commandTerminal.writeResult.start", {
    actionId: String(action.id || ""),
    advanceOnSuccess,
    exitCode,
    sessionId: String(session.sessionId || ""),
    stepId: String(session.currentStep || "")
  });
  const completed = exitCode === 0;
  const commandResult = completed ? await readCommandResultFile(resultFile.path) : {
    facts: {}
  };
  const resultApplication = completed ? await applySuccessFacts({
    action,
    facts: commandResult.facts || {},
    input,
    runtime,
    session,
    spec
  }) : {
    deleteMetadata: [],
    metadata: {}
  };
  const metadata = completed ? resultApplication.metadata : {};
  const message = completed
    ? spec.successMessage || `${action.label || action.id} completed.`
    : spec.failureMessage || `${action.label || action.id} failed with exit code ${exitCode}.`;
  const actionResult = await runtime.store.writeActionResult(
    session.sessionId,
    action.id,
    {
      actionLabel: action.label,
      actionType: "command",
      artifacts: {},
      input,
      message,
      metadata,
      status: completed ? "completed" : "blocked",
      stepId: session.currentStep
    }
  );
  if (completed) {
    await Promise.all(resultApplication.deleteMetadata.map((name) => {
      return runtime.store.deleteMetadataValue(session.sessionId, name);
    }));
    await Promise.all(Object.entries(metadata).map(([name, value]) => {
      return runtime.store.writeMetadataValue(session.sessionId, name, value);
    }));
  }
  await runtime.store.appendCommandLogEntry(session.sessionId, {
    actionId: action.id,
    actionLabel: action.label,
    actionType: "command",
    kind: "terminal-action",
    status: actionResult.status,
    stepId: session.currentStep
  });
  if (typeof runtime.recordCommandActionFinished === "function") {
    await runtime.recordCommandActionFinished(session, action.id, actionResult);
  }
  const advancedSession = await advanceSessionAfterSuccessfulCommand({
    advanceOnSuccess,
    completed,
    runtime,
    session
  });
  const currentSession = advancedSession || await runtime.getSession(session.sessionId);
  aiStudioSessionDebugLog("server.commandTerminal.writeResult.done", {
    ...aiStudioSessionDebugSummary(currentSession),
    actionId: String(action.id || ""),
    actionResultStatus: String(actionResult.status || ""),
    completed,
    durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
    exitCode,
    metadataKeys: Object.keys(metadata).sort()
  });
  if (completed) {
    await afterSuccessfulCommand({
      action,
      actionResult,
      input,
      metadata,
      runtime,
      session: currentSession,
      spec
    });
  }
  return {
    actionResult,
    completed,
    metadata,
    session: currentSession
  };
}

async function advanceSessionAfterSuccessfulCommand({
  advanceOnSuccess = false,
  completed = false,
  runtime,
  session = {}
} = {}) {
  if (!advanceOnSuccess || !completed || typeof runtime?.advance !== "function") {
    aiStudioSessionDebugLog("server.commandTerminal.advanceAfterSuccess.skipped", {
      advanceOnSuccess,
      completed,
      hasAdvance: typeof runtime?.advance === "function",
      sessionId: String(session.sessionId || "")
    });
    return null;
  }

  const refreshedSession = await runtime.getSession(session.sessionId);
  if (
    refreshedSession?.next?.visible === true &&
    refreshedSession.next.enabled === true &&
    refreshedSession.next.stepId
  ) {
    aiStudioSessionDebugLog("server.commandTerminal.advanceAfterSuccess.start", {
      ...aiStudioSessionDebugSummary(refreshedSession)
    });
    return runtime.advance(session.sessionId);
  }
  aiStudioSessionDebugLog("server.commandTerminal.advanceAfterSuccess.notReady", {
    ...aiStudioSessionDebugSummary(refreshedSession),
    nextDisabledReason: String(refreshedSession?.next?.disabledReason || ""),
    nextVisible: refreshedSession?.next?.visible === true
  });
  return refreshedSession;
}

function normalizeMetadataMap(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata || {}).map(([name, value]) => [
    String(name || "").trim(),
    String(value || "").trim()
  ]).filter(([name]) => Boolean(name)));
}

function normalizeDeleteMetadata(names = []) {
  return Array.from(new Set((Array.isArray(names) ? names : [])
    .map((name) => String(name || "").trim())
    .filter(Boolean)));
}

async function applySuccessFacts({
  action = {},
  facts = {},
  input = {},
  runtime,
  session = {},
  spec = {}
} = {}) {
  const factApplication = typeof spec.applySuccessFacts === "function"
    ? await spec.applySuccessFacts({
        action,
        facts,
        input,
        runtime,
        session
      })
    : {};
  return {
    deleteMetadata: normalizeDeleteMetadata(factApplication.deleteMetadata),
    metadata: {
      ...normalizeMetadataMap(spec.successMetadata),
      ...normalizeMetadataMap(factApplication.metadata)
    }
  };
}

function createCommandTerminalController({
  afterSuccessfulCommand = async () => null,
  ensureRuntimeNetwork = ensureTargetRuntimeNetwork,
  projectService,
  publishSessionChanged = async () => null,
  removeContainer = removeDockerContainer,
  resolveToolchainImage = resolveTerminalToolchainImage,
  startTerminal = startTerminalSession
} = {}) {
  return Object.freeze({
    closeAllForSession(sessionId) {
      return closeTerminalSessionsForNamespace(commandTerminalNamespace(sessionId));
    },

    closeTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: commandTerminalNamespace(sessionId)
      });
    },

    readTerminal(sessionId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: commandTerminalNamespace(sessionId)
      });
    },

    async startTerminal(sessionId, input = {}) {
      const startedAtMs = Date.now();
      const requestedActionId = String(input?.actionId || "").trim();
      aiStudioSessionDebugLog("server.commandTerminal.start.start", {
        actionId: requestedActionId,
        advanceOnSuccess: input?.advanceOnSuccess === true,
        inputKeys: Object.keys(normalizePlainObject(input?.input)).sort(),
        sessionId
      });
      return aiStudioResult(async () => {
        try {
          const actionId = requestedActionId;
          const runtime = await projectService.createRuntime();
          const session = await runtime.getSession(sessionId);
          aiStudioSessionDebugLog("server.commandTerminal.start.sessionLoaded", {
            ...aiStudioSessionDebugSummary(session),
            actionId
          });
          const action = actionById(session, actionId);
          if (!action) {
            aiStudioSessionDebugLog("server.commandTerminal.start.blocked", {
              ...aiStudioSessionDebugSummary(session),
              actionId,
              reason: "action_not_available"
            });
            throw aiStudioError(
              `Action ${actionId || "(empty)"} is not available on this AI Studio step.`,
              "ai_studio_action_not_available"
            );
          }
          if (!actionRunsInCommandTerminal(action)) {
            aiStudioSessionDebugLog("server.commandTerminal.start.blocked", {
              ...aiStudioSessionDebugSummary(session),
              actionId,
              reason: "command_requires_terminal"
            });
            throw aiStudioError(
              `Action ${action.label || action.id} does not run in the command terminal.`,
              "ai_studio_command_requires_terminal"
            );
          }
          if (action.enabled !== true) {
            aiStudioSessionDebugLog("server.commandTerminal.start.blocked", {
              ...aiStudioSessionDebugSummary(session),
              actionId,
              reason: "action_disabled"
            });
            throw aiStudioError(
              action.disabledReason || `Action ${action.label || action.id} is disabled.`,
              "ai_studio_action_disabled"
            );
          }
          const targetRoot = terminalTargetRoot(session, projectService);
          if (!targetRoot) {
            aiStudioSessionDebugLog("server.commandTerminal.start.blocked", {
              ...aiStudioSessionDebugSummary(session),
              actionId,
              reason: "missing_target_root"
            });
            return {
              ok: false,
              error: "AI Studio command target root is not available."
            };
          }

          const advanceOnSuccess = input?.advanceOnSuccess === true;
          const commandInput = normalizePlainObject(input?.input);
          const spec = await runtime.adapter.createCommandTerminalSpec(action.id, {
            action,
            config: runtime.projectConfig,
            input: commandInput,
            runtime,
            session,
            store: runtime.store
          });
          if (spec?.ok === false) {
            aiStudioSessionDebugLog("server.commandTerminal.start.blocked", {
              ...aiStudioSessionDebugSummary(session),
              actionId,
              reason: "spec_not_ready"
            });
            return {
              ok: false,
              error: spec.message || `Command ${action.label || action.id} cannot start.`
            };
          }

          const workdir = resolveCommandWorkdir(targetRoot, spec.cwd);
          if (!pathInsideOrEqual(targetRoot, workdir)) {
            aiStudioSessionDebugLog("server.commandTerminal.start.blocked", {
              ...aiStudioSessionDebugSummary(session),
              actionId,
              reason: "workdir_outside_target"
            });
            return {
              ok: false,
              error: "AI Studio command workdir is outside the target root."
            };
          }

          const imageResult = await resolveToolchainImage({
            runtime,
            session,
            target: "command",
            targetRoot
          });
          if (imageResult.ok === false) {
            aiStudioSessionDebugLog("server.commandTerminal.start.blocked", {
              ...aiStudioSessionDebugSummary(session),
              actionId,
              reason: "toolchain_image",
              toolchainError: String(imageResult.error || "")
            });
            return imageResult;
          }

          await ensureRuntimeNetwork(targetRoot);
          await ensureAdapterRuntimeContainers({
            runtime,
            session,
            target: "command",
            targetRoot
          });
          const terminalEnv = await projectTerminalEnvironment({
            projectService,
            runtime,
            session,
            target: "command",
            targetRoot
          });
          const terminalEnvHash = terminalEnvironmentFingerprint(terminalEnv);
          const namespace = commandTerminalNamespace(sessionId);
          let resultFile = null;
          const commandResultFile = () => {
            if (!resultFile) {
              resultFile = createCommandResultFileSync();
            }
            return resultFile;
          };
          if (typeof runtime.recordCommandActionStarted === "function") {
            await runtime.recordCommandActionStarted(sessionId, action.id);
          }
          try {
            const terminal = await startTerminal({
              args: (terminalContext) => {
                const activeResultFile = commandResultFile();
                const specEnv = typeof spec.env === "function" ? spec.env(terminalContext) : spec.env || {};
                return commandTerminalArgs({
                  args: spec.args || [],
                  command: spec.command,
                  containerName: commandTerminalContainerName({
                    sessionId,
                    terminalId: terminalContext.id
                  }),
                  env: {
                    ...terminalEnv,
                    ...specEnv,
                    [COMMAND_RESULT_ENV]: activeResultFile.path
                  },
                  image: imageResult.image,
                  mounts: Array.isArray(spec.mounts) ? spec.mounts : [],
                  resultFile: activeResultFile,
                  sessionId,
                  targetRoot,
                  terminalId: terminalContext.id,
                  workdir
                });
              },
              command: "docker",
              commandPreview: spec.commandPreview,
              cwd: workdir,
              maxRunning: 1,
              metadata: {
                actionId: action.id,
                actionLabel: action.label,
                cwd: workdir,
                envHash: terminalEnvHash,
                image: imageResult.image,
                imageLabel: imageResult.label,
                sessionId
              },
              namespace,
              namespaceLimitPrefix: namespace,
              onClose: async ({ exitCode, id }) => {
                const onCloseStartedAtMs = Date.now();
                const activeResultFile = resultFile || {};
                aiStudioSessionDebugLog("server.commandTerminal.onClose.start", {
                  actionId: action.id,
                  exitCode,
                  sessionId,
                  terminalSessionId: id
                });
                try {
                  await writeActionTerminalResult({
                    advanceOnSuccess,
                    afterSuccessfulCommand,
                    action,
                    exitCode,
                    input: commandInput,
                    resultFile: activeResultFile,
                    runtime,
                    session,
                    spec
                  });
                  await publishSessionChanged(sessionId, {
                    reason: "command-terminal-closed"
                  });
                  aiStudioSessionDebugLog("server.commandTerminal.onClose.done", {
                    actionId: action.id,
                    durationMs: aiStudioSessionDebugDurationMs(onCloseStartedAtMs),
                    exitCode,
                    sessionId,
                    terminalSessionId: id
                  });
                } catch (error) {
                  aiStudioSessionDebugLog("server.commandTerminal.onClose.error", {
                    actionId: action.id,
                    durationMs: aiStudioSessionDebugDurationMs(onCloseStartedAtMs),
                    error: aiStudioSessionDebugError(error),
                    exitCode,
                    sessionId,
                    terminalSessionId: id
                  });
                  throw error;
                } finally {
                  await Promise.all([
                    removeCommandResultFile(activeResultFile),
                    removeContainer(commandTerminalContainerName({
                      sessionId,
                      terminalId: id
                    }))
                  ]);
                }
              },
              reuseRunning: true
            });
            aiStudioSessionDebugLog("server.commandTerminal.start.done", {
              actionId: action.id,
              durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
              sessionId,
              terminalSessionId: String(terminal?.id || ""),
              terminalStatus: String(terminal?.status || "")
            });
            return terminal;
          } catch (error) {
            if (typeof runtime.recordCommandActionFinished === "function") {
              await runtime.recordCommandActionFinished(session, action.id, {
                message: String(error?.message || error || "Command terminal could not start."),
                status: "blocked"
              });
            }
            throw error;
          }
        } catch (error) {
          aiStudioSessionDebugLog("server.commandTerminal.start.error", {
            actionId: requestedActionId,
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            error: aiStudioSessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: commandTerminalNamespace(sessionId)
      });
    },

    writeTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: commandTerminalNamespace(sessionId)
      });
    },

    resizeTerminal(sessionId, terminalSessionId, size) {
      return resizeTerminalSession(terminalSessionId, size, {
        namespace: commandTerminalNamespace(sessionId)
      });
    }
  });
}

export {
  commandTerminalArgs,
  commandTerminalContainerName,
  createCommandTerminalController
};
