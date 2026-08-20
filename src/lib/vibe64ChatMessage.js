import {
  vibe64BrowserTabOriginId
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  appendPromptAttachmentFileNames,
  appendPromptAttachmentReferences
} from "@/lib/vibe64PromptAttachments.js";

function chatText(value = "") {
  return String(value || "").trim();
}

function createChatMessageId({
  now = Date.now(),
  originId = vibe64BrowserTabOriginId(),
  sequence = 0
} = {}) {
  const origin = chatText(originId);
  const timestamp = Number(now);
  if (!origin || !Number.isFinite(timestamp)) {
    throw new TypeError("Chat message ids require a browser origin and timestamp.");
  }
  const number = Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 1;
  const safeOrigin = origin.replace(/[^A-Za-z0-9_-]+/gu, "_");
  return `message_${safeOrigin}_${timestamp.toString(36)}_${number.toString(36)}`;
}

function chatMessagePayload(message = "", attachments = []) {
  const text = chatText(message);
  if (!text) {
    return null;
  }
  const files = Array.isArray(attachments) ? attachments : [];
  return {
    displayMessage: files.length
      ? appendPromptAttachmentFileNames(text, files)
      : text,
    message: files.length
      ? appendPromptAttachmentReferences(text, files)
      : text
  };
}

function turnMatchesOptimisticMessage(turn = {}, optimistic = {}) {
  const canonicalMessageId = chatText(turn?.user?.messageId);
  const optimisticMessageId = chatText(optimistic.id);
  if (canonicalMessageId && optimisticMessageId) {
    return canonicalMessageId === optimisticMessageId;
  }
  if (chatText(turn?.user?.text) !== optimistic.text) {
    return false;
  }
  const userAtMs = Date.parse(String(turn?.user?.at || ""));
  return Number.isFinite(userAtMs) && userAtMs >= optimistic.createdAtMs - 5000;
}

function unmatchedOptimisticMessages(turns = [], optimisticMessages = []) {
  const conversationTurns = Array.isArray(turns) ? turns : [];
  const matchedTurnIndexes = new Set();
  return (Array.isArray(optimisticMessages) ? optimisticMessages : []).filter((message) => {
    const turnIndex = conversationTurns.findIndex((turn, index) => (
      !matchedTurnIndexes.has(index) && turnMatchesOptimisticMessage(turn, message)
    ));
    if (turnIndex < 0) {
      return true;
    }
    matchedTurnIndexes.add(turnIndex);
    return false;
  });
}

export {
  chatMessagePayload,
  createChatMessageId,
  turnMatchesOptimisticMessage,
  unmatchedOptimisticMessages
};
