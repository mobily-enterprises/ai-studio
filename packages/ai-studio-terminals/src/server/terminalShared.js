import crypto from "node:crypto";

const CODEX_TERMINAL_NAMESPACE = "ai-studio-codex";
const CODEX_TERMINAL_NAMESPACE_PREFIX = `${CODEX_TERMINAL_NAMESPACE}:`;
const COMMAND_TERMINAL_NAMESPACE = "ai-studio-command";

function aiStudioErrorResponse(error, fallback = "AI Studio terminal request failed.") {
  return {
    errors: [
      {
        code: String(error?.code || "ai_studio_terminal_request_failed"),
        message: String(error?.message || error || fallback)
      }
    ],
    ok: false,
    projectType: error?.projectType || null
  };
}

async function aiStudioResult(operation) {
  try {
    return await operation();
  } catch (error) {
    return aiStudioErrorResponse(error);
  }
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function shellQuote(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:=@,+-]+$/u.test(stringValue)) {
    return stringValue;
  }
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
}

function dockerCommand(args) {
  return ["docker", ...args].map(shellQuote).join(" ");
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 12);
}

function codexTerminalNamespace(sessionId) {
  return `${CODEX_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function commandTerminalNamespace(sessionId) {
  return `${COMMAND_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

export {
  CODEX_TERMINAL_NAMESPACE_PREFIX,
  aiStudioResult,
  codexTerminalNamespace,
  commandTerminalNamespace,
  dockerCommand,
  normalizePlainObject,
  shellQuote,
  stableHash
};
