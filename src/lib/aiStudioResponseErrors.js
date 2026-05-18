function resolveResponseErrorMessage(response = {}, fallback = "AI Studio request failed.") {
  return String(response?.errors?.[0]?.message || response?.error || fallback);
}

export {
  resolveResponseErrorMessage
};
