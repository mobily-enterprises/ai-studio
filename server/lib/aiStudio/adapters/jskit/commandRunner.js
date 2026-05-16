import { execFile } from "node:child_process";
import { access, mkdir, readdir, rmdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_COMMAND_TIMEOUT_MS = 30_000;
const NPM_COMMAND_TIMEOUT_MS = 10 * 60_000;
const GIT_OUTPUT_BUFFER_BYTES = 1024 * 1024;
const NPM_OUTPUT_BUFFER_BYTES = 8 * 1024 * 1024;

function normalizeText(value = "") {
  return String(value || "").trim();
}

function commandOutput(error = {}) {
  return normalizeText(`${error.stdout || ""}\n${error.stderr || ""}`) ||
    normalizeText(error.message);
}

function shellQuote(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:=@,+-]+$/u.test(stringValue)) {
    return stringValue;
  }
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function gitOutput(cwd, args, {
  timeout = GIT_COMMAND_TIMEOUT_MS
} = {}) {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: GIT_OUTPUT_BUFFER_BYTES,
    timeout
  });
  return normalizeText(result.stdout);
}

async function gitResult(cwd, args, {
  timeout = GIT_COMMAND_TIMEOUT_MS
} = {}) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: GIT_OUTPUT_BUFFER_BYTES,
      timeout
    });
    return {
      ok: true,
      output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`)
    };
  } catch (error) {
    return {
      ok: false,
      output: commandOutput(error)
    };
  }
}

async function gitCommandSucceeds(cwd, args) {
  const result = await gitResult(cwd, args);
  return result.ok;
}

async function readCurrentBranch(targetRoot) {
  return gitOutput(targetRoot, ["branch", "--show-current"], {
    timeout: 15_000
  });
}

async function readCurrentCommit(targetRoot) {
  return gitOutput(targetRoot, ["rev-parse", "--verify", "HEAD"], {
    timeout: 15_000
  });
}

async function isGitWorktree(worktreePath) {
  if (!await pathExists(worktreePath)) {
    return false;
  }
  return gitCommandSucceeds(worktreePath, ["rev-parse", "--is-inside-work-tree"]);
}

async function removeEmptyDirectory(directoryPath) {
  try {
    const entries = await readdir(directoryPath);
    if (entries.length > 0) {
      return {
        ok: false,
        message: `Worktree path exists but is not a Git worktree: ${directoryPath}`
      };
    }
    await rmdir(directoryPath);
    return {
      ok: true
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        ok: true
      };
    }
    return {
      ok: false,
      message: `Cannot prepare worktree path ${directoryPath}: ${error?.message || error}`
    };
  }
}

function worktreeMetadata({
  baseBranch = "",
  baseCommit = "",
  branch = "",
  worktreePath = ""
} = {}) {
  return {
    base_branch: baseBranch,
    base_commit: baseCommit,
    branch,
    worktree_path: worktreePath
  };
}

function createWorktreePath(session = {}) {
  if (!session.sessionRoot) {
    return "";
  }
  return path.join(session.sessionRoot, "worktree");
}

function createWorktreeBranch(session = {}) {
  return `ai-studio/${session.sessionId}`;
}

function createWorktreeScript({
  branch = "",
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const quotedBranch = shellQuote(branch);
  const quotedBranchRef = shellQuote(`refs/heads/${branch}`);
  const quotedTargetRoot = shellQuote(targetRoot);
  const quotedWorktreePath = shellQuote(worktreePath);
  return [
    "set -e",
    `printf '[studio] Preparing worktree %s\\n' ${quotedWorktreePath}`,
    `mkdir -p "$(dirname ${quotedWorktreePath})"`,
    `if [ -e ${quotedWorktreePath} ]; then`,
    `  if git -C ${quotedWorktreePath} rev-parse --is-inside-work-tree >/dev/null 2>&1; then`,
    "    printf '[studio] Reusing existing worktree.\\n'",
    "    exit 0",
    "  fi",
    `  if [ -d ${quotedWorktreePath} ] && [ -z "$(find ${quotedWorktreePath} -mindepth 1 -maxdepth 1 -print -quit)" ]; then`,
    `    rmdir ${quotedWorktreePath}`,
    "  else",
    "    printf '[studio] Worktree path exists but is not a Git worktree.\\n' >&2",
    "    exit 1",
    "  fi",
    "fi",
    `if git -C ${quotedTargetRoot} show-ref --verify --quiet ${quotedBranchRef}; then`,
    `  git -C ${quotedTargetRoot} worktree add ${quotedWorktreePath} ${quotedBranch}`,
    "else",
    `  git -C ${quotedTargetRoot} worktree add -b ${quotedBranch} ${quotedWorktreePath} HEAD`,
    "fi"
  ].join("\n");
}

function npmInstallScript(worktreePath = "") {
  return [
    "set -e",
    `printf '[studio] Installing dependencies in %s\\n' ${shellQuote(worktreePath)}`,
    "printf '[studio] $ npm install --foreground-scripts --no-audit --no-fund\\n\\n'",
    "NPM_CONFIG_AUDIT=false NPM_CONFIG_FUND=false NPM_CONFIG_YES=true npm_config_audit=false npm_config_fund=false npm_config_yes=true npm install --foreground-scripts --no-audit --no-fund"
  ].join("\n");
}

function metadataPath(session = {}, name = "") {
  return session.metadataRoot && name ? path.join(session.metadataRoot, name) : "";
}

function artifactPath(session = {}, relativePath = "") {
  return session.artifactsRoot && relativePath ? path.join(session.artifactsRoot, relativePath) : "";
}

function writeMetadataLineScript(name = "", valueExpression = "") {
  return `printf '%s\\n' ${valueExpression} > ${shellQuote(name)}`;
}

function requiredFileScript(filePath = "", label = "file") {
  const quotedFilePath = shellQuote(filePath);
  return [
    `if [ ! -s ${quotedFilePath} ]; then`,
    `  printf '[studio] Missing ${label}: %s\\n' ${quotedFilePath} >&2`,
    "  exit 1",
    "fi"
  ].join("\n");
}

function createIssueOnGhScript(session = {}) {
  const issueTitlePath = artifactPath(session, "issue_title");
  const issueBodyPath = artifactPath(session, "issue.md");
  const issueUrlPath = metadataPath(session, "issue_url");
  const issueNumberPath = metadataPath(session, "issue_number");
  const storedIssueTitlePath = metadataPath(session, "issue_title");
  return [
    "set -e",
    requiredFileScript(issueTitlePath, "issue title artifact"),
    requiredFileScript(issueBodyPath, "issue body artifact"),
    `ISSUE_TITLE="$(head -n 1 ${shellQuote(issueTitlePath)} | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$ISSUE_TITLE\" ]; then",
    "  printf '[studio] Issue title is empty.\\n' >&2",
    "  exit 1",
    "fi",
    "printf '[studio] Creating GitHub issue: %s\\n' \"$ISSUE_TITLE\"",
    `ISSUE_URL="$(gh issue create --title "$ISSUE_TITLE" --body-file ${shellQuote(issueBodyPath)})"`,
    "printf '%s\\n' \"$ISSUE_URL\"",
    writeMetadataLineScript(issueUrlPath, "\"$ISSUE_URL\""),
    writeMetadataLineScript(storedIssueTitlePath, "\"$ISSUE_TITLE\""),
    "ISSUE_NUMBER=\"$(printf '%s\\n' \"$ISSUE_URL\" | sed -n 's#.*/issues/\\([0-9][0-9]*\\).*#\\1#p' | head -n 1)\"",
    "if [ -n \"$ISSUE_NUMBER\" ]; then",
    `  ${writeMetadataLineScript(issueNumberPath, "\"$ISSUE_NUMBER\"")}`,
    "fi"
  ].join("\n");
}

function runAutomatedChecksScript() {
  return [
    "set -e",
    "printf '[studio] Running JSKIT automated checks.\\n'",
    "printf '[studio] $ npm run build\\n\\n'",
    "npm run build"
  ].join("\n");
}

function acceptChangesScript(session = {}, worktreePath = "") {
  const changesAcceptedPath = metadataPath(session, "changes_accepted");
  return [
    "set -e",
    `printf '[studio] Reviewing changes in %s\\n' ${shellQuote(worktreePath)}`,
    "git status --short",
    writeMetadataLineScript(changesAcceptedPath, "yes")
  ].join("\n");
}

function commitChangesScript(session = {}) {
  const commitPath = metadataPath(session, "accepted_commit");
  const issueTitlePath = metadataPath(session, "issue_title");
  return [
    "set -e",
    "if [ -z \"$(git status --short)\" ]; then",
    "  printf '[studio] No changes to commit.\\n' >&2",
    "  exit 1",
    "fi",
    `COMMIT_TITLE="$(cat ${shellQuote(issueTitlePath)} 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$COMMIT_TITLE\" ]; then",
    `  COMMIT_TITLE="AI Studio session ${session.sessionId}"`,
    "fi",
    "printf '[studio] Committing changes: %s\\n' \"$COMMIT_TITLE\"",
    "git add -A",
    "git commit -m \"$COMMIT_TITLE\"",
    "ACCEPTED_COMMIT=\"$(git rev-parse --verify HEAD)\"",
    writeMetadataLineScript(commitPath, "\"$ACCEPTED_COMMIT\""),
    "printf '[studio] Committed %s\\n' \"$ACCEPTED_COMMIT\""
  ].join("\n");
}

function createPrOnGhScript(session = {}) {
  const prBodyPath = artifactPath(session, "pull_request.md");
  const issueTitlePath = metadataPath(session, "issue_title");
  const prUrlPath = metadataPath(session, "pr_url");
  const branch = normalizeText(session.metadata?.branch);
  const baseBranch = normalizeText(session.metadata?.base_branch) || "main";
  return [
    "set -e",
    requiredFileScript(prBodyPath, "pull request artifact"),
    `PR_TITLE="$(cat ${shellQuote(issueTitlePath)} 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$PR_TITLE\" ]; then",
    `  PR_TITLE="$(grep -m 1 -v '^[[:space:]]*$' ${shellQuote(prBodyPath)} | sed 's/^#*[[:space:]]*//' | sed 's/[[:space:]]*$//')"`,
    "fi",
    "if [ -z \"$PR_TITLE\" ]; then",
    `  PR_TITLE="AI Studio session ${session.sessionId}"`,
    "fi",
    "printf '[studio] Creating GitHub pull request: %s\\n' \"$PR_TITLE\"",
    `PR_URL="$(gh pr create --base ${shellQuote(baseBranch)} --head ${shellQuote(branch)} --title "$PR_TITLE" --body-file ${shellQuote(prBodyPath)})"`,
    "printf '%s\\n' \"$PR_URL\"",
    writeMetadataLineScript(prUrlPath, "\"$PR_URL\"")
  ].join("\n");
}

function mergePrScript(session = {}) {
  const prUrl = normalizeText(session.metadata?.pr_url);
  const prMergedPath = metadataPath(session, "pr_merged");
  return [
    "set -e",
    `printf '[studio] Merging pull request %s\\n' ${shellQuote(prUrl)}`,
    `gh pr merge ${shellQuote(prUrl)} --merge`,
    writeMetadataLineScript(prMergedPath, "yes")
  ].join("\n");
}

function syncMainCheckoutScript(session = {}, targetRoot = "") {
  const baseBranch = normalizeText(session.metadata?.base_branch) || "main";
  const mainCheckoutSyncedPath = metadataPath(session, "main_checkout_synced");
  return [
    "set -e",
    `printf '[studio] Syncing main checkout %s to %s\\n' ${shellQuote(targetRoot)} ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} fetch origin ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} checkout ${shellQuote(baseBranch)}`,
    `git -C ${shellQuote(targetRoot)} pull --ff-only origin ${shellQuote(baseBranch)}`,
    writeMetadataLineScript(mainCheckoutSyncedPath, "yes")
  ].join("\n");
}

async function addGitWorktree({
  branch = "",
  targetRoot = "",
  worktreePath = ""
} = {}) {
  await mkdir(path.dirname(worktreePath), {
    recursive: true
  });

  const staleDirectory = await removeEmptyDirectory(worktreePath);
  if (!staleDirectory.ok) {
    return staleDirectory;
  }

  const branchRef = `refs/heads/${branch}`;
  const branchExists = await gitCommandSucceeds(targetRoot, ["show-ref", "--verify", "--quiet", branchRef]);
  const args = branchExists
    ? ["worktree", "add", worktreePath, branch]
    : ["worktree", "add", "-b", branch, worktreePath, "HEAD"];
  const result = await gitResult(targetRoot, args);
  if (!result.ok) {
    return {
      ok: false,
      message: result.output || `Failed to create worktree ${worktreePath}.`,
      repairCommand: `git -C ${targetRoot} worktree prune`
    };
  }

  return {
    ok: true,
    message: result.output
  };
}

async function runCreateWorktreeCommand({
  session = {},
  targetRoot = ""
} = {}) {
  const resolvedTargetRoot = path.resolve(targetRoot || session.targetRoot || process.cwd());
  const worktreePath = normalizeText(session.metadata?.worktree_path) || createWorktreePath(session);
  const branch = normalizeText(session.metadata?.branch) || createWorktreeBranch(session);
  if (!worktreePath || !branch) {
    return {
      message: "Cannot create a worktree before the AI Studio session has a root path.",
      metadata: {},
      status: "blocked"
    };
  }
  const [baseBranch, baseCommit] = await Promise.all([
    readCurrentBranch(resolvedTargetRoot),
    readCurrentCommit(resolvedTargetRoot)
  ]);

  if (await isGitWorktree(worktreePath)) {
    return {
      message: `Reused existing worktree ${worktreePath}.`,
      metadata: worktreeMetadata({
        baseBranch,
        baseCommit,
        branch,
        worktreePath
      }),
      status: "completed"
    };
  }

  const createResult = await addGitWorktree({
    branch,
    targetRoot: resolvedTargetRoot,
    worktreePath
  });
  if (!createResult.ok) {
    return {
      message: createResult.message,
      metadata: {},
      status: "blocked"
    };
  }

  return {
    message: `Created worktree ${worktreePath} on branch ${branch}.`,
    metadata: worktreeMetadata({
      baseBranch,
      baseCommit,
      branch,
      worktreePath
    }),
    status: "completed"
  };
}

async function runNpmInstall(worktreePath) {
  try {
    const result = await execFileAsync("npm", [
      "install",
      "--foreground-scripts",
      "--no-audit",
      "--no-fund"
    ], {
      cwd: worktreePath,
      env: {
        ...process.env,
        NPM_CONFIG_AUDIT: "false",
        NPM_CONFIG_FUND: "false",
        NPM_CONFIG_YES: "true",
        npm_config_audit: "false",
        npm_config_fund: "false",
        npm_config_yes: "true"
      },
      maxBuffer: NPM_OUTPUT_BUFFER_BYTES,
      timeout: NPM_COMMAND_TIMEOUT_MS
    });
    return {
      ok: true,
      output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`)
    };
  } catch (error) {
    return {
      ok: false,
      output: commandOutput(error)
    };
  }
}

async function runInstallDependenciesCommand({
  session = {}
} = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  if (!worktreePath) {
    return {
      message: "Create the worktree before installing dependencies.",
      metadata: {},
      status: "blocked"
    };
  }
  if (!await isGitWorktree(worktreePath)) {
    return {
      message: `Session worktree is not ready: ${worktreePath}`,
      metadata: {},
      status: "blocked"
    };
  }

  const result = await runNpmInstall(worktreePath);
  if (!result.ok) {
    return {
      message: result.output || "npm install failed.",
      metadata: {},
      status: "blocked"
    };
  }

  return {
    message: `Installed Node dependencies in ${worktreePath}.`,
    metadata: {
      dependencies_installed: "yes",
      dependencies_path: worktreePath
    },
    status: "completed"
  };
}

async function createWorktreeTerminalSpec({
  session = {},
  targetRoot = ""
} = {}) {
  const resolvedTargetRoot = path.resolve(targetRoot || session.targetRoot || process.cwd());
  const worktreePath = normalizeText(session.metadata?.worktree_path) || createWorktreePath(session);
  const branch = normalizeText(session.metadata?.branch) || createWorktreeBranch(session);
  if (!worktreePath || !branch) {
    return {
      ok: false,
      message: "Cannot create a worktree before the AI Studio session has a root path."
    };
  }
  const [baseBranch, baseCommit] = await Promise.all([
    readCurrentBranch(resolvedTargetRoot),
    readCurrentCommit(resolvedTargetRoot)
  ]);
  return {
    args: ["-lc", createWorktreeScript({
      branch,
      targetRoot: resolvedTargetRoot,
      worktreePath
    })],
    command: "bash",
    commandPreview: `git worktree add ${worktreePath}`,
    cwd: resolvedTargetRoot,
    ok: true,
    successMessage: `Created worktree ${worktreePath} on branch ${branch}.`,
    successMetadata: worktreeMetadata({
      baseBranch,
      baseCommit,
      branch,
      worktreePath
    })
  };
}

async function installDependenciesTerminalSpec({
  session = {}
} = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before installing dependencies."
    };
  }
  if (!await isGitWorktree(worktreePath)) {
    return {
      ok: false,
      message: `Session worktree is not ready: ${worktreePath}`
    };
  }
  return {
    args: ["-lc", npmInstallScript(worktreePath)],
    command: "bash",
    commandPreview: "npm install --foreground-scripts --no-audit --no-fund",
    cwd: worktreePath,
    ok: true,
    successMessage: `Installed Node dependencies in ${worktreePath}.`,
    successMetadata: {
      dependencies_installed: "yes",
      dependencies_path: worktreePath
    }
  };
}

function completedMetadataSpec({
  commandPreview = "",
  cwd = "",
  label = "",
  metadata = {},
  script = ""
} = {}) {
  return {
    args: ["-lc", script],
    command: "bash",
    commandPreview,
    cwd,
    ok: true,
    successMessage: `${label} completed.`,
    successMetadata: metadata
  };
}

async function worktreeCommandSpec({
  commandPreview = "",
  label = "",
  metadata = {},
  script = "",
  session = {}
} = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the worktree before running this command."
    };
  }
  if (!await isGitWorktree(worktreePath)) {
    return {
      ok: false,
      message: `Session worktree is not ready: ${worktreePath}`
    };
  }
  return completedMetadataSpec({
    commandPreview,
    cwd: worktreePath,
    label,
    metadata,
    script
  });
}

async function createIssueOnGhTerminalSpec({ session = {} } = {}) {
  return completedMetadataSpec({
    commandPreview: "gh issue create",
    cwd: normalizeText(session.metadata?.worktree_path) || session.targetRoot || process.cwd(),
    label: "Create issue on GH",
    script: createIssueOnGhScript(session)
  });
}

async function runAutomatedChecksTerminalSpec({ session = {} } = {}) {
  return worktreeCommandSpec({
    commandPreview: "npm run build",
    label: "Run automated checks",
    metadata: {
      automated_checks_run: "yes"
    },
    script: runAutomatedChecksScript(),
    session
  });
}

async function acceptChangesTerminalSpec({ session = {} } = {}) {
  const worktreePath = normalizeText(session.metadata?.worktree_path);
  return worktreeCommandSpec({
    commandPreview: "git status --short",
    label: "Accept changes",
    script: acceptChangesScript(session, worktreePath),
    session
  });
}

async function commitChangesTerminalSpec({ session = {} } = {}) {
  return worktreeCommandSpec({
    commandPreview: "git add -A && git commit",
    label: "Commit changes",
    script: commitChangesScript(session),
    session
  });
}

async function createPrOnGhTerminalSpec({ session = {} } = {}) {
  const branch = normalizeText(session.metadata?.branch);
  if (!branch) {
    return {
      ok: false,
      message: "Create the worktree before creating the pull request."
    };
  }
  return worktreeCommandSpec({
    commandPreview: "gh pr create",
    label: "Create PR on GH",
    script: createPrOnGhScript(session),
    session
  });
}

async function mergePrTerminalSpec({ session = {} } = {}) {
  if (!normalizeText(session.metadata?.pr_url)) {
    return {
      ok: false,
      message: "Create the pull request before merging."
    };
  }
  return worktreeCommandSpec({
    commandPreview: "gh pr merge",
    label: "Merge PR",
    script: mergePrScript(session),
    session
  });
}

async function syncMainCheckoutTerminalSpec({
  session = {},
  targetRoot = ""
} = {}) {
  if (!normalizeText(session.metadata?.pr_merged)) {
    return {
      ok: false,
      message: "Merge the pull request before syncing the main checkout."
    };
  }
  return completedMetadataSpec({
    commandPreview: "git fetch && git pull --ff-only",
    cwd: targetRoot || session.targetRoot || process.cwd(),
    label: "Sync main checkout",
    script: syncMainCheckoutScript(session, targetRoot || session.targetRoot || process.cwd())
  });
}

async function createJskitAiStudioCommandTerminalSpec({
  commandId = "",
  context = {},
  targetRoot = ""
} = {}) {
  const session = context.session || {};
  if (commandId === "create_worktree") {
    return createWorktreeTerminalSpec({
      session,
      targetRoot
    });
  }
  if (commandId === "install_dependencies") {
    return installDependenciesTerminalSpec({
      session
    });
  }
  if (commandId === "create_issue_on_gh") {
    return createIssueOnGhTerminalSpec({
      session
    });
  }
  if (commandId === "run_automated_checks") {
    return runAutomatedChecksTerminalSpec({
      session
    });
  }
  if (commandId === "accept_changes") {
    return acceptChangesTerminalSpec({
      session
    });
  }
  if (commandId === "commit_changes") {
    return commitChangesTerminalSpec({
      session
    });
  }
  if (commandId === "create_pr_on_gh") {
    return createPrOnGhTerminalSpec({
      session
    });
  }
  if (commandId === "merge_pr") {
    return mergePrTerminalSpec({
      session
    });
  }
  if (commandId === "sync_main_checkout") {
    return syncMainCheckoutTerminalSpec({
      session,
      targetRoot
    });
  }
  return {
    ok: false,
    message: `JSKIT command ${commandId} is not implemented in the command terminal yet.`
  };
}

function unsupportedCommandResult(commandId = "") {
  return {
    message: `JSKIT command ${commandId} is not implemented in AI Studio yet.`,
    metadata: {},
    status: "blocked"
  };
}

function createJskitAiStudioCommandRunner() {
  return async function runJskitAiStudioCommand({
    commandId = "",
    context = {},
    targetRoot = ""
  } = {}) {
    if (commandId === "create_worktree") {
      return runCreateWorktreeCommand({
        session: context.session || {},
        targetRoot
      });
    }
    if (commandId === "install_dependencies") {
      return runInstallDependenciesCommand({
        session: context.session || {}
      });
    }
    if (commandId === "finish_session") {
      return {
        message: "Finished AI Studio session.",
        metadata: {
          session_finished: "yes"
        },
        status: "completed"
      };
    }
    return unsupportedCommandResult(commandId);
  };
}

export {
  createJskitAiStudioCommandRunner,
  createJskitAiStudioCommandTerminalSpec
};
