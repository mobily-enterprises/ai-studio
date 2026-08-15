import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  resolveProjectCanonicalRepositoryPath
} from "@local/vibe64-core/server/projectState";
import {
  canonicalRepositoryInitializeScript,
  canonicalRepositoryInstallRefScript,
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  initializeGenesisProject
} from "@local/vibe64-genesis/server";

function managedProjectError(result = {}, fallback = "Managed project initialization failed.") {
  return vibe64Error(
    normalizeText(result.stderr || result.output || result.error) || fallback,
    normalizeText(result.code) || "vibe64_managed_project_initialization_failed"
  );
}

async function runGit(args = [], {
  allowedRoots = [],
  cwd = "",
  runCommand = runVibe64Command
} = {}) {
  const result = await runCommand({
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
    throw managedProjectError(result, "Git failed while initializing the managed project.");
  }
  return normalizeText(result.stdout || result.output);
}

async function initializeCanonicalRepository(repositoryPath, branch, {
  allowedRoots,
  repositoryRoot,
  runCommand
} = {}) {
  const result = await runCommand({
    actor: "daemon",
    allowedRoots,
    args: ["-lc", canonicalRepositoryInitializeScript({
      defaultBranch: branch,
      repositoryPath
    })],
    command: "bash",
    cwd: repositoryRoot,
    envPolicy: "project",
    gitSafeDirectories: allowedRoots,
    mode: "capture",
    purpose: "source",
    runtimes: ["git"],
    timeout: 60_000
  });
  if (result?.ok !== true) {
    throw managedProjectError(result, "Canonical repository initialization failed.");
  }
}

async function installCanonicalCommit(repositoryPath, sourceRoot, branch, {
  allowedRoots,
  repositoryRoot,
  runCommand
} = {}) {
  const result = await runCommand({
    actor: "daemon",
    allowedRoots,
    args: ["-lc", canonicalRepositoryInstallRefScript({
      repositoryPath,
      sourceRef: `refs/heads/${branch}`,
      sourceRepository: sourceRoot,
      targetRef: `refs/heads/${branch}`
    })],
    command: "bash",
    cwd: repositoryRoot,
    envPolicy: "project",
    gitSafeDirectories: allowedRoots,
    mode: "capture",
    purpose: "source",
    runtimes: ["git"],
    timeout: 60_000
  });
  if (result?.ok !== true) {
    throw managedProjectError(result, "The initial Genesis commit could not be installed in canonical Git storage.");
  }
}

async function initializeManagedGenesisProject({
  defaultBranch = "main",
  projectRuntimeRoot = "",
  runCommand = runVibe64Command,
  targetRoot = ""
} = {}) {
  const sourceInput = normalizeText(targetRoot);
  const runtimeInput = normalizeText(projectRuntimeRoot);
  if (!sourceInput || !runtimeInput || !path.isAbsolute(sourceInput) || !path.isAbsolute(runtimeInput)) {
    throw vibe64Error(
      "Managed project initialization requires absolute source and runtime roots.",
      "vibe64_managed_project_root_invalid"
    );
  }
  const sourceRoot = path.resolve(sourceInput);
  const runtimeRoot = path.resolve(runtimeInput);
  if ((await readdir(sourceRoot)).length > 0) {
    throw vibe64Error(
      "A new managed project must start from an empty source directory.",
      "vibe64_managed_project_source_not_empty"
    );
  }

  const branch = normalizeText(defaultBranch) || "main";
  const repositoryPath = resolveProjectCanonicalRepositoryPath({
    projectRoot: runtimeRoot
  });
  const repositoryRoot = path.dirname(repositoryPath);
  const allowedRoots = [sourceRoot, runtimeRoot, repositoryRoot, repositoryPath];

  await runGit(["init", `--initial-branch=${branch}`], {
    allowedRoots,
    cwd: sourceRoot,
    runCommand
  });
  await initializeGenesisProject({
    projectRoot: sourceRoot
  });
  await runGit(["add", "-A"], {
    allowedRoots,
    cwd: sourceRoot,
    runCommand
  });
  await runGit([
    "-c", "user.name=Vibe64",
    "-c", "user.email=vibe64@localhost",
    "commit", "-m", "Initialize Genesis project"
  ], {
    allowedRoots,
    cwd: sourceRoot,
    runCommand
  });

  await mkdir(repositoryRoot, {
    recursive: true
  });
  await initializeCanonicalRepository(repositoryPath, branch, {
    allowedRoots,
    repositoryRoot,
    runCommand
  });
  await installCanonicalCommit(repositoryPath, sourceRoot, branch, {
    allowedRoots,
    repositoryRoot,
    runCommand
  });
  await runGit(["remote", "add", "origin", repositoryPath], {
    allowedRoots,
    cwd: sourceRoot,
    runCommand
  });
  await runGit(["config", `branch.${branch}.remote`, "origin"], {
    allowedRoots,
    cwd: sourceRoot,
    runCommand
  });
  await runGit(["config", `branch.${branch}.merge`, `refs/heads/${branch}`], {
    allowedRoots,
    cwd: sourceRoot,
    runCommand
  });

  return {
    branch,
    commit: await runGit(["rev-parse", "HEAD^{commit}"], {
      allowedRoots,
      cwd: sourceRoot,
      runCommand
    }),
    repositoryPath,
    sourceRoot
  };
}

export {
  initializeManagedGenesisProject
};
