import {
  AI_STUDIO_CLIENT_CONTROL_ACTIONS,
  controlClientAction
} from "@/lib/aiStudioPresentationControls.js";
import {
  startAiStudioCodexTerminal
} from "@/lib/aiStudioSessionApi.js";

function openDiffControl({
  diff = {}
} = {}) {
  if (typeof diff.openDialog !== "function") {
    return false;
  }
  diff.openDialog();
  return true;
}

async function startCodexTerminalControl({
  refreshSessionData = async () => null,
  session = {},
  sessionId = ""
} = {}) {
  const normalizedSessionId = String(sessionId || session?.sessionId || "").trim();
  if (!normalizedSessionId) {
    return false;
  }
  const result = await startAiStudioCodexTerminal(normalizedSessionId);
  if (result?.ok === false) {
    return result;
  }
  await refreshSessionData();
  return true;
}

const AI_STUDIO_CLIENT_CONTROL_DISPATCHERS = Object.freeze({
  [AI_STUDIO_CLIENT_CONTROL_ACTIONS.OPEN_DIFF]: openDiffControl,
  [AI_STUDIO_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL]: startCodexTerminalControl
});

function clientControlDispatcher(control = {}) {
  return AI_STUDIO_CLIENT_CONTROL_DISPATCHERS[controlClientAction(control)] || null;
}

function clientControlHasDispatcher(control = {}) {
  return Boolean(clientControlDispatcher(control));
}

async function runAiStudioClientControl(control = {}, context = {}) {
  const dispatcher = clientControlDispatcher(control);
  if (!dispatcher) {
    return false;
  }
  return dispatcher(context);
}

export {
  AI_STUDIO_CLIENT_CONTROL_DISPATCHERS,
  clientControlDispatcher,
  clientControlHasDispatcher,
  runAiStudioClientControl
};
