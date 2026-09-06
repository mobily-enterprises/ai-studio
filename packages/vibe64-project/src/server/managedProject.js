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

function initialProjectError(result = {}, fallback = "Initial project materialization failed.") {
  return vibe64Error(
    normalizeText(result.stderr || result.output || result.error) || fallback,
    normalizeText(result.code) || "vibe64_initial_project_materialization_failed"
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
    throw initialProjectError(result, "Git failed while materializing the initial project.");
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
    throw initialProjectError(result, "Canonical repository initialization failed.");
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
    throw initialProjectError(result, "The initial project commit could not be installed in canonical Git storage.");
  }
}

function absoluteRuntimeRoot(projectRuntimeRoot = "") {
  const input = normalizeText(projectRuntimeRoot);
  if (!input || !path.isAbsolute(input)) {
    throw vibe64Error(
      "Initial project materialization requires an absolute runtime root.",
      "vibe64_initial_project_runtime_root_invalid"
    );
  }
  return path.resolve(input);
}

async function materializeInitialProject({
  afterAuthorityVerification = null,
  beforeAuthorityMutation = null,
  defaultBranch = "main",
  initializeProject = initializeGenesisProject,
  projectName = "",
  projectRuntimeRoot = "",
  publish,
  runCommand = runVibe64Command
} = {}) {
  if (typeof publish !== "function") {
    throw new TypeError("materializeInitialProject requires publish.");
  }
  const runtimeRoot = absoluteRuntimeRoot(projectRuntimeRoot);
  const branch = normalizeText(defaultBranch) || "main";
  const temporaryRoot = path.join(runtimeRoot, "tmp");
  await mkdir(temporaryRoot, {
    recursive: true
  });
  const sourceRoot = await mkdtemp(path.join(temporaryRoot, "initial-project-"));
  const allowedRoots = [sourceRoot, runtimeRoot];
  try {
    await runGit(["init", `--initial-branch=${branch}`], {
      allowedRoots,
      cwd: sourceRoot,
      runCommand
    });
    await initializeProject({
      projectName,
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
      "commit", "-m", "Initialize Vibe64 project"
    ], {
      allowedRoots,
      cwd: sourceRoot,
      runCommand
    });
    const [commit, commitCount, rootCommit] = await Promise.all([
      runGit(["rev-parse", "HEAD^{commit}"], {
        allowedRoots,
        cwd: sourceRoot,
        runCommand
      }),
      runGit(["rev-list", "--count", "HEAD"], {
        allowedRoots,
        cwd: sourceRoot,
        runCommand
      }),
      runGit(["rev-list", "--parents", "-n", "1", "HEAD"], {
        allowedRoots,
        cwd: sourceRoot,
        runCommand
      })
    ]);
    if (commitCount !== "1" || rootCommit.split(/\s+/u).filter(Boolean).length !== 1) {
      throw vibe64Error(
        "The initial project did not produce exactly one root commit.",
        "vibe64_initial_project_commit_invalid"
      );
    }

    const materialization = {
      branch,
      commit
    };
    if (typeof beforeAuthorityMutation === "function") {
      await beforeAuthorityMutation(materialization);
    }
    const publication = await publish({
      ...materialization,
      sourceRoot
    });
    if (typeof afterAuthorityVerification === "function") {
      await afterAuthorityVerification(materialization);
    }
    return {
      materialization: {
        ...(publication && typeof publication === "object" && !Array.isArray(publication)
          ? publication
          : {}),
        ...materialization
      },
      ok: true
    };
  } finally {
    await rm(sourceRoot, {
      force: true,
      recursive: true
    });
  }
}

async function initializeManagedProject({
  defaultBranch = "main",
  initializeProject = initializeGenesisProject,
  projectContextRoot = "",
  projectName = "",
  projectRuntimeRoot = "",
  runCommand = runVibe64Command
} = {}) {
  const namespaceInput = normalizeText(projectContextRoot);
  const runtimeInput = normalizeText(projectRuntimeRoot);
  if (
    !namespaceInput ||
    !runtimeInput ||
    !path.isAbsolute(namespaceInput) ||
    !path.isAbsolute(runtimeInput)
  ) {
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

  const repositoryPath = resolveProjectCanonicalRepositoryPath({
    projectRuntimeRoot: runtimeRoot
  });
  const repositoryRoot = path.dirname(repositoryPath);
  const result = await materializeInitialProject({
    defaultBranch,
    initializeProject,
    projectName,
    projectRuntimeRoot: runtimeRoot,
    publish: async ({ branch, commit, sourceRoot }) => {
      const allowedRoots = [sourceRoot, runtimeRoot, repositoryRoot, repositoryPath];
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
          "The canonical repository did not retain the exact initial project commit.",
          "vibe64_managed_project_canonical_verification_failed"
        );
      }
      return {
        repositoryPath
      };
    },
    runCommand
  });
  return result.materialization;
}

export {
  initializeManagedProject,
  materializeInitialProject
};
