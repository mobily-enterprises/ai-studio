const MANAGED_SESSION_SOURCE_AUTHORITY = "managed_session_source";

function normalizePath(value = "") {
  return String(value || "").trim().replace(/\/+$/u, "");
}

function pathInsideOrEqual(parentPath = "", childPath = "") {
  const parent = normalizePath(parentPath);
  const child = normalizePath(childPath);
  return Boolean(parent && child && (child === parent || child.startsWith(`${parent}/`)));
}

function explicitPathIsManagedSessionSource(session = {}, explicitPath = "") {
  const metadata = session?.metadata || {};
  if (String(metadata.source_path_authority || "").trim() !== MANAGED_SESSION_SOURCE_AUTHORITY) {
    return false;
  }
  if (String(metadata.source_kind || "").trim() !== "session_clone") {
    return false;
  }
  const normalizedPath = normalizePath(explicitPath);
  const sessionRoot = normalizePath(session?.sessionRoot);
  const sessionId = String(session?.sessionId || session?.id || "").trim();
  if (!normalizedPath || !sessionId || (sessionRoot && pathInsideOrEqual(sessionRoot, normalizedPath))) {
    return false;
  }
  return normalizedPath.endsWith(`/sessions/active/${sessionId}/source`);
}

function explicitSessionSourcePath(session = {}) {
  const metadata = session?.metadata || {};
  if (String(metadata.source_removed || "").trim().toLowerCase() === "yes") {
    return "";
  }
  const explicitPath = normalizePath(
    metadata.source_path ||
    metadata.source ||
    session?.source ||
    session?.sourcePath
  );
  if (!explicitPath) {
    return "";
  }
  return explicitPathIsManagedSessionSource(session, explicitPath) ? explicitPath : "";
}

function vibe64SessionSourcePath(session = {}) {
  return explicitSessionSourcePath(session);
}

export {
  explicitPathIsManagedSessionSource,
  explicitSessionSourcePath,
  vibe64SessionSourcePath
};
