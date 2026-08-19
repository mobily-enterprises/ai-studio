const DEFAULT_VISIBLE_SESSION_LIMIT = 3;

function visibleVibe64ToolbarSessions({
  limit = DEFAULT_VISIBLE_SESSION_LIMIT,
  selectedSessionId = "",
  sessions = []
} = {}) {
  const items = Array.isArray(sessions) ? sessions : [];
  const boundedLimit = Math.max(0, Number(limit || 0));
  if (boundedLimit < 1 || items.length <= boundedLimit) {
    return items;
  }
  const selectedId = String(selectedSessionId || "").trim();
  const selectedIndex = items.findIndex((session) => session?.sessionId === selectedId);
  if (selectedIndex < 0 || selectedIndex < boundedLimit) {
    return items.slice(0, boundedLimit);
  }
  return [
    ...items.slice(0, Math.max(0, boundedLimit - 1)),
    items[selectedIndex]
  ];
}

export {
  DEFAULT_VISIBLE_SESSION_LIMIT,
  visibleVibe64ToolbarSessions
};
