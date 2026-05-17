import {
  aiStudioResult as sharedAiStudioResult,
  normalizePlainObject
} from "../../../../server/lib/aiStudio/serverResponses.js";
import {
  dockerCommand,
  shellQuote,
  stableHash
} from "../../../../server/lib/shellCommands.js";

const CODEX_TERMINAL_NAMESPACE = "ai-studio-codex";
const CODEX_TERMINAL_NAMESPACE_PREFIX = `${CODEX_TERMINAL_NAMESPACE}:`;
const COMMAND_TERMINAL_NAMESPACE = "ai-studio-command";
const APP_REVIEW_TERMINAL_NAMESPACE = "ai-studio-app-review";

function aiStudioResult(operation) {
  return sharedAiStudioResult(operation, {
    fallbackCode: "ai_studio_terminal_request_failed",
    fallbackMessage: "AI Studio terminal request failed."
  });
}

function codexTerminalNamespace(sessionId) {
  return `${CODEX_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function commandTerminalNamespace(sessionId) {
  return `${COMMAND_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function appReviewTerminalNamespace(sessionId) {
  return `${APP_REVIEW_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

export {
  CODEX_TERMINAL_NAMESPACE_PREFIX,
  aiStudioResult,
  appReviewTerminalNamespace,
  codexTerminalNamespace,
  commandTerminalNamespace,
  dockerCommand,
  normalizePlainObject,
  shellQuote,
  stableHash
};
