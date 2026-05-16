function normalizeText(value) {
  return String(value ?? "").trim();
}

function aiStudioError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export {
  aiStudioError,
  normalizeText
};
