const CONVERSATION_RESPONSE_ARTIFACT = "response.md";
const CONVERSATION_INPUT_FORMAT_ARTIFACT = "input_format.json";
const CONVERSATION_HISTORY_ARTIFACT = "conversation-history.json";
const CONVERSATION_FILE_ARTIFACTS = Object.freeze([
  CONVERSATION_RESPONSE_ARTIFACT,
  CONVERSATION_INPUT_FORMAT_ARTIFACT
]);

const CONVERSATION_STATUS = Object.freeze({
  AWAITING_INPUT: "awaiting_input",
  BLOCKED: "blocked",
  DONE: "done"
});
const CONVERSATION_INPUT_KIND = Object.freeze({
  FREE_TEXT: "free_text",
  ISSUE_DRAFT: "issue_draft",
  NONE: "none",
  QUESTIONS: "questions",
  RETRY_COMMAND: "retry_command"
});
const CONVERSATION_STATUSES = new Set(Object.values(CONVERSATION_STATUS));
const CONVERSATION_INPUT_KINDS = new Set(Object.values(CONVERSATION_INPUT_KIND));

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeConversationStatus(value = "") {
  const status = normalizeText(value);
  return CONVERSATION_STATUSES.has(status) ? status : "";
}

function normalizeConversationInputKind(value = "") {
  const kind = normalizeText(value);
  return CONVERSATION_INPUT_KINDS.has(kind) ? kind : CONVERSATION_INPUT_KIND.NONE;
}

function normalizeConversationQuestion(value = {}, index = 0) {
  const text = normalizeText(typeof value === "string" ? value : value.text || value.question || "");
  if (!text) {
    return null;
  }
  return {
    answer: normalizeText(typeof value === "string" ? "" : value.answer || ""),
    id: normalizeText(typeof value === "string" ? "" : value.id) || `q${index + 1}`,
    text
  };
}

function normalizeConversationQuestions(questions = []) {
  return (Array.isArray(questions) ? questions : [])
    .slice(0, 10)
    .map(normalizeConversationQuestion)
    .filter(Boolean);
}

function normalizeConversationIssueDraft(value = {}) {
  const title = normalizeText(value?.title);
  const body = normalizeText(value?.body);
  const word = normalizeText(value?.word || value?.issueWord);
  if (!title || !body || !word) {
    return null;
  }
  return {
    body,
    title,
    word
  };
}

function normalizeConversationInputFormat(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const status = normalizeConversationStatus(value.status);
  if (!status) {
    return null;
  }
  const inputKind = normalizeConversationInputKind(value.inputKind || value.input_kind);
  const questions = normalizeConversationQuestions(value.questions);
  const issueDraft = normalizeConversationIssueDraft(value.issueDraft || value.issue_draft);
  return {
    inputKind,
    issueDraft,
    message: normalizeText(value.message),
    questions,
    status
  };
}

function conversationFilePath(artifactsRoot = "", artifactName = "") {
  const root = normalizeText(artifactsRoot);
  const name = normalizeText(artifactName);
  return root && name ? `${root}/${name}` : name;
}

function conversationInputFormatExample() {
  return JSON.stringify({
    status: "awaiting_input",
    inputKind: "questions",
    message: "I need a few details before continuing.",
    questions: [
      {
        id: "q1",
        text: "What should Codex know before continuing?"
      }
    ]
  }, null, 2);
}

function conversationDoneInputFormatExample() {
  return JSON.stringify({
    status: "done",
    inputKind: "none",
    message: "The Codex turn is complete."
  }, null, 2);
}

function conversationIssueDraftInputFormatExample() {
  return JSON.stringify({
    status: "awaiting_input",
    inputKind: "issue_draft",
    message: "Review this issue draft.",
    issueDraft: {
      title: "Concise issue title",
      word: "Label",
      body: "Markdown issue body"
    }
  }, null, 2);
}

function conversationRetryCommandInputFormatExample() {
  return JSON.stringify({
    status: "done",
    inputKind: "retry_command",
    message: "I believe the command failure has been fixed. Retry the original command."
  }, null, 2);
}

export {
  CONVERSATION_FILE_ARTIFACTS,
  CONVERSATION_HISTORY_ARTIFACT,
  CONVERSATION_INPUT_FORMAT_ARTIFACT,
  CONVERSATION_INPUT_KIND,
  CONVERSATION_RESPONSE_ARTIFACT,
  CONVERSATION_STATUS,
  conversationDoneInputFormatExample,
  conversationFilePath,
  conversationInputFormatExample,
  conversationIssueDraftInputFormatExample,
  conversationRetryCommandInputFormatExample,
  normalizeConversationInputFormat,
  normalizeConversationIssueDraft,
  normalizeConversationQuestions
};
