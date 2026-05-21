import {
  AUTOPILOT_ISSUE_MARKER_END,
  AUTOPILOT_ISSUE_MARKER_START,
  issueMarkerExample
} from "@/lib/aiStudioAutopilotIssueMarkers.js";
import {
  AUTOPILOT_QUESTIONS_MARKER_END,
  AUTOPILOT_QUESTIONS_MARKER_START,
  autopilotQuestionAnswersPrompt,
  autopilotQuestionsMarkerExample
} from "@/lib/aiStudioAutopilotStepMarkers.js";
import {
  wrapPromptWithStudioContext
} from "@/lib/codexOutput.js";

function visibleIssueDraftPrompt() {
  return `Return ${AUTOPILOT_QUESTIONS_MARKER_START} or ${AUTOPILOT_ISSUE_MARKER_START}.`;
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
    `Use this exact requestId in the JSON: ${String(requestId || "").trim()}`,
    "",
    "If you need clarification, use this format:",
    "First write a short plain-text sentence and the numbered questions so Inspect users can read them naturally.",
    "Then append the same questions as this machine-readable block for Autopilot:",
    autopilotQuestionsMarkerExample("<requestId>"),
    "",
    `The questions closing marker must be exactly: ${AUTOPILOT_QUESTIONS_MARKER_END}`,
    "",
    "If no clarification is needed, use this format:",
    issueMarkerExample("<requestId>"),
    "",
    `The issue closing marker must be exactly: ${AUTOPILOT_ISSUE_MARKER_END}`,
    "",
    "Return no prose with the issue block.",
    "",
    `Do not return both ${AUTOPILOT_QUESTIONS_MARKER_START} and ${AUTOPILOT_ISSUE_MARKER_START}.`
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
  questions = [],
  requestId = "",
  requestText = ""
} = {}) {
  const hiddenPrompt = [
    issueDraftPromptHeader(requestId),
    "",
    "Original user request:",
    String(requestText || "").trim(),
    "",
    autopilotQuestionAnswersPrompt({
      contextLabel: "Issue definition",
      continuationLines: [
        "Use the original request and these answers to continue defining the issue.",
        "If essential scope is still missing, return another questions block using the format above.",
        "Otherwise return the issue title and body block."
      ],
      questions
    })
  ].join("\n");
  return wrapPromptWithStudioContext(hiddenPrompt, visibleIssueDraftPrompt());
}

export {
  buildAnsweredIssueDraftPrompt,
  buildInitialIssueDraftPrompt
};
