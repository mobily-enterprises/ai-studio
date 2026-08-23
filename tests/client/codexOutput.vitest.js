import { describe, expect, it } from "vitest";
import {
  stripTerminalControlSequences,
  terminalLastMeaningfulLine
} from "../../src/lib/codexOutput.js";

describe("codexOutput terminal utilities", () => {
  it("strips terminal control sequences without parsing AI responses", () => {
    expect(stripTerminalControlSequences("\u001B[31mhello\u001B[0m")).toBe("hello");
  });

  it("projects the last meaningful terminal line across ANSI and carriage-return progress", () => {
    const output = [
      "Preparing\n",
      "\u001B]0;private title\u0007",
      "Downloaded 10%\r\u001B[2KDownloaded 80%\r",
      "\n\n"
    ].join("");

    expect(terminalLastMeaningfulLine(output)).toBe("Downloaded 80%");
  });

  it("removes C1 terminal strings and CSI controls from the projected line", () => {
    const output = `old\n\u009Dprivate title\u009C\u009B31mReady 👋\u009B0m`;

    expect(terminalLastMeaningfulLine(output)).toBe("Ready 👋");
  });

  it("does not expose incomplete terminal control payloads while a chunk is pending", () => {
    expect(terminalLastMeaningfulLine("Ready\n\u001B]private title")).toBe("Ready");
    expect(terminalLastMeaningfulLine("Ready\n\u009Dprivate title")).toBe("Ready");
    expect(terminalLastMeaningfulLine("Ready\n\u001B[31")).toBe("Ready");
  });

  it("skips trailing blank rows and preserves CRLF as a line boundary", () => {
    expect(terminalLastMeaningfulLine("first\r\nsecond\r\n\r\n")).toBe("second");
    expect(terminalLastMeaningfulLine("\n\r\n  \n")).toBe("");
  });

  it("bounds pathological lines without splitting Unicode code points", () => {
    expect(terminalLastMeaningfulLine("🙂🙂🙂", {
      maxCharacters: 3
    })).toBe("🙂🙂🙂");
    expect(terminalLastMeaningfulLine("🙂🙂🙂", {
      maxCharacters: 2
    })).toBe("🙂…");

    const summary = terminalLastMeaningfulLine("x".repeat(20_000));
    expect(Array.from(summary)).toHaveLength(512);
    expect(summary.endsWith("…")).toBe(true);
  });
});
