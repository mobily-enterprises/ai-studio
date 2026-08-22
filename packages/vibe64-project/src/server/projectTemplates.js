import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat
} from "node:fs/promises";
import path from "node:path";

import {
  addGenesisStack,
  initializeGenesisProject
} from "@local/vibe64-genesis/server";
import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  canonicalRepositoryInitializeScript,
  canonicalRepositoryInstallRefScript,
  githubCredentialContext,
  githubMirrorRefreshInvocation,
  normalizeGithubAccountMode,
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  normalizeRepositoryMode
} from "@local/vibe64-core/server/projectRepository";
import {
  resolveProjectCanonicalRepositoryPath,
  resolveProjectGithubMirrorPath
} from "@local/vibe64-core/server/projectState";

const PROJECT_TEMPLATE_SOURCE_REF = "refs/vibe64/template-source";
const PROJECT_TEMPLATE_MATERIALIZED_REF = "refs/vibe64/template-materialized";
const PROJECT_TEMPLATE_DESTINATION_REF = "refs/vibe64/template-destination";
const PROJECT_TEMPLATE_SCHEMA = "vibe64.seed";
const PROJECT_TEMPLATE_SCHEMA_VERSION = 1;
const PROJECT_TEMPLATE_SOURCE_FILE = "vibe64.seed.json";
const PROJECT_TEMPLATE_GIT_TIMEOUT_MS = 120_000;
const PROJECT_TEMPLATE_IGNORED_LOCAL_ENTRIES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini"
]);

const projectTemplateLocks = new Map();

const PROJECT_TEMPLATES = Object.freeze([
  projectTemplate({
    accent: "slate",
    capabilities: ["Empty Git project", "Genesis ready", "No technology selected"],
    description: "Start with only Git and Genesis. Choose any language, framework, database, or platform later with Codex.",
    icon: "blank",
    id: "genesis-blank",
    kind: "blank",
    name: "Blank project",
    order: 0,
    tagline: "Start with intent, not a framework"
  }),
  projectTemplate({
    accent: "sky",
    capabilities: ["No sign-in", "No database"],
    description: "Visitors can open and use the app without creating an account. A natural fit for public tools, directories, content and landing experiences.",
    icon: "web",
    id: "jskit-public",
    name: "Public",
    order: 10,
    stackPieces: ["jskit"],
    repository: "vibe64-dev/jskit-seed-public",
    tagline: "A public experience for everyone"
  }),
  projectTemplate({
    accent: "violet",
    capabilities: ["Personal accounts", "Private areas"],
    description: "People can sign up and sign in, then use their own private area. Choose this when the app needs accounts but does not need persistent application data yet.",
    icon: "account",
    id: "jskit-accounts",
    name: "Accounts",
    order: 20,
    stackPieces: ["jskit"],
    repository: "vibe64-dev/jskit-seed-accounts",
    tagline: "A private space for every person"
  }),
  projectTemplate({
    accent: "amber",
    capabilities: ["Database accounts", "Persistent records"],
    description: "People sign in and work with records that stay safely in the database. Each person gets their own experience, without team or workspace sharing.",
    icon: "database",
    id: "jskit-database",
    name: "Database",
    order: 30,
    stackPieces: ["jskit-mysql"],
    repository: "vibe64-dev/jskit-seed-database",
    tagline: "Personal accounts with lasting data"
  }),
  projectTemplate({
    accent: "emerald",
    capabilities: ["Team workspaces", "Shared database"],
    description: "People sign in, create or join workspaces, and collaborate on shared information. Choose this for team products and multi-organisation apps.",
    icon: "workspaces",
    id: "jskit-workspaces",
    name: "Workspaces",
    order: 40,
    stackPieces: ["jskit-mysql"],
    repository: "vibe64-dev/jskit-seed-workspaces",
    tagline: "A shared place for teams to work"
  })
]);

function projectTemplate(value = {}) {
  const repository = normalizeText(value.repository);
  const kind = normalizeText(value.kind) || "starter";
  return Object.freeze({
    accent: normalizeText(value.accent),
    basedOn: value.basedOn || null,
    capabilities: Object.freeze((Array.isArray(value.capabilities) ? value.capabilities : [])
      .map(normalizeText)
      .filter(Boolean)),
    cloneUrl: normalizeText(value.cloneUrl) || (repository ? `https://github.com/${repository}.git` : ""),
    description: normalizeText(value.description),
    icon: normalizeText(value.icon),
    id: normalizeText(value.id),
    kind,
    name: normalizeText(value.name),
    order: Number.isFinite(Number(value.order)) ? Number(value.order) : 0,
    stackPieces: Object.freeze((Array.isArray(value.stackPieces) ? value.stackPieces : [])
      .map(normalizeText)
      .filter(Boolean)),
    ref: normalizeText(value.ref) || "refs/heads/main",
    repository,
    repositoryUrl: normalizeText(value.repositoryUrl) || (repository ? `https://github.com/${repository}` : ""),
    tagline: normalizeText(value.tagline)
  });
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function templateError(code, message, {
  details = null,
  statusCode = 400
} = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  error.statusCode = statusCode;
  return error;
}

function publicProjectTemplate(template = {}) {
  return {
    accent: template.accent,
    basedOn: template.basedOn,
    capabilities: [...template.capabilities],
    description: template.description,
    icon: template.icon,
    id: template.id,
    kind: template.kind,
    name: template.name,
    repository: template.repository,
    repositoryUrl: template.repositoryUrl,
    tagline: template.tagline
  };
}

function resolveProjectTemplate(templateId = "", templates = PROJECT_TEMPLATES) {
  const id = normalizeText(templateId);
  const template = (Array.isArray(templates) ? templates : [])
    .find((entry) => entry.id === id);
  if (!template) {
    throw templateError(
      "vibe64_project_template_invalid",
      "Choose one of the available project templates."
    );
  }
  return template;
}

function projectRepositoryMode(project = {}, sourceRoot = "") {
  return normalizeRepositoryMode(project.repositoryMode || project.repository?.mode) ||
    (sourceRoot ? PROJECT_REPOSITORY_MODE_LOCAL_SOURCE : "");
}

function projectDefaultBranch(project = {}) {
  const branch = normalizeText(project.repository?.defaultBranch);
  if (!branch) {
    throw templateError(
      "vibe64_project_repository_default_branch_missing",
      "The project repository does not define a default branch."
    );
  }
  return branch;
}

function projectGithubRepository(project = {}) {
  return project.githubRepository || project.repository?.github || null;
}

function projectGithubCloneUrl(project = {}) {
  const repository = projectGithubRepository(project);
  const fullName = normalizeText(repository?.fullName);
  return normalizeText(repository?.cloneUrl) || (fullName ? `https://github.com/${fullName}.git` : "");
}

function projectRepositoryStoragePath({
  code = "vibe64_project_repository_storage_path_invalid",
  explicitPath = "",
  resolvePath,
  targetRoot = ""
} = {}) {
  const configuredPath = normalizeText(explicitPath);
  const expectedPath = targetRoot && typeof resolvePath === "function"
    ? resolvePath({
        projectRoot: targetRoot
      })
    : "";
  if (
    configuredPath &&
    (
      !path.isAbsolute(configuredPath) ||
      (expectedPath && path.resolve(configuredPath) !== path.resolve(expectedPath))
    )
  ) {
    throw templateError(
      code,
      "The project repository storage path does not match its repository mode.",
      {
        statusCode: 409
      }
    );
  }
  return configuredPath || expectedPath;
}

function projectCanonicalRepositoryPath(project = {}, targetRoot = "") {
  return projectRepositoryStoragePath({
    code: "vibe64_project_canonical_repository_path_invalid",
    explicitPath: project.canonicalRepositoryPath,
    resolvePath: resolveProjectCanonicalRepositoryPath,
    targetRoot: project.projectRuntimeRoot || targetRoot
  });
}

function projectGithubMirrorPath(project = {}, targetRoot = "") {
  return projectRepositoryStoragePath({
    code: "vibe64_project_github_mirror_path_invalid",
    explicitPath: project.githubMirrorPath,
    resolvePath: resolveProjectGithubMirrorPath,
    targetRoot: project.projectRuntimeRoot || targetRoot
  });
}

async function pathIsDirectory(value = "") {
  try {
    return (await stat(value)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

async function directoryEntries(value = "") {
  try {
    return await readdir(value, {
      withFileTypes: true
    });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return [];
    }
    throw error;
  }
}

async function activeProjectSessionExists(projectRuntimeRoot = "") {
  const activeRoot = projectRuntimeRoot
    ? path.join(projectRuntimeRoot, "sessions", "active")
    : "";
  if (!activeRoot) {
    return false;
  }
  return (await directoryEntries(activeRoot)).some((entry) => entry.isDirectory());
}

function commandOutput(result = {}) {
  return normalizeText(result.stdout || result.output);
}

function commandFailure(result = {}, fallbackMessage = "Git command failed.") {
  return templateError(
    result.code || "vibe64_project_template_git_failed",
    normalizeText(result.stderr || result.stdout || result.output || result.error) || fallbackMessage
  );
}

async function runTemplateCommand(command = "git", args = [], {
  actor = "daemon",
  allowedRoots = [],
  credentialHome = null,
  cwd = "",
  gitAuthToken = "",
  gitTransport = "none",
  runCommand = runVibe64Command,
  timeout = PROJECT_TEMPLATE_GIT_TIMEOUT_MS,
  userKey = ""
} = {}) {
  const githubTransport = gitTransport === "github-https" || gitTransport === "github-token";
  const result = await runCommand({
    actor,
    allowedRoots,
    args,
    command,
    ...(credentialHome ? { credentialHome } : {}),
    cwd,
    envPolicy: "project",
    ...(gitAuthToken ? { gitAuthToken } : {}),
    gitSafeDirectories: allowedRoots,
    gitTransport,
    mode: "capture",
    purpose: githubTransport ? "github" : "source",
    runtimes: gitTransport === "github-https" ? ["git", "gh"] : ["git"],
    timeout,
    ...(userKey ? { userKey } : {})
  });
  if (!result.ok) {
    throw commandFailure(result);
  }
  return commandOutput(result);
}

function runGit(args = [], options = {}) {
  return runTemplateCommand("git", args, options);
}

function runShell(script = "", options = {}) {
  return runTemplateCommand("bash", ["-lc", script], options);
}

async function gitOutputOrEmpty(args = [], options = {}) {
  try {
    return await runGit(args, options);
  } catch {
    return "";
  }
}

function githubCommandOptions(input = {}, {
  env = process.env
} = {}) {
  const gitAuthToken = normalizeText(input.gitAuthToken);
  if (gitAuthToken) {
    return {
      actor: "daemon",
      gitAuthToken,
      gitTransport: "github-token"
    };
  }
  const accountMode = normalizeGithubAccountMode(
    env?.[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
    GITHUB_ACCOUNT_MODE_LOCAL
  );
  const context = githubCredentialContext(input, {
    accountMode
  });
  if (context?.ok === false) {
    throw templateError(
      context.code || "vibe64_project_template_github_credentials_required",
      context.error || "Connect GitHub before applying this project template."
    );
  }
  const actor = accountMode === GITHUB_ACCOUNT_MODE_LOCAL ? "daemon" : "named-user";
  return {
    actor,
    credentialHome: {
      gid: context.gid,
      home: context.home,
      scope: context.scope,
      uid: context.uid,
      username: context.username
    },
    gitTransport: "github-https",
    userKey: actor === "named-user" ? context.username : ""
  };
}

function eligibility(eligible, code = "", message = "") {
  return {
    code,
    eligible,
    message
  };
}

async function localSourceEligibility({
  runCommand,
  sourceRoot
} = {}) {
  if (!sourceRoot || !await pathIsDirectory(sourceRoot)) {
    return eligibility(false, "vibe64_project_template_source_missing", "The project source directory is not available.");
  }
  const entries = await directoryEntries(sourceRoot);
  const meaningfulEntries = entries
    .map((entry) => entry.name)
    .filter((name) => name !== ".git" && !PROJECT_TEMPLATE_IGNORED_LOCAL_ENTRIES.has(name));
  if (meaningfulEntries.length > 0) {
    return eligibility(false, "vibe64_project_template_destination_not_empty", "This project already contains source files.");
  }
  if (!entries.some((entry) => entry.name === ".git")) {
    return eligibility(true);
  }
  const refs = await runGit(["for-each-ref", "--format=%(refname)"], {
    allowedRoots: [sourceRoot],
    cwd: sourceRoot,
    runCommand
  });
  return refs
    ? eligibility(false, "vibe64_project_template_destination_not_empty", "This project already has Git history.")
    : eligibility(true);
}

async function canonicalGitEligibility({
  project,
  runCommand,
  targetRoot
} = {}) {
  const repositoryPath = projectCanonicalRepositoryPath(project, targetRoot);
  if (!repositoryPath || !await pathIsDirectory(repositoryPath)) {
    return eligibility(true);
  }
  const refs = await runGit(["--git-dir", repositoryPath, "for-each-ref", "--format=%(refname)"], {
    allowedRoots: [targetRoot, path.dirname(repositoryPath), repositoryPath],
    cwd: targetRoot,
    runCommand
  });
  return refs
    ? eligibility(false, "vibe64_project_template_destination_not_empty", "This project already has Git history.")
    : eligibility(true);
}

async function remoteGithubRefs(project = {}, input = {}, {
  env = process.env,
  runCommand = runVibe64Command,
  targetRoot = ""
} = {}) {
  const cloneUrl = projectGithubCloneUrl(project);
  if (!cloneUrl) {
    throw templateError(
      "vibe64_project_template_github_repository_missing",
      "This project is not connected to a GitHub repository."
    );
  }
  return runGit(["ls-remote", "--heads", "--tags", cloneUrl], {
    ...githubCommandOptions(input, {
      env
    }),
    allowedRoots: [targetRoot],
    cwd: targetRoot,
    runCommand
  });
}

async function projectTemplateEligibility({
  checkGithubRemote = false,
  env = process.env,
  input = {},
  project = null,
  projectRuntimeRoot = "",
  runCommand = runVibe64Command,
  sourceRoot = "",
  targetRoot = ""
} = {}) {
  if (!project || !targetRoot) {
    return eligibility(false, "vibe64_project_not_selected", "Choose a project before selecting a template.");
  }
  if (await activeProjectSessionExists(projectRuntimeRoot)) {
    return eligibility(false, "vibe64_project_template_active_sessions", "This project already has an active session.");
  }

  const mode = projectRepositoryMode(project, sourceRoot);
  if (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    return localSourceEligibility({
      runCommand,
      sourceRoot: sourceRoot || targetRoot
    });
  }
  if (mode !== PROJECT_REPOSITORY_MODE_MANAGED_GIT && mode !== PROJECT_REPOSITORY_MODE_GITHUB) {
    return eligibility(false, "vibe64_project_template_repository_unsupported", "This project repository cannot use ready-made templates.");
  }

  if (mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    return canonicalGitEligibility({
      project,
      runCommand,
      targetRoot
    });
  }

  if (!checkGithubRemote) {
    return eligibility(true);
  }
  const refs = await remoteGithubRefs(project, input, {
    env,
    runCommand,
    targetRoot
  });
  return refs
    ? eligibility(false, "vibe64_project_template_destination_not_empty", "This GitHub repository already contains source.")
    : eligibility(true);
}

async function readProjectTemplates(options = {}) {
  const state = await projectTemplateEligibility(options);
  const templates = (Array.isArray(options.templates) ? options.templates : PROJECT_TEMPLATES)
    .slice()
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
    .map(publicProjectTemplate);
  return {
    eligibility: state,
    ok: true,
    templates
  };
}

async function createTemplateSourceRepository(template, {
  runCommand,
  temporaryRoot
} = {}) {
  const repositoryPath = path.join(temporaryRoot, "source.git");
  await runGit(["init", "--bare", repositoryPath], {
    allowedRoots: [temporaryRoot, repositoryPath],
    cwd: temporaryRoot,
    runCommand
  });
  if (template.kind === "blank") {
    return repositoryPath;
  }
  await runGit([
    "--git-dir",
    repositoryPath,
    "fetch",
    "--depth=1",
    "--no-tags",
    template.cloneUrl,
    `${template.ref}:${PROJECT_TEMPLATE_SOURCE_REF}`
  ], {
    allowedRoots: [temporaryRoot, repositoryPath],
    cwd: temporaryRoot,
    runCommand
  });
  return repositoryPath;
}

async function readTemplateGitFile(repositoryPath = "", relativePath = "", {
  runCommand,
  temporaryRoot
} = {}) {
  return runGit([
    "--git-dir",
    repositoryPath,
    "show",
    `${PROJECT_TEMPLATE_SOURCE_REF}:${relativePath}`
  ], {
    allowedRoots: [temporaryRoot, repositoryPath],
    cwd: temporaryRoot,
    runCommand
  });
}

function parseTemplateJson(text = "", fileName = "") {
  try {
    return JSON.parse(text);
  } catch {
    throw templateError(
      "vibe64_project_template_metadata_invalid",
      `${fileName} is not valid JSON.`
    );
  }
}

async function validateTemplateSource(template, repositoryPath, options = {}) {
  const [seedText, sourceRevision] = await Promise.all([
    readTemplateGitFile(repositoryPath, PROJECT_TEMPLATE_SOURCE_FILE, options),
    runGit(["--git-dir", repositoryPath, "rev-parse", `${PROJECT_TEMPLATE_SOURCE_REF}^{commit}`], {
      allowedRoots: [options.temporaryRoot, repositoryPath],
      cwd: options.temporaryRoot,
      runCommand: options.runCommand
    })
  ]);
  const seed = parseTemplateJson(seedText, PROJECT_TEMPLATE_SOURCE_FILE);
  if (
    seed.schema !== PROJECT_TEMPLATE_SCHEMA ||
    seed.schemaVersion !== PROJECT_TEMPLATE_SCHEMA_VERSION ||
    normalizeText(seed.id) !== template.id ||
    normalizeText(seed.repository) !== template.repository
  ) {
    throw templateError(
      "vibe64_project_template_metadata_mismatch",
      `${template.name} has seed metadata that does not match the trusted template registry.`
    );
  }
  return {
    seed,
    sourceRevision
  };
}

async function createMaterializedCommit(template, repositoryPath, sourceRevision, options = {}) {
  const worktree = path.join(options.temporaryRoot, "materialized");
  await mkdir(worktree);
  await runGit(["init", "--initial-branch=main"], {
    allowedRoots: [options.temporaryRoot, repositoryPath, worktree],
    cwd: worktree,
    runCommand: options.runCommand
  });
  if (sourceRevision) {
    await runGit([
      "fetch",
      "--no-tags",
      repositoryPath,
      sourceRevision
    ], {
      allowedRoots: [options.temporaryRoot, repositoryPath, worktree],
      cwd: worktree,
      runCommand: options.runCommand
    });
    await runGit(["read-tree", "--reset", "-u", sourceRevision], {
      allowedRoots: [options.temporaryRoot, repositoryPath, worktree],
      cwd: worktree,
      runCommand: options.runCommand
    });
  }

  await rm(path.join(worktree, PROJECT_TEMPLATE_SOURCE_FILE), {
    force: true
  });

  await (options.initializeProject || initializeGenesisProject)({
    projectRoot: worktree
  });
  if (template.stackPieces.length > 0) {
    await addGenesisStack({
      pieces: template.stackPieces,
      projectRoot: worktree
    });
  }

  const trailers = [
    `Vibe64-Starter: ${template.id}`,
    ...(template.repository ? [`Vibe64-Template-Repository: ${template.repository}`] : []),
    ...(sourceRevision ? [`Vibe64-Template-Revision: ${sourceRevision}`] : [])
  ].join("\n");
  await runGit(["add", "-A"], {
    allowedRoots: [options.temporaryRoot, repositoryPath, worktree],
    cwd: worktree,
    runCommand: options.runCommand
  });
  await runGit([
    "-c",
    "user.name=Vibe64",
    "-c",
    "user.email=vibe64@localhost",
    "commit",
    "--allow-empty",
    "-m",
    `Start from Vibe64 starter: ${template.name}`,
    "-m",
    trailers
  ], {
    allowedRoots: [options.temporaryRoot, repositoryPath, worktree],
    cwd: worktree,
    runCommand: options.runCommand
  });
  const commit = await runGit(["rev-parse", "HEAD^{commit}"], {
    allowedRoots: [options.temporaryRoot, repositoryPath, worktree],
    cwd: worktree,
    runCommand: options.runCommand
  });
  await runGit([
    "--git-dir",
    repositoryPath,
    "fetch",
    "--no-tags",
    worktree,
    `HEAD:${PROJECT_TEMPLATE_MATERIALIZED_REF}`
  ], {
    allowedRoots: [options.temporaryRoot, repositoryPath, worktree],
    cwd: worktree,
    runCommand: options.runCommand
  });
  return commit;
}

async function materializeLocalSource({
  branch,
  commit,
  runCommand,
  sourceRepositoryPath,
  sourceRoot,
  temporaryRoot
} = {}) {
  const gitEntry = path.join(sourceRoot, ".git");
  if (!await pathIsDirectory(gitEntry) && !(await directoryEntries(sourceRoot)).some((entry) => entry.name === ".git")) {
    await runGit(["init", `--initial-branch=${branch}`], {
      allowedRoots: [sourceRoot],
      cwd: sourceRoot,
      runCommand
    });
  }
  await runGit(["symbolic-ref", "HEAD", `refs/heads/${branch}`], {
    allowedRoots: [sourceRoot],
    cwd: sourceRoot,
    runCommand
  });
  await runGit([
    "fetch",
    "--no-tags",
    sourceRepositoryPath,
    `${PROJECT_TEMPLATE_MATERIALIZED_REF}:${PROJECT_TEMPLATE_DESTINATION_REF}`
  ], {
    allowedRoots: [sourceRoot, temporaryRoot, sourceRepositoryPath],
    cwd: sourceRoot,
    runCommand
  });
  await runGit(["update-ref", `refs/heads/${branch}`, commit], {
    allowedRoots: [sourceRoot],
    cwd: sourceRoot,
    runCommand
  });
  await runGit(["reset", "--hard", commit], {
    allowedRoots: [sourceRoot],
    cwd: sourceRoot,
    runCommand
  });
  await runGit(["update-ref", "-d", PROJECT_TEMPLATE_DESTINATION_REF], {
    allowedRoots: [sourceRoot],
    cwd: sourceRoot,
    runCommand
  });
}

async function ensureCanonicalRepository(repositoryPath = "", branch = "main", {
  runCommand,
  targetRoot
} = {}) {
  const repositoryRoot = path.dirname(repositoryPath);
  await mkdir(repositoryRoot, {
    recursive: true
  });
  await runShell(canonicalRepositoryInitializeScript({
    defaultBranch: branch,
    repositoryPath
  }), {
    allowedRoots: [targetRoot, repositoryRoot, repositoryPath],
    cwd: repositoryRoot,
    runCommand
  });
}

async function materializeCanonicalGit({
  branch,
  project,
  runCommand,
  sourceRepositoryPath,
  targetRoot,
  temporaryRoot
} = {}) {
  const repositoryPath = projectCanonicalRepositoryPath(project, targetRoot);
  await ensureCanonicalRepository(repositoryPath, branch, {
    runCommand,
    targetRoot
  });
  await runShell(canonicalRepositoryInstallRefScript({
    repositoryPath,
    sourceRef: PROJECT_TEMPLATE_MATERIALIZED_REF,
    sourceRepository: sourceRepositoryPath,
    targetRef: `refs/heads/${branch}`
  }), {
    allowedRoots: [targetRoot, path.dirname(repositoryPath), repositoryPath, temporaryRoot, sourceRepositoryPath],
    cwd: targetRoot,
    runCommand
  });
}

async function pushGithubDestination({
  branch,
  commit,
  env,
  input,
  project,
  repositoryPath,
  runCommand,
  targetRoot
} = {}) {
  const cloneUrl = projectGithubCloneUrl(project);
  const githubOptions = githubCommandOptions(input, {
    env
  });
  try {
    await runGit([
      "--git-dir",
      repositoryPath,
      "push",
      "--atomic",
      cloneUrl,
      `${PROJECT_TEMPLATE_MATERIALIZED_REF}:refs/heads/${branch}`
    ], {
      ...githubOptions,
      allowedRoots: [targetRoot, path.dirname(repositoryPath), repositoryPath],
      cwd: targetRoot,
      runCommand
    });
  } catch (error) {
    const remoteRef = await gitOutputOrEmpty(["ls-remote", "--heads", cloneUrl, `refs/heads/${branch}`], {
      ...githubOptions,
      allowedRoots: [targetRoot],
      cwd: targetRoot,
      runCommand
    });
    const remoteCommit = normalizeText(remoteRef.split(/\s+/u)[0]);
    if (remoteCommit !== commit) {
      throw error;
    }
  }
}

async function refreshGithubMirror({
  env,
  input,
  project,
  runCommand,
  targetRoot
} = {}) {
  const cloneUrl = projectGithubCloneUrl(project);
  const mirrorPath = projectGithubMirrorPath(project, targetRoot);
  if (!cloneUrl || !mirrorPath) {
    return false;
  }
  try {
    const [command, ...args] = githubMirrorRefreshInvocation({
      mirrorPath,
      remoteUrl: cloneUrl
    });
    await runTemplateCommand(command, args, {
      ...githubCommandOptions(input, {
        env
      }),
      allowedRoots: [targetRoot, path.dirname(mirrorPath), mirrorPath],
      cwd: targetRoot,
      runCommand
    });
    return true;
  } catch {
    return false;
  }
}

async function verifyMaterializedCommit({
  branch,
  commit,
  env,
  input,
  mode,
  project,
  runCommand,
  sourceRepositoryPath,
  sourceRoot,
  targetRoot
} = {}) {
  let repositoryPath = "";
  let verifiedRef = `refs/heads/${branch}`;
  if (mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    repositoryPath = projectCanonicalRepositoryPath(project, targetRoot);
  } else if (mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    repositoryPath = sourceRepositoryPath;
    verifiedRef = PROJECT_TEMPLATE_MATERIALIZED_REF;
  }
  const gitPrefix = repositoryPath ? ["--git-dir", repositoryPath] : [];
  const cwd = repositoryPath ? targetRoot : sourceRoot;
  const allowedRoots = repositoryPath
    ? [targetRoot, path.dirname(repositoryPath), repositoryPath]
    : [sourceRoot];
  const [count, parents] = await Promise.all([
    runGit([...gitPrefix, "rev-list", "--count", verifiedRef], {
      allowedRoots,
      cwd,
      runCommand
    }),
    runGit([...gitPrefix, "rev-list", "--parents", "-n", "1", verifiedRef], {
      allowedRoots,
      cwd,
      runCommand
    })
  ]);
  if (count !== "1" || parents.split(/\s+/u).filter(Boolean).length !== 1) {
    throw templateError(
      "vibe64_project_template_commit_invalid",
      "The project template did not produce exactly one initial commit."
    );
  }
  if (mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    const refs = await remoteGithubRefs(project, input, {
      env,
      runCommand,
      targetRoot
    });
    const remoteCommit = normalizeText(refs
      .split(/\r?\n/u)
      .map((line) => line.trim().split(/\s+/u))
      .find(([, ref]) => ref === `refs/heads/${branch}`)?.[0]);
    if (remoteCommit !== commit) {
      throw templateError(
        "vibe64_project_template_remote_commit_mismatch",
        "The GitHub repository did not retain the materialized project template commit."
      );
    }
  }
}

async function createTemporaryRoot(projectRuntimeRoot = "", targetRoot = "") {
  const runtimeRoot = projectRuntimeRoot || path.join(targetRoot, ".vibe64-local");
  const temporaryParent = path.join(runtimeRoot, "tmp");
  await mkdir(temporaryParent, {
    recursive: true
  });
  return mkdtemp(path.join(temporaryParent, "project-template-"));
}

async function withProjectTemplateLock(key = "", operation) {
  const previous = projectTemplateLocks.get(key) || Promise.resolve();
  let release;
  const lock = new Promise((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => lock);
  projectTemplateLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (projectTemplateLocks.get(key) === queued) {
      projectTemplateLocks.delete(key);
    }
  }
}

async function applyProjectTemplate({
  afterAuthorityVerification = null,
  beforeAuthorityMutation = null,
  env = process.env,
  initializeProject = initializeGenesisProject,
  input = {},
  project = null,
  projectRuntimeRoot = "",
  runCommand = runVibe64Command,
  sourceRoot = "",
  targetRoot = "",
  templateId = "",
  templates = PROJECT_TEMPLATES
} = {}) {
  const template = resolveProjectTemplate(templateId, templates);
  const lockKey = path.resolve(targetRoot || sourceRoot || projectRuntimeRoot);
  return withProjectTemplateLock(lockKey, async () => {
    const mode = projectRepositoryMode(project, sourceRoot);
    const branch = projectDefaultBranch(project);
    const currentEligibility = await projectTemplateEligibility({
      checkGithubRemote: true,
      env,
      input,
      project,
      projectRuntimeRoot,
      runCommand,
      sourceRoot,
      targetRoot
    });
    if (!currentEligibility.eligible) {
      throw templateError(
        currentEligibility.code || "vibe64_project_template_unavailable",
        currentEligibility.message || "This project can no longer use a ready-made template.",
        {
          statusCode: 409
        }
      );
    }

    const temporaryRoot = await createTemporaryRoot(projectRuntimeRoot, targetRoot);
    try {
      const sourceRepositoryPath = await createTemplateSourceRepository(template, {
        runCommand,
        temporaryRoot
      });
      let commit;
      let sourceRevision = "";
      sourceRevision = template.kind === "blank"
        ? ""
        : (await validateTemplateSource(template, sourceRepositoryPath, {
            runCommand,
            temporaryRoot
          })).sourceRevision;
      commit = await createMaterializedCommit(template, sourceRepositoryPath, sourceRevision, {
        initializeProject,
        runCommand,
        temporaryRoot
      });

      const materialization = {
        branch,
        commit,
        repositoryMode: mode,
        sourceRevision
      };
      if (typeof beforeAuthorityMutation === "function") {
        await beforeAuthorityMutation(materialization);
      }

      if (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
        await materializeLocalSource({
          branch,
          commit,
          runCommand,
          sourceRepositoryPath,
          sourceRoot: sourceRoot || targetRoot,
          temporaryRoot
        });
      } else if (mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
        await materializeCanonicalGit({
          branch,
          project,
          runCommand,
          sourceRepositoryPath,
          targetRoot,
          temporaryRoot
        });
      } else {
        await pushGithubDestination({
          branch,
          commit,
          env,
          input,
          project,
          repositoryPath: sourceRepositoryPath,
          runCommand,
          targetRoot
        });
      }

      await verifyMaterializedCommit({
        branch,
        commit,
        env,
        input,
        mode,
        project,
        runCommand,
        sourceRepositoryPath,
        sourceRoot: sourceRoot || targetRoot,
        targetRoot
      });
      if (typeof afterAuthorityVerification === "function") {
        await afterAuthorityVerification(materialization);
      }

      const mirrorRefreshed = mode === PROJECT_REPOSITORY_MODE_GITHUB
        ? await refreshGithubMirror({
            env,
            input,
            project,
            runCommand,
            targetRoot
          })
        : false;
      return {
        materialization: {
          ...materialization,
          ...(mode === PROJECT_REPOSITORY_MODE_GITHUB ? {
            mirrorRefreshed
          } : {}),
        },
        ok: true,
        template: publicProjectTemplate(template)
      };
    } finally {
      await rm(temporaryRoot, {
        force: true,
        recursive: true
      });
    }
  });
}

export {
  PROJECT_TEMPLATES,
  PROJECT_TEMPLATE_SCHEMA,
  PROJECT_TEMPLATE_SCHEMA_VERSION,
  PROJECT_TEMPLATE_SOURCE_FILE,
  applyProjectTemplate,
  projectTemplate,
  projectTemplateEligibility,
  publicProjectTemplate,
  readProjectTemplates,
  resolveProjectTemplate
};
