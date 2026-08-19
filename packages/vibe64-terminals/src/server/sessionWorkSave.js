import crypto from "node:crypto";
import path from "node:path";

import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  normalizeRepositoryMode
} from "@local/vibe64-core/server/projectRepository";
import {
  repositoryUpdateRelationship,
  repositoryUpdateStrategy
} from "@local/vibe64-core/shared";
import {
  createGitTurnCheckpoint,
  runVibe64Command,
  writeGitWorktreeTree
} from "@local/vibe64-execution/server";
import {
  GIT_HISTORY_RECORD_FORMAT,
  parseGitHistoryRecords
} from "./gitHistoryRecords.js";

const SAVE_TIMEOUT_MS = 120_000;
const DEFAULT_CHANGE_FILE_LIMIT = 200;
const MAX_CHANGE_FILE_LIMIT = 500;
const DEFAULT_CHANGE_DIFF_LINE_LIMIT = 800;
const MAX_CHANGE_DIFF_LINE_LIMIT = 5000;
const INCOMING_VERSION_LIMIT = 5;

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
  const lastCanonicalCommit = text(sessionMetadata.canonical_commit) || baseCommit;
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
    lastCanonicalCommit,
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
  additionalAllowedRoots = [],
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
    ...(path.isAbsolute(context.remoteUrl) ? [context.remoteUrl, path.dirname(context.remoteUrl)] : []),
    ...additionalAllowedRoots.flatMap((root) => {
      const normalized = text(root);
      return normalized ? [normalized, path.dirname(normalized)] : [];
    })
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

async function countCommitsBetween(runCommand, context, fromCommit, toCommit, options = {}) {
  const count = Number(await gitOutput(runCommand, context, [
    "rev-list",
    "--count",
    `${fromCommit}..${toCommit}`
  ], options));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

async function incomingVersionsBetween(
  runCommand,
  context,
  fromCommit,
  toCommit,
  options = {}
) {
  const result = await git(runCommand, context, [
    "log",
    "--topo-order",
    `--max-count=${INCOMING_VERSION_LIMIT + 1}`,
    "-z",
    `--format=${GIT_HISTORY_RECORD_FORMAT}`,
    `${fromCommit}..${toCommit}`
  ], options);
  const records = parseGitHistoryRecords(String(result.stdout || result.output || ""));
  return {
    incomingVersions: records.slice(0, INCOMING_VERSION_LIMIT),
    incomingVersionsTruncated: records.length > INCOMING_VERSION_LIMIT
  };
}

async function optionalGitOutput(runCommand, context, args, options = {}) {
  const result = await git(runCommand, context, args, {
    ...options,
    required: false
  });
  return result?.ok === true ? output(result) : "";
}

async function commitTree(runCommand, context, commit, options = {}) {
  return gitOutput(runCommand, context, [
    "rev-parse",
    "--verify",
    `${commit}^{tree}`
  ], options);
}

async function commitIsAncestor(runCommand, context, ancestor, descendant, options = {}) {
  if (ancestor === descendant) {
    return true;
  }
  const result = await git(runCommand, context, [
    "merge-base",
    "--is-ancestor",
    ancestor,
    descendant
  ], {
    ...options,
    required: false
  });
  return result?.ok === true;
}

async function observedCanonicalCommit(runCommand, context, options = {}) {
  const [stable, recorded, base] = await Promise.all([
    optionalGitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      `${canonicalRef(context)}^{commit}`
    ], options),
    context.lastCanonicalCommit
    ? await optionalGitOutput(runCommand, context, [
        "rev-parse",
        "--verify",
        `${context.lastCanonicalCommit}^{commit}`
      ], options)
      : "",
    gitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      `${context.baseCommit}^{commit}`
    ], options)
  ]);
  let observed = stable || recorded || base;
  for (const candidate of [recorded, base].filter(Boolean)) {
    if (candidate === observed) {
      continue;
    }
    if (await commitIsAncestor(runCommand, context, observed, candidate, options)) {
      observed = candidate;
    }
  }
  return observed;
}

async function sessionWorkComparison(runCommand, context, {
  baseCommit,
  canonicalCommit,
  sessionHead,
  worktreeTree
}, options = {}) {
  const [baseTree, canonicalTree] = await Promise.all([
    commitTree(runCommand, context, baseCommit, options),
    commitTree(runCommand, context, canonicalCommit, options)
  ]);
  if (worktreeTree === canonicalTree) {
    return {
      baseTree,
      canonicalTree,
      changeBaseCommit: canonicalCommit,
      changeBaseTree: canonicalTree,
      changedPaths: [],
      sessionMatchesCanonical: true
    };
  }
  const changeBaseCommit = await gitOutput(runCommand, context, [
    "merge-base",
    canonicalCommit,
    sessionHead
  ], options);
  const changeBaseTree = changeBaseCommit === canonicalCommit
    ? canonicalTree
    : await commitTree(runCommand, context, changeBaseCommit, options);
  const changedPaths = worktreeTree === changeBaseTree
    ? []
    : await changedPathsBetween(
        runCommand,
        context,
        changeBaseCommit,
        worktreeTree,
        options
      );
  return {
    baseTree,
    canonicalTree,
    changeBaseCommit,
    changeBaseTree,
    changedPaths,
    sessionMatchesCanonical: worktreeTree === canonicalTree
  };
}

function boundedInteger(value, fallback, maximum) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(number) && number > 0
    ? Math.min(number, maximum)
    : fallback;
}

function parseGitNameStatusZ(value = "") {
  const fields = String(value || "").split("\0");
  const files = new Map();
  for (let index = 0; index < fields.length;) {
    const status = text(fields[index++]);
    if (!status) {
      continue;
    }
    const previousPath = /^[CR]/u.test(status) ? text(fields[index++]) : "";
    const filePath = text(fields[index++]);
    if (!filePath) {
      continue;
    }
    files.set(filePath, {
      path: filePath,
      ...(previousPath ? { previousPath } : {}),
      status: status.slice(0, 1)
    });
  }
  return files;
}

function numericStat(value = "") {
  const normalized = text(value);
  if (normalized === "-") {
    return null;
  }
  const number = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function parseGitNumstatZ(value = "") {
  const fields = String(value || "").split("\0");
  const stats = new Map();
  for (let index = 0; index < fields.length;) {
    const record = fields[index++];
    if (!record) {
      continue;
    }
    const [added, deleted, filePath = ""] = record.split("\t");
    const renamed = !filePath;
    if (renamed) {
      index += 1;
    }
    const targetPath = text(renamed ? fields[index++] : filePath);
    if (!targetPath) {
      continue;
    }
    stats.set(targetPath, {
      added: numericStat(added),
      deleted: numericStat(deleted)
    });
  }
  return stats;
}

async function sessionChangeFiles(runCommand, context, canonicalCommit, worktreeTree, options = {}) {
  const [statusResult, statResult] = await Promise.all([
    git(runCommand, context, [
      "diff-tree",
      "--no-commit-id",
      "-r",
      "-M",
      "--name-status",
      "-z",
      canonicalCommit,
      worktreeTree
    ], options),
    git(runCommand, context, [
      "diff-tree",
      "--no-commit-id",
      "-r",
      "-M",
      "--numstat",
      "-z",
      canonicalCommit,
      worktreeTree
    ], options)
  ]);
  const files = parseGitNameStatusZ(statusResult.stdout || statusResult.output);
  const stats = parseGitNumstatZ(statResult.stdout || statResult.output);
  return [...files.values()]
    .map((file) => ({
      ...file,
      ...(stats.get(file.path) || { added: 0, deleted: 0 })
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function safeChangePath(value = "") {
  const normalized = text(value).replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    path.posix.isAbsolute(normalized) ||
    path.posix.normalize(normalized) !== normalized ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw saveError("Choose a changed project file.", "vibe64_session_change_path_invalid");
  }
  return normalized;
}

async function inspectSessionChanges({
  commandOptions = {},
  limit = DEFAULT_CHANGE_FILE_LIMIT,
  offset = 0,
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const work = await inspectSessionWork({ commandOptions, project, runCommand, session });
  const context = repositoryContext(session, project);
  const files = work.unsaved
    ? await sessionChangeFiles(runCommand, context, work.changeBaseCommit, work.worktreeTree, {
        commandOptions,
        project
      })
    : [];
  const boundedLimit = boundedInteger(limit, DEFAULT_CHANGE_FILE_LIMIT, MAX_CHANGE_FILE_LIMIT);
  const boundedOffset = Math.max(0, Number.parseInt(String(offset ?? ""), 10) || 0);
  return {
    ...work,
    files: files.slice(boundedOffset, boundedOffset + boundedLimit),
    limit: boundedLimit,
    offset: boundedOffset,
    totalCount: files.length,
    truncated: boundedOffset + boundedLimit < files.length
  };
}

async function inspectSessionChangeDiff({
  commandOptions = {},
  lineLimit = DEFAULT_CHANGE_DIFF_LINE_LIMIT,
  path: requestedPath = "",
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const filePath = safeChangePath(requestedPath);
  const work = await inspectSessionWork({ commandOptions, project, runCommand, session });
  if (!work.changedPaths.includes(filePath)) {
    throw saveError("That file is not part of the current saved-work difference.", "vibe64_session_change_not_found");
  }
  const context = repositoryContext(session, project);
  const result = await git(runCommand, context, [
    "diff",
    "--no-ext-diff",
    "--find-renames",
    "--unified=3",
    work.changeBaseCommit,
    work.worktreeTree,
    "--",
    filePath
  ], {
    commandOptions,
    project
  });
  const lines = String(result.stdout || result.output || "").replaceAll("\r\n", "\n").split("\n");
  const boundedLimit = boundedInteger(lineLimit, DEFAULT_CHANGE_DIFF_LINE_LIMIT, MAX_CHANGE_DIFF_LINE_LIMIT);
  return {
    canonicalCommit: work.canonicalCommit,
    changeBaseCommit: work.changeBaseCommit,
    diff: lines.slice(0, boundedLimit).join("\n"),
    lineLimit: boundedLimit,
    ok: true,
    path: filePath,
    shownLines: Math.min(lines.length, boundedLimit),
    totalLines: lines.length,
    truncated: lines.length > boundedLimit,
    worktreeTree: work.worktreeTree
  };
}

async function inspectSessionWork({
  commandOptions = {},
  comparisonOperationId = "",
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
  const [canonicalCommit, sessionHead] = await Promise.all([
    observedCanonicalCommit(runCommand, context, { commandOptions, project }),
    gitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}"
    ], {
      commandOptions,
      project
    })
  ]);
  const [headTree, ahead, behind, comparison] = await Promise.all([
    gitOutput(runCommand, context, [
      "rev-parse",
      `${sessionHead}^{tree}`
    ], {
      commandOptions,
      project
    }),
    countCommitsBetween(runCommand, context, canonicalCommit, sessionHead, {
      commandOptions,
      project
    }),
    countCommitsBetween(runCommand, context, sessionHead, canonicalCommit, {
      commandOptions,
      project
    }),
    sessionWorkComparison(runCommand, context, {
      baseCommit: context.baseCommit,
      canonicalCommit,
      sessionHead,
      worktreeTree: tree
    }, { commandOptions, project })
  ]);
  const comparisonRef = comparisonOperationId
    ? saveRef(context, comparisonOperationId, "comparison")
    : "";
  const comparisonCommit = comparisonRef
    ? await gitOutput(runCommand, context, [
        "-c", "user.name=Vibe64 Save",
        "-c", "user.email=vibe64@localhost",
        "commit-tree",
        tree,
        "-p",
        comparison.changeBaseCommit
      ], {
        commandOptions,
        input: "Vibe64 sibling Save comparison\n",
        project
      })
    : "";
  if (comparisonRef) {
    await git(runCommand, context, ["update-ref", comparisonRef, comparisonCommit], {
      commandOptions,
      project
    });
  }
  const relationship = repositoryUpdateRelationship(ahead, behind);
  return {
    ahead,
    baseCommit: context.baseCommit,
    behind,
    branch: context.branch,
    canonicalCommit,
    canonicalTree: comparison.canonicalTree,
    changeBaseCommit: comparison.changeBaseCommit,
    changeBaseTree: comparison.changeBaseTree,
    changedPaths: comparison.changedPaths,
    comparisonCommit,
    comparisonRef,
    dirty: tree !== headTree,
    mode: context.mode,
    ok: true,
    repositoryMode: context.mode,
    relationship,
    sessionMatchesCanonical: comparison.sessionMatchesCanonical,
    sessionHead,
    sessionId: context.sessionId,
    tree,
    updateAvailable: behind > 0,
    updateStrategy: repositoryUpdateStrategy(relationship),
    unsaved: comparison.changedPaths.length > 0,
    worktreeTree: tree,
    worktreePath: context.worktreePath
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

function canonicalRef(context) {
  const digest = crypto.createHash("sha256")
    .update(context.branch)
    .digest("hex")
    .slice(0, 32);
  return `refs/vibe64/canonical/${digest}`;
}

async function rememberCanonicalCommit(runCommand, context, commit, options = {}) {
  const verified = await gitOutput(runCommand, context, [
    "rev-parse",
    "--verify",
    `${commit}^{commit}`
  ], options);
  await git(runCommand, context, [
    "update-ref",
    canonicalRef(context),
    verified
  ], options);
  return verified;
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
  const commit = await gitOutput(runCommand, context, ["rev-parse", "--verify", canonicalRef], options);
  return rememberCanonicalCommit(runCommand, context, commit, options);
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
  if (context.mode !== PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    return readRemoteCanonical(runCommand, context, operationId, options);
  }
  const authorityCommit = await assertLocalAuthority(runCommand, context, options);
  const canonicalRef = saveRef(context, operationId, "canonical");
  await git(runCommand, context, [
    "fetch",
    "--no-tags",
    context.projectRoot,
    `+refs/heads/${context.branch}:${canonicalRef}`
  ], options);
  const importedCommit = await gitOutput(runCommand, context, [
    "rev-parse",
    "--verify",
    canonicalRef
  ], options);
  if (importedCommit !== authorityCommit) {
    throw saveError(
      "The local project baseline changed while Vibe64 was reading it.",
      "vibe64_session_save_authority_advanced"
    );
  }
  return rememberCanonicalCommit(runCommand, context, importedCommit, options);
}

async function mergeTrees(runCommand, context, {
  baseCommit,
  canonicalCommit,
  checkpointTree,
  commandOptions,
  identity,
  project,
  virtualCommit = ""
}) {
  const mergeInputCommit = virtualCommit || await createVirtualCommit(runCommand, context, {
    baseCommit,
    commandOptions,
    identity,
    message: "Vibe64 session rebase input",
    project,
    tree: checkpointTree
  });
  const merged = await git(runCommand, context, [
    "merge-tree",
    "--write-tree",
    "--messages",
    canonicalCommit,
    mergeInputCommit
  ], {
    commandOptions,
    project,
    required: false
  });
  if (merged?.ok !== true) {
    throw saveError(
      text(merged?.stdout || merged?.stderr || merged?.output) || "Session changes conflict with canonical work.",
      "vibe64_session_update_conflict"
    );
  }
  const mergedTree = output(merged).split(/\r?\n/u)[0];
  if (!/^[0-9a-f]{40,64}$/u.test(mergedTree)) {
    throw saveError("Git did not produce a valid rebased tree.", "vibe64_session_update_merge_invalid");
  }
  return {
    mergedTree,
    virtualCommit: mergeInputCommit
  };
}

async function createVirtualCommit(runCommand, context, {
  baseCommit,
  commandOptions,
  identity,
  message,
  project,
  tree
}) {
  return gitOutput(runCommand, context, [
    "-c", `user.name=${identity.name}`,
    "-c", `user.email=${identity.email}`,
    "commit-tree",
    tree,
    "-p",
    baseCommit
  ], {
    commandOptions,
    input: `${text(message) || "Vibe64 virtual commit"}\n`,
    project
  });
}

function siblingLocalRef(context, operationId, siblingSessionId) {
  const siblingDigest = crypto.createHash("sha256")
    .update(text(siblingSessionId))
    .digest("hex")
    .slice(0, 24);
  return saveRef(context, operationId, `sibling-${siblingDigest}`);
}

async function compareSiblingWork(runCommand, context, {
  commandOptions,
  currentVirtualCommit,
  operationId,
  project,
  sibling
}) {
  const siblingSessionId = text(sibling?.sessionId);
  const comparisonCommit = text(sibling?.comparisonCommit);
  const comparisonRef = text(sibling?.comparisonRef);
  const siblingWorktreePath = text(sibling?.worktreePath);
  if (!siblingSessionId || !comparisonCommit || !comparisonRef || !siblingWorktreePath) {
    return {
      classification: "unknown",
      paths: Array.isArray(sibling?.overlappingPaths) ? sibling.overlappingPaths : [],
      sessionId: siblingSessionId
    };
  }
  const localRef = siblingLocalRef(context, operationId, siblingSessionId);
  try {
    await git(runCommand, context, [
      "fetch",
      "--no-tags",
      siblingWorktreePath,
      `+${comparisonRef}:${localRef}`
    ], {
      additionalAllowedRoots: [siblingWorktreePath],
      project
    });
    const importedCommit = await gitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      localRef
    ], { commandOptions, project });
    if (importedCommit !== comparisonCommit) {
      return {
        classification: "unknown",
        paths: sibling.overlappingPaths,
        sessionId: siblingSessionId
      };
    }
    const mergeBase = await git(runCommand, context, [
      "merge-base",
      currentVirtualCommit,
      importedCommit
    ], {
      commandOptions,
      project,
      required: false
    });
    if (mergeBase?.ok !== true || !output(mergeBase)) {
      return {
        classification: "unknown",
        paths: sibling.overlappingPaths,
        sessionId: siblingSessionId
      };
    }
    const merged = await git(runCommand, context, [
      "merge-tree",
      "--write-tree",
      "--messages",
      currentVirtualCommit,
      importedCommit
    ], {
      commandOptions,
      project,
      required: false
    });
    return {
      classification: merged?.ok === true ? "overlap-clean" : "conflict",
      paths: sibling.overlappingPaths,
      sessionId: siblingSessionId
    };
  } finally {
    await git(runCommand, context, ["update-ref", "-d", localRef], {
      commandOptions,
      project,
      required: false
    });
  }
}

async function createSaveCommit(runCommand, context, {
  canonicalCommit,
  commandOptions,
  identity,
  mergedTree,
  message,
  project
}) {
  const subject = text(message);
  if (!subject) {
    throw saveError(
      "Save requires an assistant-generated commit subject.",
      "vibe64_session_save_message_required"
    );
  }
  return gitOutput(runCommand, context, [
    "-c", `user.name=${identity.name}`,
    "-c", `user.email=${identity.email}`,
    "commit-tree",
    mergedTree,
    "-p",
    canonicalCommit
  ], {
    commandOptions,
    input: `${subject}\n`,
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
    const verified = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      ...options,
      cwd: context.projectRoot
    });
    await rememberCanonicalCommit(runCommand, context, verified, options);
    return verified;
  }
  const pushArgs = ["push"];
  if (context.mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    pushArgs.push("--push-option=vibe64-atomic");
  }
  pushArgs.push("origin", `${saveCommit}:refs/heads/${context.branch}`);
  const pushed = await git(runCommand, context, pushArgs, {
    ...options,
    required: false
  });
  if (pushed?.ok !== true) {
    const remote = await git(runCommand, context, [
      "ls-remote",
      "--heads",
      "origin",
      `refs/heads/${context.branch}`
    ], {
      ...options,
      required: false
    });
    const remoteCommit = output(remote).split(/\s+/u)[0] || "";
    if (remoteCommit && remoteCommit !== canonicalCommit) {
      throw saveError(
        "The saved project changed while Save was publishing. Update this session (rebase), then save again.",
        "vibe64_session_save_update_required",
        {
          canonicalCommit: remoteCommit,
          reconciledCommit: canonicalCommit,
          updateRequired: true
        }
      );
    }
    throw saveError(
      text(pushed?.stderr || pushed?.stdout || pushed?.output || pushed?.error) || "Git Save publication failed.",
      text(pushed?.code) || "vibe64_session_save_git_failed"
    );
  }
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
  await rememberCanonicalCommit(runCommand, context, verified, options);
  return verified;
}

async function currentCanonicalCommit(runCommand, context, operationId, options) {
  return readCanonical(runCommand, context, operationId, options);
}

async function checkSessionUpdates({
  commandOptions = {},
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runProjectSourceExclusive(async () => {
    await assertBranch(runCommand, context, { commandOptions, project });
    const canonicalCommit = await currentCanonicalCommit(
      runCommand,
      context,
      operationId,
      { commandOptions, project }
    );
    const [sessionHead, worktreeTree] = await Promise.all([
      gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
        commandOptions,
        project
      }),
      writeGitWorktreeTree({
        baseCommit: "HEAD",
        project: commandProject(context, project),
        runCommand,
        worktreePath: context.worktreePath
      })
    ]);
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
        "The saved project history no longer descends from this session's starting version.",
        "vibe64_session_update_history_diverged"
      );
    }
    const [ahead, behind, canonicalInSession, canonicalTree] = await Promise.all([
      countCommitsBetween(runCommand, context, canonicalCommit, sessionHead, {
        commandOptions,
        project
      }),
      countCommitsBetween(runCommand, context, sessionHead, canonicalCommit, {
        commandOptions,
        project
      }),
      commitIsAncestor(runCommand, context, canonicalCommit, sessionHead, {
        commandOptions,
        project
      }),
      commitTree(runCommand, context, canonicalCommit, { commandOptions, project })
    ]);
    const relationship = repositoryUpdateRelationship(ahead, behind);
    const incoming = behind > 0
      ? await incomingVersionsBetween(runCommand, context, sessionHead, canonicalCommit, {
          commandOptions,
          project
        })
      : { incomingVersions: [], incomingVersionsTruncated: false };
    return {
      ahead,
      baseCommit: context.baseCommit,
      behind,
      canonicalCommit,
      ...incoming,
      ok: true,
      operationId,
      reconciled: canonicalInSession,
      repositoryMode: context.mode,
      relationship,
      sessionCurrent: canonicalInSession,
      sessionHead,
      sessionMatchesCanonical: worktreeTree === canonicalTree,
      updateAvailable: !canonicalInSession,
      updateStrategy: repositoryUpdateStrategy(relationship)
    };
  }, {
    operation: `check-session-updates:${context.sessionId}`
  });
}

async function applySessionUpdate(runCommand, context, {
  canonicalCommit,
  checkpointCommit,
  checkpointTree,
  commandOptions,
  mergedCommit,
  mergedTree,
  oldHead,
  oldIndexTree,
  project
}) {
  const currentTree = await writeGitWorktreeTree({
    baseCommit: "HEAD",
    project: commandProject(context, project),
    runCommand,
    worktreePath: context.worktreePath
  });
  if (currentTree !== checkpointTree) {
    throw saveError(
      "This session changed while its update was being prepared. Retry when the assistant is idle.",
      "vibe64_session_update_worktree_changed"
    );
  }
  try {
    await git(runCommand, context, ["read-tree", "--reset", "-u", mergedCommit], {
      commandOptions,
      project
    });
    await git(runCommand, context, ["update-ref", "HEAD", canonicalCommit, oldHead], {
      commandOptions,
      project
    });
    await git(runCommand, context, ["read-tree", canonicalCommit], {
      commandOptions,
      project
    });
    const updatedTree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    if (updatedTree !== mergedTree) {
      throw saveError(
        "The updated session did not match the prepared merged work.",
        "vibe64_session_update_verification_failed"
      );
    }
    await rememberCanonicalCommit(runCommand, context, canonicalCommit, {
      commandOptions,
      project
    });
    return { currentTree: updatedTree, reconciled: true, status: "updated" };
  } catch (error) {
    const currentHead = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    }).catch(() => "");
    await git(runCommand, context, ["read-tree", "--reset", "-u", checkpointCommit], {
      commandOptions,
      project,
      required: false
    });
    if (currentHead && currentHead !== oldHead) {
      await git(runCommand, context, ["update-ref", "HEAD", oldHead, currentHead], {
        commandOptions,
        project,
        required: false
      });
    }
    await git(runCommand, context, ["read-tree", oldIndexTree], {
      commandOptions,
      project,
      required: false
    });
    throw error;
  }
}

async function updateSessionWork({
  commandOptions = {},
  identity = {},
  onProgress = async () => null,
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const author = {
    email: text(identity.email) || "vibe64@localhost",
    name: text(identity.name) || "Vibe64 Update"
  };
  return runProjectSourceExclusive(async () => {
    await assertBranch(runCommand, context, { commandOptions, project });
    await onProgress({ kind: "checkpoint", message: "Capturing this session's complete worktree.", stage: "checkpointing" });
    const checkpoint = await createGitTurnCheckpoint({
      outerTurnId: `update:${operationId}`,
      outcome: "completed",
      project: commandProject(context, project),
      runCommand,
      sessionId: context.sessionId,
      timestamp: new Date().toISOString(),
      worktreePath: context.worktreePath
    });
    const [oldHead, oldIndexTree] = await Promise.all([
      gitOutput(runCommand, context, ["rev-parse", "HEAD"], { commandOptions, project }),
      gitOutput(runCommand, context, ["write-tree"], { commandOptions, project })
    ]);
    await onProgress({
      checkpointCommit: checkpoint.commit,
      checkpointTree: checkpoint.tree,
      kind: "checkpoint",
      message: "Session checkpoint captured.",
      oldHead,
      oldIndexTree,
      stage: "checkpointed"
    });
    const canonicalCommit = await currentCanonicalCommit(
      runCommand,
      context,
      operationId,
      { commandOptions, project }
    );
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
        "The saved project history no longer descends from this session's starting version.",
        "vibe64_session_update_history_diverged"
      );
    }
    const comparison = await sessionWorkComparison(runCommand, context, {
      baseCommit: context.baseCommit,
      canonicalCommit,
      sessionHead: oldHead,
      worktreeTree: checkpoint.tree
    }, { commandOptions, project });
    const canonicalInSession = await commitIsAncestor(
      runCommand,
      context,
      canonicalCommit,
      oldHead,
      { commandOptions, project }
    );
    if (canonicalInSession) {
      return {
        baseCommit: context.baseCommit,
        canonicalCommit,
        canonicalTree: comparison.canonicalTree,
        changeBaseCommit: comparison.changeBaseCommit,
        checkpointCommit: checkpoint.commit,
        checkpointTree: checkpoint.tree,
        currentTree: checkpoint.tree,
        ok: true,
        operationId,
        mode: context.mode,
        reconciled: true,
        repositoryMode: context.mode,
        sessionCurrent: canonicalInSession,
        sessionMatchesCanonical: comparison.sessionMatchesCanonical,
        status: "already_current"
      };
    }
    if (comparison.sessionMatchesCanonical) {
      await onProgress({
        canonicalCommit,
        checkpointCommit: checkpoint.commit,
        checkpointTree: checkpoint.tree,
        kind: "update",
        mergedCommit: canonicalCommit,
        mergedTree: comparison.canonicalTree,
        message: "A conflict-free session update is ready.",
        oldHead,
        oldIndexTree,
        stage: "prepared"
      });
      await onProgress({ kind: "update", message: "Updating this session (rebase).", stage: "mutating" });
      const reconciliation = await applySessionUpdate(runCommand, context, {
        canonicalCommit,
        checkpointCommit: checkpoint.commit,
        checkpointTree: checkpoint.tree,
        commandOptions,
        mergedCommit: canonicalCommit,
        mergedTree: comparison.canonicalTree,
        oldHead,
        oldIndexTree,
        project
      });
      return {
        baseCommit: context.baseCommit,
        canonicalCommit,
        canonicalTree: comparison.canonicalTree,
        changeBaseCommit: comparison.changeBaseCommit,
        checkpointCommit: checkpoint.commit,
        checkpointTree: checkpoint.tree,
        mergedCommit: canonicalCommit,
        mergedTree: comparison.canonicalTree,
        ok: true,
        oldHead,
        oldIndexTree,
        operationId,
        mode: context.mode,
        repositoryMode: context.mode,
        sessionCurrent: true,
        sessionMatchesCanonical: true,
        ...reconciliation
      };
    }
    const { mergedTree } = await mergeTrees(runCommand, context, {
      baseCommit: comparison.changeBaseCommit,
      canonicalCommit,
      checkpointTree: checkpoint.tree,
      commandOptions,
      identity: author,
      project
    });
    const mergedCommit = await createVirtualCommit(runCommand, context, {
      baseCommit: canonicalCommit,
      commandOptions,
      identity: author,
      message: "Vibe64 session update result",
      project,
      tree: mergedTree
    });
    await onProgress({
      canonicalCommit,
      checkpointCommit: checkpoint.commit,
      checkpointTree: checkpoint.tree,
      kind: "update",
      mergedCommit,
      mergedTree,
      message: "A conflict-free session update is ready.",
      oldHead,
      oldIndexTree,
      stage: "prepared"
    });
    await onProgress({ kind: "update", message: "Updating this session (rebase).", stage: "mutating" });
    const reconciliation = await applySessionUpdate(runCommand, context, {
      canonicalCommit,
      checkpointCommit: checkpoint.commit,
      checkpointTree: checkpoint.tree,
      commandOptions,
      mergedCommit,
      mergedTree,
      oldHead,
      oldIndexTree,
      project
    });
    return {
      baseCommit: context.baseCommit,
      canonicalCommit,
      changeBaseCommit: comparison.changeBaseCommit,
      checkpointCommit: checkpoint.commit,
      checkpointTree: checkpoint.tree,
      mergedCommit,
      mergedTree,
      ok: true,
      oldHead,
      oldIndexTree,
      operationId,
      mode: context.mode,
      repositoryMode: context.mode,
      ...reconciliation
    };
  }, {
    operation: `update-session:${context.sessionId}`
  });
}

async function recoverSessionWorkUpdate({
  commandOptions = {},
  project = {},
  recovery = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const required = [
    "canonicalCommit",
    "checkpointCommit",
    "checkpointTree",
    "mergedCommit",
    "mergedTree",
    "oldHead",
    "oldIndexTree"
  ];
  if (required.some((key) => !text(recovery[key]))) {
    throw saveError(
      "The interrupted session update stopped before mutation and can be retried.",
      "vibe64_session_update_interrupted_retryable",
      { retryable: true }
    );
  }
  return runProjectSourceExclusive(async () => {
    const head = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    });
    const tree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    const headIsOld = head === recovery.oldHead;
    const headIsCanonical = head === recovery.canonicalCommit;
    const treeIsCheckpoint = tree === recovery.checkpointTree;
    const treeIsMerged = tree === recovery.mergedTree;
    if ((!headIsOld && !headIsCanonical) || (!treeIsCheckpoint && !treeIsMerged)) {
      throw saveError(
        "The interrupted session update cannot be recovered automatically because the worktree changed.",
        "vibe64_session_update_recovery_changed"
      );
    }
    if (treeIsCheckpoint) {
      await git(runCommand, context, ["read-tree", "--reset", "-u", recovery.mergedCommit], {
        commandOptions,
        project
      });
    }
    if (headIsOld) {
      await git(runCommand, context, [
        "update-ref",
        "HEAD",
        recovery.canonicalCommit,
        recovery.oldHead
      ], {
        commandOptions,
        project
      });
    }
    await git(runCommand, context, ["read-tree", recovery.canonicalCommit], {
      commandOptions,
      project
    });
    const recoveredTree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    if (recoveredTree !== recovery.mergedTree) {
      throw saveError(
        "The interrupted session update could not reproduce its prepared worktree.",
        "vibe64_session_update_verification_failed"
      );
    }
    await rememberCanonicalCommit(runCommand, context, recovery.canonicalCommit, {
      commandOptions,
      project
    });
    return {
      ...recovery,
      currentTree: recoveredTree,
      ok: true,
      reconciled: true,
      recovered: true,
      status: "updated"
    };
  }, {
    operation: `recover-update-session:${context.sessionId}`
  });
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
  expectedMessageTree = "",
  message = "",
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
    if (text(expectedMessageTree) && checkpoint.tree !== text(expectedMessageTree)) {
      throw saveError(
        "The session changed while Vibe64 was naming this work. Save was not started; try again.",
        "vibe64_session_save_message_stale"
      );
    }
    await onProgress({ kind: "canonical", message: "Reading the current canonical branch.", stage: "canonical-reading" });
    const [canonicalCommit, sessionHead] = await Promise.all([
      readCanonical(runCommand, context, operationId, { commandOptions, project }),
      gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
        commandOptions,
        project
      })
    ]);
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
    const canonicalInSession = await commitIsAncestor(
      runCommand,
      context,
      canonicalCommit,
      sessionHead,
      { commandOptions, project }
    );
    if (canonicalCommit !== context.baseCommit && !canonicalInSession) {
      throw saveError(
        "The saved project has changed. Update this session (rebase) before saving its work.",
        "vibe64_session_save_update_required",
        {
          canonicalCommit,
          reconciledCommit: context.baseCommit,
          updateRequired: true
        }
      );
    }
    const comparison = await sessionWorkComparison(runCommand, context, {
      baseCommit: context.baseCommit,
      canonicalCommit,
      sessionHead,
      worktreeTree: checkpoint.tree
    }, { commandOptions, project });
    const changedPaths = comparison.changedPaths;
    if (!changedPaths.length) {
      throw saveError(
        "This session has no work to save.",
        "vibe64_session_save_no_changes"
      );
    }
    const currentVirtualCommit = await createVirtualCommit(runCommand, context, {
      baseCommit: comparison.changeBaseCommit,
      commandOptions,
      identity: author,
      message: "Vibe64 session sibling comparison",
      project,
      tree: checkpoint.tree
    });
    const siblings = await siblingWork({
      changedPaths,
      context,
      operationId
    });
    const changedPathSet = new Set(changedPaths);
    const siblingCandidates = (Array.isArray(siblings) ? siblings : [])
      .map((sibling) => ({
        ...sibling,
        overlappingPaths: (Array.isArray(sibling?.changedPaths) ? sibling.changedPaths : [])
          .filter((filePath) => changedPathSet.has(filePath))
          .sort((left, right) => left.localeCompare(right))
      }))
      .filter((sibling) => text(sibling?.sessionId) && sibling.overlappingPaths.length);
    const siblingResults = [];
    for (const sibling of siblingCandidates) {
      siblingResults.push(await compareSiblingWork(runCommand, context, {
        commandOptions,
        currentVirtualCommit,
        operationId,
        project,
        sibling
      }));
    }
    const siblingConflicts = siblingResults.filter(({ classification }) => (
      classification === "conflict" || classification === "unknown"
    ));
    if (siblingConflicts.length) {
      throw saveError(
        siblingConflicts.some(({ classification }) => classification === "unknown")
          ? "Vibe64 could not prove that overlapping work in another open session merges cleanly."
          : "This work conflicts with unsaved changes in another open session.",
        "vibe64_session_save_sibling_conflict",
        { siblingConflicts }
      );
    }
    const mergedTree = checkpoint.tree;
    const virtualCommit = currentVirtualCommit;
    const saveCommit = await createSaveCommit(runCommand, context, {
      canonicalCommit,
      commandOptions,
      identity: author,
      mergedTree: checkpoint.tree,
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
      changeBaseCommit: comparison.changeBaseCommit,
      changedPaths,
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
  checkSessionUpdates,
  inspectSessionChangeDiff,
  inspectSessionChanges,
  inspectSessionWork,
  parseGitNameStatusZ,
  parseGitNumstatZ,
  repositoryUpdateRelationship,
  repositoryUpdateStrategy,
  recoverSessionWorkSave,
  recoverSessionWorkUpdate,
  repositoryContext,
  safeChangePath,
  saveSessionWork,
  updateSessionWork
};
