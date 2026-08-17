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
import { inspectSessionDiff } from "./sessionDiff.js";

function text(value = "") {
  return String(value || "").trim();
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sessionResult(operation, fallbackMessage = "Vibe64 session request failed.") {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_session_request_failed",
    fallbackMessage
  });
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

  return Object.freeze({
    async abandonSession(sessionId, input = {}) {
      return sessionResult(async () => {
        if (setupRunner.isRunning(sessionId)) {
          const error = new Error("Wait for workspace preparation to finish before closing this session.");
          error.code = "vibe64_workspace_setup_running";
          throw error;
        }
        const runtime = await project.createRuntime();
        await runtime.markSessionClosing(sessionId, {
          reason: "abandoned"
        });
        try {
          await terminals.closeSessionTerminals(sessionId);
          if (typeof project.releaseSessionResources === "function") {
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

    async inspectSessionDiff(sessionId, options = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime();
        return inspectSessionDiff(await runtime.getSession(sessionId, {
          inspectSource: false
        }), options);
      });
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
