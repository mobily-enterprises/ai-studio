import path from "node:path";
import { mkdir } from "node:fs/promises";

import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
  targetSessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  runVibe64Command
} from "@local/vibe64-execution/server";

const SESSION_BRANCH_PREFIX = "vibe64/";

function sourceError(message = "", code = "vibe64_session_source_failed") {
  return vibe64Error(message || "Vibe64 could not create the session source.", code);
}

async function runGit(cwd = "", args = [], allowedRoots = []) {
  const result = await runVibe64Command({
    actor: "daemon",
    allowedRoots,
    args,
    command: "git",
    cwd,
    envPolicy: "project",
    gitSafeDirectories: allowedRoots,
    mode: "capture",
    purpose: "source",
    runtimes: ["git"],
    timeout: 60_000
  });
  if (result?.ok !== true) {
    throw sourceError(
      normalizeText(result?.stderr || result?.output || result?.error) || "Git command failed while creating the session source.",
      normalizeText(result?.code) || "vibe64_session_source_git_failed"
    );
  }
  return normalizeText(result.stdout || result.output);
}

async function optionalGitOutput(cwd = "", args = [], allowedRoots = []) {
  try {
    return await runGit(cwd, args, allowedRoots);
  } catch {
    return "";
  }
}

async function ensureProjectBaseline(targetRoot = "") {
  const roots = [targetRoot];
  const gitDirectory = await optionalGitOutput(targetRoot, ["rev-parse", "--git-dir"], roots);
  if (!gitDirectory) {
    await runGit(targetRoot, ["init", "--initial-branch=main"], roots);
  }
  let branch = await optionalGitOutput(targetRoot, ["branch", "--show-current"], roots) || "main";
  let commit = await optionalGitOutput(targetRoot, ["rev-parse", "--verify", "HEAD"], roots);
  if (!commit) {
    await runGit(targetRoot, ["add", "-A"], roots);
    await runGit(targetRoot, [
      "-c", "user.name=Vibe64",
      "-c", "user.email=vibe64@localhost",
      "commit", "--allow-empty", "-m", "Initial commit"
    ], roots);
    commit = await runGit(targetRoot, ["rev-parse", "--verify", "HEAD"], roots);
    branch = await optionalGitOutput(targetRoot, ["branch", "--show-current"], roots) || branch;
  }
  const dirty = await runGit(targetRoot, ["status", "--porcelain"], roots);
  if (dirty) {
    throw sourceError(
      "The project source has uncommitted changes. Save or discard them before starting a session so its source has an exact Git baseline.",
      "vibe64_session_source_project_dirty"
    );
  }
  return {
    branch,
    commit,
    remoteUrl: await optionalGitOutput(targetRoot, ["remote", "get-url", "origin"], roots)
  };
}

async function attachSessionSource(store, sessionId = "", metadata = {}) {
  const write = async () => {
    await Promise.all(Object.entries(metadata).map(([name, value]) => (
      store.writeMetadataValue(sessionId, name, value)
    )));
  };
  return typeof store.mutateSession === "function"
    ? store.mutateSession(sessionId, write)
    : write();
}

async function createSessionSource({
  runtime,
  session = {},
  store
} = {}) {
  const sessionId = normalizeText(session.sessionId || session.id);
  const targetRoot = normalizeText(runtime?.targetRoot || session.targetRoot);
  const sourceRoot = normalizeText(runtime?.projectSessionSourceRoot);
  if (!sessionId || !targetRoot || !sourceRoot || !store) {
    throw sourceError(
      "Session source creation requires a session id, project root, managed source root, and session store.",
      "vibe64_session_source_context_missing"
    );
  }
  if (!path.isAbsolute(targetRoot) || !path.isAbsolute(sourceRoot)) {
    throw sourceError(
      "Session source creation requires absolute project and managed source paths.",
      "vibe64_session_source_path_invalid"
    );
  }
  if (!await pathExists(targetRoot)) {
    throw sourceError(
      `Project source does not exist: ${targetRoot}`,
      "vibe64_session_source_project_missing"
    );
  }

  const sourcePath = targetSessionSourcePath(sourceRoot, sessionId);
  const sourceParent = path.dirname(sourcePath);
  const branch = `${SESSION_BRANCH_PREFIX}${sessionId}`;
  const baseline = await ensureProjectBaseline(targetRoot);
  await mkdir(sourceParent, {
    recursive: true
  });

  const sourceRoots = [targetRoot, sourceParent, sourcePath];
  const existingTopLevel = await optionalGitOutput(sourcePath, ["rev-parse", "--show-toplevel"], sourceRoots);
  if (existingTopLevel && path.resolve(existingTopLevel) !== path.resolve(sourcePath)) {
    throw sourceError(
      `Session source path is already owned by another Git repository: ${sourcePath}`,
      "vibe64_session_source_path_conflict"
    );
  }
  if (!existingTopLevel) {
    await runGit(sourceParent, [
      "clone",
      "--no-hardlinks",
      "--single-branch",
      "--branch", baseline.branch,
      targetRoot,
      sourcePath
    ], sourceRoots);
  }
  await runGit(sourcePath, ["checkout", "-B", branch, baseline.commit], sourceRoots);
  if (baseline.remoteUrl) {
    await runGit(sourcePath, ["remote", "set-url", "origin", baseline.remoteUrl], sourceRoots);
  }
  await attachSessionSource(store, sessionId, {
    base_branch: baseline.branch,
    base_commit: baseline.commit,
    branch,
    main_checkout_root: targetRoot,
    source_default_branch: baseline.branch,
    source_kind: "session_clone",
    source_path: sourcePath,
    source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
    source_remote_url: baseline.remoteUrl
  });
  return {
    branch,
    commit: baseline.commit,
    ok: true,
    sourcePath
  };
}

export {
  createSessionSource
};
