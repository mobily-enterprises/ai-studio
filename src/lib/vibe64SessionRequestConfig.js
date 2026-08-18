import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  vibe64ProjectScopedStorageKey,
  vibe64ProjectQueryScope
} from "@/lib/vibe64ProjectScope.js";

const VIBE64_SESSIONS_API_SUFFIX = "/vibe64/sessions";
const VIBE64_CURRENT_SESSION_API_SUFFIX = `${VIBE64_SESSIONS_API_SUFFIX}/current`;
const VIBE64_API_SUFFIX = "/vibe64";
const VIBE64_SESSION_CHANGED_EVENT = "vibe64.session.changed";
const VIBE64_SESSION_VIEW_CHANGED_EVENT = "vibe64.session.view.changed";
const VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT = "vibe64.source-editor.file.changed";
const VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT = "vibe64.source-editor.file.opened";
const VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT = "vibe64.source-editor.sync.error";
const VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT = "vibe64.source-editor.sync.ready";
const DEFAULT_MAX_OPEN_SESSIONS = 3;
const SELECTED_SESSION_STORAGE_KEY = "vibe64:selected-session-id";

function selectedSessionStorageKey(projectSlug) {
  return vibe64ProjectScopedStorageKey(SELECTED_SESSION_STORAGE_KEY, projectSlug);
}

function vibe64SessionsQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "sessions"];
}

function vibe64SessionQueryKey(surfaceId, ownershipFilter, projectSlug) {
  return ["vibe64", ...vibe64ProjectQueryScope(projectSlug), surfaceId, ownershipFilter, "session"];
}

function encodePathSegment(value = "") {
  return encodeURIComponent(String(value || "").trim());
}

function vibe64SessionPath(sessionsApiPath = "", sessionId = "", suffix = "") {
  return `${sessionsApiPath}/${encodePathSegment(sessionId)}${suffix}`;
}

function vibe64AgentAttachmentPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/agent-attachments");
}

function vibe64AgentAttachmentDeletePath(
  sessionsApiPath = "",
  sessionId = "",
  attachmentId = ""
) {
  return `${vibe64AgentAttachmentPath(sessionsApiPath, sessionId)}/${encodePathSegment(attachmentId)}`;
}

function vibe64TemporaryConversationsPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/temporary-conversations");
}

function vibe64TemporaryConversationPath(
  sessionsApiPath = "",
  sessionId = "",
  conversationId = ""
) {
  return `${vibe64TemporaryConversationsPath(sessionsApiPath, sessionId)}/${encodePathSegment(conversationId)}`;
}

function vibe64TemporaryConversationTurnsPath(
  sessionsApiPath = "",
  sessionId = "",
  conversationId = ""
) {
  return `${vibe64TemporaryConversationPath(sessionsApiPath, sessionId, conversationId)}/turns`;
}

function vibe64TemporaryConversationStopPath(
  sessionsApiPath = "",
  sessionId = "",
  conversationId = ""
) {
  return `${vibe64TemporaryConversationPath(sessionsApiPath, sessionId, conversationId)}/stop`;
}

function vibe64AgentTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/agent-terminal/${encodePathSegment(terminalSessionId)}` : "/agent-terminal"
  );
}

function vibe64GlobalCodexTerminalPath(vibe64ApiPath = "", terminalSessionId = "") {
  return terminalSessionId
    ? `${vibe64ApiPath}/codex-terminal/${encodePathSegment(terminalSessionId)}`
    : `${vibe64ApiPath}/codex-terminal`;
}

function vibe64AgentSessionsReconcilePath(vibe64ApiPath = "") {
  return `${vibe64ApiPath}/agent-sessions/reconcile`;
}

function vibe64ConversationLogPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/conversation-log");
}

function vibe64SessionViewStatePath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/view-state");
}

function vibe64SessionPreviewStatePath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/preview-state");
}

function vibe64LaunchTargetOpenPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/launch-target/open");
}

function vibe64LaunchTargetsPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/launch-targets");
}

function vibe64PreviewIdentityPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/preview-identity");
}

function vibe64LaunchTerminalPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    terminalSessionId ? `/launch-terminal/${encodePathSegment(terminalSessionId)}` : "/launch-terminal"
  );
}

function vibe64LaunchTerminalStopPath(sessionsApiPath = "", sessionId = "", terminalSessionId = "") {
  return `${vibe64LaunchTerminalPath(sessionsApiPath, sessionId, terminalSessionId)}/stop`;
}

function vibe64SourceEditorTreePath(sessionsApiPath = "", sessionId = "", options = {}) {
  const basePath = vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/tree");
  const params = new URLSearchParams();
  const normalizedPath = String(options?.path || "").trim();
  if (normalizedPath) {
    params.set("path", normalizedPath);
  }
  if (Number.isInteger(Number(options?.offset)) && Number(options.offset) > 0) {
    params.set("offset", String(Number(options.offset)));
  }
  if (Number.isInteger(Number(options?.limit)) && Number(options.limit) > 0) {
    params.set("limit", String(Number(options.limit)));
  }
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function vibe64SourceEditorFilesPath(sessionsApiPath = "", sessionId = "", query = "") {
  const basePath = vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/files");
  const normalizedQuery = String(query || "").trim();
  return normalizedQuery ? `${basePath}?q=${encodeURIComponent(normalizedQuery)}` : basePath;
}

function vibe64SourceEditorSearchPath(sessionsApiPath = "", sessionId = "", query = "") {
  const basePath = vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/search");
  const normalizedQuery = String(query || "").trim();
  return normalizedQuery ? `${basePath}?q=${encodeURIComponent(normalizedQuery)}` : basePath;
}

function vibe64SourceEditorResolvePathPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/resolve-path");
}

function vibe64SourceEditorFilePath(sessionsApiPath = "", sessionId = "", sourcePath = "") {
  const basePath = vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/file");
  const normalizedPath = String(sourcePath || "").trim();
  return normalizedPath ? `${basePath}?path=${encodeURIComponent(normalizedPath)}` : basePath;
}

function vibe64SourceEditorCreateFilePath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/file");
}

function vibe64SourceEditorOpenFilePath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/open-file");
}

function vibe64SourceEditorChangesStreamPath(sessionsApiPath = "", sessionId = "", sourcePath = "") {
  const basePath = vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/changes/stream");
  const normalizedPath = String(sourcePath || "").trim();
  return normalizedPath ? `${basePath}?path=${encodeURIComponent(normalizedPath)}` : basePath;
}

function vibe64SourceEditorExplanationsPath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/source-editor/explanations");
}

function vibe64SourceEditorExplanationsStreamPath(sessionsApiPath = "", sessionId = "") {
  return `${vibe64SourceEditorExplanationsPath(sessionsApiPath, sessionId)}/stream`;
}

function vibe64SourceEditorExplanationsCleanupPath(sessionsApiPath = "", sessionId = "") {
  return `${vibe64SourceEditorExplanationsPath(sessionsApiPath, sessionId)}/cleanup`;
}

function vibe64SourceEditorExplanationPath(sessionsApiPath = "", sessionId = "", explanationId = "") {
  return vibe64SessionPath(
    sessionsApiPath,
    sessionId,
    `/source-editor/explanations/${encodePathSegment(explanationId)}`
  );
}

function vibe64SourceEditorExplanationFollowupsPath(sessionsApiPath = "", sessionId = "", explanationId = "") {
  return `${vibe64SourceEditorExplanationPath(sessionsApiPath, sessionId, explanationId)}/followups`;
}

function vibe64SourceEditorExplanationFollowupsStreamPath(sessionsApiPath = "", sessionId = "", explanationId = "") {
  return `${vibe64SourceEditorExplanationFollowupsPath(sessionsApiPath, sessionId, explanationId)}/stream`;
}

function vibe64SourceEditorExplanationStopPath(sessionsApiPath = "", sessionId = "", explanationId = "") {
  return `${vibe64SourceEditorExplanationPath(sessionsApiPath, sessionId, explanationId)}/stop`;
}

function vibe64ConversationLogQueryKey(surfaceId, ownershipFilter, sessionId = "", projectSlug) {
  return [
    "vibe64",
    ...vibe64ProjectQueryScope(projectSlug),
    surfaceId,
    ownershipFilter,
    "conversation-log",
    encodePathSegment(sessionId)
  ];
}

function vibe64LaunchTargetsQueryKey(surfaceId, ownershipFilter, sessionId = "", projectSlug) {
  return [
    "vibe64",
    ...vibe64ProjectQueryScope(projectSlug),
    surfaceId,
    ownershipFilter,
    "launch-targets",
    encodePathSegment(sessionId)
  ];
}

function agentSettingsInputFromContext(context = {}) {
  return context?.agentSettings && typeof context.agentSettings === "object" && !Array.isArray(context.agentSettings)
    ? {
        agentSettings: context.agentSettings
      }
    : {};
}

export {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SESSION_VIEW_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT,
  VIBE64_API_SUFFIX,
  VIBE64_CURRENT_SESSION_API_SUFFIX,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  DEFAULT_MAX_OPEN_SESSIONS,
  SELECTED_SESSION_STORAGE_KEY,
  vibe64AgentAttachmentDeletePath,
  vibe64AgentAttachmentPath,
  vibe64AgentSessionsReconcilePath,
  vibe64AgentTerminalPath,
  vibe64ConversationLogPath,
  vibe64ConversationLogQueryKey,
  vibe64SessionPreviewStatePath,
  vibe64SessionViewStatePath,
  vibe64GlobalCodexTerminalPath,
  vibe64LaunchTargetOpenPath,
  vibe64LaunchTargetsPath,
  vibe64LaunchTargetsQueryKey,
  vibe64PreviewIdentityPath,
  vibe64LaunchTerminalPath,
  vibe64LaunchTerminalStopPath,
  vibe64SessionPath,
  vibe64SessionQueryKey,
  selectedSessionStorageKey,
  vibe64SourceEditorCreateFilePath,
  vibe64SourceEditorChangesStreamPath,
  vibe64SourceEditorExplanationFollowupsPath,
  vibe64SourceEditorExplanationFollowupsStreamPath,
  vibe64SourceEditorExplanationPath,
  vibe64SourceEditorExplanationStopPath,
  vibe64SourceEditorExplanationsCleanupPath,
  vibe64SourceEditorExplanationsPath,
  vibe64SourceEditorExplanationsStreamPath,
  vibe64SourceEditorFilesPath,
  vibe64SourceEditorFilePath,
  vibe64SourceEditorOpenFilePath,
  vibe64SourceEditorResolvePathPath,
  vibe64SourceEditorSearchPath,
  vibe64SourceEditorTreePath,
  vibe64TemporaryConversationPath,
  vibe64TemporaryConversationsPath,
  vibe64TemporaryConversationStopPath,
  vibe64TemporaryConversationTurnsPath,
  vibe64SessionsQueryKey,
  agentSettingsInputFromContext
};
