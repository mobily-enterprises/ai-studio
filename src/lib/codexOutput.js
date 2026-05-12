function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const ESCAPE_CHARACTER = String.fromCharCode(27);
const BELL_CHARACTER = String.fromCharCode(7);
const OSC_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\][\\s\\S]*?(?:${BELL_CHARACTER}|${ESCAPE_CHARACTER}\\\\)`, "gu");
const CSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, "gu");
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODEX_THREAD_ID_TOKEN_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

function stripTerminalControlSequences(value) {
  return String(value || "")
    .replace(OSC_PATTERN, "")
    .replace(CSI_PATTERN, "");
}

function extractMarkedOutput(value, marker) {
  const normalizedMarker = String(marker || "").trim();
  if (!normalizedMarker) {
    return "";
  }

  const source = stripTerminalControlSequences(value);
  const pattern = new RegExp(
    `\\[${escapeRegExp(normalizedMarker)}\\]([\\s\\S]*?)\\[/${escapeRegExp(normalizedMarker)}\\]`,
    "gu"
  );
  let extracted = "";
  for (const match of source.matchAll(pattern)) {
    const nextValue = String(match[1] || "").trim();
    if (nextValue) {
      extracted = nextValue;
    }
  }
  return extracted;
}

function isCodexThreadId(value) {
  return CODEX_THREAD_ID_PATTERN.test(String(value || "").trim());
}

function extractCodexThreadId(output) {
  const lines = stripTerminalControlSequences(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
    if (!lines[lineIndex].includes("CODEX_THREAD_ID")) {
      continue;
    }
    for (const nextLine of lines.slice(lineIndex + 1, lineIndex + 8)) {
      CODEX_THREAD_ID_TOKEN_PATTERN.lastIndex = 0;
      const token = [...nextLine.matchAll(CODEX_THREAD_ID_TOKEN_PATTERN)]
        .map((match) => match[0])
        .find(isCodexThreadId);
      if (token) {
        return token.toLowerCase();
      }
    }
  }

  return "";
}

export {
  extractCodexThreadId,
  extractMarkedOutput,
  isCodexThreadId,
  stripTerminalControlSequences
};
