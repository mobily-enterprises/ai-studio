import assert from "node:assert/strict";
import test from "node:test";

import {
  generateSessionSaveCommitMessage,
  normalizeSessionSaveCommitMessage,
  sessionSaveCommitMessagePrompt
} from "../../packages/vibe64-terminals/src/server/sessionSaveCommitMessage.js";

test("commit-message prompt is bounded, specific, and contains only change facts", () => {
  const prompt = sessionSaveCommitMessagePrompt({
    files: Array.from({ length: 45 }, (_, index) => ({
      added: index + 1,
      deleted: index,
      path: `packages/feature-${index}/src/service.js`,
      status: "M"
    })),
    totalCount: 45
  });
  assert.match(prompt, /Changed files: 45/u);
  assert.match(prompt, /M: packages\/feature-0\/src\/service\.js \(\+1 -0\)/u);
  assert.match(prompt, /…and 5 more changed files/u);
  assert.doesNotMatch(prompt, /feature-44/u);
  assert.match(prompt, /do not use tools/iu);
});

test("commit-message generation uses and deletes one ephemeral assistant thread", async () => {
  const calls = [];
  const subject = await generateSessionSaveCommitMessage({
    changes: {
      files: [{ added: 12, deleted: 2, path: "src/bookings.js", status: "M" }],
      totalCount: 1
    },
    async deleteThread(input) {
      calls.push(["delete", input]);
      return { ok: true };
    },
    async runAgentTurn(input, options) {
      calls.push(["run", input]);
      options.onEvent({ threadId: "thread-1", type: "thread" });
      return { ok: true, text: "Improve booking availability rules", threadId: "thread-1" };
    }
  });
  assert.equal(subject, "Improve booking availability rules");
  assert.equal(calls[0][1].ephemeral, true);
  assert.deepEqual(calls[1], ["delete", { threadId: "thread-1" }]);
});

test("invalid, failed, and uncleared assistant results stop Save", async () => {
  assert.throws(
    () => normalizeSessionSaveCommitMessage("Save Vibe64 work"),
    (error) => error.code === "vibe64_session_save_message_generic"
  );
  assert.throws(
    () => normalizeSessionSaveCommitMessage("A title\nwith a body"),
    (error) => error.code === "vibe64_session_save_message_invalid"
  );
  await assert.rejects(generateSessionSaveCommitMessage({
    changes: {},
    async deleteThread() {
      return { ok: true };
    },
    async runAgentTurn() {
      return { code: "provider_failed", error: "Provider failed.", ok: false };
    }
  }), (error) => error.code === "provider_failed");
  await assert.rejects(generateSessionSaveCommitMessage({
    changes: {},
    async deleteThread() {
      return { code: "delete_failed", error: "Delete failed.", ok: false };
    },
    async runAgentTurn(_input, options) {
      options.onEvent({ threadId: "thread-2", type: "thread" });
      return { ok: true, text: "Improve booking availability rules", threadId: "thread-2" };
    }
  }), (error) => error.code === "delete_failed");
});
