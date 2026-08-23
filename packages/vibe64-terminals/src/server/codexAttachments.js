import crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  stableHash
} from "./terminalShared.js";
import {
  targetRuntimeIdentity
} from "@local/vibe64-core/server/projectRuntimeIdentity";
import {
  CODEX_ATTACHMENT_HOST_ROOT,
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
const CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES = Number.MAX_SAFE_INTEGER;
const ATTACHMENT_TTL_MS = 30 * 60 * 1000;
const attachmentCleanupTimers = new Map();

function attachmentSessionKey(executionRoot, sessionId) {
  return path.join(stableHash(targetRuntimeIdentity(executionRoot)), stableHash(sessionId));
}

function attachmentHostDirectory(executionRoot, sessionId, attachmentId = "") {
  const parts = [
    codexAttachmentHostRoot(),
    ...attachmentSessionKey(executionRoot, sessionId).split(path.sep)
  ];
  if (attachmentId) {
    parts.push(attachmentId);
  }
  return path.join(...parts);
}

function sanitizeAttachmentFileName(fileName = "") {
  const baseName = path.basename(String(fileName || "attachment").replaceAll("\\", "/"));
  const sanitized = baseName
    .replace(/[^\w .@+-]/gu, "_")
    .replace(/^\.+/u, "")
    .trim()
    .slice(0, 160);
  return sanitized || "attachment";
}

function decodeAttachmentData(value = "") {
  const raw = String(value || "").trim();
  const data = raw.includes(",") && /^data:[^,]+;base64,/iu.test(raw)
    ? raw.slice(raw.indexOf(",") + 1)
    : raw;
  const normalized = data.replace(/\s/gu, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    return null;
  }
  return Buffer.from(normalized, "base64");
}

async function cleanupCodexAttachments(executionRoot, sessionId, attachmentId = "") {
  const cleanupPath = attachmentId
    ? attachmentHostDirectory(executionRoot, sessionId, attachmentId)
    : attachmentHostDirectory(executionRoot, sessionId);
  const timerKey = `${stableHash(targetRuntimeIdentity(executionRoot))}:${stableHash(sessionId)}:${attachmentId}`;
  const timer = attachmentCleanupTimers.get(timerKey);
  if (timer) {
    clearTimeout(timer);
    attachmentCleanupTimers.delete(timerKey);
  }
  await rm(cleanupPath, {
    force: true,
    recursive: true
  });
}

function scheduleAttachmentCleanup(executionRoot, sessionId, attachmentId) {
  const timerKey = `${stableHash(targetRuntimeIdentity(executionRoot))}:${stableHash(sessionId)}:${attachmentId}`;
  const existingTimer = attachmentCleanupTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    attachmentCleanupTimers.delete(timerKey);
    void cleanupCodexAttachments(executionRoot, sessionId, attachmentId);
  }, ATTACHMENT_TTL_MS);
  timer.unref?.();
  attachmentCleanupTimers.set(timerKey, timer);
}

async function storeCodexAttachment({
  input = {},
  sessionId = "",
  executionRoot = ""
} = {}) {
  const fileName = sanitizeAttachmentFileName(input?.fileName);
  const data = decodeAttachmentData(input?.dataBase64);
  if (!data || data.length < 1) {
    return {
      ok: false,
      error: "Attachment data is invalid."
    };
  }

  const attachmentId = crypto.randomUUID();
  const hostDirectory = attachmentHostDirectory(executionRoot, sessionId, attachmentId);
  const hostPath = path.join(hostDirectory, fileName);
  await mkdir(hostDirectory, {
    recursive: true
  });
  await writeFile(hostPath, data);
  scheduleAttachmentCleanup(executionRoot, sessionId, attachmentId);

  return {
    ok: true,
    attachmentId,
    path: hostPath,
    contentType: String(input?.contentType || ""),
    expiresInMs: ATTACHMENT_TTL_MS,
    fileName,
    size: data.length
  };
}

export {
  CODEX_ATTACHMENT_HOST_ROOT,
  CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES,
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  cleanupCodexAttachments,
  prepareCodexAttachmentRoot,
  storeCodexAttachment
};
