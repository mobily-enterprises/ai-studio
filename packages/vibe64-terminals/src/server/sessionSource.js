import path from "node:path";
import { mkdir } from "node:fs/promises";

import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  normalizeRepositoryMode
} from "@local/vibe64-core/server/projectRepository";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
  targetSessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  githubCredentialContext,
  normalizeGithubAccountMode,
  runVibe64Command
} from "@local/vibe64-execution/server";

const SESSION_BRANCH_PREFIX = "vibe64/";

function sourceError(message = "", code = "vibe64_session_source_failed") {
  return vibe64Error(message || "Vibe64 could not create the session source.", code);
}

async function runGit(cwd = "", args = [], allowedRoots = [], {
  actor = "daemon",
  credentialHome = null,
  gitAuthToken = "",
  gitTransport = "none",
  userKey = ""
} = {}) {
  const githubTransport = gitTransport === "github-https" || gitTransport === "github-token";
  const result = await runVibe64Command({
    actor,
    allowedRoots,
    args,
    command: "git",
    ...(credentialHome ? { credentialHome } : {}),
    cwd,
    envPolicy: "project",
    ...(gitAuthToken ? { gitAuthToken } : {}),
    gitSafeDirectories: allowedRoots,
    gitTransport,
    mode: "capture",
    purpose: githubTransport ? "github" : "source",
    runtimes: gitTransport === "github-https" ? ["git", "gh"] : ["git"],
    timeout: 60_000,
    ...(userKey ? { userKey } : {})
  });
  if (result?.ok !== true) {
    throw sourceError(
      normalizeText(result?.stderr || result?.output || result?.error) || "Git command failed while creating the session source.",
      normalizeText(result?.code) || "vibe64_session_source_git_failed"
    );
  }
  return normalizeText(result.stdout || result.output);
}

async function githubSourceCommandOptions(vibe64User = null, env = process.env, {
  runCommand = runVibe64Command
} = {}) {
  const accountMode = normalizeGithubAccountMode(
    env?.[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
    GITHUB_ACCOUNT_MODE_LOCAL
  );
  const context = githubCredentialContext({
    vibe64User
  }, {
    accountMode
  });
  if (context?.ok === false) {
    throw sourceError(
      context.error || "Connect GitHub before creating a session from this project.",
      context.code || "vibe64_session_source_github_credentials_required"
    );
  }
  if (accountMode === GITHUB_ACCOUNT_MODE_LOCAL) {
    return {
      actor: "daemon",
      credentialHome: {
        gid: context.gid,
        home: context.home,
        scope: context.scope,
        uid: context.uid,
        username: context.username
      },
      gitTransport: "github-https"
    };
  }
  const tokenResult = await runCommand({
    actor: "named-user",
    allowedRoots: [context.home],
    args: ["auth", "token"],
    command: "gh",
    cwd: context.home,
    envPolicy: "auth",
    gitTransport: "none",
    mode: "capture",
    project: {
      ownerUserKey: context.username
    },
    purpose: "github-api",
    runtimes: ["gh"],
    timeout: 60_000,
    userKey: context.username
  });
  const token = tokenResult?.ok === true ? normalizeText(tokenResult.stdout) : "";
  if (!token) {
    throw sourceError(
      normalizeText(tokenResult?.stderr || tokenResult?.error) ||
        "GitHub authentication is not ready for this Vibe64 account.",
      "vibe64_session_source_github_credentials_required"
    );
  }
  return {
    actor: "daemon",
    gitAuthToken: token,
    gitTransport: "github-token"
  };
}

async function optionalGitOutput(cwd = "", args = [], allowedRoots = []) {
  try {
    return await runGit(cwd, args, allowedRoots);
  } catch {
    return "";
  }
}

async function ensureLocalProjectBaseline(targetRoot = "") {
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

function canonicalProjectSource(project = {}, targetRoot = "") {
  const repository = project?.repository && typeof project.repository === "object"
    ? project.repository
    : {};
  const mode = normalizeRepositoryMode(project.repositoryMode || repository.mode);
  const branch = normalizeText(repository.defaultBranch);
  if (mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    const github = project.githubRepository || repository.github || {};
    const remoteUrl = normalizeText(github.cloneUrl);
    if (!remoteUrl || !branch) {
      throw sourceError(
        "The GitHub project does not declare a complete canonical repository and default branch.",
        "vibe64_session_source_canonical_repository_missing"
      );
    }
    return {
      branch,
      cacheRoot: targetRoot,
      mode,
      remoteUrl,
      source: remoteUrl
    };
  }
  if (mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    const repositoryPath = normalizeText(project.canonicalRepositoryPath);
    if (!repositoryPath || !branch) {
      throw sourceError(
        "The Vibe64 Git project does not declare a complete canonical repository and default branch.",
        "vibe64_session_source_canonical_repository_missing"
      );
    }
    return {
      branch,
      cacheRoot: targetRoot,
      mode,
      remoteUrl: repositoryPath,
      source: repositoryPath
    };
  }
  if (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    return {
      mode,
      source: targetRoot
    };
  }
  throw sourceError(
    "The project does not declare whether its canonical source is GitHub, Vibe64 Git, or local source.",
    "vibe64_session_source_repository_mode_missing"
  );
}

async function cloneCanonicalSource({
  branch = "",
  cacheRoot = "",
  commandOptions = {},
  source = "",
  sourceParent = "",
  sourcePath = ""
} = {}) {
  const roots = [cacheRoot, source, sourceParent, sourcePath]
    .map(normalizeText)
    .filter((value) => path.isAbsolute(value));
  const referenceArgs = cacheRoot && await pathExists(path.join(cacheRoot, ".git"))
    ? ["--reference-if-able", cacheRoot, "--dissociate"]
    : [];
  await runGit(sourceParent, [
    "clone",
    "--no-hardlinks",
    ...referenceArgs,
    "--single-branch",
    "--branch", branch,
    source,
    sourcePath
  ], roots, commandOptions);
  const commit = await runGit(sourcePath, ["rev-parse", "--verify", "HEAD"], roots);
  return {
    branch,
    commit,
    remoteUrl: source
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
  env = process.env,
  project = {},
  runtime,
  session = {},
  store,
  vibe64User = null
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
  const canonical = canonicalProjectSource(project, targetRoot);
  let baseline = canonical.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
    ? await ensureLocalProjectBaseline(targetRoot)
    : null;
  await mkdir(sourceParent, {
    recursive: true
  });

  const sourceRoots = [targetRoot, canonical.source, sourceParent, sourcePath]
    .map(normalizeText)
    .filter((value) => path.isAbsolute(value));
  const existingTopLevel = await optionalGitOutput(sourcePath, ["rev-parse", "--show-toplevel"], sourceRoots);
  if (existingTopLevel && path.resolve(existingTopLevel) !== path.resolve(sourcePath)) {
    throw sourceError(
      `Session source path is already owned by another Git repository: ${sourcePath}`,
      "vibe64_session_source_path_conflict"
    );
  }
  if (!existingTopLevel) {
    if (canonical.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
      await runGit(sourceParent, [
        "clone",
        "--no-hardlinks",
        "--single-branch",
        "--branch", baseline.branch,
        targetRoot,
        sourcePath
      ], sourceRoots);
    } else {
      baseline = await cloneCanonicalSource({
        branch: canonical.branch,
        cacheRoot: canonical.cacheRoot,
        commandOptions: canonical.mode === PROJECT_REPOSITORY_MODE_GITHUB
          ? await githubSourceCommandOptions(vibe64User, env)
          : {},
        source: canonical.source,
        sourceParent,
        sourcePath
      });
    }
  }
  const resolvedBaseline = baseline || {
    branch: canonical.branch,
    commit: await runGit(sourcePath, ["rev-parse", "--verify", "HEAD"], sourceRoots),
    remoteUrl: canonical.remoteUrl
  };
  await runGit(sourcePath, ["checkout", "-B", branch, resolvedBaseline.commit], sourceRoots);
  if (resolvedBaseline.remoteUrl) {
    await runGit(sourcePath, ["remote", "set-url", "origin", resolvedBaseline.remoteUrl], sourceRoots);
  }
  await attachSessionSource(store, sessionId, {
    base_branch: resolvedBaseline.branch,
    base_commit: resolvedBaseline.commit,
    canonical_commit: resolvedBaseline.commit,
    branch,
    main_checkout_root: targetRoot,
    source_default_branch: resolvedBaseline.branch,
    source_kind: "session_clone",
    source_path: sourcePath,
    source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
    source_remote_url: resolvedBaseline.remoteUrl
  });
  return {
    branch,
    commit: resolvedBaseline.commit,
    ok: true,
    sourcePath
  };
}

export {
  createSessionSource,
  githubSourceCommandOptions
};
