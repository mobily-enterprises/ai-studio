import { describe, expect, it } from "vitest";

import {
  extractCodexThreadId,
  extractMarkedOutput,
  isCodexThreadId,
  stripTerminalControlSequences
} from "../../src/lib/codexOutput.js";

describe("codex output extraction", () => {
  it("extracts the last non-empty marked output block", () => {
    const output = [
      "draft",
      "[issue_text]",
      "# Old",
      "[/issue_text]",
      "final",
      "[issue_text]",
      "# New",
      "",
      "Ship it.",
      "[/issue_text]"
    ].join("\n");

    expect(extractMarkedOutput(output, "issue_text")).toBe("# New\n\nShip it.");
  });

  it("ignores terminal control sequences around marked output", () => {
    const output = "\u001b[32m[issue_text]\n# Fix\n[/issue_text]\u001b[0m";

    expect(stripTerminalControlSequences(output)).toContain("[issue_text]");
    expect(extractMarkedOutput(output, "issue_text")).toBe("# Fix");
  });

  it("returns an empty string until the complete marker pair exists", () => {
    expect(extractMarkedOutput("[issue_text]\n# Missing close", "issue_text")).toBe("");
  });

  it("extracts Codex thread ids only when the echoed environment variable produced a UUID-shaped id", () => {
    expect(extractCodexThreadId([
      "Codex ready.",
      "!echo $CODEX_THREAD_ID",
      "019e1575-2458-7b93-bf9d-e7d7ffd49ad2"
    ].join("\n"))).toBe("019e1575-2458-7b93-bf9d-e7d7ffd49ad2");
  });

  it("rejects CLI versions and other nearby terminal tokens as Codex thread ids", () => {
    expect(isCodexThreadId("v0.130.0")).toBe(false);
    expect(extractCodexThreadId([
      "Codex ready.",
      "!echo $CODEX_THREAD_ID",
      "codex-cli v0.130.0",
      "ready"
    ].join("\n"))).toBe("");
  });
});
