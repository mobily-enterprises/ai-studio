const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const TERMINAL_CONTROL_SEQUENCE_PATTERN = new RegExp(
  `${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][\\s\\S]*?(?:${BEL}|${ESC}\\\\)|[PX^_][\\s\\S]*?${ESC}\\\\|[@-Z\\\\-_])`,
  "gu"
);

function hasPrintableText(value = "") {
  for (const character of String(value || "")) {
    const codePoint = character.codePointAt(0) || 0;
    if (codePoint > 0x1f && codePoint !== 0x7f) {
      return true;
    }
  }
  return false;
}

function terminalInputHasUserText(input = "") {
  const value = String(input || "");
  if (!value) {
    return false;
  }
  if (value.includes("\r") || value.includes("\n")) {
    return true;
  }
  const stripped = value.replace(TERMINAL_CONTROL_SEQUENCE_PATTERN, "");
  return hasPrintableText(stripped);
}

export {
  terminalInputHasUserText
};
