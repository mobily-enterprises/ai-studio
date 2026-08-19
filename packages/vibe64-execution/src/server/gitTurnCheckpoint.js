import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import {
  runVibe64Command
} from "./runVibe64Command.js";

const GIT_CHECKPOINT_TIMEOUT_MS = 30_000;
const CHECKPOINT_OUTCOMES = new Set([
  "cancelled",
  "completed",
  "failed",
  "interrupted"
]);

async function createGitTurnCheckpoint({
  outerTurnId = "",
  outcome = "completed",
  project = {},
  runCommand = runVibe64Command,
  sessionId = "",
  timestamp = "",
  worktreePath = ""
} = {}) {
  const identity = checkpointIdentity({
    outerTurnId,
    outcome,
    sessionId,
    timestamp,
    worktreePath
  });
  const refs = checkpointRefs(identity);
  const existingCommit = await optionalGitOutput(runCommand, identity.worktreePath, [
    "rev-parse",
    "--verify",
    refs.turnRef
  ], { project });
  if (existingCommit) {
    return validateExistingCheckpoint({
      commit: existingCommit,
      identity,
      project,
      refs,
      runCommand
    });
  }

  const latestCommit = await optionalGitOutput(runCommand, identity.worktreePath, [
    "rev-parse",
    "--verify",
    refs.latestRef
  ], { project });
  const baseCommit = latestCommit || await requiredGitOutput(runCommand, identity.worktreePath, [
    "rev-parse",
    "--verify",
    "HEAD"
  ], { project });
  const tree = await writeGitWorktreeTree({
    baseCommit,
    project,
    runCommand,
    worktreePath: identity.worktreePath
  });
  const message = checkpointMessage(identity);
  const commit = await requiredGitOutput(runCommand, identity.worktreePath, [
    "commit-tree",
    tree,
    "-p",
    baseCommit
  ], {
    env: checkpointDateEnv(identity.timestamp),
    input: message,
    project
  });
  const absentObject = await zeroObjectId(runCommand, identity.worktreePath, { project });
  await requiredGitOutput(runCommand, identity.worktreePath, [
    "update-ref",
    refs.turnRef,
    commit,
    absentObject
  ], { project });
  await requiredGitOutput(runCommand, identity.worktreePath, [
    "update-ref",
    refs.latestRef,
    commit,
    latestCommit || absentObject
  ], { project });
  return {
    baseCommit,
    commit,
    created: true,
    latestRef: refs.latestRef,
    ok: true,
    outerTurnId: identity.outerTurnId,
    outcome: identity.outcome,
    sessionId: identity.sessionId,
    tree,
    turnRef: refs.turnRef
  };
}

async function writeGitWorktreeTree({
  baseCommit = "HEAD",
  paths = [],
  project = {},
  runCommand = runVibe64Command,
  worktreePath = ""
} = {}) {
  const normalizedWorktreePath = path.resolve(singleLine(worktreePath, "worktreePath"));
  const gitDirectory = await requiredGitOutput(runCommand, normalizedWorktreePath, [
    "rev-parse",
    "--absolute-git-dir"
  ], { project });
  const checkpointRoot = path.join(gitDirectory, "vibe64-checkpoints");
  await mkdir(checkpointRoot, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(checkpointRoot, ".tree-"));
  const temporaryIndex = path.join(temporaryRoot, "index");
  try {
    const indexEnv = { GIT_INDEX_FILE: temporaryIndex };
    await requiredGitOutput(runCommand, normalizedWorktreePath, [
      "read-tree",
      baseCommit || "HEAD"
    ], { env: indexEnv, project });
    const selectedPaths = Array.isArray(paths)
      ? paths.map((entry) => String(entry || "")).filter(Boolean)
      : [];
    await requiredGitOutput(runCommand, normalizedWorktreePath, [
      "add",
      "-A",
      "--",
      ...(selectedPaths.length > 0 ? selectedPaths : ["."])
    ], { env: indexEnv, project });
    return await requiredGitOutput(runCommand, normalizedWorktreePath, [
      "write-tree"
    ], { env: indexEnv, project });
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function validateExistingCheckpoint({
  commit = "",
  identity = {},
  project = {},
  refs = {},
  runCommand = runVibe64Command
} = {}) {
  const message = await requiredGitOutput(runCommand, identity.worktreePath, [
    "show",
    "-s",
    "--format=%B",
    commit
  ], { project });
  if (message !== checkpointMessage(identity).trim()) {
    throw checkpointError(
      "Existing Vibe64 turn checkpoint does not match its durable turn identity.",
      "vibe64_checkpoint_identity_mismatch"
    );
  }
  const tree = await requiredGitOutput(runCommand, identity.worktreePath, [
    "rev-parse",
    `${commit}^{tree}`
  ], { project });
  const latestCommit = await optionalGitOutput(runCommand, identity.worktreePath, [
    "rev-parse",
    "--verify",
    refs.latestRef
  ], { project });
  if (!latestCommit) {
    const absentObject = await zeroObjectId(runCommand, identity.worktreePath, { project });
    await requiredGitOutput(runCommand, identity.worktreePath, [
      "update-ref",
      refs.latestRef,
      commit,
      absentObject
    ], { project });
  }
  return {
    baseCommit: await requiredGitOutput(runCommand, identity.worktreePath, [
      "rev-parse",
      `${commit}^`
    ], { project }),
    commit,
    created: false,
    latestRef: refs.latestRef,
    ok: true,
    outerTurnId: identity.outerTurnId,
    outcome: identity.outcome,
    sessionId: identity.sessionId,
    tree,
    turnRef: refs.turnRef
  };
}

function checkpointIdentity({
  outerTurnId = "",
  outcome = "completed",
  sessionId = "",
  timestamp = "",
  worktreePath = ""
} = {}) {
  const normalizedOutcome = singleLine(outcome, "outcome").toLowerCase();
  if (!CHECKPOINT_OUTCOMES.has(normalizedOutcome)) {
    throw checkpointError(
      `Unsupported Vibe64 turn checkpoint outcome: ${normalizedOutcome || "(empty)"}.`,
      "vibe64_checkpoint_outcome_invalid"
    );
  }
  const normalizedTimestamp = singleLine(timestamp, "timestamp");
  if (!Number.isFinite(Date.parse(normalizedTimestamp))) {
    throw checkpointError(
      "Vibe64 turn checkpoint timestamp must be an ISO date.",
      "vibe64_checkpoint_timestamp_invalid"
    );
  }
  const normalizedWorktreePath = path.resolve(singleLine(worktreePath, "worktreePath"));
  return {
    outerTurnId: singleLine(outerTurnId, "outerTurnId"),
    outcome: normalizedOutcome,
    sessionId: singleLine(sessionId, "sessionId"),
    timestamp: new Date(normalizedTimestamp).toISOString(),
    worktreePath: normalizedWorktreePath
  };
}

function checkpointRefs(identity = {}) {
  const root = checkpointRefRoot(identity.sessionId);
  const turnDigest = checkpointDigest(identity.outerTurnId);
  return {
    latestRef: `${root}/latest`,
    turnRef: `${root}/${turnDigest}`
  };
}

function checkpointRefRoot(sessionId = "") {
  return `refs/vibe64/checkpoints/${checkpointDigest(sessionId)}`;
}

function checkpointDigest(value = "") {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
}

function checkpointMessage(identity = {}) {
  return [
    `vibe64 checkpoint: session ${identity.sessionId} turn ${identity.outerTurnId}`,
    "",
    "Vibe64-Checkpoint: true",
    `Vibe64-Session: ${identity.sessionId}`,
    `Vibe64-Outer-Turn: ${identity.outerTurnId}`,
    `Vibe64-Turn-Outcome: ${identity.outcome}`,
    ""
  ].join("\n");
}

function checkpointDateEnv(timestamp = "") {
  return {
    GIT_AUTHOR_DATE: timestamp,
    GIT_COMMITTER_DATE: timestamp
  };
}

async function zeroObjectId(runCommand, worktreePath, { project = {} } = {}) {
  const format = await optionalGitOutput(runCommand, worktreePath, [
    "rev-parse",
    "--show-object-format"
  ], { project });
  return "0".repeat(format === "sha256" ? 64 : 40);
}

async function optionalGitOutput(runCommand, worktreePath, args, options = {}) {
  const result = await gitCommand(runCommand, worktreePath, args, options);
  return result.ok === true ? String(result.stdout || "").trim() : "";
}

async function requiredGitOutput(runCommand, worktreePath, args, options = {}) {
  const result = await gitCommand(runCommand, worktreePath, args, options);
  if (result.ok !== true) {
    throw checkpointError(
      String(result.stderr || result.stdout || result.output || result.error || "Git checkpoint command failed.").trim(),
      result.code || "vibe64_checkpoint_git_failed"
    );
  }
  return String(result.stdout || "").trim();
}

function gitCommand(runCommand, worktreePath, args, {
  env = {},
  input,
  project = {}
} = {}) {
  return runCommand({
    actor: "daemon",
    allowedRoots: [worktreePath],
    args,
    command: "git",
    cwd: worktreePath,
    env,
    envPolicy: "session",
    gitSafeDirectories: [worktreePath],
    input,
    mode: "capture",
    project,
    purpose: "source",
    runtimes: ["git"],
    timeout: GIT_CHECKPOINT_TIMEOUT_MS
  });
}

function singleLine(value = "", label = "value") {
  const normalized = String(value || "").trim();
  const hasControlCharacter = Array.from(normalized).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
  if (!normalized || normalized.length > 512 || hasControlCharacter) {
    throw checkpointError(
      `Vibe64 turn checkpoint ${label} is invalid.`,
      `vibe64_checkpoint_${label.replaceAll(/[^A-Za-z0-9]+/gu, "_").toLowerCase()}_invalid`
    );
  }
  return normalized;
}

function checkpointError(message = "", code = "vibe64_checkpoint_failed") {
  const error = new Error(message || "Vibe64 turn checkpoint failed.");
  error.code = code;
  return error;
}

export {
  checkpointRefRoot,
  checkpointRefs,
  createGitTurnCheckpoint,
  writeGitWorktreeTree
};
