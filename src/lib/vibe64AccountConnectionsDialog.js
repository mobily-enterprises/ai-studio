const VIBE64_ACCOUNT_CONNECTIONS_OPEN_EVENT = "vibe64:account-connections:open";

function requestVibe64AccountConnectionsDialog({
  codexReconnectRequired = false,
  providerLabel = "",
  providerId = "",
  providerRevision = "",
  refresh = true,
  section = ""
} = {}) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return false;
  }
  window.dispatchEvent(new CustomEvent(VIBE64_ACCOUNT_CONNECTIONS_OPEN_EVENT, {
    detail: {
      codexReconnectRequired: codexReconnectRequired === true,
      providerLabel: String(providerLabel || ""),
      providerId: String(providerId || ""),
      providerRevision: String(providerRevision || ""),
      refresh: refresh !== false,
      section: String(section || "")
    }
  }));
  return true;
}

function onVibe64AccountConnectionsDialogRequested(handler) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => null;
  }
  window.addEventListener(VIBE64_ACCOUNT_CONNECTIONS_OPEN_EVENT, handler);
  return () => window.removeEventListener(VIBE64_ACCOUNT_CONNECTIONS_OPEN_EVENT, handler);
}

export {
  VIBE64_ACCOUNT_CONNECTIONS_OPEN_EVENT,
  onVibe64AccountConnectionsDialogRequested,
  requestVibe64AccountConnectionsDialog
};
