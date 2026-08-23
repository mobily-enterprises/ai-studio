import {
  mkdir,
  mkdtemp,
  readdir,
  rm
} from "node:fs/promises";
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
  initializeProject = initializeGenesisProject,
  projectContextRoot = "",
  projectRuntimeRoot = "",
  runCommand = runVibe64Command
} = {}) {
  const namespaceInput = normalizeText(projectContextRoot);
  const runtimeInput = normalizeText(projectRuntimeRoot);
  if (!namespaceInput || !runtimeInput || !path.isAbsolute(namespaceInput) || !path.isAbsolute(runtimeInput)) {
    throw vibe64Error(
      "Managed project initialization requires absolute namespace and runtime roots.",
      "vibe64_managed_project_root_invalid"
    );
  }
  const namespaceRoot = path.resolve(namespaceInput);
  const runtimeRoot = path.resolve(runtimeInput);
  if ((await readdir(namespaceRoot)).length > 0) {
    throw vibe64Error(
      "A new managed project must start from an empty hosted namespace.",
      "vibe64_managed_project_namespace_not_empty"
    );
  }

  const branch = normalizeText(defaultBranch) || "main";
  const repositoryPath = resolveProjectCanonicalRepositoryPath({
    projectRuntimeRoot: runtimeRoot
  });
  const repositoryRoot = path.dirname(repositoryPath);
  const temporaryRoot = path.join(runtimeRoot, "tmp");
  await mkdir(temporaryRoot, {
    recursive: true
  });
  const sourceRoot = await mkdtemp(path.join(temporaryRoot, "managed-genesis-"));
  const allowedRoots = [sourceRoot, runtimeRoot, repositoryRoot, repositoryPath];
  try {
    await runGit(["init", `--initial-branch=${branch}`], {
      allowedRoots,
      cwd: sourceRoot,
      runCommand
    });
    await initializeProject({
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
    const commit = await runGit(["rev-parse", "HEAD^{commit}"], {
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
    const canonicalCommit = await runGit([
      "--git-dir", repositoryPath,
      "rev-parse", "--verify", `refs/heads/${branch}^{commit}`
    ], {
      allowedRoots,
      cwd: repositoryRoot,
      runCommand
    });
    if (canonicalCommit !== commit) {
      throw vibe64Error(
        "The canonical repository did not retain the exact initial Genesis commit.",
        "vibe64_managed_project_canonical_verification_failed"
      );
    }

    return {
      branch,
      commit,
      repositoryPath
    };
  } finally {
    await rm(sourceRoot, {
      force: true,
      recursive: true
    });
  }
}

export {
  initializeManagedGenesisProject
};
