import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  aiStudioResult,
  appReviewTerminalNamespace
} from "./terminalShared.js";

function terminalCwd(session = {}, projectService = {}) {
  return String(session.targetRoot || projectService.targetRoot || "").trim();
}

function createAppReviewTerminalController({ projectService } = {}) {
  return Object.freeze({
    closeAllForSession(sessionId) {
      return closeTerminalSessionsForNamespace(appReviewTerminalNamespace(sessionId));
    },

    closeTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: appReviewTerminalNamespace(sessionId)
      });
    },

    readTerminal(sessionId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: appReviewTerminalNamespace(sessionId)
      });
    },

    async startTerminal(sessionId) {
      return aiStudioResult(async () => {
        const runtime = await projectService.createRuntime();
        const session = await runtime.getSession(sessionId);
        const cwd = terminalCwd(session, projectService);
        if (!cwd) {
          return {
            ok: false,
            error: "AI Studio app review target root is not available."
          };
        }

        const spec = await runtime.adapter.createAppReviewTerminalSpec({
          config: runtime.projectConfig,
          runtime,
          session,
          store: runtime.store
        });
        if (spec?.ok === false) {
          return {
            ok: false,
            error: spec.message || "App review terminal cannot start."
          };
        }

        const namespace = appReviewTerminalNamespace(sessionId);
        const projectConfigEnv = typeof projectService.projectConfigEnvironment === "function"
          ? await projectService.projectConfigEnvironment()
          : {};
        return startTerminalSession({
          args: spec.args || [],
          command: spec.command,
          commandPreview: spec.commandPreview,
          cwd: spec.cwd || cwd,
          env: {
            ...projectConfigEnv,
            ...(spec.env || {})
          },
          maxRunning: 1,
          metadata: {
            ...(spec.metadata || {}),
            sessionId
          },
          namespace,
          namespaceLimitPrefix: namespace,
          onClose: spec.onClose,
          reuseRunning: spec.reuseRunning !== false
        });
      });
    },

    subscribeTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: appReviewTerminalNamespace(sessionId)
      });
    },

    writeTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: appReviewTerminalNamespace(sessionId)
      });
    }
  });
}

export { createAppReviewTerminalController };
