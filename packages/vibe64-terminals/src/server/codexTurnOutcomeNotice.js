import crypto from "node:crypto";

const CODEX_TURN_OUTCOME = Object.freeze({
  PROVIDER_FAILURE: "provider_failure",
  RESPONSE_DELIVERY_FAILURE: "response_delivery_failure",
  SERVICE_RESTART: "service_restart",
  USER_CANCELLED: "user_cancelled"
});

const CODEX_TURN_OUTCOME_MESSAGES = Object.freeze({
  [CODEX_TURN_OUTCOME.PROVIDER_FAILURE]:
    "Codex could not finish because its provider failed. Saved file changes remain; send a message to continue.",
  [CODEX_TURN_OUTCOME.RESPONSE_DELIVERY_FAILURE]:
    "Codex finished, but Vibe64 could not recover its final response. Saved file changes remain; send a message to continue.",
  [CODEX_TURN_OUTCOME.SERVICE_RESTART]:
    "Codex was interrupted by a Vibe64 restart before it could finish. Saved file changes remain; send a message to continue.",
  [CODEX_TURN_OUTCOME.USER_CANCELLED]:
    "You stopped Codex before it finished. Saved file changes remain; send a message to continue."
});

function normalizeText(value) {
  return String(value || "").trim();
}

function codexTurnOutcomeNoticeMessage(outcome = "") {
  return CODEX_TURN_OUTCOME_MESSAGES[normalizeText(outcome)] ||
    CODEX_TURN_OUTCOME_MESSAGES[CODEX_TURN_OUTCOME.PROVIDER_FAILURE];
}

function codexTurnOutcomeNoticeMessageId(threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  if (!normalizedThreadId || !normalizedTurnId) {
    return "";
  }
  const digest = crypto.createHash("sha256")
    .update([normalizedThreadId, normalizedTurnId, "turn-outcome"].join("\u0000"))
    .digest("hex");
  return `codex-turn-outcome-${digest}`;
}

async function writeCodexTurnOutcomeNotice({
  outcome = CODEX_TURN_OUTCOME.PROVIDER_FAILURE,
  publishSessionChanged = async () => null,
  sessionId = "",
  store = null,
  threadId = "",
  turnId = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const messageId = codexTurnOutcomeNoticeMessageId(threadId, turnId);
  if (
    !normalizedSessionId ||
    !messageId ||
    typeof store?.writeConversationSystemMessage !== "function"
  ) {
    return {
      reason: "unavailable",
      written: false
    };
  }
  const turn = await store.writeConversationSystemMessage(normalizedSessionId, {
    messageId,
    text: codexTurnOutcomeNoticeMessage(outcome)
  });
  if (!turn) {
    return {
      messageId,
      reason: "already_written",
      written: false
    };
  }
  await publishSessionChanged(normalizedSessionId, {
    payload: {
      conversationLogPatch: {
        turn,
        type: "upsert-turn"
      }
    },
    reason: "codex-turn-outcome"
  });
  return {
    messageId,
    reason: "written",
    turn,
    written: true
  };
}

export {
  CODEX_TURN_OUTCOME,
  codexTurnOutcomeNoticeMessage,
  codexTurnOutcomeNoticeMessageId,
  writeCodexTurnOutcomeNotice
};
