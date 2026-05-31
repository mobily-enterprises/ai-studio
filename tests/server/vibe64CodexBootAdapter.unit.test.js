import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_BOOT_SCREEN_STATE,
  classifyCodexBootScreen,
  codexBootShouldRestartAfterExit
} from "../../packages/vibe64-terminals/src/server/codexBootAdapter.js";

test("codex boot adapter treats trust prompts as blocked startup screens", () => {
  const classification = classifyCodexBootScreen([
    "Do you trust the contents of this directory?",
    "Working with untrusted contents comes with higher risk of prompt injection.",
    "1. Yes, continue",
    "2. No, quit",
    "Press enter to continue"
  ].join("\n"));

  assert.equal(classification.state, CODEX_BOOT_SCREEN_STATE.BLOCKED);
  assert.equal(classification.reason, "trust_prompt");
  assert.equal(classification.confidence, "high");
});

test("codex boot adapter treats upgrade prompts as blocked startup screens", () => {
  const classification = classifyCodexBootScreen([
    "A new version of Codex is available.",
    "Install the update now?",
    "Press enter to continue"
  ].join("\n"));

  assert.equal(classification.state, CODEX_BOOT_SCREEN_STATE.BLOCKED);
  assert.equal(classification.reason, "upgrade_prompt");
});

test("codex boot adapter lets a newer ready prompt outrank earlier startup prompts", () => {
  const classification = classifyCodexBootScreen([
    "Do you trust the contents of this directory?",
    "Press enter to continue",
    "",
    "OpenAI Codex",
    "gpt-5.5 xhigh \u00b7 /workspace/example"
  ].join("\n"));

  assert.equal(classification.state, CODEX_BOOT_SCREEN_STATE.READY);
  assert.equal(classification.reason, "codex_prompt");
});

test("codex boot adapter recognizes Codex ready prompts in redraw output", () => {
  const classification = classifyCodexBootScreen([
    "Tip: New Use /fast to enable our fastest inference with increased plan usage.",
    "›Use /skills to list available skills",
    "gpt-5.5 xhigh \u00b7 /home/merc/vibe64/test/.vibe64/sessions/active/2026-05-31_06-30-53/worktree q q"
  ].join(""));

  assert.equal(classification.state, CODEX_BOOT_SCREEN_STATE.READY);
  assert.equal(classification.reason, "codex_prompt");
});

test("codex boot adapter detects the interactive completion menu", () => {
  const classification = classifyCodexBootScreen([
    "!  echo $CODEX_THREAD_ID",
    "",
    "no matches",
    "",
    "Press enter to insert or esc to close"
  ].join("\n"));

  assert.equal(classification.state, CODEX_BOOT_SCREEN_STATE.BLOCKED);
  assert.equal(classification.reason, "codex_completion_menu");
});

test("codex boot adapter allows bounded restarts before handoff only", () => {
  assert.equal(codexBootShouldRestartAfterExit({
    handoffStarted: false,
    restartCount: 0
  }), true);
  assert.equal(codexBootShouldRestartAfterExit({
    handoffStarted: false,
    restartCount: 2
  }), false);
  assert.equal(codexBootShouldRestartAfterExit({
    handoffStarted: true,
    restartCount: 0
  }), false);
});
