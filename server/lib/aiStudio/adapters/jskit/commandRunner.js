import {
  createJskitAiStudioCommandTerminalSpec
} from "./commandTerminalSpecs.js";

function unsupportedCommandResult(commandId = "") {
  return {
    message: `JSKIT command ${commandId} must run in the AI Studio command terminal.`,
    metadata: {},
    status: "blocked"
  };
}

function createJskitAiStudioCommandRunner() {
  return async function runJskitAiStudioCommand({
    commandId = ""
  } = {}) {
    if (commandId === "finish_session") {
      return {
        message: "Finished AI Studio session.",
        metadata: {
          session_finished: "yes"
        },
        status: "completed"
      };
    }
    return unsupportedCommandResult(commandId);
  };
}

export {
  createJskitAiStudioCommandRunner,
  createJskitAiStudioCommandTerminalSpec
};
