function shouldAutoRunCodexPromptHandoff({
  alreadyStarted = false,
  baseReady = false,
  hasPrompt = false,
  hasPromptToInject = false
} = {}) {
  if (!baseReady) {
    return false;
  }
  if (hasPromptToInject) {
    return true;
  }
  return !hasPrompt && !alreadyStarted;
}

function promptTextHash(value = "") {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildIssueSessionCodexPromptSignature({
  activeCycle = "",
  currentReviewPass = "",
  prompt = "",
  sessionId = ""
} = {}) {
  const promptText = String(prompt || "");
  if (!sessionId || !promptText) {
    return "";
  }
  return [
    sessionId,
    activeCycle || "",
    currentReviewPass || "",
    promptTextHash(promptText),
    promptText.length
  ].join(":");
}

export {
  buildIssueSessionCodexPromptSignature,
  shouldAutoRunCodexPromptHandoff
};
