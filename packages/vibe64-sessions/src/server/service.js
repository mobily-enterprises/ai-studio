import crypto from "node:crypto";

import { vibe64Result } from "@local/vibe64-core/server/serverResponses";
import {
  readSessionUiSyncState,
  writeSessionUiSyncPreviewState,
  writeSessionUiSyncViewState
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  REPOSITORY_UPDATE_RELATIONSHIPS,
  normalizeRepositoryUpdateCheck
} from "@local/vibe64-core/shared";

function text(value = "") {
  return String(value || "").trim();
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const REPOSITORY_UPDATE_CHECK_METADATA = "repository_update_check";
const REPOSITORY_UPDATE_CHECK_CACHE_MS = 25_000;
function repositoryUpdateCheckIsFresh(value = {}, now = Date.now()) {
  const checkedAt = Date.parse(text(value?.checkedAt));
  return Number.isFinite(checkedAt) && now - checkedAt >= 0 &&
    now - checkedAt < REPOSITORY_UPDATE_CHECK_CACHE_MS;
}

function cachedRepositoryUpdateCheck(session = {}) {
  const raw = text(session?.metadata?.[REPOSITORY_UPDATE_CHECK_METADATA]);
  if (!raw) {
    return null;
  }
  try {
    const parsed = record(JSON.parse(raw));
    const checkedAt = text(parsed.checkedAt);
    const relationship = text(parsed.relationship);
    if (
      !checkedAt ||
      !Number.isFinite(Date.parse(checkedAt)) ||
      !REPOSITORY_UPDATE_RELATIONSHIPS.has(relationship) ||
      (Number(parsed.behind || 0) > 0 && !Array.isArray(parsed.incomingVersions)) ||
      (
        text(session?.metadata?.canonical_commit) &&
        text(parsed.canonicalCommit) !== text(session.metadata.canonical_commit)
      )
    ) {
      return null;
    }
    const normalized = normalizeRepositoryUpdateCheck(parsed, checkedAt);
    return normalized.relationship === relationship ? normalized : null;
  } catch {
    return null;
  }
}

async function persistRepositoryUpdateCheck(runtime, sessionId, result = {}) {
  const status = normalizeRepositoryUpdateCheck(result);
  await runtime.store.writeMetadataValue(
    sessionId,
    REPOSITORY_UPDATE_CHECK_METADATA,
    JSON.stringify(status)
  );
  return status;
}

function sessionResult(operation, fallbackMessage = "Vibe64 session request failed.") {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_session_request_failed",
    fallbackMessage
  });
}

function requiredRepositorySessionId(value = "") {
  const sessionId = text(value);
  if (!sessionId) {
    const error = new Error("Select a session before opening its repository history.");
    error.code = "vibe64_repository_history_session_required";
    throw error;
  }
  return sessionId;
}

function archiveListOptions(value = "") {
  const archive = text(value);
  if (archive === "abandoned") {
    return {
      statuses: ["abandoned"]
    };
  }
  return {
    statusGroup: "open"
  };
}

function conversationPageOptions(options = {}) {
  const limit = Number.parseInt(String(options.limit || ""), 10);
  return {
    beforeTurnId: text(options.beforeTurnId),
    limit: Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50
  };
}

function conversationPage(result = {}, options = {}) {
  if (Array.isArray(result)) {
    return {
      conversationLog: result,
      pagination: {
        beforeTurnId: options.beforeTurnId,
        hasMoreBefore: false,
        limit: options.limit,
        nextBeforeTurnId: ""
      }
    };
  }
  return {
    conversationLog: Array.isArray(result.conversationLog) ? result.conversationLog : [],
    pagination: record(result.pagination)
  };
}

function messageText(input = {}) {
  return text(input.message);
}

function sessionRuntimeOptions(terminals) {
  const createSessionSource = typeof terminals?.createSessionSource === "function"
    ? (context) => terminals.createSessionSource(context)
    : null;
  return createSessionSource ? { createSessionSource } : {};
}

function publicSession(session = {}, extra = {}) {
  return {
    ...session,
    ...extra,
    ok: true
  };
}

const SESSION_SAVE_TASK_ID = "save-work";
const SESSION_UPDATE_TASK_ID = "update-session";

function createService({
  project,
  publishSessionChanged = async () => null,
  terminals,
  workspaceSetupRunner = null
} = {}) {
  if (!project) {
    throw new TypeError("createService requires vibe64.project.");
  }
  if (!terminals) {
    throw new TypeError("createService requires vibe64.terminals.");
  }
  const setupRunner = workspaceSetupRunner || Object.freeze({
    isRunning: (sessionId) => typeof terminals.workspaceSetupIsRunning === "function" &&
      terminals.workspaceSetupIsRunning(sessionId),
    start: ({ retry = false, runtime, session }) => terminals.prepareWorkspaceSetup(
      session.sessionId,
      { retry, runtime, session }
    ),
    wait: (sessionId) => typeof terminals.waitForWorkspaceSetup === "function"
      ? terminals.waitForWorkspaceSetup(sessionId)
      : null
  });
  const activeSaveOperations = new Map();
  const activeUpdateOperations = new Map();

  async function publishCanonicalChanged(runtime, sourceSessionId, canonicalCommit, {
    originId = ""
  } = {}) {
    const sessions = typeof runtime.listSessionSummaries === "function"
      ? await runtime.listSessionSummaries({ statusGroup: "open" })
      : [];
    const deliveries = await Promise.allSettled(sessions.map(async (candidate) => {
      const candidateId = text(candidate?.sessionId);
      if (!candidateId || candidateId === sourceSessionId) {
        return;
      }
      await runtime.store.writeMetadataValue(
        candidateId,
        "canonical_commit",
        canonicalCommit
      );
      await publishSessionChanged(candidateId, {
        operation: "updated",
        originId: text(originId),
        payload: {
          canonicalCommit,
          sourceSessionId
        },
        reason: "repository-canonical-changed",
        session: candidate
      });
    }));
    deliveries.forEach((delivery, index) => {
      if (delivery.status === "rejected") {
        vibe64SessionDebugLog("server.sessions.repositoryCanonicalChanged.publish.error", {
          error: vibe64SessionDebugError(delivery.reason),
          sessionId: text(sessions[index]?.sessionId),
          sourceSessionId
        });
      }
    });
  }

  function observeWorkspaceSetup(sessionId, completion, {
    originId = ""
  } = {}) {
    if (!completion || typeof completion.then !== "function") {
      return;
    }
    void completion.then(async (workspaceSetup) => {
      const runtime = await project.createRuntime({
        inspectSource: false
      });
      await publishSessionChanged(sessionId, {
        operation: "updated",
        originId: text(originId),
        reason: "workspace-setup-completed",
        session: await runtime.getSession(sessionId, {
          inspectSource: false
        }),
        workspaceSetup
      });
    }).catch((error) => {
      vibe64SessionDebugLog("server.sessions.workspaceSetup.publish.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
    });
  }

  async function recoverInterruptedSave(runtime, session, task) {
    if (task?.status !== "running" || typeof terminals.recoverSessionWorkSave !== "function") {
      return task;
    }
    if (activeSaveOperations.get(session.sessionId) === text(task.operationId)) {
      return task;
    }
    try {
      const result = await terminals.recoverSessionWorkSave(session.sessionId, {
        recovery: task,
        runtime,
        session
      });
      await runtime.store.writeMetadataValue(session.sessionId, "canonical_commit", result.saveCommit);
      if (result.reconciled === true) {
        await runtime.store.writeMetadataValue(session.sessionId, "base_commit", result.saveCommit);
      }
      return runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_SAVE_TASK_ID, {
        event: {
          kind: "save-recovered",
          message: result.reconciled === true
            ? "Interrupted Save recovered and reconciled."
            : "Interrupted Save was published and needs local reconciliation.",
          status: "ready"
        },
        patch: {
          ...result,
          status: "ready"
        }
      });
    } catch (error) {
      return runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_SAVE_TASK_ID, {
        event: {
          kind: "save-recovery-failed",
          message: text(error?.message) || "Interrupted Save needs attention.",
          status: "failed"
        },
        patch: {
          code: text(error?.code),
          error: text(error?.message) || "Interrupted Save needs attention.",
          retryable: error?.retryable === true,
          status: "failed"
        }
      });
    }
  }

  async function recoverInterruptedUpdate(runtime, session, task) {
    if (task?.status !== "running" || typeof terminals.recoverSessionWorkUpdate !== "function") {
      return task;
    }
    if (activeUpdateOperations.get(session.sessionId) === text(task.operationId)) {
      return task;
    }
    try {
      const result = await terminals.recoverSessionWorkUpdate(session.sessionId, {
        recovery: task,
        runtime,
        session
      });
      await runtime.store.writeMetadataValue(session.sessionId, "canonical_commit", result.canonicalCommit);
      if (result.reconciled === true) {
        await runtime.store.writeMetadataValue(session.sessionId, "base_commit", result.canonicalCommit);
      }
      return runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_UPDATE_TASK_ID, {
        event: {
          kind: "update-recovered",
          message: "Interrupted session update recovered.",
          status: "ready"
        },
        patch: { ...result, status: "ready" }
      });
    } catch (error) {
      return runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_UPDATE_TASK_ID, {
        event: {
          kind: "update-recovery-failed",
          message: text(error?.message) || "Interrupted session update needs attention.",
          status: "failed"
        },
        patch: {
          code: text(error?.code),
          error: text(error?.message) || "Interrupted session update needs attention.",
          retryable: error?.retryable === true,
          status: "failed"
        }
      });
    }
  }

  async function resolveSupersededUpdateFailure(runtime, sessionId, saveResult = {}, options = {}) {
    if (
      saveResult?.reconciled !== true ||
      typeof runtime?.store?.readBackgroundTask !== "function"
    ) {
      return null;
    }
    const task = await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID);
    if (task?.status !== "failed") {
      return task || null;
    }
    if (options.knownNewer !== true) {
      const saveUpdatedAt = Date.parse(text(saveResult.updatedAt));
      const updateUpdatedAt = Date.parse(text(task.updatedAt));
      if (
        !Number.isFinite(saveUpdatedAt) ||
        !Number.isFinite(updateUpdatedAt) ||
        saveUpdatedAt <= updateUpdatedAt
      ) {
        return task;
      }
    }
    return runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
      event: {
        kind: "update-superseded-by-save",
        message: "The repository issue was resolved by the completed Save.",
        status: "ready"
      },
      patch: {
        code: "",
        error: "",
        resolvedBySaveCommit: text(saveResult.saveCommit),
        retryable: false,
        status: "ready"
      }
    });
  }

  return Object.freeze({
    async inspectRepositoryHistory(input = {}) {
      return sessionResult(async () => {
        const sessionId = requiredRepositorySessionId(input.sessionId);
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const history = await terminals.inspectRepositoryHistory({ ...input, session });
        const updateCheck = cachedRepositoryUpdateCheck(session);
        return {
          ...history,
          ...(updateCheck ? { updateCheck } : {})
        };
      }, "Vibe64 could not read project version history.");
    },

    async inspectRepositoryVersionFiles(input = {}) {
      return sessionResult(async () => {
        const sessionId = requiredRepositorySessionId(input.sessionId);
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        return terminals.inspectRepositoryVersionFiles({ ...input, session });
      }, "Vibe64 could not read this project version.");
    },

    async inspectRepositoryVersionFileDiff(input = {}) {
      return sessionResult(async () => {
        const sessionId = requiredRepositorySessionId(input.sessionId);
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        return terminals.inspectRepositoryVersionFileDiff({ ...input, session });
      }, "Vibe64 could not read this version's file change.");
    },

    async abandonSession(sessionId, input = {}) {
      return sessionResult(async () => {
        if (setupRunner.isRunning(sessionId)) {
          const error = new Error("Wait for workspace preparation to finish before closing this session.");
          error.code = "vibe64_workspace_setup_running";
          throw error;
        }
        const runtime = await project.createRuntime();
        const currentSession = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        const sourceCreationFailed = currentSession.sourceReady !== true &&
          text(currentSession.metadata?.source_creation_failed).toLowerCase() === "yes";
        await runtime.markSessionClosing(sessionId, {
          reason: "abandoned"
        });
        try {
          await terminals.closeSessionTerminals(sessionId);
          if (!sourceCreationFailed && typeof project.releaseSessionResources === "function") {
            await project.releaseSessionResources({
              sessionId
            });
          }
          const session = await runtime.abandonSession(sessionId);
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-abandoned",
            session
          });
          return publicSession(session);
        } catch (error) {
          await runtime.clearSessionClosing(sessionId).catch(() => null);
          throw error;
        }
      }, "Vibe64 could not close this session.");
    },

    async broadcastSessionPreviewState(sessionId, input = {}) {
      const preview = {
        originId: text(input.originId),
        projectSlug: text(input.projectSlug),
        route: text(input.route),
        sessionId: text(sessionId),
        title: text(input.title).slice(0, 256),
        updatedAt: new Date().toISOString()
      };
      if (!preview.sessionId || !preview.projectSlug || !preview.route || !preview.originId) {
        return {
          error: "Preview updates require a session, project, route, and origin.",
          ok: false
        };
      }
      writeSessionUiSyncPreviewState(preview);
      return {
        ok: true,
        preview
      };
    },

    async broadcastSessionViewState(sessionId, input = {}) {
      const viewState = {
        originId: text(input.originId),
        projectPane: text(input.projectPane),
        projectSlug: text(input.projectSlug),
        routeFullPath: text(input.routeFullPath),
        sessionId: text(sessionId),
        updatedAt: new Date().toISOString()
      };
      if (!viewState.sessionId || !viewState.projectSlug || !viewState.routeFullPath || !viewState.originId) {
        return {
          error: "Session view updates require a session, project, route, and origin.",
          ok: false
        };
      }
      writeSessionUiSyncViewState(viewState);
      return {
        ok: true,
        viewState
      };
    },

    async createSession(input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime(sessionRuntimeOptions(terminals));
        const session = await runtime.createSession({
          metadata: {
            created_by: text(input.vibe64User?.username || input.vibe64User?.name)
          },
          sourceContext: {
            vibe64User: input.vibe64User || null
          }
        });
        const setup = await setupRunner.start({
          retry: true,
          runtime,
          session
        });
        const currentSession = await runtime.getSession(session.sessionId, {
          inspectSource: false
        });
        await publishSessionChanged(session.sessionId, {
          operation: "created",
          originId: text(input.originId),
          reason: "session-created",
          session: currentSession
        });
        observeWorkspaceSetup(session.sessionId, setup.completion, {
          originId: input.originId
        });
        return publicSession(currentSession);
      }, "Vibe64 could not create a chat session.");
    },

    async inspectSession(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime();
        const session = await runtime.getSession(sessionId);
        const agentSession = typeof terminals.agentSessionState === "function"
          ? await terminals.agentSessionState(sessionId, {
              runtime,
              session
            })
          : null;
        const uiSync = readSessionUiSyncState({
          projectSlug: input.projectSlug,
          sessionId
        });
        return publicSession(session, {
          ...(agentSession?.ok === false ? {} : { agentSession }),
          ...(uiSync ? { uiSync } : {})
        });
      });
    },

    async inspectSessionWork(sessionId) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        const existingTask = await runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID);
        const operation = await recoverInterruptedSave(runtime, session, existingTask);
        const updateTask = await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID);
        const recoveredUpdateOperation = await recoverInterruptedUpdate(runtime, session, updateTask);
        const updateOperation = recoveredUpdateOperation?.status === "failed"
          ? await resolveSupersededUpdateFailure(runtime, sessionId, operation)
          : recoveredUpdateOperation;
        const work = await terminals.inspectSessionWork(sessionId, {
          runtime,
          session
        });
        const [latestOperation, latestUpdateOperation] = await Promise.all([
          runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID),
          runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID)
        ]);
        return {
          ...work,
          operation: latestOperation || operation,
          updateOperation: latestUpdateOperation || updateOperation,
          ok: true
        };
      }, "Vibe64 could not inspect this session's work.");
    },

    async inspectSessionChanges(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        return terminals.inspectSessionChanges(sessionId, {
          ...input,
          runtime,
          session
        });
      }, "Vibe64 could not inspect this session's current changes.");
    },

    async inspectSessionChangeDiff(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        return terminals.inspectSessionChangeDiff(sessionId, {
          ...input,
          runtime,
          session
        });
      }, "Vibe64 could not inspect this changed file.");
    },

    async saveSessionWork(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        const operationId = crypto.randomUUID();
        let operationStarted = false;
        try {
          const result = await terminals.saveSessionWork(sessionId, {
            onRepositoryWriteAcquired: async () => {
              operationStarted = true;
              activeSaveOperations.set(sessionId, operationId);
              await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
                event: {
                  kind: "save-started",
                  message: "Saving session work.",
                  status: "running"
                },
                patch: {
                  operationId,
                  status: "running"
                }
              });
              await publishSessionChanged(sessionId, {
                operation: "updated",
                originId: text(input.originId),
                reason: "session-save-started",
                session: await runtime.getSession(sessionId, { inspectSource: false })
              });
            },
            operationId,
            onProgress: async (progress = {}) => {
              await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
                event: {
                  kind: text(progress.kind) || "save-progress",
                  message: text(progress.message),
                  status: "running"
                },
                patch: {
                  ...progress,
                  operationId,
                  status: "running"
                }
              });
              await publishSessionChanged(sessionId, {
                operation: "updated",
                originId: text(input.originId),
                reason: "session-save-progress",
                session: await runtime.getSession(sessionId, { inspectSource: false })
              });
            },
            runtime,
            session,
            vibe64User: input.vibe64User || null
          });
          await runtime.store.writeMetadataValue(sessionId, "canonical_commit", result.saveCommit);
          if (result.reconciled === true) {
            await runtime.store.writeMetadataValue(sessionId, "base_commit", result.saveCommit);
          }
          const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
            event: {
              kind: result.status,
              message: result.reconciled === true
                ? "Session work was saved."
                : "Session work was published and needs local reconciliation.",
              status: "ready"
            },
            patch: {
              ...result,
              status: "ready"
            }
          });
          await resolveSupersededUpdateFailure(runtime, sessionId, result, { knownNewer: true });
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-save-completed",
            session: await runtime.getSession(sessionId, { inspectSource: false })
          });
          await publishCanonicalChanged(runtime, sessionId, result.saveCommit, {
            originId: input.originId
          });
          return {
            ...result,
            operation: task,
            ok: true
          };
        } catch (error) {
          if (!operationStarted) {
            throw error;
          }
          const updateRequired = error?.code === "vibe64_session_save_update_required";
          const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
            event: {
              kind: updateRequired ? "save-update-required" : "save-failed",
              message: text(error?.message) || "Session Save failed.",
              status: updateRequired ? "ready" : "failed"
            },
            patch: {
              code: text(error?.code),
              ...(updateRequired
                ? { updateRequired: true }
                : { error: text(error?.message) || "Session Save failed." }),
              operationId,
              status: updateRequired ? "ready" : "failed"
            }
          });
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: updateRequired ? "session-save-update-required" : "session-save-failed",
            session: await runtime.getSession(sessionId, { inspectSource: false }),
            task
          });
          throw error;
        } finally {
          if (activeSaveOperations.get(sessionId) === operationId) {
            activeSaveOperations.delete(sessionId);
          }
        }
      }, "Vibe64 could not save this session's work.");
    },

    async checkSessionUpdates(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const cached = cachedRepositoryUpdateCheck(session);
        if (input.force !== true && cached && repositoryUpdateCheckIsFresh(cached)) {
          return {
            ...cached,
            cached: true,
            ok: true
          };
        }
        const previousCanonicalCommit = text(
          session?.metadata?.canonical_commit || session?.metadata?.base_commit
        );
        const result = await terminals.checkSessionUpdates(sessionId, {
          ...input,
          operationId: crypto.randomUUID(),
          runtime,
          session
        });
        await runtime.store.writeMetadataValue(sessionId, "canonical_commit", result.canonicalCommit);
        if (result.reconciled === true) {
          await runtime.store.writeMetadataValue(sessionId, "base_commit", result.canonicalCommit);
        }
        const updateCheck = await persistRepositoryUpdateCheck(runtime, sessionId, result);
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: text(input.originId),
          reason: "session-repository-checked",
          session: await runtime.getSession(sessionId, { inspectSource: false })
        });
        if (previousCanonicalCommit && previousCanonicalCommit !== result.canonicalCommit) {
          await publishCanonicalChanged(runtime, sessionId, result.canonicalCommit, {
            originId: input.originId
          });
        }
        return {
          ...result,
          ...updateCheck
        };
      }, "Vibe64 could not check this session for updates.");
    },

    async updateSessionWork(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const previousTask = await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID);
        const conflictRecovery = previousTask?.status === "failed" &&
          previousTask?.conflictRecovery && typeof previousTask.conflictRecovery === "object"
          ? previousTask.conflictRecovery
          : null;
        const operationId = crypto.randomUUID();
        let operationStarted = false;
        try {
          const result = await terminals.updateSessionWork(sessionId, {
            conflictRecovery,
            onRepositoryWriteAcquired: async () => {
              operationStarted = true;
              activeUpdateOperations.set(sessionId, operationId);
              await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
                event: {
                  kind: "update-started",
                  message: "Updating this session (rebase).",
                  status: "running"
                },
                patch: { operationId, status: "running" }
              });
              await publishSessionChanged(sessionId, {
                operation: "updated",
                originId: text(input.originId),
                reason: "session-update-started",
                session: await runtime.getSession(sessionId, { inspectSource: false })
              });
            },
            operationId,
            onProgress: async (progress = {}) => {
              await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
                event: {
                  kind: text(progress.kind) || "update-progress",
                  message: text(progress.message),
                  status: "running"
                },
                patch: { ...progress, operationId, status: "running" }
              });
            },
            runtime,
            session,
            vibe64User: input.vibe64User || null
          });
          await runtime.store.writeMetadataValue(sessionId, "canonical_commit", result.canonicalCommit);
          if (result.reconciled === true) {
            await runtime.store.writeMetadataValue(sessionId, "base_commit", result.canonicalCommit);
          }
          const refreshedSession = await runtime.getSession(sessionId, { inspectSource: false });
          const refreshedWork = await terminals.inspectSessionWork(sessionId, {
            runtime,
            session: refreshedSession
          });
          const updateCheck = await persistRepositoryUpdateCheck(runtime, sessionId, refreshedWork);
          const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
            event: {
              kind: result.status,
              message: result.status === "already_current" ? "This session was already current." : "This session was updated.",
              status: "ready"
            },
            patch: {
              ...result,
              code: "",
              conflictPaths: [],
              conflictRecovery: null,
              error: "",
              status: "ready"
            }
          });
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-update-completed",
            session: await runtime.getSession(sessionId, { inspectSource: false })
          });
          return {
            ...result,
            ...updateCheck,
            ok: true,
            operation: task
          };
        } catch (error) {
          if (!operationStarted) {
            throw error;
          }
          const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
            event: {
              kind: "update-failed",
              message: text(error?.message) || "Session update failed.",
              status: "failed"
            },
            patch: {
              code: text(error?.code),
              conflictPaths: Array.isArray(error?.details?.conflictPaths)
                ? error.details.conflictPaths
                : [],
              conflictRecovery: error?.details?.conflictRecovery || null,
              error: text(error?.message) || "Session update failed.",
              operationId,
              status: "failed"
            }
          });
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-update-failed",
            session: await runtime.getSession(sessionId, { inspectSource: false }),
            task
          });
          throw error;
        } finally {
          if (activeUpdateOperations.get(sessionId) === operationId) {
            activeUpdateOperations.delete(sessionId);
          }
        }
      }, "Vibe64 could not update this session.");
    },

    async interruptAgentTurn(sessionId, input = {}) {
      return sessionResult(async () => terminals.interruptAgentTurn(sessionId, input, {
        runtime: await project.createRuntime()
      }), "Vibe64 could not interrupt the assistant.");
    },

    async listSessions(input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const sessions = await runtime.listSessionSummaries(archiveListOptions(input.archive));
        return {
          creation: {
            canCreate: true,
            mode: "direct"
          },
          limits: {
            openSessionCount: sessions.filter((session) => session.status !== "abandoned").length
          },
          ok: true,
          sessions
        };
      });
    },

    async readSessionConversationLog(sessionId, options = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime();
        const pageOptions = conversationPageOptions(options);
        const result = await runtime.readConversationLogPage(sessionId, pageOptions);
        return {
          ...conversationPage(result, pageOptions),
          ok: true,
          sessionId
        };
      });
    },

    async retryWorkspaceSetup(sessionId, input = {}) {
      return sessionResult(async () => {
        if (setupRunner.isRunning(sessionId)) {
          const error = new Error("Workspace preparation is already running.");
          error.code = "vibe64_workspace_setup_running";
          throw error;
        }
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        if (!["ambiguous", "failed", "unconfigured"].includes(text(session.workspaceSetup?.status))) {
          const error = new Error(
            "Workspace preparation can only be started when it is newly configured, failed, or needs a recipe choice."
          );
          error.code = "vibe64_workspace_setup_retry_not_available";
          throw error;
        }
        const setup = await setupRunner.start({
          retry: true,
          runtime,
          session
        });
        const currentSession = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: text(input.originId),
          reason: "workspace-setup-retried",
          session: currentSession
        });
        observeWorkspaceSetup(sessionId, setup.completion, {
          originId: input.originId
        });
        return publicSession(currentSession);
      }, "Vibe64 could not retry workspace preparation.");
    },

    async sendAgentMessage(sessionId, input = {}) {
      const request = messageText(input);
      if (!request) {
        return {
          code: "vibe64_agent_message_input_required",
          error: "Assistant messages require text.",
          ok: false
        };
      }
      await setupRunner.wait(sessionId);
      const runtime = await project.createRuntime();
      const session = await runtime.getSession(sessionId);
      const messageId = text(input.messageId) || crypto.randomUUID();
      try {
        const result = await terminals.sendAgentMessage(sessionId, {
          ...input,
          messageId,
          message: request
        }, {
          runtime,
          session,
          vibe64User: input.vibe64User || null
        });
        const accepted = result?.ok !== false;
        await publishSessionChanged(sessionId, {
          originId: text(input.originId),
          reason: accepted
            ? "session-agent-message-accepted"
            : "session-agent-message-failed",
          session: await runtime.getSession(sessionId, {
            inspectSource: false
          })
        });
        return {
          ...result,
          messageId,
          ok: accepted,
          sessionId
        };
      } catch (error) {
        vibe64SessionDebugLog("server.sessions.sendAgentMessage.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
        throw error;
      }
    },

    async updateCurrentSession(sessionId = "") {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const current = await runtime.updateCurrentSession(sessionId);
        return {
          ok: true,
          sessionId: text(current.sessionId)
        };
      });
    }
  });
}

export { createService };
