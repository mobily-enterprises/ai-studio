const VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT = "vibe64.source-editor.file.changed";
const VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT = "vibe64.source-editor.file.opened";
const VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT = "vibe64.source-editor.sync.error";
const VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT = "vibe64.source-editor.sync.ready";

function normalizeSourceEditorFileValue(value = "") {
  return String(value || "").trim();
}

function safeSourceEditorFileNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function plainObject(value = null) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sourceEditorFileChangeFromResult(result = {}) {
  const source = plainObject(result) ? result : {};
  return plainObject(source.fileChange) ? source.fileChange : null;
}

function sourceEditorFileOpenFromResult(result = {}) {
  const source = plainObject(result) ? result : {};
  return plainObject(source.fileOpen) ? source.fileOpen : null;
}

function sourceEditorFileRealtimePayload({ result = {} } = {}) {
  const fileChange = sourceEditorFileChangeFromResult(result);
  if (!fileChange) {
    return {};
  }
  const hash = normalizeSourceEditorFileValue(fileChange.hash);
  const originId = normalizeSourceEditorFileValue(fileChange.originId);
  const path = normalizeSourceEditorFileValue(fileChange.path);
  const projectSlug = normalizeSourceEditorFileValue(fileChange.projectSlug);
  const sessionId = normalizeSourceEditorFileValue(fileChange.sessionId);
  if (!hash || !originId || !path || !projectSlug || !sessionId) {
    return {};
  }
  const mtimeMs = safeSourceEditorFileNumber(fileChange.mtimeMs);
  const size = safeSourceEditorFileNumber(fileChange.size);
  return {
    hash,
    ...(mtimeMs === null ? {} : { mtimeMs }),
    originId,
    path,
    projectSlug,
    sessionId,
    ...(size === null ? {} : { size }),
    updatedAt: normalizeSourceEditorFileValue(fileChange.updatedAt)
  };
}

function sourceEditorFileOpenRealtimePayload({ result = {} } = {}) {
  const fileOpen = sourceEditorFileOpenFromResult(result);
  if (!fileOpen) {
    return {};
  }
  const originId = normalizeSourceEditorFileValue(fileOpen.originId);
  const path = normalizeSourceEditorFileValue(fileOpen.path);
  const projectSlug = normalizeSourceEditorFileValue(fileOpen.projectSlug);
  const sessionId = normalizeSourceEditorFileValue(fileOpen.sessionId);
  if (!originId || !path || !projectSlug || !sessionId) {
    return {};
  }
  return {
    originId,
    path,
    projectSlug,
    sessionId,
    updatedAt: normalizeSourceEditorFileValue(fileOpen.updatedAt)
  };
}

export {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT,
  sourceEditorFileOpenRealtimePayload,
  sourceEditorFileRealtimePayload
};
