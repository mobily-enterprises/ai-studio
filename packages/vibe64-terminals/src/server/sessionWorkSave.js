import crypto from "node:crypto";
import path from "node:path";

import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  normalizeRepositoryMode
} from "@local/vibe64-core/server/projectRepository";
import {
  createGitTurnCheckpoint,
  runVibe64Command,
  writeGitWorktreeTree
} from "@local/vibe64-execution/server";

const SAVE_TIMEOUT_MS = 120_000;

function text(value = "") {
  return String(value || "").trim();
}

function metadata(session = {}) {
  return session?.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {};
}

function saveError(message, code = "vibe64_session_save_failed", details = {}) {
  const error = new Error(message || "Vibe64 could not save this session.");
  error.code = code;
  Object.assign(error, details);
  return error;
}

function repositoryContext(session = {}, project = {}) {
  const sessionMetadata = metadata(session);
  const mode = normalizeRepositoryMode(project.repositoryMode || project.repository?.mode);
  const branch = text(
    project.repository?.defaultBranch ||
    sessionMetadata.source_default_branch ||
    sessionMetadata.base_branch
  );
  const worktreePath = text(session.sourcePath || sessionMetadata.source_path);
  const sessionId = text(session.sessionId || session.id);
  const baseCommit = text(sessionMetadata.base_commit);
  const projectRoot = text(project.path || project.projectRoot);
  if (!mode || !branch || !worktreePath || !sessionId || !baseCommit || !projectRoot) {
    throw saveError(
      "Session Save requires a complete repository mode, branch, source, base commit, and project root.",
      "vibe64_session_save_context_incomplete"
    );
  }
  const remoteUrl = mode === PROJECT_REPOSITORY_MODE_GITHUB
    ? text(project.githubRepository?.cloneUrl || project.repository?.github?.cloneUrl || sessionMetadata.source_remote_url)
    : mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT
      ? text(project.canonicalRepositoryPath || sessionMetadata.source_remote_url)
      : projectRoot;
  if (!remoteUrl) {
    throw saveError(
      "Session Save cannot find the canonical repository authority.",
      "vibe64_session_save_authority_missing"
    );
  }
  return {
    baseCommit,
    branch,
    mode,
    projectRoot,
    remoteUrl,
    sessionId,
    worktreePath
  };
}

function commandProject(context = {}, project = {}) {
  return {
    ownerUserKey: text(project.ownerUserKey || project.githubRepository?.owner),
    projectRoot: context.projectRoot,
    repositoryMode: context.mode,
    sessionId: context.sessionId
  };
}

async function git(runCommand, context, args, {
  commandOptions = {},
  cwd = context.worktreePath,
  env = {},
  input,
  project = {},
  required = true
} = {}) {
  const allowedRoots = [
    context.worktreePath,
    context.projectRoot,
    path.dirname(context.worktreePath),
    ...(path.isAbsolute(context.remoteUrl) ? [context.remoteUrl, path.dirname(context.remoteUrl)] : [])
  ];
  const result = await runCommand({
    actor: "daemon",
    allowedRoots,
    args,
    command: "git",
    cwd,
    env,
    envPolicy: "session",
    gitSafeDirectories: allowedRoots,
    input,
    mode: "capture",
    project: commandProject(context, project),
    purpose: commandOptions.gitTransport?.startsWith("github") ? "github" : "source",
    runtimes: commandOptions.gitTransport === "github-https" ? ["git", "gh"] : ["git"],
    timeout: SAVE_TIMEOUT_MS,
    ...commandOptions
  });
  if (required && result?.ok !== true) {
    throw saveError(
      text(result?.stderr || result?.stdout || result?.output || result?.error) || "Git Save command failed.",
      text(result?.code) || "vibe64_session_save_git_failed",
      { gitArgs: args }
    );
  }
  return result;
}

function output(result = {}) {
  return text(result.stdout || result.output);
}

async function gitOutput(runCommand, context, args, options = {}) {
  return output(await git(runCommand, context, args, options));
}

async function changedPathsBetween(runCommand, context, baseCommit, tree, options = {}) {
  const result = await git(runCommand, context, [
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "-r",
    "-z",
    baseCommit,
    tree
  ], options);
  return String(result.stdout || result.output || "")
    .split("\0")
    .map(text)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

async function inspectSessionWork({
  commandOptions = {},
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const tree = await writeGitWorktreeTree({
    baseCommit: "HEAD",
    project: commandProject(context, project),
    runCommand,
    worktreePath: context.worktreePath
  });
  const baseTree = await gitOutput(runCommand, context, [
    "rev-parse",
    `${context.baseCommit}^{tree}`
  ], {
    commandOptions,
    project
  });
  const changedPaths = tree === baseTree
    ? []
    : await changedPathsBetween(runCommand, context, context.baseCommit, tree, {
        commandOptions,
        project
      });
  return {
    baseCommit: context.baseCommit,
    changedPaths,
    mode: context.mode,
    ok: true,
    sessionId: context.sessionId,
    tree,
    unsaved: changedPaths.length > 0
  };
}

async function assertBranch(runCommand, context, options) {
  await git(runCommand, context, ["check-ref-format", "--branch", context.branch], options);
}

function saveRef(context, operationId, label) {
  const digest = crypto.createHash("sha256")
    .update(`${context.sessionId}\0${operationId}`)
    .digest("hex")
    .slice(0, 32);
  return `refs/vibe64/save/${digest}/${label}`;
}

async function readRemoteCanonical(runCommand, context, operationId, options) {
  await git(runCommand, context, ["remote", "set-url", "origin", context.remoteUrl], options);
  const canonicalRef = saveRef(context, operationId, "canonical");
  await git(runCommand, context, [
    "fetch",
    "--no-tags",
    "origin",
    `+refs/heads/${context.branch}:${canonicalRef}`
  ], options);
  return gitOutput(runCommand, context, ["rev-parse", "--verify", canonicalRef], options);
}

async function assertLocalAuthority(runCommand, context, options) {
  const branch = await gitOutput(runCommand, context, ["branch", "--show-current"], {
    ...options,
    cwd: context.projectRoot
  });
  if (branch !== context.branch) {
    throw saveError(
      `The project baseline must have ${context.branch} checked out before Save.`,
      "vibe64_session_save_local_branch_mismatch"
    );
  }
  const status = await gitOutput(runCommand, context, ["status", "--porcelain", "--untracked-files=all"], {
    ...options,
    cwd: context.projectRoot
  });
  if (status) {
    throw saveError(
      "The local project baseline has unsaved work. Save cannot overwrite it.",
      "vibe64_session_save_local_authority_dirty"
    );
  }
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD"]) {
    const markerResult = await git(runCommand, context, ["rev-parse", "--verify", "-q", marker], {
      ...options,
      cwd: context.projectRoot,
      required: false
    });
    if (markerResult?.ok === true) {
      throw saveError(
        "The local project baseline has an unfinished Git operation.",
        "vibe64_session_save_local_operation_in_progress"
      );
    }
  }
  return gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD"], {
    ...options,
    cwd: context.projectRoot
  });
}

async function readCanonical(runCommand, context, operationId, options) {
  return context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
    ? assertLocalAuthority(runCommand, context, options)
    : readRemoteCanonical(runCommand, context, operationId, options);
}

async function mergeTrees(runCommand, context, {
  baseCommit,
  canonicalCommit,
  checkpointTree,
  commandOptions,
  identity,
  project
}) {
  const virtualCommit = await gitOutput(runCommand, context, [
    "-c", `user.name=${identity.name}`,
    "-c", `user.email=${identity.email}`,
    "commit-tree",
    checkpointTree,
    "-p",
    baseCommit
  ], {
    commandOptions,
    input: "Vibe64 session Save merge input\n",
    project
  });
  const merged = await git(runCommand, context, [
    "merge-tree",
    "--write-tree",
    "--messages",
    canonicalCommit,
    virtualCommit
  ], {
    commandOptions,
    project,
    required: false
  });
  if (merged?.ok !== true) {
    throw saveError(
      text(merged?.stdout || merged?.stderr || merged?.output) || "Session changes conflict with canonical work.",
      "vibe64_session_save_conflict"
    );
  }
  const mergedTree = output(merged).split(/\r?\n/u)[0];
  if (!/^[0-9a-f]{40,64}$/u.test(mergedTree)) {
    throw saveError("Git did not produce a valid merged tree.", "vibe64_session_save_merge_invalid");
  }
  return {
    mergedTree,
    virtualCommit
  };
}

async function createSaveCommit(runCommand, context, {
  canonicalCommit,
  commandOptions,
  identity,
  mergedTree,
  message,
  project
}) {
  return gitOutput(runCommand, context, [
    "-c", `user.name=${identity.name}`,
    "-c", `user.email=${identity.email}`,
    "commit-tree",
    mergedTree,
    "-p",
    canonicalCommit
  ], {
    commandOptions,
    input: `${text(message) || "Save Vibe64 work"}\n`,
    project
  });
}

async function publishSaveCommit(runCommand, context, saveCommit, canonicalCommit, options) {
  if (context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    const current = await assertLocalAuthority(runCommand, context, options);
    if (current !== canonicalCommit) {
      throw saveError(
        "The local project baseline advanced during Save.",
        "vibe64_session_save_authority_advanced"
      );
    }
    await git(runCommand, context, ["fetch", context.worktreePath, saveCommit], {
      ...options,
      cwd: context.projectRoot
    });
    await git(runCommand, context, ["merge", "--ff-only", saveCommit], {
      ...options,
      cwd: context.projectRoot
    });
    return gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      ...options,
      cwd: context.projectRoot
    });
  }
  const pushArgs = ["push"];
  if (context.mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    pushArgs.push("--push-option=vibe64-atomic");
  }
  pushArgs.push("origin", `${saveCommit}:refs/heads/${context.branch}`);
  await git(runCommand, context, pushArgs, options);
  const remote = await gitOutput(runCommand, context, [
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${context.branch}`
  ], options);
  const verified = remote.split(/\s+/u)[0] || "";
  if (verified !== saveCommit) {
    throw saveError(
      "Canonical repository verification did not return the commit Vibe64 published.",
      "vibe64_session_save_verification_failed"
    );
  }
  return verified;
}

async function currentCanonicalCommit(runCommand, context, operationId, options) {
  if (context.mode !== PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    return readRemoteCanonical(runCommand, context, operationId, options);
  }
  return assertLocalAuthority(runCommand, context, options);
}

async function reconcileSession(runCommand, context, {
  checkpointCommit,
  checkpointTree,
  commandOptions,
  project,
  saveCommit
}) {
  const currentTree = await writeGitWorktreeTree({
    baseCommit: "HEAD",
    project: commandProject(context, project),
    runCommand,
    worktreePath: context.worktreePath
  });
  if (currentTree !== checkpointTree) {
    return {
      currentTree,
      reconciled: false,
      status: "published_needs_reconcile"
    };
  }
  const oldIndexTree = await gitOutput(runCommand, context, ["write-tree"], {
    commandOptions,
    project
  });
  const patch = (await git(runCommand, context, [
    "diff",
    "--binary",
    checkpointCommit,
    saveCommit,
    "--"
  ], {
    commandOptions,
    project
  })).stdout || "";
  try {
    await git(runCommand, context, ["read-tree", checkpointCommit], {
      commandOptions,
      project
    });
    if (patch) {
      await git(runCommand, context, ["apply", "--index", "--binary", "-"], {
        commandOptions,
        input: patch,
        project
      });
    }
    const oldHead = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    });
    await git(runCommand, context, ["update-ref", "HEAD", saveCommit, oldHead], {
      commandOptions,
      project
    });
    return {
      currentTree,
      reconciled: true,
      status: "saved"
    };
  } catch (error) {
    await git(runCommand, context, ["read-tree", oldIndexTree], {
      commandOptions,
      project,
      required: false
    });
    return {
      currentTree,
      error: text(error?.message || error),
      reconciled: false,
      status: "published_needs_reconcile"
    };
  }
}

async function saveSessionWork({
  commandOptions = {},
  identity = {},
  message = "Save Vibe64 work",
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  onProgress = async () => null,
  siblingWork = async () => [],
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const author = {
    email: text(identity.email) || "vibe64@localhost",
    name: text(identity.name) || "Vibe64 Save"
  };
  return runProjectSourceExclusive(async () => {
    await onProgress({
      baseCommit: context.baseCommit,
      branch: context.branch,
      kind: "checkpoint",
      message: "Capturing the complete session worktree.",
      mode: context.mode,
      operationId,
      stage: "checkpointing"
    });
    await assertBranch(runCommand, context, { commandOptions, project });
    const checkpoint = await createGitTurnCheckpoint({
      outerTurnId: `save:${operationId}`,
      outcome: "completed",
      project: commandProject(context, project),
      runCommand,
      sessionId: context.sessionId,
      timestamp: new Date().toISOString(),
      worktreePath: context.worktreePath
    });
    await onProgress({
      checkpointCommit: checkpoint.commit,
      checkpointTree: checkpoint.tree,
      kind: "checkpoint",
      message: "Session checkpoint captured.",
      stage: "checkpointed"
    });
    const changedPaths = await changedPathsBetween(
      runCommand,
      context,
      context.baseCommit,
      checkpoint.tree,
      { commandOptions, project }
    );
    const siblings = await siblingWork({
      changedPaths,
      context
    });
    const changedPathSet = new Set(changedPaths);
    const siblingConflicts = (Array.isArray(siblings) ? siblings : [])
      .map((sibling) => ({
        paths: (Array.isArray(sibling?.changedPaths) ? sibling.changedPaths : [])
          .filter((filePath) => changedPathSet.has(filePath))
          .sort((left, right) => left.localeCompare(right)),
        sessionId: text(sibling?.sessionId)
      }))
      .filter((sibling) => sibling.sessionId && sibling.paths.length);
    if (siblingConflicts.length) {
      throw saveError(
        "This work overlaps unsaved changes in another open session.",
        "vibe64_session_save_sibling_conflict",
        { siblingConflicts }
      );
    }
    await onProgress({ kind: "canonical", message: "Reading the current canonical branch.", stage: "canonical-reading" });
    const canonicalCommit = await readCanonical(runCommand, context, operationId, {
      commandOptions,
      project
    });
    await onProgress({
      expectedCanonicalCommit: canonicalCommit,
      kind: "canonical",
      message: "Canonical branch read.",
      stage: "canonical-read"
    });
    const ancestor = await git(runCommand, context, [
      "merge-base",
      "--is-ancestor",
      context.baseCommit,
      canonicalCommit
    ], {
      commandOptions,
      project,
      required: false
    });
    if (ancestor?.ok !== true) {
      throw saveError(
        "Canonical history no longer descends from this session's saved base.",
        "vibe64_session_save_history_diverged"
      );
    }
    await onProgress({ kind: "merge", message: "Merging session work with current canonical work.", stage: "merging" });
    const { mergedTree, virtualCommit } = await mergeTrees(runCommand, context, {
      baseCommit: context.baseCommit,
      canonicalCommit,
      changedPaths,
      checkpointTree: checkpoint.tree,
      commandOptions,
      identity: author,
      project
    });
    const saveCommit = await createSaveCommit(runCommand, context, {
      canonicalCommit,
      commandOptions,
      identity: author,
      mergedTree,
      message,
      project
    });
    await onProgress({
      expectedCanonicalCommit: canonicalCommit,
      kind: "publish",
      mergedTree,
      message: "Save commit prepared.",
      proposedCommit: saveCommit,
      stage: "prepared",
      virtualCommit
    });
    await onProgress({ kind: "publish", message: "Publishing one ordinary Save commit.", stage: "publishing" });
    const verifiedCommit = await publishSaveCommit(
      runCommand,
      context,
      saveCommit,
      canonicalCommit,
      { commandOptions, project }
    );
    await onProgress({
      kind: "publish",
      message: "Canonical Save commit verified.",
      stage: "published",
      verifiedCommit
    });
    await onProgress({ kind: "reconcile", message: "Reconciling the session onto the saved commit.", stage: "reconciling" });
    const reconciliation = await reconcileSession(runCommand, context, {
      checkpointCommit: checkpoint.commit,
      checkpointTree: checkpoint.tree,
      commandOptions,
      project,
      saveCommit
    });
    return {
      baseCommit: context.baseCommit,
      canonicalCommit,
      checkpointCommit: checkpoint.commit,
      checkpointTree: checkpoint.tree,
      mergedTree,
      mode: context.mode,
      ok: true,
      operationId,
      saveCommit,
      status: reconciliation.status,
      verifiedCommit,
      virtualCommit,
      ...reconciliation
    };
  }, {
    operation: `save-session:${context.sessionId}`
  });
}

async function recoverSessionWorkSave({
  commandOptions = {},
  project = {},
  recovery = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const operationId = text(recovery.operationId);
  const expectedCanonicalCommit = text(recovery.expectedCanonicalCommit);
  const proposedCommit = text(recovery.proposedCommit);
  const checkpointCommit = text(recovery.checkpointCommit);
  const checkpointTree = text(recovery.checkpointTree);
  if (!operationId || !expectedCanonicalCommit || !proposedCommit || !checkpointCommit || !checkpointTree) {
    throw saveError(
      "The interrupted Save stopped before a publishable commit was durably prepared. Retry Save.",
      "vibe64_session_save_interrupted_retryable",
      { retryable: true }
    );
  }
  return runProjectSourceExclusive(async () => {
    const authorityCommit = await currentCanonicalCommit(
      runCommand,
      context,
      operationId,
      { commandOptions, project }
    );
    if (authorityCommit === expectedCanonicalCommit) {
      throw saveError(
        "The interrupted Save did not publish. Retry Save when ready.",
        "vibe64_session_save_interrupted_retryable",
        { retryable: true }
      );
    }
    if (authorityCommit !== proposedCommit) {
      throw saveError(
        "Canonical history advanced while the interrupted Save was being recovered.",
        "vibe64_session_save_authority_advanced",
        { authorityCommit, expectedCanonicalCommit, proposedCommit }
      );
    }
    const reconciliation = await reconcileSession(runCommand, context, {
      checkpointCommit,
      checkpointTree,
      commandOptions,
      project,
      saveCommit: proposedCommit
    });
    return {
      ...recovery,
      authorityCommit,
      ok: true,
      recovered: true,
      saveCommit: proposedCommit,
      status: reconciliation.status,
      verifiedCommit: proposedCommit,
      ...reconciliation
    };
  }, {
    operation: `recover-save-session:${context.sessionId}`
  });
}

export {
  inspectSessionWork,
  recoverSessionWorkSave,
  repositoryContext,
  saveSessionWork
};
