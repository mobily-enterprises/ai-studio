import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  vibe64Error,
  isPlainObject,
  isMissingPathError,
  normalizeTargetRoot,
  normalizeText,
  pathExists
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  clearVibe64CurrentSessionAliasIfMatches,
  readVibe64CurrentSessionAlias,
  resolveVibe64CurrentSessionAliasPath,
  updateVibe64CurrentSessionAlias
} from "./currentSessionAlias.js";
const VIBE64_SESSION_SCHEMA_VERSION = 2;
const VIBE64_CLOSED_SESSION_ARCHIVE_SCHEMA_VERSION = 1;
const SESSION_LABEL_METADATA = "label";
const SESSION_LABEL_MAX_LENGTH = 120;
const VIBE64_SESSION_STATUS = deepFreeze({
  ABANDONED: "abandoned",
  ACTIVE: "active",
  BLOCKED: "blocked"
});
const VIBE64_SESSION_STATUSES = new Set(Object.values(VIBE64_SESSION_STATUS));
const CLOSED_VIBE64_SESSION_STATUS_LIST = [
  VIBE64_SESSION_STATUS.ABANDONED
];
const CLOSED_VIBE64_SESSION_STATUSES = new Set(CLOSED_VIBE64_SESSION_STATUS_LIST);
const CLOSED_SESSION_ARCHIVE_KIND = "vibe64.closed_session_archive";
const CLOSED_SESSION_INDEX_METADATA_NAMES = Object.freeze([
  "base_branch",
  "base_commit",
  "canonical_commit",
  "branch",
  "source_default_branch",
  "source_kind",
  "source_path",
  "source_recovery_base_branch",
  "source_recovery_base_commit",
  "source_recovery_branch",
  "source_recovery_bundle_artifact",
  "source_recovery_checkpoint_bundle_artifact",
  "source_recovery_default_branch",
  "source_recovery_dirty",
  "source_recovery_head",
  "source_recovery_kind",
  "source_recovery_patch_artifact",
  "source_recovery_remote_url",
  "source_recovery_saved",
  "source_recovery_saved_at",
  "source_recovery_session_name",
  "source_recovery_source_path",
  "source_recovery_untracked_artifact",
  "source_recovery_untracked_count",
  "source_remote_url",
  "source_removed"
]);
const CLOSED_SESSION_ARCHIVE_TIMEOUT_MS = 60_000;
const COMMAND_BUFFER_BYTES = 50 * 1024 * 1024;
const BACKGROUND_TASK_EVENT_LIMIT = 200;
const AGENT_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;
const ARTIFACT_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const BACKGROUND_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;
const CONVERSATION_ACTIVITY_ROLES = new Set([
  "commentary",
  "thinking"
]);
const CONVERSATION_MESSAGE_ROLES = deepFreeze([
  "assistant",
  "commentary",
  "system",
  "thinking",
  "user"
]);
const CONVERSATION_MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const CONVERSATION_MESSAGE_FILE_PATTERN =
  /^(user|assistant|commentary|system|thinking)\.(\d{8}T\d{9}Z)(?:\.([A-Za-z0-9][A-Za-z0-9_-]{0,127}))?\.md$/u;
const CONVERSATION_TURN_ID_PATTERN = /^\d{6}$/u;
const SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES = Object.freeze([
  "base_commit",
  "canonical_commit",
  "repository_mode",
  "source",
  "source_kind",
  "source_path",
  "source_path_authority",
  "source_removed"
]);
const METADATA_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const BACKGROUND_TASK_STATUS = Object.freeze({
  FAILED: "failed",
  READY: "ready",
  RUNNING: "running"
});
const BACKGROUND_TASK_STATUSES = new Set(Object.values(BACKGROUND_TASK_STATUS));
const VIBE64_AGENT_RUN_STATE = Object.freeze({
  ACTIVE: "active",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  FAILED: "failed",
  FINALIZING: "finalizing",
  INTERRUPTED: "interrupted",
  STARTING: "starting",
  TIMED_OUT: "timed_out"
});
const AGENT_RUN_STATES = new Set(Object.values(VIBE64_AGENT_RUN_STATE));
const TERMINAL_AGENT_RUN_STATES = new Set([
  VIBE64_AGENT_RUN_STATE.CANCELLED,
  VIBE64_AGENT_RUN_STATE.COMPLETED,
  VIBE64_AGENT_RUN_STATE.FAILED,
  VIBE64_AGENT_RUN_STATE.INTERRUPTED,
  VIBE64_AGENT_RUN_STATE.TIMED_OUT
]);

const ACTIVE_AGENT_RUN_STATES = new Set([
  VIBE64_AGENT_RUN_STATE.ACTIVE,
  VIBE64_AGENT_RUN_STATE.FINALIZING,
  VIBE64_AGENT_RUN_STATE.STARTING
]);
const SESSION_LOCK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SESSION_LOCK_OWNER_GRACE_MS = 2_000;
const SESSION_LOCK_POLL_MS = 20;
const SESSION_MUTATION_LOCK_WAIT_MS = 60_000;
const sessionMutationChains = new Map();
const sessionMutationContext = new AsyncLocalStorage();
const sessionExclusiveContext = new AsyncLocalStorage();

function isValidVibe64SessionId(sessionId) {
  const normalizedSessionId = normalizeText(sessionId);
  return SESSION_ID_PATTERN.test(normalizedSessionId);
}

function isSafeAgentRunId(runId) {
  return AGENT_RUN_ID_PATTERN.test(normalizeText(runId));
}

function isSafeBackgroundTaskId(taskId) {
  return BACKGROUND_TASK_ID_PATTERN.test(normalizeText(taskId));
}

function assertValidVibe64SessionId(sessionId) {
  const normalizedSessionId = normalizeText(sessionId);
  if (!isValidVibe64SessionId(normalizedSessionId)) {
    throw vibe64Error(`Invalid vibe64 session id: ${normalizedSessionId || "(empty)"}`, "vibe64_invalid_session_id");
  }
  return normalizedSessionId;
}

function assertSafeMetadataName(name) {
  const normalizedName = normalizeText(name);
  if (!METADATA_NAME_PATTERN.test(normalizedName)) {
    throw vibe64Error(`Invalid vibe64 metadata name: ${normalizedName || "(empty)"}`, "vibe64_invalid_metadata_name");
  }
  return normalizedName;
}

function assertSafeAgentRunId(runId) {
  const normalizedRunId = normalizeText(runId);
  if (!isSafeAgentRunId(normalizedRunId)) {
    throw vibe64Error(
      `Invalid vibe64 agent run id: ${normalizedRunId || "(empty)"}`,
      "vibe64_invalid_agent_run_id"
    );
  }
  return normalizedRunId;
}

function assertSafeBackgroundTaskId(taskId) {
  const normalizedTaskId = normalizeText(taskId);
  if (!isSafeBackgroundTaskId(normalizedTaskId)) {
    throw vibe64Error(
      `Invalid vibe64 background task id: ${normalizedTaskId || "(empty)"}`,
      "vibe64_invalid_background_task_id"
    );
  }
  return normalizedTaskId;
}

function normalizeVibe64AgentRunState(state) {
  const normalizedState = normalizeText(state) || VIBE64_AGENT_RUN_STATE.STARTING;
  if (!AGENT_RUN_STATES.has(normalizedState)) {
    throw vibe64Error(
      `Invalid vibe64 agent run state: ${normalizedState}`,
      "vibe64_invalid_agent_run_state"
    );
  }
  return normalizedState;
}

function vibe64AgentRunStateIsActive(state) {
  return ACTIVE_AGENT_RUN_STATES.has(normalizeVibe64AgentRunState(state));
}

function vibe64AgentRunStateIsTerminal(state) {
  return TERMINAL_AGENT_RUN_STATES.has(normalizeVibe64AgentRunState(state));
}

function normalizeBackgroundTaskStatus(status) {
  const normalizedStatus = normalizeText(status) || BACKGROUND_TASK_STATUS.RUNNING;
  if (!BACKGROUND_TASK_STATUSES.has(normalizedStatus)) {
    throw vibe64Error(
      `Invalid vibe64 background task status: ${normalizedStatus}`,
      "vibe64_invalid_background_task_status"
    );
  }
  return normalizedStatus;
}

function assertVibe64SessionStatus(status) {
  const normalizedStatus = normalizeText(status) || VIBE64_SESSION_STATUS.ACTIVE;
  if (!VIBE64_SESSION_STATUSES.has(normalizedStatus)) {
    throw vibe64Error(`Invalid vibe64 session status: ${normalizedStatus}`, "vibe64_invalid_session_status");
  }
  return normalizedStatus;
}

function normalizeSessionListStatusGroup(statusGroup = "") {
  const normalizedStatusGroup = normalizeText(statusGroup);
  if (!normalizedStatusGroup) {
    return "";
  }
  if (["all", "closed", "open"].includes(normalizedStatusGroup)) {
    return normalizedStatusGroup;
  }
  throw vibe64Error(`Invalid vibe64 session list status group: ${normalizedStatusGroup}`, "vibe64_invalid_session_list_status_group");
}

function normalizeSessionListStatuses(statuses = []) {
  return new Set((Array.isArray(statuses) ? statuses : [])
    .map((status) => normalizeText(status))
    .filter(Boolean)
    .map(assertVibe64SessionStatus));
}

function normalizeSessionListOptions(options = {}) {
  return {
    statusGroup: normalizeSessionListStatusGroup(options.statusGroup),
    statuses: normalizeSessionListStatuses(options.statuses)
  };
}

function sessionStatusMatchesListOptions(status, {
  statusGroup = "",
  statuses = new Set()
} = {}) {
  const normalizedStatus = normalizeText(status) || VIBE64_SESSION_STATUS.ACTIVE;
  if (statuses.size > 0 && !statuses.has(normalizedStatus)) {
    return false;
  }
  if (statusGroup === "open") {
    return !CLOSED_VIBE64_SESSION_STATUSES.has(normalizedStatus);
  }
  if (statusGroup === "closed") {
    return CLOSED_VIBE64_SESSION_STATUSES.has(normalizedStatus);
  }
  return true;
}

function sessionListMayIncludeClosed({
  statusGroup = "",
  statuses = new Set()
} = {}) {
  return statusGroup !== "open" && (
    statuses.size < 1 ||
    [...statuses].some((status) => CLOSED_VIBE64_SESSION_STATUSES.has(status))
  );
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return "";
    }
    throw error;
  }
}

async function writeTextFile(filePath, text) {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, String(text), "utf8");
}

async function writeJsonFile(filePath, value) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, {
    recursive: true
  });
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, {
      force: true
    });
    throw error;
  }
}

async function runCommand(command, args = [], {
  allowedRoots = [],
  cwd = "",
  maxBuffer = COMMAND_BUFFER_BYTES,
  timeout = CLOSED_SESSION_ARCHIVE_TIMEOUT_MS
} = {}) {
  const resolvedCwd = cwd || process.cwd();
  const result = await runVibe64Command({
    actor: "daemon",
    allowedRoots: [
      resolvedCwd,
      ...allowedRoots
    ].filter(Boolean),
    args,
    command,
    cwd: resolvedCwd,
    envPolicy: "session",
    maxBuffer,
    mode: "capture",
    purpose: "source",
    timeout
  });
  return {
    ok: result.ok === true,
    output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`) ||
      normalizeText(result.output || result.error),
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

function revisionNumber(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function normalizeManifest(manifest = {}) {
  return {
    ...manifest,
    revision: revisionNumber(manifest.revision)
  };
}

function withRevisionMarker(value, manifest = {}, sessionId = "") {
  if (!isPlainObject(value) || normalizeText(value.sessionId) !== sessionId) {
    return value;
  }
  const normalizedManifest = normalizeManifest(manifest);
  return {
    ...value,
    manifest: isPlainObject(value.manifest)
      ? {
          ...value.manifest,
          revision: normalizedManifest.revision,
          updatedAt: normalizeText(normalizedManifest.updatedAt)
        }
      : value.manifest,
    revision: normalizedManifest.revision,
    updatedAt: normalizeText(normalizedManifest.updatedAt)
  };
}

function enqueueSessionMutation(key, operation) {
  const previous = sessionMutationChains.get(key) || Promise.resolve();
  const queued = previous.catch(() => null).then(operation);
  const stored = queued.catch(() => null).finally(() => {
    if (sessionMutationChains.get(key) === stored) {
      sessionMutationChains.delete(key);
    }
  });
  sessionMutationChains.set(key, stored);
  return queued;
}

function createSessionOperationLease() {
  let resolveIdle = () => null;
  const idle = new Promise((resolve) => {
    resolveIdle = resolve;
  });
  return {
    idle,
    operations: 0,
    resolveIdle
  };
}

function beginSessionOperation(lease) {
  lease.operations += 1;
  return {
    active: true
  };
}

function finishSessionOperation(lease, participant) {
  participant.active = false;
  lease.operations -= 1;
  if (lease.operations === 0) {
    lease.resolveIdle();
  }
}

function delay(milliseconds = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function processIsAlive(pid) {
  const normalizedPid = Number(pid);
  if (!Number.isSafeInteger(normalizedPid) || normalizedPid <= 0) {
    return false;
  }
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function sessionLockPath(sessionPaths, lockName = "") {
  const normalizedLockName = normalizeText(lockName);
  if (!SESSION_LOCK_NAME_PATTERN.test(normalizedLockName)) {
    throw vibe64Error(`Invalid vibe64 session lock name: ${normalizedLockName || "(empty)"}`, "vibe64_session_lock_name_invalid");
  }
  return path.join(
    sessionPaths.sessionsRoot,
    ".locks",
    sessionPaths.sessionId,
    `${normalizedLockName}.lock`
  );
}

async function readSessionLockOwner(lockPath = "") {
  try {
    return JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

async function sessionLockIsAbandoned(lockPath = "") {
  const owner = await readSessionLockOwner(lockPath);
  if (owner?.pid) {
    return !processIsAlive(owner.pid);
  }
  try {
    const lockStat = await stat(lockPath);
    return Date.now() - lockStat.mtimeMs >= SESSION_LOCK_OWNER_GRACE_MS;
  } catch (error) {
    return isMissingPathError(error);
  }
}

async function quarantineAbandonedSessionLock(lockPath = "") {
  if (!await sessionLockIsAbandoned(lockPath)) {
    return false;
  }
  const quarantinePath = `${lockPath}.abandoned.${process.pid}.${randomUUID()}`;
  try {
    await rename(lockPath, quarantinePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return true;
    }
    return false;
  }
  await rm(quarantinePath, {
    force: true,
    recursive: true
  });
  return true;
}

async function acquireSessionLock(sessionPaths, lockName = "", {
  waitMs = 0
} = {}) {
  const lockPath = sessionLockPath(sessionPaths, lockName);
  const lockRoot = path.dirname(lockPath);
  const token = randomUUID();
  const startedAtMs = Date.now();
  await mkdir(lockRoot, {
    recursive: true
  });
  while (true) {
    try {
      await mkdir(lockPath, {
        mode: 0o700
      });
      try {
        await writeJsonFile(path.join(lockPath, "owner.json"), {
          createdAt: new Date().toISOString(),
          pid: process.pid,
          token
        });
      } catch (error) {
        await rm(lockPath, {
          force: true,
          recursive: true
        });
        throw error;
      }
      return async () => {
        const owner = await readSessionLockOwner(lockPath);
        if (normalizeText(owner?.token) !== token) {
          return;
        }
        const releasedPath = `${lockPath}.released.${process.pid}.${token}`;
        try {
          await rename(lockPath, releasedPath);
        } catch (error) {
          if (isMissingPathError(error)) {
            return;
          }
          throw error;
        }
        await rm(releasedPath, {
          force: true,
          recursive: true
        });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await quarantineAbandonedSessionLock(lockPath)) {
        continue;
      }
      if (Date.now() - startedAtMs >= waitMs) {
        return null;
      }
      await delay(Math.min(SESSION_LOCK_POLL_MS, Math.max(1, waitMs - (Date.now() - startedAtMs))));
    }
  }
}

async function readDirectoryEntries(directoryPath) {
  try {
    return await readdir(directoryPath, {
      withFileTypes: true
    });
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }
}

function sortedFileNames(entries, isAllowedName) {
  return entries
    .filter((entry) => entry.isFile() && isAllowedName(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function sortedDirectoryNames(entries, isAllowedName) {
  return entries
    .filter((entry) => entry.isDirectory() && isAllowedName(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw vibe64Error("Invalid vibe64 clock value.", "vibe64_invalid_clock");
  }
  return date;
}

function timestampForSessionId(date) {
  return toDate(date)
    .toISOString()
    .replace(/\.\d{3}Z$/u, "")
    .replace("T", "_")
    .replaceAll(":", "-");
}

function timestampForConversationFile(date) {
  return toDate(date)
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(".", "");
}

function isoFromConversationTimestamp(timestamp = "") {
  const value = normalizeText(timestamp);
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/u);
  if (!match) {
    return "";
  }
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`;
}

function sessionPathsFromRoot({
  activeSessionsRoot = "",
  closingSessionsRoot = "",
  closedSessionsRoot = "",
  currentSessionAliasPath = "",
  projectContextRoot = "",
  sessionId = "",
  sessionRoot = "",
  sessionsRoot = "",
  stateRoot = ""
} = {}) {
  return {
    activeSessionsRoot,
    agentRunsRoot: sessionRoot ? path.join(sessionRoot, "agent-runs") : "",
    artifactsRoot: sessionRoot ? path.join(sessionRoot, "artifacts") : "",
    backgroundTasksRoot: sessionRoot ? path.join(sessionRoot, "background-tasks") : "",
    closingSessionsRoot,
    closedSessionsRoot,
    conversationLogRoot: sessionRoot ? path.join(sessionRoot, "conversation-log") : "",
    currentSessionAliasPath,
    manifestPath: sessionRoot ? path.join(sessionRoot, "session.json") : "",
    metadataRoot: sessionRoot ? path.join(sessionRoot, "metadata") : "",
    projectContextRoot,
    sessionId,
    sessionRoot,
    sessionsRoot,
    stateRoot,
    statusPath: sessionRoot ? path.join(sessionRoot, "status") : ""
  };
}

function resolveVibe64SessionPaths({
  projectContextRoot = process.cwd(),
  projectRuntimeRoot = "",
  projectSessionSourceRoot = "",
  sessionId = ""
} = {}) {
  const normalizedProjectContextRoot = normalizeTargetRoot(projectContextRoot);
  const resolvedStateRoot = projectRuntimeRoot ? path.resolve(projectRuntimeRoot) : "";
  if (!resolvedStateRoot) {
    throw vibe64Error("Vibe64 session paths require projectRuntimeRoot.", "vibe64_project_runtime_root_required");
  }
  const sessionsRoot = path.join(resolvedStateRoot, "sessions");
  const sourceSessionsRoot = projectSessionSourceRoot
    ? path.join(path.resolve(projectSessionSourceRoot), "sessions")
    : "";
  const activeSessionsRoot = path.join(sessionsRoot, "active");
  const closingSessionsRoot = path.join(sessionsRoot, "closing");
  const closedSessionsRoot = path.join(sessionsRoot, "closed");
  const normalizedSessionId = normalizeText(sessionId);
  const sessionRoot = normalizedSessionId ? path.join(activeSessionsRoot, assertValidVibe64SessionId(normalizedSessionId)) : "";
  return sessionPathsFromRoot({
    activeSessionsRoot,
    closingSessionsRoot,
    closedSessionsRoot,
    currentSessionAliasPath: sourceSessionsRoot
      ? resolveVibe64CurrentSessionAliasPath(sourceSessionsRoot)
      : "",
    projectContextRoot: normalizedProjectContextRoot,
    sessionId: normalizedSessionId,
    sessionRoot,
    sessionsRoot,
    stateRoot: resolvedStateRoot
  });
}

function createClockNow(clock) {
  if (typeof clock === "function") {
    return () => toDate(clock());
  }
  return () => new Date();
}

async function createAvailableSessionId(rootPaths, now) {
  const baseSessionId = timestampForSessionId(now);
  for (let index = 0; index < 1000; index += 1) {
    const sessionId = index === 0 ? baseSessionId : `${baseSessionId}_${index + 1}`;
    if (!await sessionRecordExists(rootPaths, sessionId)) {
      return sessionId;
    }
  }
  throw vibe64Error("Unable to allocate an vibe64 session id.", "vibe64_session_id_exhausted");
}

function closedSessionStatusRoot(rootPaths = {}, status = "") {
  const normalizedStatus = assertVibe64SessionStatus(status);
  if (!CLOSED_VIBE64_SESSION_STATUSES.has(normalizedStatus)) {
    throw vibe64Error(
      `Cannot archive open Vibe64 session status: ${normalizedStatus}`,
      "vibe64_session_archive_open_status"
    );
  }
  return path.join(rootPaths.closedSessionsRoot, normalizedStatus);
}

function closedSessionArchivePath(rootPaths = {}, status = "", sessionId = "") {
  return path.join(closedSessionStatusRoot(rootPaths, status), `${assertValidVibe64SessionId(sessionId)}.tar.gz`);
}

function closedSessionMetadataPath(rootPaths = {}, status = "", sessionId = "") {
  return path.join(closedSessionStatusRoot(rootPaths, status), `${assertValidVibe64SessionId(sessionId)}.json`);
}

function closedSessionStagingRoot(rootPaths = {}) {
  return path.join(rootPaths.closedSessionsRoot, ".staging");
}

function closingSessionRoot(rootPaths = {}, sessionId = "") {
  return path.join(rootPaths.closingSessionsRoot, assertValidVibe64SessionId(sessionId));
}

async function closedSessionRecordExists(rootPaths = {}, sessionId = "") {
  const normalizedSessionId = assertValidVibe64SessionId(sessionId);
  return (await Promise.all(CLOSED_VIBE64_SESSION_STATUS_LIST.map(async (status) => {
    return await pathExists(closedSessionMetadataPath(rootPaths, status, normalizedSessionId)) ||
      await pathExists(closedSessionArchivePath(rootPaths, status, normalizedSessionId));
  }))).some(Boolean);
}

async function sessionRecordExists(rootPaths = {}, sessionId = "") {
  const normalizedSessionId = assertValidVibe64SessionId(sessionId);
  return await pathExists(path.join(rootPaths.activeSessionsRoot, normalizedSessionId)) ||
    await pathExists(closingSessionRoot(rootPaths, normalizedSessionId)) ||
    await closedSessionRecordExists(rootPaths, normalizedSessionId);
}

function metadataFilePath(sessionPaths, name) {
  return path.join(sessionPaths.metadataRoot, assertSafeMetadataName(name));
}

function normalizeSessionLabel(value = "") {
  return normalizeText(value).slice(0, SESSION_LABEL_MAX_LENGTH);
}

function assertSafeArtifactPath(relativePath) {
  const normalizedPath = normalizeText(relativePath);
  const segments = normalizedPath.split("/");
  if (
    !normalizedPath
    || normalizedPath.includes("\\")
    || segments.some((segment) => !ARTIFACT_PATH_SEGMENT_PATTERN.test(segment))
  ) {
    throw vibe64Error(`Invalid vibe64 artifact path: ${normalizedPath || "(empty)"}`, "vibe64_invalid_artifact_path");
  }
  return segments.join("/");
}

function artifactFilePath(sessionPaths, relativePath) {
  const safeRelativePath = assertSafeArtifactPath(relativePath);
  const artifactsRoot = path.resolve(sessionPaths.artifactsRoot);
  const artifactPath = path.resolve(artifactsRoot, ...safeRelativePath.split("/"));
  const pathFromRoot = path.relative(artifactsRoot, artifactPath);
  if (pathFromRoot.startsWith("..") || path.isAbsolute(pathFromRoot)) {
    throw vibe64Error(`Invalid vibe64 artifact path: ${safeRelativePath}`, "vibe64_invalid_artifact_path");
  }
  return artifactPath;
}

function agentRunFilePath(sessionPaths, runId) {
  return path.join(sessionPaths.agentRunsRoot, `${assertSafeAgentRunId(runId)}.json`);
}

function backgroundTaskFilePath(sessionPaths, taskId) {
  return path.join(sessionPaths.backgroundTasksRoot, `${assertSafeBackgroundTaskId(taskId)}.json`);
}

function conversationTurnRoot(sessionPaths, turnId) {
  const normalizedTurnId = normalizeText(turnId);
  if (!CONVERSATION_TURN_ID_PATTERN.test(normalizedTurnId)) {
    throw vibe64Error(`Invalid vibe64 conversation turn id: ${normalizedTurnId || "(empty)"}`, "vibe64_invalid_conversation_turn_id");
  }
  return path.join(sessionPaths.conversationLogRoot, normalizedTurnId);
}

function conversationMessageFileName(role = "", date, messageId = "") {
  const normalizedRole = normalizeText(role);
  if (!CONVERSATION_MESSAGE_ROLES.includes(normalizedRole)) {
    throw vibe64Error(`Invalid vibe64 conversation role: ${normalizedRole || "(empty)"}`, "vibe64_invalid_conversation_role");
  }
  const normalizedMessageId = normalizeText(messageId);
  if (normalizedMessageId && !CONVERSATION_MESSAGE_ID_PATTERN.test(normalizedMessageId)) {
    throw vibe64Error(
      `Invalid vibe64 conversation message id: ${normalizedMessageId}`,
      "vibe64_invalid_conversation_message_id"
    );
  }
  const idSuffix = normalizedMessageId ? `.${normalizedMessageId}` : "";
  return `${normalizedRole}.${timestampForConversationFile(date)}${idSuffix}.md`;
}

function nextConversationTurnId(turnIds = []) {
  const latest = [...turnIds]
    .filter((turnId) => CONVERSATION_TURN_ID_PATTERN.test(turnId))
    .map((turnId) => Number.parseInt(turnId, 10))
    .filter((turnId) => Number.isSafeInteger(turnId) && turnId > 0)
    .sort((left, right) => left - right)
    .at(-1) || 0;
  return String(latest + 1).padStart(6, "0");
}

function conversationTurnHasMessages(turn = {}) {
  return Boolean(
    turn.system ||
    turn.user ||
    turn.assistant ||
    turn.commentary?.length ||
    turn.thinking?.length
  );
}

function createVibe64SessionStore({
  clock = undefined,
  projectContextRoot = process.cwd(),
  projectRuntimeRoot = "",
  projectSessionSourceRoot = ""
} = {}) {
  const normalizedProjectContextRoot = normalizeTargetRoot(projectContextRoot);
  const resolvedProjectRuntimeRoot = String(projectRuntimeRoot || "").trim();
  if (!resolvedProjectRuntimeRoot) {
    throw vibe64Error("Vibe64 session store requires projectRuntimeRoot.", "vibe64_project_runtime_root_required");
  }
  const normalizedStateRoot = path.resolve(resolvedProjectRuntimeRoot);
  const now = createClockNow(clock);

  function paths(sessionId = "") {
    return resolveVibe64SessionPaths({
      projectContextRoot: normalizedProjectContextRoot,
      projectRuntimeRoot: normalizedStateRoot,
      projectSessionSourceRoot,
      sessionId
    });
  }

  function pathsForSessionRoot(sessionId = "", sessionRoot = "") {
    const rootPaths = paths();
    return sessionPathsFromRoot({
      activeSessionsRoot: rootPaths.activeSessionsRoot,
      closingSessionsRoot: rootPaths.closingSessionsRoot,
      closedSessionsRoot: rootPaths.closedSessionsRoot,
      currentSessionAliasPath: rootPaths.currentSessionAliasPath,
      projectContextRoot: rootPaths.projectContextRoot,
      sessionId: assertValidVibe64SessionId(sessionId),
      sessionRoot,
      sessionsRoot: rootPaths.sessionsRoot,
      stateRoot: rootPaths.stateRoot
    });
  }

  async function ensureActiveSessionRoot(sessionId) {
    const sessionPaths = paths(sessionId);
    if (!await pathExists(sessionPaths.manifestPath)) {
      const closingSession = closingSessionPaths(sessionPaths.sessionId);
      if (
        await pathExists(closingSession.manifestPath) ||
        await readClosedArchiveRecord(sessionPaths.sessionId)
      ) {
        throw vibe64Error(
          `Vibe64 session is already closed: ${sessionPaths.sessionId}`,
          "vibe64_session_closed"
        );
      }
      throw vibe64Error(
        `Unknown vibe64 session: ${sessionPaths.sessionId}`,
        "vibe64_session_not_found"
      );
    }
    return sessionPaths;
  }

  function closingSessionPaths(sessionId = "") {
    const rootPaths = paths();
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    return pathsForSessionRoot(
      normalizedSessionId,
      closingSessionRoot(rootPaths, normalizedSessionId)
    );
  }

  function closedArchiveRecordFromJson(value = {}, {
    archivePath = "",
    metadataPath = "",
    status = ""
  } = {}) {
    if (
      !isPlainObject(value) ||
      value.kind !== CLOSED_SESSION_ARCHIVE_KIND ||
      value.schemaVersion !== VIBE64_CLOSED_SESSION_ARCHIVE_SCHEMA_VERSION ||
      !isValidVibe64SessionId(value.sessionId)
    ) {
      throw vibe64Error(
        `Invalid closed Vibe64 session archive metadata: ${metadataPath}`,
        "vibe64_invalid_closed_session_archive_metadata"
      );
    }
    const normalizedStatus = assertVibe64SessionStatus(value.status || status);
    if (!CLOSED_VIBE64_SESSION_STATUSES.has(normalizedStatus)) {
      throw vibe64Error(
        `Invalid closed Vibe64 session archive status: ${normalizedStatus}`,
        "vibe64_invalid_closed_session_archive_status"
      );
    }
    return {
      ...value,
      archivePath,
      index: isPlainObject(value.index) ? value.index : {},
      metadataPath,
      status: normalizedStatus
    };
  }

  async function readClosedArchiveRecordForStatus(rootPaths, status, sessionId) {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const metadataPath = closedSessionMetadataPath(rootPaths, status, normalizedSessionId);
    if (!await pathExists(metadataPath)) {
      return null;
    }
    try {
      return closedArchiveRecordFromJson(JSON.parse(await readFile(metadataPath, "utf8")), {
        archivePath: closedSessionArchivePath(rootPaths, status, normalizedSessionId),
        metadataPath,
        status
      });
    } catch (error) {
      if (error?.code?.startsWith?.("vibe64_")) {
        throw error;
      }
      throw vibe64Error(
        `Invalid closed Vibe64 session archive metadata: ${metadataPath}`,
        "vibe64_invalid_closed_session_archive_metadata"
      );
    }
  }

  async function readClosedArchiveRecord(sessionId) {
    const rootPaths = paths();
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    for (const status of CLOSED_VIBE64_SESSION_STATUS_LIST) {
      const record = await readClosedArchiveRecordForStatus(rootPaths, status, normalizedSessionId);
      if (record) {
        return record;
      }
    }
    return null;
  }

  async function readClosedArchiveRecords() {
    const rootPaths = paths();
    const statusRecords = await Promise.all(CLOSED_VIBE64_SESSION_STATUS_LIST.map(async (status) => {
      const entries = await readDirectoryEntries(closedSessionStatusRoot(rootPaths, status));
      const metadataFileNames = sortedFileNames(entries, (name) => {
        return name.endsWith(".json") && isValidVibe64SessionId(name.slice(0, -".json".length));
      });
      return Promise.all(metadataFileNames.map((fileName) => {
        return readClosedArchiveRecordForStatus(rootPaths, status, fileName.slice(0, -".json".length));
      }));
    }));
    return statusRecords.flat().filter(Boolean);
  }

  function closedArchiveIndexMetadata(metadata = {}) {
    if (!isPlainObject(metadata)) {
      return {};
    }
    const entries = CLOSED_SESSION_INDEX_METADATA_NAMES
      .map((name) => [
        name,
        normalizeText(metadata[name])
      ])
      .filter(([, value]) => value);
    return Object.fromEntries(entries);
  }

  function closedArchiveIndexFromSummary(summary = {}, {
    sessionId = "",
    status = ""
  } = {}) {
    const manifest = isPlainObject(summary.manifest) ? summary.manifest : {};
    const createdAt = normalizeText(summary.createdAt || manifest.createdAt);
    const updatedAt = normalizeText(summary.updatedAt || manifest.updatedAt || createdAt);
    return {
      createdAt,
      manifest: {
        createdAt,
        revision: revisionNumber(summary.revision ?? manifest.revision),
        runtimeKind: normalizeText(manifest.runtimeKind),
        updatedAt
      },
      metadata: closedArchiveIndexMetadata(summary.metadata),
      revision: revisionNumber(summary.revision ?? manifest.revision),
      sessionId: assertValidVibe64SessionId(sessionId || summary.sessionId),
      sessionName: normalizeText(summary.sessionName),
      sessionRoot: "",
      status: assertVibe64SessionStatus(status || summary.status),
      updatedAt
    };
  }

  function closedArchiveSummary(record = {}) {
    const index = isPlainObject(record.index) ? record.index : {};
    return {
      createdAt: normalizeText(index.createdAt),
      manifest: isPlainObject(index.manifest) ? index.manifest : {},
      metadata: isPlainObject(index.metadata) ? index.metadata : {},
      revision: revisionNumber(index.revision),
      sessionName: normalizeText(index.sessionName),
      updatedAt: normalizeText(index.updatedAt),
      archiveMetadataPath: record.metadataPath,
      archivePath: record.archivePath,
      archiveStatus: record.status,
      archived: true,
      archivedAt: normalizeText(record.archivedAt),
      sessionId: normalizeText(index.sessionId) || normalizeText(record.sessionId),
      sessionRoot: "",
      status: normalizeText(index.status) || normalizeText(record.status)
    };
  }

  function closedArchiveMetadataRecord({
    archivePath = "",
    archivedAt = "",
    metadataPath = "",
    sessionId = "",
    status = "",
    summary = {}
  } = {}) {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const normalizedStatus = assertVibe64SessionStatus(status);
    const archiveFileName = path.basename(archivePath);
    const metadataFileName = path.basename(metadataPath);
    return {
      archive: {
        fileName: archiveFileName,
        relativePath: `closed/${normalizedStatus}/${archiveFileName}`
      },
      archivedAt: normalizeText(archivedAt),
      index: closedArchiveIndexFromSummary(summary, {
        sessionId: normalizedSessionId,
        status: normalizedStatus
      }),
      kind: CLOSED_SESSION_ARCHIVE_KIND,
      metadata: {
        fileName: metadataFileName,
        relativePath: `closed/${normalizedStatus}/${metadataFileName}`
      },
      schemaVersion: VIBE64_CLOSED_SESSION_ARCHIVE_SCHEMA_VERSION,
      sessionId: normalizedSessionId,
      status: normalizedStatus
    };
  }

  async function withExtractedClosedArchive(record, operation) {
    const extractionRoot = path.join(paths().sessionsRoot, ".archive-read", `${record.sessionId}-${randomUUID()}`);
    const extractedSessionRoot = path.join(extractionRoot, record.sessionId);
    try {
      await mkdir(extractionRoot, {
        recursive: true
      });
      const extractResult = await runCommand("tar", [
        "-xzf",
        record.archivePath,
        "-C",
        extractionRoot
      ], {
        allowedRoots: [
          path.dirname(record.archivePath)
        ],
        cwd: extractionRoot
      });
      if (!extractResult.ok) {
        throw vibe64Error(
          `Cannot read closed Vibe64 session archive ${record.archivePath}: ${extractResult.output}`,
          "vibe64_closed_session_archive_read_failed"
        );
      }
      const sessionPaths = pathsForSessionRoot(record.sessionId, extractedSessionRoot);
      if (!await pathExists(sessionPaths.manifestPath)) {
        throw vibe64Error(
          `Closed Vibe64 session archive does not contain session ${record.sessionId}.`,
          "vibe64_closed_session_archive_missing_session"
        );
      }
      return await operation(sessionPaths, record);
    } finally {
      await rm(extractionRoot, {
        force: true,
        recursive: true
      });
    }
  }

  async function readUnarchivedSessionIfPresent(sessionId, operation) {
    for (const sessionPaths of [
      paths(sessionId),
      closingSessionPaths(sessionId)
    ]) {
      if (!await pathExists(sessionPaths.manifestPath)) {
        continue;
      }
      try {
        const value = await operation(sessionPaths, null);
        if (await pathExists(sessionPaths.manifestPath)) {
          return {
            found: true,
            value
          };
        }
      } catch (error) {
        // Closing only renames the tree; its contents do not change. Retry at
        // the next location only when the manifest moved during this read.
        if (await pathExists(sessionPaths.manifestPath)) {
          throw error;
        }
      }
    }
    return {
      found: false
    };
  }

  async function withReadableSessionPaths(sessionId, operation) {
    const activePaths = paths(sessionId);
    const unarchivedRead = await readUnarchivedSessionIfPresent(sessionId, operation);
    if (unarchivedRead.found) {
      return unarchivedRead.value;
    }
    const publishedArchive = await readClosedArchiveRecord(sessionId);
    if (publishedArchive) {
      return withExtractedClosedArchive(publishedArchive, operation);
    }
    throw vibe64Error(`Unknown vibe64 session: ${activePaths.sessionId}`, "vibe64_session_not_found");
  }

  async function bumpSessionRevision(sessionPaths) {
    const manifest = await readManifestFromPaths(sessionPaths);
    const nextManifest = {
      ...manifest,
      revision: revisionNumber(manifest.revision) + 1,
      updatedAt: now().toISOString()
    };
    await writeJsonFile(sessionPaths.manifestPath, nextManifest);
    return nextManifest;
  }

  async function mutateSession(sessionId, operation) {
    const requestedPaths = paths(sessionId);
    const key = requestedPaths.sessionRoot;
    const inheritedContext = sessionMutationContext.getStore();
    if (inheritedContext?.key === key && inheritedContext.participant?.active === true) {
      const participant = beginSessionOperation(inheritedContext.lease);
      try {
        return await sessionMutationContext.run({
          key,
          lease: inheritedContext.lease,
          participant,
          sessionPaths: inheritedContext.sessionPaths
        }, () => operation(inheritedContext.sessionPaths));
      } finally {
        finishSessionOperation(inheritedContext.lease, participant);
      }
    }
    return enqueueSessionMutation(key, async () => {
      const release = await acquireSessionLock(requestedPaths, "mutation", {
        waitMs: SESSION_MUTATION_LOCK_WAIT_MS
      });
      if (!release) {
        throw vibe64Error(
          `Timed out waiting to update Vibe64 session: ${requestedPaths.sessionId}`,
          "vibe64_session_mutation_lock_timeout"
        );
      }
      try {
        // Resolve the active tree only after acquiring the stable session lock.
        // A close operation may have detached it while this writer was queued.
        const sessionPaths = await ensureActiveSessionRoot(requestedPaths.sessionId);
        const lease = createSessionOperationLease();
        const participant = beginSessionOperation(lease);
        let result;
        try {
          result = await sessionMutationContext.run({
            key,
            lease,
            participant,
            sessionPaths
          }, () => operation(sessionPaths));
        } finally {
          finishSessionOperation(lease, participant);
          await lease.idle;
        }
        const manifest = await bumpSessionRevision(sessionPaths);
        return withRevisionMarker(result, manifest, sessionPaths.sessionId);
      } finally {
        await release();
      }
    });
  }

  async function runSessionExclusive(sessionId, operationName, operation, {
    waitMs = 0
  } = {}) {
    if (typeof operation !== "function") {
      throw new TypeError("Exclusive Vibe64 session work requires an operation.");
    }
    const sessionPaths = await ensureActiveSessionRoot(sessionId);
    const lockPath = sessionLockPath(sessionPaths, operationName);
    const activeLocks = sessionExclusiveContext.getStore();
    const inheritedContext = activeLocks?.get(lockPath);
    if (inheritedContext?.participant?.active === true) {
      const participant = beginSessionOperation(inheritedContext.lease);
      const nestedLocks = new Map(activeLocks);
      nestedLocks.set(lockPath, {
        lease: inheritedContext.lease,
        participant
      });
      try {
        return {
          acquired: true,
          value: await sessionExclusiveContext.run(nestedLocks, operation)
        };
      } finally {
        finishSessionOperation(inheritedContext.lease, participant);
      }
    }
    const release = await acquireSessionLock(sessionPaths, operationName, {
      waitMs
    });
    if (!release) {
      return {
        acquired: false,
        value: null
      };
    }
    const lease = createSessionOperationLease();
    const participant = beginSessionOperation(lease);
    const nextLocks = new Map(activeLocks || []);
    nextLocks.set(lockPath, {
      lease,
      participant
    });
    try {
      return await sessionExclusiveContext.run(nextLocks, async () => ({
        acquired: true,
        value: await operation()
      }));
    } finally {
      finishSessionOperation(lease, participant);
      await lease.idle;
      await release();
    }
  }

  async function writeStatus(sessionId, status) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await writeTextFile(sessionPaths.statusPath, `${assertVibe64SessionStatus(status)}\n`);
    });
  }

  async function readStatus(sessionId) {
    return withReadableSessionPaths(sessionId, readStatusFromPaths);
  }

  async function readStatusFromPaths(sessionPaths) {
    return normalizeText(await readTextIfExists(sessionPaths.statusPath)) || VIBE64_SESSION_STATUS.ACTIVE;
  }

  async function writeMetadataValue(sessionId, name, value) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await writeTextFile(metadataFilePath(sessionPaths, name), `${normalizeText(value)}\n`);
    });
  }

  async function writeSessionLabel(sessionId, sessionLabel) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const sessionName = normalizeSessionLabel(sessionLabel);
      if (!sessionName) {
        await rm(metadataFilePath(sessionPaths, SESSION_LABEL_METADATA), {
          force: true
        });
        return "";
      }
      await writeTextFile(metadataFilePath(sessionPaths, SESSION_LABEL_METADATA), `${sessionName}\n`);
      return sessionName;
    });
  }

  async function readMetadataValue(sessionId, name) {
    return withReadableSessionPaths(sessionId, async (sessionPaths) => {
      return normalizeText(await readTextIfExists(metadataFilePath(sessionPaths, name)));
    });
  }

  async function deleteMetadataValue(sessionId, name) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await rm(metadataFilePath(sessionPaths, name), {
        force: true
      });
    });
  }

  async function deleteMetadataValues(sessionId, names = []) {
    await Promise.all(names.map((name) => deleteMetadataValue(sessionId, name)));
  }

  async function readMetadata(sessionId) {
    return withReadableSessionPaths(sessionId, readMetadataFromPaths);
  }

  async function readMetadataFromPaths(sessionPaths) {
    const names = sortedFileNames(
      await readDirectoryEntries(sessionPaths.metadataRoot),
      (name) => METADATA_NAME_PATTERN.test(name)
    );
    const metadataEntries = await Promise.all(
      names.map(async (name) => {
        return [
          name,
          normalizeText(await readTextIfExists(metadataFilePath(sessionPaths, name)))
        ];
      })
    );
    return Object.fromEntries(metadataEntries);
  }

  async function readSessionSourceDescriptor(sessionId) {
    return withReadableSessionPaths(sessionId, async (sessionPaths) => {
      const metadataEntries = await Promise.all(
        SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES.map(async (name) => [
          name,
          normalizeText(await readTextIfExists(metadataFilePath(sessionPaths, name)))
        ])
      );
      return {
        metadata: Object.fromEntries(metadataEntries),
        projectContextRoot: sessionPaths.projectContextRoot,
        sessionId: sessionPaths.sessionId,
        sessionRoot: sessionPaths.sessionRoot
      };
    });
  }

  async function sessionNameForSession(sessionPaths, metadata = {}) {
    return normalizeSessionLabel(metadata[SESSION_LABEL_METADATA]) || sessionPaths.sessionId;
  }

  async function writeArtifact(sessionId, relativePath, text) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const artifactPath = artifactFilePath(sessionPaths, relativePath);
      await writeTextFile(artifactPath, text);
      return artifactPath;
    });
  }

  async function readArtifact(sessionId, relativePath) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => {
      return readTextIfExists(artifactFilePath(sessionPaths, relativePath));
    });
  }

  async function readAgentRunFromPath(sessionPaths, runId) {
    const normalizedRunId = assertSafeAgentRunId(runId);
    const runText = await readTextIfExists(agentRunFilePath(sessionPaths, normalizedRunId));
    if (!runText) {
      return null;
    }
    try {
      const record = JSON.parse(runText);
      return isPlainObject(record)
        ? {
            ...record,
            active: vibe64AgentRunStateIsActive(record.state),
            events: Array.isArray(record.events) ? record.events.filter(isPlainObject) : [],
            id: normalizedRunId,
            state: normalizeVibe64AgentRunState(record.state)
          }
        : null;
    } catch {
      throw vibe64Error(
        `Invalid vibe64 agent run: ${normalizedRunId}`,
        "vibe64_invalid_agent_run"
      );
    }
  }

  async function readAgentRun(sessionId, runId) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => readAgentRunFromPath(sessionPaths, runId));
  }

  async function readAgentRuns(sessionId) {
    return withReadableSessionPaths(sessionId, readAgentRunsFromPaths);
  }

  async function readAgentRunsFromPaths(sessionPaths) {
    const runNames = sortedFileNames(
      await readDirectoryEntries(sessionPaths.agentRunsRoot),
      (name) => name.endsWith(".json") && isSafeAgentRunId(name.slice(0, -".json".length))
    );
    const runs = await Promise.all(runNames.map((fileName) => {
      return readAgentRunFromPath(sessionPaths, fileName.slice(0, -".json".length));
    }));
    return runs
      .filter(Boolean)
      .sort((left, right) => {
        const timeComparison = normalizeText(left.updatedAt).localeCompare(normalizeText(right.updatedAt));
        return timeComparison || normalizeText(left.id).localeCompare(normalizeText(right.id));
      });
  }

  async function writeAgentRunEvent(sessionId, runId, {
    event = {},
    patch = {}
  } = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedRunId = assertSafeAgentRunId(runId);
      const previous = await readAgentRunFromPath(sessionPaths, normalizedRunId) || {
        events: [],
        id: normalizedRunId
      };
      const eventAt = normalizeText(event.at || patch.updatedAt) || now().toISOString();
      const state = normalizeVibe64AgentRunState(patch.state || event.state || previous.state);
      const terminalState = vibe64AgentRunStateIsTerminal(state);
      const eventRecord = {
        ...event,
        at: eventAt,
        kind: normalizeText(event.kind || state || "updated"),
        message: normalizeText(event.message || patch.message),
        state
      };
      const record = {
        ...previous,
        ...patch,
        active: !terminalState,
        events: [
          ...(Array.isArray(previous.events) ? previous.events : []),
          eventRecord
        ],
        finishedAt: terminalState
          ? normalizeText(patch.finishedAt || previous.finishedAt) || eventAt
          : "",
        id: normalizedRunId,
        startedAt: normalizeText(previous.startedAt || patch.startedAt) || eventAt,
        state,
        updatedAt: eventAt
      };
      if (!terminalState && !Object.hasOwn(patch, "error")) {
        record.error = "";
      }
      await writeJsonFile(agentRunFilePath(sessionPaths, normalizedRunId), record);
      return record;
    });
  }

  async function readBackgroundTaskFromPath(sessionPaths, taskId) {
    const normalizedTaskId = assertSafeBackgroundTaskId(taskId);
    const taskText = await readTextIfExists(backgroundTaskFilePath(sessionPaths, normalizedTaskId));
    if (!taskText) {
      return null;
    }
    try {
      const record = JSON.parse(taskText);
      return isPlainObject(record)
        ? {
            ...record,
            events: Array.isArray(record.events) ? record.events.filter(isPlainObject) : [],
            id: normalizedTaskId,
            status: normalizeBackgroundTaskStatus(record.status)
          }
        : null;
    } catch {
      throw vibe64Error(
        `Invalid vibe64 background task: ${normalizedTaskId}`,
        "vibe64_invalid_background_task"
      );
    }
  }

  async function readBackgroundTask(sessionId, taskId) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => readBackgroundTaskFromPath(sessionPaths, taskId));
  }

  async function readBackgroundTasks(sessionId) {
    return withReadableSessionPaths(sessionId, readBackgroundTasksFromPaths);
  }

  async function readBackgroundTasksFromPaths(sessionPaths) {
    const taskNames = sortedFileNames(
      await readDirectoryEntries(sessionPaths.backgroundTasksRoot),
      (name) => name.endsWith(".json") && isSafeBackgroundTaskId(name.slice(0, -".json".length))
    );
    const tasks = await Promise.all(taskNames.map((fileName) => {
      return readBackgroundTaskFromPath(sessionPaths, fileName.slice(0, -".json".length));
    }));
    return tasks
      .filter(Boolean)
      .sort((left, right) => {
        const timeComparison = normalizeText(left.updatedAt).localeCompare(normalizeText(right.updatedAt));
        return timeComparison || normalizeText(left.id).localeCompare(normalizeText(right.id));
      });
  }

  async function writeBackgroundTaskEvent(sessionId, taskId, {
    event = {},
    patch = {},
    shouldWrite = null
  } = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedTaskId = assertSafeBackgroundTaskId(taskId);
      const previous = await readBackgroundTaskFromPath(sessionPaths, normalizedTaskId) || {
        events: [],
        id: normalizedTaskId
      };
      const eventAt = normalizeText(event.at || patch.updatedAt) || now().toISOString();
      const status = normalizeBackgroundTaskStatus(patch.status || event.status || previous.status);
      const previousStatus = normalizeText(previous.status);
      const eventRecord = {
        ...event,
        at: eventAt,
        kind: normalizeText(event.kind || status || "updated"),
        message: normalizeText(event.message || patch.message),
        status
      };
      if (typeof shouldWrite === "function" && !shouldWrite({
        event: eventRecord,
        patch,
        previous,
        status
      })) {
        return previous;
      }
      const record = {
        ...previous,
        ...patch,
        events: [
          ...(Array.isArray(previous.events) ? previous.events : []),
          eventRecord
        ].slice(-BACKGROUND_TASK_EVENT_LIMIT),
        finishedAt: status === BACKGROUND_TASK_STATUS.RUNNING
          ? ""
          : normalizeText(patch.finishedAt || previous.finishedAt) || eventAt,
        id: normalizedTaskId,
        kind: Object.hasOwn(patch, "kind")
          ? normalizeText(patch.kind)
          : normalizeText(eventRecord.kind || previous.kind),
        message: Object.hasOwn(patch, "message")
          ? normalizeText(patch.message)
          : Object.hasOwn(event, "message")
            ? normalizeText(event.message)
            : normalizeText(previous.message),
        startedAt: status === BACKGROUND_TASK_STATUS.RUNNING && previousStatus !== BACKGROUND_TASK_STATUS.RUNNING
          ? eventAt
          : normalizeText(patch.startedAt || previous.startedAt) || eventAt,
        status,
        updatedAt: eventAt
      };
      if (status !== BACKGROUND_TASK_STATUS.RUNNING && !Object.hasOwn(patch, "stage")) {
        delete record.stage;
      }
      if (status !== BACKGROUND_TASK_STATUS.FAILED && !Object.hasOwn(patch, "error")) {
        record.error = "";
      }
      await writeJsonFile(backgroundTaskFilePath(sessionPaths, normalizedTaskId), record);
      return record;
    });
  }

  async function readConversationMessage(sessionPaths, turnId, fileName) {
    const match = normalizeText(fileName).match(CONVERSATION_MESSAGE_FILE_PATTERN);
    if (!match) {
      return null;
    }
    const messageId = normalizeText(match[3]);
    return {
      at: isoFromConversationTimestamp(match[2]),
      role: match[1],
      text: normalizeText(await readTextIfExists(path.join(conversationTurnRoot(sessionPaths, turnId), fileName))),
      ...(messageId ? { messageId } : {})
    };
  }

  async function readConversationTurn(sessionPaths, turnId) {
    const fileNames = sortedFileNames(
      await readDirectoryEntries(conversationTurnRoot(sessionPaths, turnId)),
      (name) => CONVERSATION_MESSAGE_FILE_PATTERN.test(name)
    );
    const messages = (await Promise.all(
      fileNames.map((fileName) => readConversationMessage(sessionPaths, turnId, fileName))
    )).filter((message) => message && message.text);
    const user = messages.find((message) => message.role === "user") || null;
    const assistant = messages.find((message) => message.role === "assistant") || null;
    const commentary = messages.filter((message) => message.role === "commentary");
    const system = messages.find((message) => message.role === "system") || null;
    const thinking = messages.filter((message) => message.role === "thinking");
    const activity = [...thinking, ...commentary]
      .sort((left, right) => left.at.localeCompare(right.at));
    return {
      assistant,
      commentary,
      messages: [system, user, ...activity, assistant].filter(Boolean),
      ...(system ? { system } : {}),
      thinking,
      turnId,
      user
    };
  }

  async function conversationTurnIds(sessionPaths) {
    return sortedDirectoryNames(
      await readDirectoryEntries(sessionPaths.conversationLogRoot),
      (name) => CONVERSATION_TURN_ID_PATTERN.test(name)
    );
  }

  async function conversationMessageIdExistsFromPaths(sessionPaths, messageId = "") {
    const normalizedMessageId = normalizeText(messageId);
    if (!normalizedMessageId) {
      return false;
    }
    if (!CONVERSATION_MESSAGE_ID_PATTERN.test(normalizedMessageId)) {
      throw vibe64Error(
        `Invalid vibe64 conversation message id: ${normalizedMessageId}`,
        "vibe64_invalid_conversation_message_id"
      );
    }
    const suffix = `.${normalizedMessageId}.md`;
    const turnIds = await conversationTurnIds(sessionPaths);
    for (const turnId of [...turnIds].reverse()) {
      const entries = await readDirectoryEntries(conversationTurnRoot(sessionPaths, turnId));
      if (entries.some((entry) => (
        entry.isFile() &&
        entry.name.endsWith(suffix) &&
        CONVERSATION_MESSAGE_FILE_PATTERN.test(entry.name)
      ))) {
        return true;
      }
    }
    return false;
  }

  async function tailOpenConversationTurnId(sessionPaths) {
    const turnIds = await conversationTurnIds(sessionPaths);
    const turnId = turnIds.at(-1) || "";
    if (!turnId) {
      return "";
    }
    const turn = await readConversationTurn(sessionPaths, turnId);
    return turn.user && !turn.assistant ? turnId : "";
  }

  async function tailThinkingOnlyConversationTurnId(sessionPaths, {
    messageAt = ""
  } = {}) {
    const turnIds = await conversationTurnIds(sessionPaths);
    const turnId = turnIds.at(-1) || "";
    if (!turnId || !messageAt) {
      return "";
    }
    const turn = await readConversationTurn(sessionPaths, turnId);
    if (turn.system || turn.user || turn.assistant || turn.commentary.length || !turn.thinking.length) {
      return "";
    }
    return turn.thinking.some((message) => message.at === messageAt) ? turnId : "";
  }

  async function readConversationLog(sessionId) {
    return withReadableSessionPaths(sessionId, readConversationLogFromPaths);
  }

  async function readConversationLogFromPaths(sessionPaths) {
    const turnIds = await conversationTurnIds(sessionPaths);
    const turns = await Promise.all(turnIds.map((turnId) => readConversationTurn(sessionPaths, turnId)));
    return turns.filter(conversationTurnHasMessages);
  }

  async function readConversationLogPage(sessionId, options = {}) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => readConversationLogPageFromPaths(sessionPaths, options));
  }

  async function readConversationLogPageFromPaths(sessionPaths, options = {}) {
    const turnIds = await conversationTurnIds(sessionPaths);
    const page = conversationLogPageTurnIds(turnIds, options);
    const turns = await Promise.all(page.turnIds.map((turnId) => readConversationTurn(sessionPaths, turnId)));
    const conversationLog = turns.filter(conversationTurnHasMessages);
    return {
      conversationLog,
      pagination: {
        beforeTurnId: page.beforeTurnId,
        count: conversationLog.length,
        hasMoreBefore: page.hasMoreBefore,
        limit: page.limit,
        newestTurnId: conversationLog.at(-1)?.turnId || "",
        nextBeforeTurnId: page.hasMoreBefore ? conversationLog[0]?.turnId || page.nextBeforeTurnId : "",
        oldestTurnId: conversationLog[0]?.turnId || "",
        totalTurnCount: turnIds.length
      }
    };
  }

  function conversationLogPageTurnIds(turnIds = [], {
    beforeTurnId = "",
    limit = 0
  } = {}) {
    const ids = Array.isArray(turnIds) ? turnIds.filter((turnId) => CONVERSATION_TURN_ID_PATTERN.test(turnId)) : [];
    const normalizedBeforeTurnId = normalizeText(beforeTurnId);
    const normalizedLimit = normalizeConversationLogPageLimit(limit);
    const beforeIndex = normalizedBeforeTurnId && ids.includes(normalizedBeforeTurnId)
      ? ids.indexOf(normalizedBeforeTurnId)
      : ids.length;
    const endIndex = Math.max(0, beforeIndex);
    const startIndex = normalizedLimit > 0
      ? Math.max(0, endIndex - normalizedLimit)
      : 0;
    const pageIds = ids.slice(startIndex, endIndex);
    return {
      beforeTurnId: normalizedBeforeTurnId,
      hasMoreBefore: startIndex > 0,
      limit: normalizedLimit,
      nextBeforeTurnId: pageIds[0] || "",
      turnIds: pageIds
    };
  }

  function normalizeConversationLogPageLimit(value = 0) {
    const number = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(number) || number < 1) {
      return 0;
    }
    return Math.min(number, 100);
  }

  async function conversationMessageIdExists(sessionId, messageId = "") {
    return withReadableSessionPaths(sessionId, (sessionPaths) => (
      conversationMessageIdExistsFromPaths(sessionPaths, messageId)
    ));
  }

  async function writeConversationUserMessage(sessionId, {
    messageId = "",
    text = ""
  } = {}) {
    const messageText = normalizeText(text);
    const normalizedMessageId = normalizeText(messageId);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      if (
        normalizedMessageId &&
        await conversationMessageIdExistsFromPaths(sessionPaths, normalizedMessageId)
      ) {
        return null;
      }
      const turnId = nextConversationTurnId(await conversationTurnIds(sessionPaths));
      const createdAt = now();
      await writeTextFile(
        path.join(
          conversationTurnRoot(sessionPaths, turnId),
          conversationMessageFileName("user", createdAt, normalizedMessageId)
        ),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function writeConversationAssistantMessage(sessionId, {
    messageId = "",
    text = ""
  } = {}) {
    const messageText = normalizeText(text);
    const normalizedMessageId = normalizeText(messageId);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      if (
        normalizedMessageId &&
        await conversationMessageIdExistsFromPaths(sessionPaths, normalizedMessageId)
      ) {
        return null;
      }
      const turnId = await tailOpenConversationTurnId(sessionPaths) ||
        nextConversationTurnId(await conversationTurnIds(sessionPaths));
      const createdAt = now();
      await writeTextFile(
        path.join(
          conversationTurnRoot(sessionPaths, turnId),
          conversationMessageFileName("assistant", createdAt, normalizedMessageId)
        ),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function upsertConversationAssistantMessage(sessionId, {
    text = "",
    turnId = ""
  } = {}) {
    const messageText = normalizeText(text);
    const normalizedTurnId = normalizeText(turnId);
    if (!messageText) {
      return null;
    }
    if (!CONVERSATION_TURN_ID_PATTERN.test(normalizedTurnId)) {
      throw vibe64Error(
        `Invalid vibe64 conversation turn id: ${normalizedTurnId || "(empty)"}`,
        "vibe64_invalid_conversation_turn_id"
      );
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      const turnRoot = conversationTurnRoot(sessionPaths, normalizedTurnId);
      const assistantFiles = sortedFileNames(
        await readDirectoryEntries(turnRoot),
        (name) => name.startsWith("assistant.") && CONVERSATION_MESSAGE_FILE_PATTERN.test(name)
      );
      const assistantFile = assistantFiles[0] || conversationMessageFileName("assistant", now());
      await writeTextFile(path.join(turnRoot, assistantFile), `${messageText}\n`);
      await Promise.all(assistantFiles.slice(1).map((fileName) => rm(path.join(turnRoot, fileName), {
        force: true
      })));
      return readConversationTurn(sessionPaths, normalizedTurnId);
    });
  }

  async function writeConversationActivityMessage(sessionId, role, {
    at = "",
    messageId = "",
    requireOpenTurn = false,
    text = ""
  } = {}) {
    if (!CONVERSATION_ACTIVITY_ROLES.has(role)) {
      throw vibe64Error(
        `Invalid vibe64 conversation activity role: ${role || "(empty)"}`,
        "vibe64_invalid_conversation_role"
      );
    }
    const messageText = normalizeText(text);
    const normalizedMessageId = normalizeText(messageId);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      if (
        normalizedMessageId &&
        await conversationMessageIdExistsFromPaths(sessionPaths, normalizedMessageId)
      ) {
        return null;
      }
      const createdAt = at ? toDate(at) : now();
      const openTurnId = await tailOpenConversationTurnId(sessionPaths);
      if (requireOpenTurn && !openTurnId) {
        return null;
      }
      const thinkingOnlyTurnId = role === "thinking" && !openTurnId
        ? await tailThinkingOnlyConversationTurnId(sessionPaths, {
            messageAt: at ? createdAt.toISOString() : ""
          })
        : "";
      const turnId = openTurnId || thinkingOnlyTurnId || nextConversationTurnId(await conversationTurnIds(sessionPaths));
      await writeTextFile(
        path.join(
          conversationTurnRoot(sessionPaths, turnId),
          conversationMessageFileName(role, createdAt, normalizedMessageId)
        ),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function writeConversationCommentaryMessage(sessionId, options = {}) {
    return writeConversationActivityMessage(sessionId, "commentary", options);
  }

  async function writeConversationThinkingMessage(sessionId, options = {}) {
    return writeConversationActivityMessage(sessionId, "thinking", options);
  }

  async function writeConversationSystemMessage(sessionId, {
    messageId = "",
    text = ""
  } = {}) {
    const messageText = normalizeText(text);
    const normalizedMessageId = normalizeText(messageId);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      if (
        normalizedMessageId &&
        await conversationMessageIdExistsFromPaths(sessionPaths, normalizedMessageId)
      ) {
        return null;
      }
      const turnId = nextConversationTurnId(await conversationTurnIds(sessionPaths));
      const createdAt = now();
      await writeTextFile(
        path.join(
          conversationTurnRoot(sessionPaths, turnId),
          conversationMessageFileName("system", createdAt, normalizedMessageId)
        ),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function readManifest(sessionId) {
    return withReadableSessionPaths(sessionId, readManifestFromPaths);
  }

  async function readManifestFromPaths(sessionPaths) {
    const manifestText = await readTextIfExists(sessionPaths.manifestPath);
    try {
      return normalizeManifest(JSON.parse(manifestText));
    } catch {
      throw vibe64Error(`Invalid vibe64 session manifest: ${sessionPaths.sessionId}`, "vibe64_invalid_manifest");
    }
  }

  async function readSession(sessionId) {
    return withReadableSessionPaths(sessionId, readSessionFromPaths);
  }

  async function readSessionFromPaths(sessionPaths, archiveRecord = null) {
    const [
      manifest,
      status,
      metadata,
      agentRuns,
      backgroundTasks
    ] = await Promise.all([
      readManifestFromPaths(sessionPaths),
      readStatusFromPaths(sessionPaths),
      readMetadataFromPaths(sessionPaths),
      readAgentRunsFromPaths(sessionPaths),
      readBackgroundTasksFromPaths(sessionPaths)
    ]);
    const archived = Boolean(archiveRecord);
    const sessionName = await sessionNameForSession(sessionPaths, metadata);
    return {
      agentRuns,
      agentRunsRoot: archived ? "" : sessionPaths.agentRunsRoot,
      artifactsRoot: archived ? "" : sessionPaths.artifactsRoot,
      backgroundTasks,
      backgroundTasksRoot: archived ? "" : sessionPaths.backgroundTasksRoot,
      conversationLogRoot: archived ? "" : sessionPaths.conversationLogRoot,
      manifest,
      metadata,
      metadataRoot: archived ? "" : sessionPaths.metadataRoot,
      projectContextRoot: sessionPaths.projectContextRoot,
      revision: revisionNumber(manifest.revision),
      sessionId: sessionPaths.sessionId,
      sessionName,
      sessionRoot: archived ? "" : sessionPaths.sessionRoot,
      stateRoot: sessionPaths.stateRoot,
      status,
      updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt),
      ...(archived
        ? {
            archivePath: archiveRecord.archivePath,
            archiveStatus: archiveRecord.status,
            archived: true,
            archivedAt: normalizeText(archiveRecord.archivedAt),
            archiveMetadataPath: archiveRecord.metadataPath
          }
        : {})
    };
  }

  async function readSessionSummary(sessionId) {
    const activePaths = paths(sessionId);
    const unarchivedRead = await readUnarchivedSessionIfPresent(
      sessionId,
      readSessionSummaryFromPaths
    );
    if (unarchivedRead.found) {
      return unarchivedRead.value;
    }
    const publishedArchive = await readClosedArchiveRecord(sessionId);
    if (publishedArchive) {
      return closedArchiveSummary(publishedArchive);
    }
    throw vibe64Error(`Unknown vibe64 session: ${activePaths.sessionId}`, "vibe64_session_not_found");
  }

  async function readSessionSummaryFromPaths(sessionPaths) {
    const [
      manifest,
      status,
      metadata
    ] = await Promise.all([
      readManifestFromPaths(sessionPaths),
      readStatusFromPaths(sessionPaths),
      readMetadataFromPaths(sessionPaths)
    ]);
    const sessionName = await sessionNameForSession(sessionPaths, metadata);
    return {
      createdAt: normalizeText(manifest.createdAt),
      manifest: {
        createdAt: normalizeText(manifest.createdAt),
        revision: revisionNumber(manifest.revision),
        runtimeKind: normalizeText(manifest.runtimeKind),
        updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt)
      },
      metadata,
      projectContextRoot: sessionPaths.projectContextRoot,
      revision: revisionNumber(manifest.revision),
      sessionId: sessionPaths.sessionId,
      sessionName,
      sessionRoot: sessionPaths.sessionRoot,
      stateRoot: sessionPaths.stateRoot,
      status,
      updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt)
    };
  }

  async function validateClosedSessionArchive(archivePath) {
    const result = await runCommand("tar", [
      "-tzf",
      archivePath
    ], {
      cwd: path.dirname(archivePath)
    });
    if (!result.ok) {
      throw vibe64Error(
        `Invalid closed Vibe64 session archive ${archivePath}: ${result.output}`,
        "vibe64_closed_session_archive_invalid"
      );
    }
  }

  async function requireClosedArchiveRecord(rootPaths, status, sessionId) {
    const record = await readClosedArchiveRecordForStatus(rootPaths, status, sessionId);
    if (!record) {
      throw vibe64Error(
        `Closed Vibe64 session archive is incomplete for ${sessionId}.`,
        "vibe64_closed_session_archive_incomplete"
      );
    }
    return record;
  }

  async function moveActiveSessionToClosing(activePaths, closingPaths) {
    const moveSessionRoot = async () => {
      await mkdir(activePaths.closingSessionsRoot, {
        recursive: true
      });
      await rename(activePaths.sessionRoot, closingPaths.sessionRoot);
    };
    if (!activePaths.currentSessionAliasPath) {
      return moveSessionRoot();
    }
    return enqueueSessionMutation(activePaths.currentSessionAliasPath, async () => {
      await moveSessionRoot();
      await clearVibe64CurrentSessionAliasIfMatches({
        aliasPath: activePaths.currentSessionAliasPath,
        sessionId: activePaths.sessionId
      });
    });
  }

  async function clearClosingSessionAlias(sessionPaths) {
    if (!sessionPaths.currentSessionAliasPath) {
      return;
    }
    await enqueueSessionMutation(sessionPaths.currentSessionAliasPath, () => (
      clearVibe64CurrentSessionAliasIfMatches({
        aliasPath: sessionPaths.currentSessionAliasPath,
        sessionId: sessionPaths.sessionId
      })
    ));
  }

  async function detachClosedSessionForArchive(sessionId) {
    const activePaths = paths(sessionId);
    const closingPaths = closingSessionPaths(activePaths.sessionId);
    const mutationKey = activePaths.sessionRoot;
    const mutationContext = sessionMutationContext.getStore();
    if (
      mutationContext?.key === mutationKey &&
      mutationContext.participant?.active === true
    ) {
      throw vibe64Error(
        `Cannot compact Vibe64 session during an active mutation: ${activePaths.sessionId}`,
        "vibe64_session_compact_during_mutation"
      );
    }
    return enqueueSessionMutation(mutationKey, async () => {
      const release = await acquireSessionLock(activePaths, "mutation", {
        waitMs: SESSION_MUTATION_LOCK_WAIT_MS
      });
      if (!release) {
        throw vibe64Error(
          `Timed out waiting to close Vibe64 session: ${activePaths.sessionId}`,
          "vibe64_session_mutation_lock_timeout"
        );
      }
      try {
        const [activeExists, closingExists] = await Promise.all([
          pathExists(activePaths.manifestPath),
          pathExists(closingPaths.manifestPath)
        ]);
        if (activeExists && closingExists) {
          throw vibe64Error(
            `Vibe64 session exists in both active and closing state: ${activePaths.sessionId}`,
            "vibe64_session_close_state_conflict"
          );
        }
        if (closingExists) {
          await clearClosingSessionAlias(closingPaths);
          return;
        }
        if (!activeExists) {
          if (await readClosedArchiveRecord(activePaths.sessionId)) {
            return;
          }
          throw vibe64Error(
            `Unknown vibe64 session: ${activePaths.sessionId}`,
            "vibe64_session_not_found"
          );
        }
        const status = await readStatusFromPaths(activePaths);
        if (!CLOSED_VIBE64_SESSION_STATUSES.has(status)) {
          throw vibe64Error(
            `Cannot compact open Vibe64 session ${activePaths.sessionId} with status ${status}.`,
            "vibe64_session_compact_open_status"
          );
        }

        // Compression must never observe a mutable live tree. The atomic rename
        // is the close barrier: earlier writers are included, and later writers
        // re-check the active namespace after acquiring this same lock.
        await moveActiveSessionToClosing(activePaths, closingPaths);
      } finally {
        await release();
      }
    });
  }

  async function runSessionArchiveExclusive(sessionId, operation) {
    const sessionPaths = paths(sessionId);
    const archiveLockPath = sessionLockPath(sessionPaths, "archive");
    return enqueueSessionMutation(archiveLockPath, async () => {
      const release = await acquireSessionLock(sessionPaths, "archive", {
        waitMs: SESSION_MUTATION_LOCK_WAIT_MS
      });
      if (!release) {
        throw vibe64Error(
          `Timed out waiting to archive Vibe64 session: ${sessionPaths.sessionId}`,
          "vibe64_session_archive_lock_timeout"
        );
      }
      try {
        return await operation();
      } finally {
        await release();
      }
    });
  }

  async function compactClosedSession(sessionId) {
    // Detachment is the close barrier. Queue it before any archive work so a
    // later writer can never overtake finalisation, even while another process
    // is publishing the archive.
    await detachClosedSessionForArchive(sessionId);
    return runSessionArchiveExclusive(
      sessionId,
      () => compactClosedSessionExclusive(sessionId)
    );
  }

  async function compactClosedSessionExclusive(sessionId) {
    const rootPaths = paths();
    const sessionPaths = closingSessionPaths(sessionId);
    if (!await pathExists(sessionPaths.manifestPath)) {
      const archiveRecord = await readClosedArchiveRecord(sessionId);
      if (!archiveRecord) {
        throw vibe64Error(
          `Unknown vibe64 session: ${assertValidVibe64SessionId(sessionId)}`,
          "vibe64_session_not_found"
        );
      }
      await validateClosedSessionArchive(archiveRecord.archivePath);
      return archiveRecord;
    }
    const status = await readStatusFromPaths(sessionPaths);
    if (!CLOSED_VIBE64_SESSION_STATUSES.has(status)) {
      throw vibe64Error(
        `Cannot compact open Vibe64 session ${sessionPaths.sessionId} with status ${status}.`,
        "vibe64_session_compact_open_status"
      );
    }

    const finalArchivePath = closedSessionArchivePath(rootPaths, status, sessionPaths.sessionId);
    const finalMetadataPath = closedSessionMetadataPath(rootPaths, status, sessionPaths.sessionId);
    const finalArchiveExists = await pathExists(finalArchivePath);
    const finalMetadataExists = await pathExists(finalMetadataPath);
    if (finalArchiveExists && finalMetadataExists) {
      const archiveRecord = await requireClosedArchiveRecord(
        rootPaths,
        status,
        sessionPaths.sessionId
      );
      await validateClosedSessionArchive(archiveRecord.archivePath);
      await rm(sessionPaths.sessionRoot, {
        force: true,
        recursive: true
      });
      return archiveRecord;
    }
    if (finalArchiveExists || finalMetadataExists) {
      // The closing tree is the durable source of truth until both published
      // files exist. A process interruption between the two renames is retried
      // from that immutable tree instead of stranding a half-closed session.
      await Promise.all([
        rm(finalArchivePath, {
          force: true
        }),
        rm(finalMetadataPath, {
          force: true
        })
      ]);
    }

    const stagedRoot = path.join(closedSessionStagingRoot(rootPaths), `${sessionPaths.sessionId}-${randomUUID()}`);
    const stagedArchivePath = path.join(stagedRoot, `${sessionPaths.sessionId}.tar.gz`);
    const stagedMetadataPath = path.join(stagedRoot, `${sessionPaths.sessionId}.json`);
    const archivedAt = now().toISOString();
    const summary = await readSessionSummaryFromPaths(sessionPaths);
    const metadataRecord = closedArchiveMetadataRecord({
      archivePath: finalArchivePath,
      archivedAt,
      metadataPath: finalMetadataPath,
      sessionId: sessionPaths.sessionId,
      status,
      summary
    });
    let archiveFinalized = false;
    let metadataFinalized = false;
    try {
      await mkdir(stagedRoot, {
        recursive: true
      });
      const tarResult = await runCommand("tar", [
        "-czf",
        stagedArchivePath,
        "-C",
        rootPaths.closingSessionsRoot,
        sessionPaths.sessionId
      ], {
        allowedRoots: [
          stagedRoot
        ],
        cwd: rootPaths.closingSessionsRoot
      });
      if (!tarResult.ok) {
        throw vibe64Error(
          `Cannot compact Vibe64 session ${sessionPaths.sessionId}: ${tarResult.output}`,
          "vibe64_closed_session_archive_write_failed"
        );
      }
      await validateClosedSessionArchive(stagedArchivePath);
      await writeJsonFile(stagedMetadataPath, metadataRecord);
      await mkdir(path.dirname(finalArchivePath), {
        recursive: true
      });
      await rename(stagedArchivePath, finalArchivePath);
      archiveFinalized = true;
      await rename(stagedMetadataPath, finalMetadataPath);
      metadataFinalized = true;
      const archiveRecord = await requireClosedArchiveRecord(
        rootPaths,
        status,
        sessionPaths.sessionId
      );
      await rm(sessionPaths.sessionRoot, {
        force: true,
        recursive: true
      });
      return archiveRecord;
    } catch (error) {
      if (!metadataFinalized) {
        await rm(stagedMetadataPath, {
          force: true
        });
      }
      if (!archiveFinalized) {
        await rm(stagedArchivePath, {
          force: true
        });
      }
      if (archiveFinalized && !metadataFinalized) {
        await rm(finalArchivePath, {
          force: true
        });
      }
      throw error;
    } finally {
      await rm(stagedRoot, {
        force: true,
        recursive: true
      });
    }
  }

  async function updateCurrentSession(sessionId = "") {
    const selectedSessionId = normalizeText(sessionId);
    const rootPaths = paths();
    if (!rootPaths.currentSessionAliasPath) {
      throw vibe64Error(
        "Updating the current Vibe64 session requires projectSessionSourceRoot.",
        "vibe64_project_session_source_root_required"
      );
    }
    return enqueueSessionMutation(rootPaths.currentSessionAliasPath, async () => {
      if (selectedSessionId) {
        await ensureActiveSessionRoot(selectedSessionId);
      }
      await updateVibe64CurrentSessionAlias({
        aliasPath: rootPaths.currentSessionAliasPath,
        sessionId: selectedSessionId
      });
      return {
        sessionId: selectedSessionId
      };
    });
  }

  async function readCurrentSession() {
    const rootPaths = paths();
    if (!rootPaths.currentSessionAliasPath) {
      return null;
    }
    const sessionId = await readVibe64CurrentSessionAlias({
      aliasPath: rootPaths.currentSessionAliasPath
    });
    return sessionId ? readSession(assertValidVibe64SessionId(sessionId)) : null;
  }

  async function createSession({
    metadata = {},
    runtimeKind = "",
    sessionId = "",
    status = VIBE64_SESSION_STATUS.ACTIVE
  } = {}) {
    const normalizedMetadata = Object.fromEntries(
      Object.entries(metadata).map(([name, value]) => [assertSafeMetadataName(name), normalizeText(value)])
    );
    const normalizedStatus = assertVibe64SessionStatus(status);
    const rootPaths = paths();
    await mkdir(rootPaths.activeSessionsRoot, {
      recursive: true
    });
    const createdAt = now().toISOString();
    const resolvedSessionId = sessionId
      ? assertValidVibe64SessionId(sessionId)
      : await createAvailableSessionId(rootPaths, createdAt);
    const sessionPaths = paths(resolvedSessionId);
    if (await sessionRecordExists(rootPaths, resolvedSessionId)) {
      throw vibe64Error(`Vibe64 session already exists: ${resolvedSessionId}`, "vibe64_session_exists");
    }
    try {
      await mkdir(sessionPaths.sessionRoot);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw vibe64Error(`Vibe64 session already exists: ${resolvedSessionId}`, "vibe64_session_exists");
      }
      throw error;
    }
    await Promise.all([
      mkdir(sessionPaths.agentRunsRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.artifactsRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.backgroundTasksRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.metadataRoot, {
        recursive: true
      })
    ]);
    const normalizedRuntimeKind = normalizeText(runtimeKind);
    const manifest = {
      ...(normalizedRuntimeKind ? { runtimeKind: normalizedRuntimeKind } : {}),
      createdAt,
      product: "vibe64",
      revision: 1,
      schemaVersion: VIBE64_SESSION_SCHEMA_VERSION,
      sessionId: resolvedSessionId,
      updatedAt: createdAt
    };
    await Promise.all([
      writeJsonFile(sessionPaths.manifestPath, manifest),
      writeTextFile(sessionPaths.statusPath, `${normalizedStatus}\n`),
      ...Object.entries(normalizedMetadata).map(([name, value]) => {
        return writeTextFile(metadataFilePath(sessionPaths, name), `${value}\n`);
      })
    ]);
    return readSession(resolvedSessionId);
  }

  async function readUnarchivedSessionRecords() {
    const rootPaths = paths();
    const [activeEntries, closingEntries] = await Promise.all([
      readDirectoryEntries(rootPaths.activeSessionsRoot),
      readDirectoryEntries(rootPaths.closingSessionsRoot)
    ]);
    const activeSessionIds = sortedDirectoryNames(activeEntries, isValidVibe64SessionId);
    const closingSessionIds = sortedDirectoryNames(closingEntries, isValidVibe64SessionId);
    const sessionIds = [...new Set([
      ...activeSessionIds,
      ...closingSessionIds
    ])].sort((left, right) => left.localeCompare(right));
    return Promise.all(sessionIds.map(async (sessionId) => ({
      sessionId,
      status: await readStatus(sessionId)
    })));
  }

  async function sessionRecordsForList(options = {}) {
    const listOptions = normalizeSessionListOptions(options);
    let unarchivedRecords = await readUnarchivedSessionRecords();
    if (sessionListMayIncludeClosed(listOptions)) {
      // A process can stop after recording the terminal status but before
      // publishing the archive. Closed-session reads are the recovery boundary.
      for (const record of unarchivedRecords) {
        if (CLOSED_VIBE64_SESSION_STATUSES.has(record.status)) {
          await compactClosedSession(record.sessionId);
        }
      }
      unarchivedRecords = unarchivedRecords.filter((record) => (
        !CLOSED_VIBE64_SESSION_STATUSES.has(record.status)
      ));
    }
    unarchivedRecords = unarchivedRecords.filter(({ status }) => (
      sessionStatusMatchesListOptions(status, listOptions)
    ));
    const unarchivedSessionIds = new Set(unarchivedRecords.map((record) => record.sessionId));
    const archivedRecords = (await readClosedArchiveRecords())
      .filter((record) => !unarchivedSessionIds.has(record.sessionId))
      .filter((record) => sessionStatusMatchesListOptions(record.status, listOptions));
    return {
      archivedRecords,
      unarchivedRecords
    };
  }

  async function listSessions(options = {}) {
    const {
      archivedRecords,
      unarchivedRecords
    } = await sessionRecordsForList(options);
    const sessionIds = [
      ...unarchivedRecords.map((record) => record.sessionId),
      ...archivedRecords.map((record) => record.sessionId)
    ].sort((left, right) => left.localeCompare(right));
    return Promise.all(sessionIds.map((entrySessionId) => readSession(entrySessionId)));
  }

  async function listSessionSummaries(options = {}) {
    const {
      archivedRecords,
      unarchivedRecords
    } = await sessionRecordsForList(options);
    const unarchivedSummaries = await Promise.all(unarchivedRecords.map((record) => (
      readSessionSummary(record.sessionId)
    )));
    return [
      ...unarchivedSummaries,
      ...archivedRecords.map(closedArchiveSummary)
    ].sort((left, right) => normalizeText(left.sessionId).localeCompare(normalizeText(right.sessionId)));
  }

  return {
    createSession,
    compactClosedSession,
    conversationMessageIdExists,
    deleteMetadataValue,
    deleteMetadataValues,
    listSessions,
    listSessionSummaries,
    mutateSession,
    paths,
    readArtifact,
    readAgentRun,
    readAgentRuns,
    readBackgroundTask,
    readBackgroundTasks,
    readConversationLog,
    readConversationLogPage,
    readCurrentSession,
    readManifest,
    readMetadata,
    readMetadataValue,
    readSession,
    readSessionSourceDescriptor,
    readSessionSummary,
    readStatus,
    runSessionExclusive,
    updateCurrentSession,
    writeArtifact,
    writeAgentRunEvent,
    writeBackgroundTaskEvent,
    upsertConversationAssistantMessage,
    writeConversationAssistantMessage,
    writeConversationCommentaryMessage,
    writeConversationSystemMessage,
    writeConversationThinkingMessage,
    writeConversationUserMessage,
    writeMetadataValue,
    writeSessionLabel,
    writeStatus
  };
}

export {
  VIBE64_AGENT_RUN_STATE,
  VIBE64_SESSION_SCHEMA_VERSION,
  VIBE64_SESSION_STATUS,
  assertVibe64SessionStatus,
  assertValidVibe64SessionId,
  createVibe64SessionStore,
  isValidVibe64SessionId,
  normalizeVibe64AgentRunState,
  resolveVibe64SessionPaths,
  vibe64AgentRunStateIsActive,
  vibe64AgentRunStateIsTerminal
};
