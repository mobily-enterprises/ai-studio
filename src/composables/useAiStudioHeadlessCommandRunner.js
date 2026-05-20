import { getCurrentInstance, onBeforeUnmount, ref } from "vue";
import {
  aiStudioCommandTerminalWebSocketUrl,
  closeAiStudioCommandTerminal,
  startAiStudioCommandTerminal
} from "@/lib/aiStudioSessionApi.js";

const WEBSOCKET_CLOSING = 2;
const WEBSOCKET_CLOSED = 3;

function normalizePlainObject(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function terminalActionLabel(action = {}) {
  return String(action.label || action.id || "Command action");
}

function terminalActionId(action = {}) {
  return String(action.id || "").trim();
}

function parseTerminalMessage(rawMessage = "") {
  try {
    return JSON.parse(String(rawMessage || ""));
  } catch {
    return {
      error: "Terminal stream returned an invalid message.",
      type: "error"
    };
  }
}

function terminalHasExited(message = {}) {
  return String(message.status || "") === "exited";
}

function closeSocket(socket) {
  if (!socket || socket.readyState === WEBSOCKET_CLOSING || socket.readyState === WEBSOCKET_CLOSED) {
    return;
  }
  socket.close();
}

function registerUnmountCleanup(callback) {
  if (getCurrentInstance()) {
    onBeforeUnmount(callback);
  }
}

function commandFailure({
  action = {},
  commandPreview = "",
  error = "",
  exitCode = null,
  output = "",
  terminalSessionId = ""
} = {}) {
  const label = terminalActionLabel(action);
  return {
    actionId: terminalActionId(action),
    actionLabel: label,
    commandPreview,
    error: String(error || `${label} failed.`),
    exitCode,
    ok: false,
    output: String(output || ""),
    terminalSessionId
  };
}

function commandSuccess({
  action = {},
  commandPreview = "",
  exitCode = 0,
  output = "",
  terminalSessionId = ""
} = {}) {
  return {
    actionId: terminalActionId(action),
    actionLabel: terminalActionLabel(action),
    commandPreview,
    error: "",
    exitCode,
    ok: true,
    output: String(output || ""),
    terminalSessionId
  };
}

function useAiStudioHeadlessCommandRunner({
  closeCommandTerminal = closeAiStudioCommandTerminal,
  startCommandTerminal = startAiStudioCommandTerminal,
  webSocketUrl = aiStudioCommandTerminalWebSocketUrl
} = {}) {
  const running = ref(false);
  const lastResult = ref(null);

  let activeSocket = null;
  let activeTerminal = null;

  async function runCommandAction({
    action = {},
    input = {},
    sessionId = ""
  } = {}) {
    const normalizedSessionId = String(sessionId || "").trim();
    const actionId = terminalActionId(action);
    if (!normalizedSessionId || !actionId || running.value) {
      return commandFailure({
        action,
        error: "Command action cannot start."
      });
    }

    running.value = true;
    lastResult.value = null;
    try {
      const terminalSession = await startCommandTerminal(normalizedSessionId, {
        actionId,
        input: normalizePlainObject(input)
      });
      if (terminalSession?.ok === false) {
        throw new Error(terminalSession.error || "Command terminal could not start.");
      }

      activeTerminal = {
        sessionId: normalizedSessionId,
        terminalSessionId: String(terminalSession.id || "")
      };
      const result = await waitForCommandExit({
        action,
        initialSession: terminalSession,
        sessionId: normalizedSessionId,
        terminalSessionId: activeTerminal.terminalSessionId,
        webSocketUrl
      });
      lastResult.value = result;
      return result;
    } catch (error) {
      const result = commandFailure({
        action,
        error: String(error?.message || error || "Command terminal failed.")
      });
      lastResult.value = result;
      return result;
    } finally {
      await closeActiveTerminal();
      running.value = false;
    }
  }

  function waitForCommandExit({
    action = {},
    initialSession = {},
    sessionId = "",
    terminalSessionId = "",
    webSocketUrl: resolveWebSocketUrl
  } = {}) {
    return new Promise((resolve) => {
      let commandPreview = String(initialSession.commandPreview || "");
      let output = String(initialSession.output || "");
      let settled = false;

      function settle(result) {
        if (settled) {
          return;
        }
        settled = true;
        closeSocket(activeSocket);
        activeSocket = null;
        resolve(result);
      }

      function resultForExit(exitCode, closeError = "") {
        const commonResult = {
          action,
          commandPreview,
          exitCode,
          output,
          terminalSessionId
        };
        return Number(exitCode) === 0 && !closeError
          ? commandSuccess(commonResult)
          : commandFailure({
              ...commonResult,
              error: closeError || `${terminalActionLabel(action)} failed with exit code ${exitCode}.`
            });
      }

      function applySnapshot(session = {}) {
        commandPreview = String(session.commandPreview || commandPreview);
        output = String(session.output || output);
        if (terminalHasExited(session)) {
          settle(resultForExit(session.exitCode ?? null, String(session.closeError || "")));
        }
      }

      function handleMessage(rawMessage = "") {
        const message = parseTerminalMessage(rawMessage);
        if (message.type === "snapshot") {
          applySnapshot(message.session || {});
          return;
        }
        if (message.type === "output") {
          output += String(message.chunk || "");
          return;
        }
        if (message.type === "status" && terminalHasExited(message)) {
          settle(resultForExit(message.exitCode ?? null, String(message.closeError || "")));
          return;
        }
        if (message.type === "error") {
          settle(commandFailure({
            action,
            commandPreview,
            error: String(message.error || "Terminal stream failed."),
            output,
            terminalSessionId
          }));
        }
      }

      if (terminalHasExited(initialSession)) {
        settle(resultForExit(initialSession.exitCode ?? null, String(initialSession.closeError || "")));
        return;
      }
      if (!terminalSessionId || typeof WebSocket !== "function") {
        settle(commandFailure({
          action,
          commandPreview,
          error: "Terminal stream is not available.",
          output,
          terminalSessionId
        }));
        return;
      }

      activeSocket = new WebSocket(resolveWebSocketUrl(sessionId, terminalSessionId));
      activeSocket.addEventListener("message", (event) => {
        handleMessage(event.data);
      });
      activeSocket.addEventListener("error", () => {
        settle(commandFailure({
          action,
          commandPreview,
          error: "Terminal stream failed.",
          output,
          terminalSessionId
        }));
      });
      activeSocket.addEventListener("close", () => {
        settle(commandFailure({
          action,
          commandPreview,
          error: "Terminal stream closed before the command finished.",
          output,
          terminalSessionId
        }));
      });
    });
  }

  async function closeActiveTerminal() {
    closeSocket(activeSocket);
    activeSocket = null;
    const terminal = activeTerminal;
    activeTerminal = null;
    if (!terminal?.sessionId || !terminal?.terminalSessionId) {
      return;
    }
    await closeCommandTerminal(terminal.sessionId, terminal.terminalSessionId).catch(() => null);
  }

  registerUnmountCleanup(() => {
    void closeActiveTerminal();
  });

  return {
    closeActiveTerminal,
    lastResult,
    runCommandAction,
    running
  };
}

export {
  useAiStudioHeadlessCommandRunner
};
