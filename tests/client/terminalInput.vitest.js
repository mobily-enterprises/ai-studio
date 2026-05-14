import { describe, expect, it } from "vitest";

import { terminalInputHasUserText } from "../../src/lib/terminalInput.js";

describe("terminal input filtering", () => {
  it("ignores focus and mouse control sequences", () => {
    expect(terminalInputHasUserText("\u001b[I")).toBe(false);
    expect(terminalInputHasUserText("\u001b[O")).toBe(false);
    expect(terminalInputHasUserText("\u001b[<0;12;4M")).toBe(false);
    expect(terminalInputHasUserText("\u001b]10;?\u001b\\")).toBe(false);
  });

  it("keeps typed text, pasted text, and enter as meaningful user input", () => {
    expect(terminalInputHasUserText("yes")).toBe(true);
    expect(terminalInputHasUserText("\u001b[200~hello\u001b[201~")).toBe(true);
    expect(terminalInputHasUserText("\r")).toBe(true);
  });
});
