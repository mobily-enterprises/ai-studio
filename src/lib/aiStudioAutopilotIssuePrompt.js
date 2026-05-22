import {
  wrapPromptWithStudioContext
} from "@/lib/codexOutput.js";
import {
  CONVERSATION_INPUT_FORMAT_ARTIFACT,
  CONVERSATION_INPUT_KIND,
  CONVERSATION_RESPONSE_ARTIFACT,
  conversationFilePath,
  conversationInputFormatExample,
  conversationIssueDraftInputFormatExample
} from "../../server/lib/aiStudio/conversationFiles.js";

function visibleIssueDraftPrompt() {
  return "Discuss and define issue.";
}

function issueDraftPromptHeader({
  artifactsRoot = "",
  seedGuidance = "",
  seedMode = false
} = {}) {
  const responseFile = conversationFilePath(artifactsRoot, CONVERSATION_RESPONSE_ARTIFACT);
  const inputFormatFile = conversationFilePath(artifactsRoot, CONVERSATION_INPUT_FORMAT_ARTIFACT);
  const modeLines = seedMode
    ? [
      "AI Studio is defining the application seed issue.",
      "The seed issue is only for the initial runnable framework foundation.",
      "Ask about setup modules, framework packages, installer flags, local dev services, and fake development secrets.",
      "Do not ask about business records, product workflows, detailed CRUD screens, or feature implementation yet.",
      "Seed readiness gate:",
      "- Treat the adapter seed guidance as the required setup checklist.",
      "- Do not write an issue draft input format until every scaffold-affecting setup choice is answered, explicitly declined, or assigned a clear default.",
      "- If any setup choice that affects the scaffold, selected modules, local environment, seed commands, or fake development secrets is still unresolved, ask another concise question set.",
      "- It is acceptable to ask more questions after the user answers a previous question set.",
      "- Only write the issue draft input format once the draft can include selected modules, local dev values/defaults, and exact seed commands.",
      seedGuidance ? `Adapter seed guidance:\n${String(seedGuidance || "").trim()}` : ""
    ]
    : [
      "AI Studio is defining the issue scope.",
      "Only ask questions whose answers would change the issue scope, acceptance criteria, or implementation direction."
    ];
  return [
    ...modeLines.filter(Boolean),
    "Do not modify files.",
    "Only write the AI Studio conversation files requested below.",
    "First decide whether the request is clear enough to create a useful issue.",
    "Every time you ask the user any question, you must do both of these things in the same response:",
    "1. Ask the question in normal plain text so Inspect users can answer naturally.",
    `2. Write the same question set to ${inputFormatFile} using inputKind ${CONVERSATION_INPUT_KIND.QUESTIONS}.`,
    "This applies to every user question, not only Autopilot and not only blockers.",
    "If essential scope details are missing, ask concise self-contained questions for a non-technical user.",
    seedMode ? "Only ask questions whose answers would change the initial scaffold, selected modules, local environment, or seed commands." : "",
    "If clarification is needed, ask the minimum useful number of questions, up to three.",
    "If the user explicitly asks to be asked questions, honor that request before producing the issue.",
    "When honoring an explicit question request, ask the requested number of questions, capped at three.",
    "Do not dismiss an explicit question request as test noise or as unrelated to issue scope.",
    "If no essential questions are needed, produce a concise issue title, a deliberate one-word session label, and a useful Markdown issue body.",
    "The session label must be exactly one expressive word that describes the change. Do not use generic action words like Add, Fix, Update, Change, or Improve unless that word is the actual feature domain.",
    `Write the user-facing response to: ${responseFile}`,
    `Write the UI state JSON to: ${inputFormatFile}`,
    "",
    "Question input_format.json format:",
    conversationInputFormatExample(),
    "",
    "If no clarification is needed:",
    "Write a short explanation to response.md and write the issue draft to input_format.json.",
    conversationIssueDraftInputFormatExample(),
    "",
    "Do not write both questions and an issue draft for the same response."
  ].join("\n");
}

function buildInitialIssueDraftPrompt({
  artifactsRoot = "",
  requestText = "",
  seedGuidance = "",
  seedMode = false
} = {}) {
  const hiddenPrompt = [
    issueDraftPromptHeader({
      artifactsRoot,
      seedGuidance,
      seedMode
    }),
    "",
    seedMode ? "Initial seed request:" : "Initial user request:",
    String(requestText || "").trim()
  ].join("\n");
  return wrapPromptWithStudioContext(hiddenPrompt, visibleIssueDraftPrompt());
}

function buildInitialSeedIssueDraftPrompt(options = {}) {
  return buildInitialIssueDraftPrompt({
    ...options,
    seedMode: true
  });
}

function buildAnsweredIssueDraftPrompt({
  artifactsRoot = "",
  questions = [],
  requestText = "",
  seedGuidance = "",
  seedMode = false
} = {}) {
  const hiddenPrompt = [
    issueDraftPromptHeader({
      artifactsRoot,
      seedGuidance,
      seedMode
    }),
    "",
    seedMode ? "Original seed request:" : "Original user request:",
    String(requestText || "").trim(),
    "",
    "User answers:",
    (Array.isArray(questions) ? questions : []).map((question, index) => {
      return [
        `Q${index + 1}: ${String(question.text || question.question || question || "").trim()}`,
        `A${index + 1}: ${String(question.answer || "").trim()}`
      ].join("\n");
    }).join("\n\n"),
    "",
    seedMode
      ? "Use the original seed request and these answers to continue defining the seed issue."
      : "Use the original request and these answers to continue defining the issue.",
    "If you ask more questions, ask them in normal text and write input_format.json using the questions format above.",
    seedMode
      ? "Only write an issue_draft input format if the seed readiness gate is satisfied; otherwise ask another question set."
      : "Otherwise write an issue_draft input format."
  ].join("\n");
  return wrapPromptWithStudioContext(hiddenPrompt, visibleIssueDraftPrompt());
}

function buildAnsweredSeedIssueDraftPrompt(options = {}) {
  return buildAnsweredIssueDraftPrompt({
    ...options,
    seedMode: true
  });
}

export {
  buildAnsweredSeedIssueDraftPrompt,
  buildAnsweredIssueDraftPrompt,
  buildInitialSeedIssueDraftPrompt,
  buildInitialIssueDraftPrompt
};
