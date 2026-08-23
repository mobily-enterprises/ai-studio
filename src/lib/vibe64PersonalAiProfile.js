const VIBE64_PREFERRED_NAME_MAX_LENGTH = 80;

function normalizePreferredNameDraft(value = "") {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .trim();
}

function preferredNameDraftState(value = "") {
  const preferredName = normalizePreferredNameDraft(value);
  const length = [...preferredName].length;
  let error = "";
  if (/\p{Cc}/u.test(preferredName)) {
    error = "Name cannot contain control characters.";
  } else if (length > VIBE64_PREFERRED_NAME_MAX_LENGTH) {
    error = `Name cannot exceed ${VIBE64_PREFERRED_NAME_MAX_LENGTH} characters.`;
  }
  return {
    error,
    length,
    preferredName,
    valid: !error
  };
}

export {
  VIBE64_PREFERRED_NAME_MAX_LENGTH,
  normalizePreferredNameDraft,
  preferredNameDraftState
};
