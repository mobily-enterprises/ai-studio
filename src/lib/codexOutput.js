import stripAnsi from "strip-ansi";

const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const STRING_TERMINATOR_CHARACTER = String.fromCharCode(156);
const C1_CSI_CHARACTER = String.fromCharCode(155);
const C1_TERMINAL_STRING_START_CHARACTERS = [
  144,
  152,
  157,
  158,
  159
].map((code) => String.fromCharCode(code)).join("");
const STANDALONE_TERMINAL_CONTROL_CHARACTERS = [
  `${String.fromCharCode(0)}-${String.fromCharCode(8)}`,
  String.fromCharCode(11),
  String.fromCharCode(12),
  `${String.fromCharCode(14)}-${String.fromCharCode(31)}`,
  `${String.fromCharCode(127)}-${String.fromCharCode(159)}`
].join("");
const OSC_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\][\\s\\S]*?(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const TERMINAL_STRING_PATTERN = new RegExp(`${ESCAPE_CHARACTER}[PX^_][\\s\\S]*?(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const CSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, "gu");
const C1_TERMINAL_STRING_PATTERN = new RegExp(`[${C1_TERMINAL_STRING_START_CHARACTERS}][\\s\\S]*?(?:${BELL_CHARACTER}|${STRING_TERMINATOR_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const C1_CSI_PATTERN = new RegExp(`${C1_CSI_CHARACTER}[0-?]*[ -/]*[@-~]`, "gu");
const INCOMPLETE_OSC_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\][\\s\\S]*$`, "gu");
const INCOMPLETE_TERMINAL_STRING_PATTERN = new RegExp(`${ESCAPE_CHARACTER}[PX^_][\\s\\S]*$`, "gu");
const INCOMPLETE_C1_TERMINAL_STRING_PATTERN = new RegExp(`[${C1_TERMINAL_STRING_START_CHARACTERS}][\\s\\S]*$`, "gu");
const INCOMPLETE_CSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*$`, "gu");
const INCOMPLETE_C1_CSI_PATTERN = new RegExp(`${C1_CSI_CHARACTER}[0-?]*[ -/]*$`, "gu");
const ESCAPE_SEQUENCE_PATTERN = new RegExp(`${ESCAPE_CHARACTER}[ -/]*[@-~]`, "gu");
const STANDALONE_TERMINAL_CONTROL_PATTERN = new RegExp(`[${STANDALONE_TERMINAL_CONTROL_CHARACTERS}]`, "gu");
const TERMINAL_SUMMARY_MAX_CHARACTERS = 512;

function stripTerminalControlSequences(value) {
  const source = String(value || "")
    .replace(OSC_PATTERN, "")
    .replace(TERMINAL_STRING_PATTERN, "")
    .replace(CSI_PATTERN, "")
    .replace(C1_TERMINAL_STRING_PATTERN, "")
    .replace(C1_CSI_PATTERN, "")
    .replace(INCOMPLETE_OSC_PATTERN, "")
    .replace(INCOMPLETE_TERMINAL_STRING_PATTERN, "")
    .replace(INCOMPLETE_C1_TERMINAL_STRING_PATTERN, "")
    .replace(INCOMPLETE_CSI_PATTERN, "")
    .replace(INCOMPLETE_C1_CSI_PATTERN, "")
    .replace(ESCAPE_SEQUENCE_PATTERN, "");
  return stripAnsi(source)
    .replace(STANDALONE_TERMINAL_CONTROL_PATTERN, "");
}

function terminalLastMeaningfulLine(value, {
  maxCharacters = TERMINAL_SUMMARY_MAX_CHARACTERS
} = {}) {
  const rows = stripTerminalControlSequences(value)
    .replace(/\r\n/gu, "\n")
    .split("\n");

  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex -= 1) {
    const replacements = rows[rowIndex].split("\r");
    for (let replacementIndex = replacements.length - 1; replacementIndex >= 0; replacementIndex -= 1) {
      const line = replacements[replacementIndex].trim();
      if (line) {
        return boundedTerminalSummaryLine(line, maxCharacters);
      }
    }
  }
  return "";
}

function boundedTerminalSummaryLine(value, maxCharacters) {
  const normalizedMaximum = Math.max(1, Math.floor(Number(maxCharacters) || 0));
  const characters = Array.from(String(value || ""));
  if (characters.length <= normalizedMaximum) {
    return characters.join("");
  }
  if (normalizedMaximum === 1) {
    return "…";
  }
  return `${characters.slice(0, normalizedMaximum - 1).join("")}…`;
}

export {
  stripTerminalControlSequences,
  terminalLastMeaningfulLine
};
