import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_TURN_OUTCOME,
  codexTurnOutcomeNoticeMessage,
  codexTurnOutcomeNoticeMessageId,
  writeCodexTurnOutcomeNotice
} from "../../packages/vibe64-terminals/src/server/codexTurnOutcomeNotice.js";

test("Codex turn outcome notices distinguish terminal outcomes", () => {
  assert.match(
    codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.USER_CANCELLED),
    /^You stopped Codex/u
  );
  assert.match(
    codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.SERVICE_RESTART),
    /Vibe64 restart/u
  );
  assert.match(
    codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.PROVIDER_FAILURE),
    /provider failed/u
  );
  assert.match(
    codexTurnOutcomeNoticeMessage(CODEX_TURN_OUTCOME.RESPONSE_DELIVERY_FAILURE),
    /could not recover its final response/u
  );
});

test("Codex turn outcome notice ids are stable per provider thread and turn", () => {
  const first = codexTurnOutcomeNoticeMessageId("thread-1", "turn-1");
  assert.equal(first, codexTurnOutcomeNoticeMessageId("thread-1", "turn-1"));
  assert.notEqual(first, codexTurnOutcomeNoticeMessageId("thread-1", "turn-2"));
  assert.notEqual(first, codexTurnOutcomeNoticeMessageId("thread-2", "turn-1"));
  assert.equal(codexTurnOutcomeNoticeMessageId("", "turn-1"), "");
});

test("Codex turn outcome notices publish only newly persisted entries", async () => {
  const writes = [];
  const published = [];
  const storedTurn = {
    system: {
      text: "Codex was interrupted."
    },
    turnId: "000002"
  };
  const store = {
    async writeConversationSystemMessage(sessionId, message) {
      writes.push({ message, sessionId });
      return writes.length === 1 ? storedTurn : null;
    }
  };
  const input = {
    outcome: CODEX_TURN_OUTCOME.SERVICE_RESTART,
    publishSessionChanged: async (...args) => published.push(args),
    sessionId: "session-1",
    store,
    threadId: "thread-1",
    turnId: "turn-1"
  };

  const first = await writeCodexTurnOutcomeNotice(input);
  const duplicate = await writeCodexTurnOutcomeNotice(input);

  assert.equal(first.written, true);
  assert.equal(duplicate.reason, "already_written");
  assert.equal(writes[0].message.messageId, writes[1].message.messageId);
  assert.match(writes[0].message.text, /Vibe64 restart/u);
  assert.deepEqual(published, [["session-1", {
    payload: {
      conversationLogPatch: {
        turn: storedTurn,
        type: "upsert-turn"
      }
    },
    reason: "codex-turn-outcome"
  }]]);
});
