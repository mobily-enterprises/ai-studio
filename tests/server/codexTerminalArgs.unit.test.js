import assert from "node:assert/strict";
import test from "node:test";

import {
  codexTerminalArgs
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";

test("managed Codex terminals pass the hook-trust bypass to Codex", () => {
  const [, startupScript] = codexTerminalArgs({
    codexThreadId: "11111111-1111-4111-8111-111111111111"
  });
  const codexCommands = startupScript
    .split("\n")
    .filter((line) => line.includes("/codex "));

  assert.equal(codexCommands.length, 2);
  for (const command of codexCommands) {
    assert.match(
      command,
      /--dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust resume/u
    );
  }
});
