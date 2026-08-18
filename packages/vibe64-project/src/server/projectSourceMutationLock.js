import crypto from "node:crypto";
import process from "node:process";
import path from "node:path";
import {
  mkdir,
  open,
  readFile,
  rm,
  stat
} from "node:fs/promises";

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const LOCK_POLL_MS = 40;

function text(value = "") {
  return String(value || "").trim();
}

function lockError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function lockOwner(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

async function removeStaleLock(lockPath) {
  const [owner, details] = await Promise.all([
    lockOwner(lockPath),
    stat(lockPath).catch(() => null)
  ]);
  if (!details) {
    return true;
  }
  if (owner && processAlive(Number(owner.pid))) {
    return false;
  }
  const staleForMs = Date.now() - details.mtimeMs;
  if (owner || staleForMs >= DEFAULT_LOCK_TIMEOUT_MS) {
    await rm(lockPath, { force: true });
    return true;
  }
  return false;
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function acquireProjectSourceMutationLock(projectRuntimeRoot, {
  operation = "project-source-mutation",
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS
} = {}) {
  const root = text(projectRuntimeRoot);
  if (!path.isAbsolute(root)) {
    throw lockError(
      "Project source mutation locking requires an absolute project runtime root.",
      "vibe64_project_source_lock_root_invalid"
    );
  }
  const lockRoot = path.join(root, "locks");
  const lockPath = path.join(lockRoot, "source-mutation.lock");
  await mkdir(lockRoot, { recursive: true, mode: 0o2770 });
  const token = crypto.randomUUID();
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || DEFAULT_LOCK_TIMEOUT_MS);
  while (Date.now() <= deadline) {
    let handle;
    try {
      handle = await open(lockPath, "wx", 0o660);
      await handle.writeFile(`${JSON.stringify({
        operation: text(operation),
        pid: process.pid,
        token
      })}\n`, "utf8");
      await handle.close();
      return {
        lockPath,
        token
      };
    } catch (error) {
      await handle?.close().catch(() => null);
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (!await removeStaleLock(lockPath)) {
        await sleep(LOCK_POLL_MS);
      }
    }
  }
  throw lockError(
    "Another project source operation is still running.",
    "vibe64_project_source_lock_timeout"
  );
}

async function releaseProjectSourceMutationLock(lock = {}) {
  const owner = await lockOwner(lock.lockPath);
  if (owner?.token === lock.token && owner?.pid === process.pid) {
    await rm(lock.lockPath, { force: true });
    return true;
  }
  return false;
}

async function runProjectSourceExclusive(projectRuntimeRoot, operation, options = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("runProjectSourceExclusive requires an operation.");
  }
  const lock = await acquireProjectSourceMutationLock(projectRuntimeRoot, options);
  try {
    return await operation();
  } finally {
    await releaseProjectSourceMutationLock(lock);
  }
}

export {
  acquireProjectSourceMutationLock,
  releaseProjectSourceMutationLock,
  runProjectSourceExclusive
};
