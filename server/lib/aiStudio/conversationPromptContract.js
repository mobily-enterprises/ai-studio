import {
  CONVERSATION_INPUT_FORMAT_ARTIFACT,
  CONVERSATION_INPUT_KIND,
  CONVERSATION_RESPONSE_ARTIFACT,
  conversationDoneInputFormatExample,
  conversationFilePath,
  conversationInputFormatExample,
  conversationIssueDraftInputFormatExample,
  conversationRetryCommandInputFormatExample
} from "./conversationFiles.js";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function conversationStepKind(session = {}) {
  return normalizeText(session.currentStepDefinition?.autopilot?.kind);
}

function conversationPromptInstruction({
  action = {},
  artifactsRoot = "",
  session = {}
} = {}) {
  const responsePath = conversationFilePath(artifactsRoot, CONVERSATION_RESPONSE_ARTIFACT);
  const inputFormatPath = conversationFilePath(artifactsRoot, CONVERSATION_INPUT_FORMAT_ARTIFACT);
  const stepKind = conversationStepKind(session);
  const issueStep = stepKind === "issue_discussion" || stepKind === "seed_issue_discussion";
  const commandRepair = action.id === "fix_command_failure";
  const conversationStep = stepKind === "agent_conversation" ||
    stepKind === "implementation_review" ||
    stepKind === "final_review";

  return [
    "AI Studio conversation contract:",
    "Always write your user-facing answer to this Markdown file when your current turn is over:",
    responsePath,
    "",
    "Always write the current UI state to this JSON file at the same time:",
    inputFormatPath,
    "",
    "The user may answer either in the terminal or through the Autopilot web UI. Treat both as plain user text.",
    "Do not require request IDs, completion tokens, hidden markers, or copied JSON from the user.",
    "Ask questions in normal plain text for Inspect users, and also represent the same questions in input_format.json for Autopilot users.",
    "If you need more user input, use status `awaiting_input`.",
    "If your turn is complete, use status `done`.",
    "If you cannot continue without external action, use status `blocked` and explain the blocker in response.md.",
    "",
    "Question input_format.json example:",
    conversationInputFormatExample(),
    "",
    "Done input_format.json example:",
    conversationDoneInputFormatExample(),
    "",
    issueStep
      ? [
        "For this issue-definition step, do not mark the conversation done when the issue is ready.",
        "Instead, write the proposed issue title, one-word session label, and Markdown body using this issue draft format:",
        conversationIssueDraftInputFormatExample()
      ].join("\n")
      : "",
    commandRepair
      ? [
        "For this failed-command repair, Codex may edit files or explain manual steps.",
        "If you believe the original failed command should be retried, use this input format:",
        conversationRetryCommandInputFormatExample()
      ].join("\n")
      : "",
    conversationStep
      ? [
        "For this interactive conversation step, `done` means your current reply is complete.",
        "The workflow should not advance just because you wrote `done`; the user decides when to continue."
      ].join("\n")
      : "",
    "",
    "Keep response.md concise and useful. Include changed files, checks run, and blockers only when they matter."
  ]
    .filter(Boolean)
    .join("\n");
}

export {
  CONVERSATION_INPUT_KIND,
  conversationPromptInstruction
};
