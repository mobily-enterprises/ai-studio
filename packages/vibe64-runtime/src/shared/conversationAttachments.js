const VIBE64_CONVERSATION_ATTACHMENT_MAX_ITEMS = 10;
const VIBE64_CONVERSATION_ATTACHMENT_FILE_NAME_MAX_CHARACTERS = 160;

function conversationAttachmentFileName(value = "") {
  const normalized = Array.from(String(value ?? ""), (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("").trim();
  return Array.from(normalized)
    .slice(0, VIBE64_CONVERSATION_ATTACHMENT_FILE_NAME_MAX_CHARACTERS)
    .join("");
}

function normalizeVibe64ConversationAttachments(value = []) {
  return (Array.isArray(value) ? value : [])
    .slice(0, VIBE64_CONVERSATION_ATTACHMENT_MAX_ITEMS)
    .map((candidate) => {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate) ||
        typeof candidate.fileName !== "string"
      ) {
        return null;
      }
      const fileName = conversationAttachmentFileName(candidate.fileName);
      if (!fileName) {
        return null;
      }
      return {
        fileName,
        ...(Number.isSafeInteger(candidate.size) && candidate.size >= 0
          ? { size: candidate.size }
          : {})
      };
    })
    .filter(Boolean);
}

export {
  normalizeVibe64ConversationAttachments
};
