import {
  normalizeVibe64ConversationAttachments
} from "@local/vibe64-runtime/shared";

const SESSION_MESSAGE_SUGGESTIONS_ARTIFACT = "assistant/message-suggestions.v1.json";
const SESSION_MESSAGE_SUGGESTIONS_SCHEMA = "vibe64.session-message-suggestions.v1";
const SESSION_MESSAGE_SUGGESTION_MAX_ATTACHMENTS = 10;
const SESSION_MESSAGE_SUGGESTION_MAX_CHARACTERS = 50_000;
const SESSION_MESSAGE_SUGGESTION_MAX_PENDING = 50;
const SESSION_MESSAGE_SUGGESTION_MAX_SUBMISSIONS_PER_MINUTE = 10;
const SESSION_MESSAGE_SUGGESTION_MAX_HISTORY = 500;
const SESSION_MESSAGE_SUGGESTION_STATUSES = new Set([
  "delivered",
  "delivering",
  "discarded",
  "pending",
  "withdrawn"
]);

function text(value = "") {
  return String(value ?? "").trim();
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function suggestionError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function boundedMessage(value = "", field = "message") {
  const normalized = text(value);
  if (!normalized || Array.from(normalized).length > SESSION_MESSAGE_SUGGESTION_MAX_CHARACTERS) {
    throw suggestionError(
      "vibe64_message_suggestion_input_invalid",
      `A suggested ${field} must contain between 1 and ${SESSION_MESSAGE_SUGGESTION_MAX_CHARACTERS.toLocaleString("en-US")} characters.`
    );
  }
  return normalized;
}

function actor(value = null, field = "actor") {
  const input = record(value);
  const username = text(input?.username || input?.id).toLowerCase();
  if (!/^[a-z_][a-z0-9_-]{0,62}$/u.test(username)) {
    throw suggestionError(
      "vibe64_message_suggestion_actor_invalid",
      `The ${field} identity is unavailable.`,
      401
    );
  }
  return Object.freeze({
    displayName: text(input?.preferredName || input?.displayName || input?.name || username).slice(0, 160),
    username
  });
}

function attachmentIds(value = []) {
  const ids = [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))];
  if (ids.length > SESSION_MESSAGE_SUGGESTION_MAX_ATTACHMENTS) {
    throw suggestionError(
      "vibe64_message_suggestion_attachment_limit",
      `A suggestion can include at most ${SESSION_MESSAGE_SUGGESTION_MAX_ATTACHMENTS} attachments.`
    );
  }
  return Object.freeze(ids);
}

function timestamp(value = "", field = "timestamp") {
  const normalized = text(value);
  const time = Date.parse(normalized);
  if (!normalized || !Number.isFinite(time) || new Date(time).toISOString() !== normalized) {
    throw suggestionError(
      "vibe64_message_suggestion_state_malformed",
      `A message suggestion has an invalid ${field}.`,
      500
    );
  }
  return normalized;
}

function optionalTimestamp(value = "", field = "timestamp") {
  return text(value) ? timestamp(value, field) : "";
}

function strictSuggestion(value = null) {
  const input = record(value);
  const id = text(input?.id);
  const providerMessageId = text(input?.providerMessageId);
  const status = text(input?.status);
  if (
    !/^[0-9a-f-]{36}$/iu.test(id) ||
    providerMessageId !== `vibe64-suggestion:${id}` ||
    !SESSION_MESSAGE_SUGGESTION_STATUSES.has(status)
  ) {
    throw suggestionError(
      "vibe64_message_suggestion_state_malformed",
      "A stored message suggestion is malformed.",
      500
    );
  }
  const decidedBy = input.decidedBy ? actor(input.decidedBy, "decision actor") : null;
  const storedAttachmentIds = attachmentIds(input.attachmentIds);
  const displayAttachments = normalizeVibe64ConversationAttachments(input.displayAttachments)
    .slice(0, storedAttachmentIds.length)
    .map(Object.freeze);
  return Object.freeze({
    attachmentIds: storedAttachmentIds,
    author: actor(input.author, "author"),
    createdAt: timestamp(input.createdAt, "creation time"),
    decidedAt: optionalTimestamp(input.decidedAt, "decision time"),
    decidedBy,
    deliveredAt: optionalTimestamp(input.deliveredAt, "delivery time"),
    deliveryAttempts: Math.max(0, Number.parseInt(input.deliveryAttempts, 10) || 0),
    ...(displayAttachments.length ? { displayAttachments: Object.freeze(displayAttachments) } : {}),
    displayMessage: text(input.displayMessage),
    id,
    lastDeliveryError: text(input.lastDeliveryError).slice(0, 2_000),
    message: boundedMessage(input.message),
    providerMessageId,
    status,
    updatedAt: timestamp(input.updatedAt, "update time"),
    withdrawnAt: optionalTimestamp(input.withdrawnAt, "withdrawal time")
  });
}

function emptySuggestionState() {
  return Object.freeze({
    entries: Object.freeze([]),
    revision: 0,
    schema: SESSION_MESSAGE_SUGGESTIONS_SCHEMA,
    updatedAt: ""
  });
}

function strictSuggestionState(value = null) {
  const input = record(value);
  if (
    !input ||
    input.schema !== SESSION_MESSAGE_SUGGESTIONS_SCHEMA ||
    !Number.isInteger(input.revision) ||
    input.revision < 0 ||
    !Array.isArray(input.entries)
  ) {
    throw suggestionError(
      "vibe64_message_suggestion_state_malformed",
      "The session message-suggestion queue is malformed.",
      500
    );
  }
  const entries = input.entries.map(strictSuggestion);
  if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
    throw suggestionError(
      "vibe64_message_suggestion_state_malformed",
      "The session message-suggestion queue contains duplicate ids.",
      500
    );
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    revision: input.revision,
    schema: SESSION_MESSAGE_SUGGESTIONS_SCHEMA,
    updatedAt: optionalTimestamp(input.updatedAt, "queue update time")
  });
}

async function readSessionMessageSuggestionState(store, sessionId = "") {
  if (typeof store?.readArtifact !== "function") {
    throw new TypeError("Session message suggestions require private artifact reads.");
  }
  const source = await store.readArtifact(sessionId, SESSION_MESSAGE_SUGGESTIONS_ARTIFACT);
  if (!source) {
    return emptySuggestionState();
  }
  try {
    return strictSuggestionState(JSON.parse(source));
  } catch (error) {
    if (error?.code === "vibe64_message_suggestion_state_malformed") {
      throw error;
    }
    throw suggestionError(
      "vibe64_message_suggestion_state_malformed",
      "The session message-suggestion queue is not valid JSON.",
      500
    );
  }
}

function nextSuggestionState(current, entries, now = new Date().toISOString()) {
  const pending = entries.filter(({ status }) => ["delivering", "pending"].includes(status));
  const terminal = entries
    .filter(({ status }) => !["delivering", "pending"].includes(status))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, SESSION_MESSAGE_SUGGESTION_MAX_HISTORY);
  return strictSuggestionState({
    entries: [...pending, ...terminal],
    revision: current.revision + 1,
    schema: SESSION_MESSAGE_SUGGESTIONS_SCHEMA,
    updatedAt: now
  });
}

async function writeSessionMessageSuggestionState(store, sessionId = "", state = {}) {
  if (typeof store?.writeJsonArtifact !== "function") {
    throw new TypeError("Session message suggestions require atomic private artifact writes.");
  }
  const normalized = strictSuggestionState(state);
  await store.writeJsonArtifact(sessionId, SESSION_MESSAGE_SUGGESTIONS_ARTIFACT, normalized);
  return normalized;
}

function newSessionMessageSuggestion({
  attachmentIds: attachments = [],
  author: suggestionAuthor,
  displayAttachments = [],
  displayMessage = "",
  id = "",
  message = "",
  now = new Date().toISOString()
} = {}) {
  return strictSuggestion({
    attachmentIds: attachments,
    author: suggestionAuthor,
    createdAt: now,
    decidedAt: "",
    decidedBy: null,
    deliveredAt: "",
    deliveryAttempts: 0,
    displayAttachments,
    displayMessage: text(displayMessage),
    id,
    lastDeliveryError: "",
    message,
    providerMessageId: `vibe64-suggestion:${id}`,
    status: "pending",
    updatedAt: now,
    withdrawnAt: ""
  });
}

function assertSuggestionSubmissionAllowed(state, suggestionAuthor, nowMs = Date.now()) {
  const normalizedAuthor = actor(suggestionAuthor);
  const pending = state.entries.filter(({ status }) => ["delivering", "pending"].includes(status));
  if (pending.length >= SESSION_MESSAGE_SUGGESTION_MAX_PENDING) {
    throw suggestionError(
      "vibe64_message_suggestion_queue_full",
      "This session already has too many pending suggestions.",
      409
    );
  }
  const recent = state.entries.filter((entry) => (
    entry.author.username === normalizedAuthor.username &&
    nowMs - Date.parse(entry.createdAt) >= 0 &&
    nowMs - Date.parse(entry.createdAt) < 60_000
  ));
  if (recent.length >= SESSION_MESSAGE_SUGGESTION_MAX_SUBMISSIONS_PER_MINUTE) {
    throw suggestionError(
      "vibe64_message_suggestion_rate_limited",
      "Wait a moment before suggesting another message.",
      429
    );
  }
}

function replaceSuggestion(state, suggestion, now = new Date().toISOString()) {
  const normalized = strictSuggestion(suggestion);
  const index = state.entries.findIndex(({ id }) => id === normalized.id);
  if (index < 0) {
    throw suggestionError(
      "vibe64_message_suggestion_missing",
      "The message suggestion no longer exists.",
      404
    );
  }
  const entries = [...state.entries];
  entries[index] = normalized;
  return nextSuggestionState(state, entries, now);
}

function appendSuggestion(state, suggestion, now = new Date().toISOString()) {
  const normalized = strictSuggestion(suggestion);
  if (state.entries.some(({ id }) => id === normalized.id)) {
    throw suggestionError(
      "vibe64_message_suggestion_duplicate",
      "This message suggestion already exists.",
      409
    );
  }
  return nextSuggestionState(state, [...state.entries, normalized], now);
}

function suggestionById(state, id = "") {
  const suggestion = state.entries.find((entry) => entry.id === text(id));
  if (!suggestion) {
    throw suggestionError(
      "vibe64_message_suggestion_missing",
      "The message suggestion no longer exists.",
      404
    );
  }
  return suggestion;
}

export {
  SESSION_MESSAGE_SUGGESTIONS_ARTIFACT,
  SESSION_MESSAGE_SUGGESTIONS_SCHEMA,
  SESSION_MESSAGE_SUGGESTION_MAX_ATTACHMENTS,
  SESSION_MESSAGE_SUGGESTION_MAX_CHARACTERS,
  SESSION_MESSAGE_SUGGESTION_MAX_HISTORY,
  SESSION_MESSAGE_SUGGESTION_MAX_PENDING,
  SESSION_MESSAGE_SUGGESTION_MAX_SUBMISSIONS_PER_MINUTE,
  appendSuggestion,
  assertSuggestionSubmissionAllowed,
  emptySuggestionState,
  newSessionMessageSuggestion,
  readSessionMessageSuggestionState,
  replaceSuggestion,
  strictSuggestion,
  strictSuggestionState,
  suggestionById,
  suggestionError,
  writeSessionMessageSuggestionState
};
