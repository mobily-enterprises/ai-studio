const AUTOPILOT_COMPLETION_TOKEN_PREFIX = "AI_STUDIO_AUTOPILOT_DONE_";
const AUTOPILOT_COMPLETION_TOKEN_PATTERN = /^AI_STUDIO_AUTOPILOT_DONE_[a-f0-9]{32}$/u;
const AUTOPILOT_QUESTIONS_MARKER_START = "[[AI_STUDIO_AUTOPILOT_QUESTIONS_V1]]";
const AUTOPILOT_QUESTIONS_MARKER_END = "[[/AI_STUDIO_AUTOPILOT_QUESTIONS_V1]]";
const AUTOPILOT_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;

function randomHexToken() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID().replaceAll("-", "");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.padEnd(32, "0").slice(0, 32);
}

function createStepCompletionToken() {
  return `${AUTOPILOT_COMPLETION_TOKEN_PREFIX}${randomHexToken()}`;
}

function normalizeStepCompletionToken(value = "") {
  const token = String(value || "").trim();
  return AUTOPILOT_COMPLETION_TOKEN_PATTERN.test(token) ? token : "";
}

function autopilotQuestionsMarkerExample(requestId = "request-id") {
  return [
    AUTOPILOT_QUESTIONS_MARKER_START,
    JSON.stringify({
      requestId,
      questions: [
        "What should Codex know before continuing this workflow action?"
      ]
    }, null, 2),
    AUTOPILOT_QUESTIONS_MARKER_END
  ].join("\n");
}

function questionInstruction(requestId = "") {
  return [
    "If this workflow action is blocked only because essential user input is missing, ask the user instead of giving up.",
    "Ask concise self-contained questions for a non-technical user.",
    "Ask the minimum useful number of questions, up to three.",
    "First write a short plain-text sentence and the numbered questions so Inspect users can read them naturally.",
    "Then append the same questions as this machine-readable block for Autopilot.",
    "Do not print the completion token when asking questions.",
    `Use this exact requestId in the JSON: ${String(requestId || "").trim()}`,
    autopilotQuestionsMarkerExample("<requestId>")
  ].join("\n");
}

function completionInstruction(token = "") {
  const completionToken = normalizeStepCompletionToken(token);
  if (!completionToken) {
    return "";
  }
  const tokenSuffix = completionToken.slice(AUTOPILOT_COMPLETION_TOKEN_PREFIX.length);
  return [
    "AI Studio Autopilot completion contract:",
    "When this workflow action is fully complete, print one final line containing the completion token.",
    "Do not print the completion token until all work, checks, and final reporting for this action are complete.",
    "Do not write any prose after the completion token.",
    "Build the completion token by joining these two parts with no spaces:",
    `Completion token part 1: ${AUTOPILOT_COMPLETION_TOKEN_PREFIX}`,
    `Completion token part 2: ${tokenSuffix}`
  ].join("\n");
}

function stepCompletionTokenInstruction({
  requestId = "",
  token = ""
} = {}) {
  return [
    completionInstruction(token),
    "",
    questionInstruction(requestId)
  ].filter(Boolean).join("\n");
}

export {
  AUTOPILOT_COMPLETION_TOKEN_PREFIX,
  AUTOPILOT_QUESTIONS_MARKER_END,
  AUTOPILOT_QUESTIONS_MARKER_START,
  AUTOPILOT_REQUEST_ID_PATTERN,
  autopilotQuestionsMarkerExample,
  createStepCompletionToken,
  normalizeStepCompletionToken,
  stepCompletionTokenInstruction
};
