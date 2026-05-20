import {
  AUTOPILOT_ISSUE_MARKER_END,
  AUTOPILOT_ISSUE_MARKER_START,
  AUTOPILOT_ISSUE_QUESTIONS_MARKER_END,
  AUTOPILOT_ISSUE_QUESTIONS_MARKER_START,
  issueMarkerExample,
  issueQuestionsMarkerExample
} from "@/lib/aiStudioAutopilotIssueMarkers.js";
import {
  wrapPromptWithStudioContext
} from "@/lib/codexOutput.js";

function visibleIssueDraftPrompt() {
  return `Return ${AUTOPILOT_ISSUE_QUESTIONS_MARKER_START} or ${AUTOPILOT_ISSUE_MARKER_START}.`;
}

function issueDraftPromptHeader(requestId = "") {
  return [
    "AI Studio Autopilot is defining the issue scope.",
    "Do not modify files.",
    "Do not inspect AI Studio session internals, session files, or artifact files.",
    "First decide whether the request is clear enough to create a useful issue.",
    "If essential scope details are missing, ask concise self-contained questions for a non-technical user.",
    "Only ask questions whose answers would change the issue scope, acceptance criteria, or implementation direction.",
    "If clarification is needed, ask the minimum useful number of questions, up to three.",
    "If the user explicitly asks to be asked questions, honor that request before producing the issue.",
    "When honoring an explicit question request, ask the requested number of questions, capped at three.",
    "Do not dismiss an explicit question request as test noise or as unrelated to issue scope.",
    "If no essential questions are needed, produce a concise issue title and a useful Markdown issue body.",
    "Return exactly one machine-readable block and no other prose.",
    `Use this exact requestId in the JSON: ${String(requestId || "").trim()}`,
    "",
    "If you need clarification, use this format:",
    issueQuestionsMarkerExample("<requestId>"),
    "",
    `The questions closing marker must be exactly: ${AUTOPILOT_ISSUE_QUESTIONS_MARKER_END}`,
    "",
    "If no clarification is needed, use this format:",
    issueMarkerExample("<requestId>"),
    "",
    `The issue closing marker must be exactly: ${AUTOPILOT_ISSUE_MARKER_END}`,
    "",
    `Do not return both ${AUTOPILOT_ISSUE_QUESTIONS_MARKER_START} and ${AUTOPILOT_ISSUE_MARKER_START}.`
  ].join("\n");
}

function buildInitialIssueDraftPrompt({
  requestId = "",
  requestText = ""
} = {}) {
  const hiddenPrompt = [
    issueDraftPromptHeader(requestId),
    "",
    "Initial user request:",
    String(requestText || "").trim()
  ].join("\n");
  return wrapPromptWithStudioContext(hiddenPrompt, visibleIssueDraftPrompt());
}

function buildAnsweredIssueDraftPrompt({
  answers = [],
  questions = [],
  requestId = "",
  requestText = ""
} = {}) {
  const questionAnswers = questions.map((question, index) => {
    const answer = answers[index] ?? question.answer ?? "";
    return [
      `Q${index + 1}: ${String(question.text || question || "").trim()}`,
      `A${index + 1}: ${String(answer || "").trim()}`
    ].join("\n");
  }).join("\n\n");

  const hiddenPrompt = [
    issueDraftPromptHeader(requestId),
    "",
    "Original user request:",
    String(requestText || "").trim(),
    "",
    "Clarification answers:",
    questionAnswers,
    "",
    "Use the original request and these answers to continue defining the issue.",
    "If essential scope is still missing, return another questions block.",
    "Otherwise return the issue title and body block."
  ].join("\n");
  return wrapPromptWithStudioContext(hiddenPrompt, visibleIssueDraftPrompt());
}

export {
  buildAnsweredIssueDraftPrompt,
  buildInitialIssueDraftPrompt
};
