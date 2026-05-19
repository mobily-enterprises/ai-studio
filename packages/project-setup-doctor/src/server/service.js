import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  readdir
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  closeTerminalSession,
  readTerminalSession,
  startTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  createRepositoryReadyStatusCache
} from "../../../../server/lib/doctorStatusCache.js";
import {
  listDoctorPluginChecks,
  runDoctorCheck,
  startDoctorPluginTerminal
} from "../../../../server/lib/doctorPlugins.js";
import {
  isGithubRemoteUrl,
  repoSlugFromRemoteUrl
} from "../../../../server/lib/githubRemote.js";
import {
  linkedGitMetadataMountSource
} from "../../../../server/lib/gitToolchainMounts.js";
import {
  blockedDoctorCheck as blockedCheck,
  doctorCheckPassed as checkPassed,
  formatDoctorList as formatList,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck,
  pendingDoctorCheck as pendingCheck
} from "../../../../server/lib/doctorCheckItems.js";
import {
  AI_STUDIO_STATE_DIR
} from "../../../../server/lib/aiStudio/sessionStore.js";
import {
  CREATE_GIT_CHECKPOINT_ACTION_ID,
  PUSH_GIT_CHECKPOINT_ACTION_ID,
  ghRepoCreateRepair,
  ghRepoCreateScript,
  gitCheckpointRepair,
  gitCheckpointScript,
  gitInitRepair,
  githubBranchRefApiPath,
  hostWritableWorkspaceDockerArgs,
  linkGithubRemoteRepair,
  readGitLocalHead,
  readGitOriginRemote,
  readGitRepositoryShape,
  readGitStatus,
  readGithubRepository,
  readRemoteBranchShaWithGh,
  readRemoteBranchShaWithGit,
  remoteHeadIsAncestorOfLocalHead,
  startGhCreateRepoTerminal as startSharedGhCreateRepoTerminal,
  startGitCheckpointTerminal as startSharedGitCheckpointTerminal,
  startGitInitTerminal as startSharedGitInitTerminal,
  startLinkGithubRemoteTerminal as startSharedLinkGithubRemoteTerminal
} from "../../../../server/lib/setupDoctorGit.js";

const TERMINAL_NAMESPACE = "project-setup-doctor";
const STUDIO_OWNED_BOOTSTRAP_ENTRIES = new Set([
  AI_STUDIO_STATE_DIR
]);

function appendPendingChecks(stages, checks, startIndex) {
  return [
    ...stages,
    ...checks.slice(startIndex).map(pendingCheck)
  ];
}

function assertUniqueCheckIds(checks) {
  const seen = new Set();
  for (const check of checks) {
    if (seen.has(check.id)) {
      throw new Error(`Duplicate Project Setup check id: ${check.id}`);
    }
    seen.add(check.id);
  }
}

function refreshRequested(input = {}) {
  return input?.refresh === true || input?.refresh === "true" || input?.refresh === "1";
}

function finalizeStatus({
  context,
  stages,
  targetRoot
}) {
  const currentStage = stages.find((item) => item.required !== false && item.status !== "pass") || null;
  const ready = stages.every((item) => item.required === false || item.status === "pass");

  return {
    currentStageId: currentStage?.id || "",
    hardStop: stages.some((item) => item.status === "hard-stop"),
    ok: true,
    ready,
    stages,
    targetRoot,
    updatedAt: new Date().toISOString(),
    summary: {
      nonGitEntries: context.nonGitEntries || [],
      originUrl: context.originUrl || "",
      remoteDefaultBranch: context.remoteDefaultBranch || ""
    }
  };
}

function repairsForStage(stage = {}) {
  return [
    stage.repair,
    ...(Array.isArray(stage.repairs) ? stage.repairs : [])
  ].filter(Boolean);
}

function terminalRepairActionIds(status = {}) {
  return new Set((Array.isArray(status.stages) ? status.stages : [])
    .flatMap(repairsForStage)
    .filter((repair) => repair.kind === "terminal" && repair.actionId)
    .map((repair) => repair.actionId));
}

function projectGitInitRepair(targetRoot) {
  return gitInitRepair(targetRoot, {
    extraArgs: hostWritableWorkspaceDockerArgs()
  });
}

async function pluginTerminalActionIsAvailable({
  actionId = "",
  setupRuntime = {},
  studioRoot = "",
  targetRoot = ""
} = {}) {
  const status = await inspectProjectSetup({
    config: setupRuntime.config,
    configEnvironment: setupRuntime.configEnvironment,
    setupPlugins: setupRuntime.setupPlugins,
    studioRoot,
    targetRoot
  });
  return terminalRepairActionIds(status).has(actionId);
}

async function listMeaningfulEntries(targetRoot) {
  const ignored = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);
  const entries = await readdir(targetRoot, {
    withFileTypes: true
  });
  return entries
    .map((entry) => entry.name)
    .filter((name) => !ignored.has(name))
    .sort((left, right) => left.localeCompare(right));
}


async function checkDirectory(targetRoot, context) {
  try {
    await access(targetRoot, fsConstants.R_OK | fsConstants.W_OK);
  } catch (error) {
    return hardStopCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "Target directory exists and is readable/writable.",
      observed: String(error?.message || error),
      explanation: "Studio cannot operate until the target directory is reachable."
    });
  }

  const entries = await listMeaningfulEntries(targetRoot);
  const nonGitEntries = entries.filter((entry) => {
    return entry !== ".git" && !STUDIO_OWNED_BOOTSTRAP_ENTRIES.has(entry);
  });
  context.entries = entries;
  context.nonGitEntries = nonGitEntries;
  context.studioOwnedEntries = entries.filter((entry) => STUDIO_OWNED_BOOTSTRAP_ENTRIES.has(entry));

  let gitStat = null;
  try {
    gitStat = await lstat(path.join(targetRoot, ".git"));
  } catch {
    gitStat = null;
  }

  if (!gitStat && nonGitEntries.length) {
    return hardStopCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "A directory without .git is empty.",
      observed: `No .git directory, but files exist:\n${formatList(nonGitEntries)}`,
      explanation: "Studio will not initialize Git over existing files because it cannot know their ownership."
    });
  }

  if (!gitStat) {
    context.directoryMode = "empty-no-git";
    return passCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "Target directory is empty or already a Git repository.",
      observed: context.studioOwnedEntries.length
        ? `No project files yet. Studio-owned state exists:\n${formatList(context.studioOwnedEntries)}`
        : "Empty directory with no .git.",
      explanation: "Studio can safely initialize this directory because only Studio bootstrap state is present."
    });
  }

  if (!gitStat.isDirectory() && linkedGitMetadataMountSource(targetRoot)) {
    context.directoryMode = "git-repo";
    return passCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: "Target directory is empty or already a Git work tree.",
      observed: ".git file points to linked Git metadata.",
      explanation: "Studio can continue with Git safety checks."
    });
  }

  if (!gitStat.isDirectory()) {
    return hardStopCheck({
      id: "directory",
      label: "Directory admissibility",
      expected: ".git is a directory or a valid linked worktree metadata file.",
      observed: ".git is not a directory.",
      explanation: "Studio could not resolve the .git file to existing Git metadata."
    });
  }

  context.directoryMode = "git-repo";
  return passCheck({
    id: "directory",
    label: "Directory admissibility",
    expected: "Target directory is empty or already a Git repository.",
    observed: ".git directory exists.",
    explanation: "Studio can continue with Git safety checks."
  });
}

async function checkGitReady(targetRoot, context) {
  if (context.directoryMode === "empty-no-git") {
    return blockedCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "A non-bare Git repository exists with a named branch.",
      observed: "No .git directory.",
      explanation: "Initialize Git before Studio creates or links a remote repository.",
      repair: projectGitInitRepair(targetRoot)
    });
  }

  const {
    bare,
    branch,
    inside
  } = await readGitRepositoryShape(targetRoot);
  if (!inside.ok || inside.stdout !== "true") {
    return hardStopCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "Target root is inside a Git work tree.",
      observed: inside.output,
      explanation: "The .git directory exists, but Git does not recognize the target as a normal work tree."
    });
  }

  if (bare.stdout === "true") {
    return hardStopCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "Repository is a non-bare work tree.",
      observed: "Bare repository.",
      explanation: "Studio only operates inside normal working trees."
    });
  }

  if (!branch.stdout) {
    return hardStopCheck({
      id: "git-ready",
      label: "Git ready",
      expected: "Repository has a named branch.",
      observed: "Detached or unborn branch with no branch name.",
      explanation: "Create or switch to a named branch before Studio continues."
    });
  }

  context.branch = branch.stdout;
  return passCheck({
    id: "git-ready",
    label: "Git ready",
    expected: "A non-bare Git repository exists with a named branch.",
    observed: `Branch: ${branch.stdout}`,
    explanation: "Git has the minimum local shape Studio needs."
  });
}

async function checkRemoteReady(targetRoot, context) {
  const result = await readGitOriginRemote(targetRoot);
  if (!result.ok || !result.stdout) {
    return blockedCheck({
      id: "remote-ready",
      label: "Remote ready",
      expected: "origin points at an accessible GitHub repository.",
      observed: result.output || "origin is missing.",
      explanation: "Create or link a GitHub repository before target-specific setup begins.",
      repairs: [
        ghRepoCreateRepair(targetRoot),
        linkGithubRemoteRepair()
      ]
    });
  }

  if (!isGithubRemoteUrl(result.stdout)) {
    return hardStopCheck({
      id: "remote-ready",
      label: "Remote ready",
      expected: "origin is a GitHub remote.",
      observed: result.stdout,
      explanation: "Studio relies on gh for issues and PRs, so the primary remote must be GitHub."
    });
  }

  const repoSlug = repoSlugFromRemoteUrl(result.stdout);
  const repoResult = await readGithubRepository(targetRoot, result.stdout);

  if (!repoResult.ok) {
    return hardStopCheck({
      id: "remote-ready",
      label: "Remote ready",
      expected: "GitHub remote is accessible through gh.",
      observed: repoResult.output,
      explanation: "Studio cannot continue unless gh can inspect the target repository."
    });
  }

  context.originUrl = result.stdout;
  context.remoteDefaultBranch = repoResult.repoInfo?.defaultBranchRef?.name || "";
  return passCheck({
    id: "remote-ready",
    label: "Remote ready",
    expected: "origin points at an accessible GitHub repository.",
    observed: [
      repoResult.repoInfo?.nameWithOwner || repoSlug,
      repoResult.repoInfo?.url || result.stdout,
      context.remoteDefaultBranch ? `default: ${context.remoteDefaultBranch}` : "remote has no default branch yet"
    ].join("\n"),
    explanation: "gh can inspect the repository Studio will use for issues and PRs."
  });
}

async function checkRemoteSync(targetRoot, context) {
  const localHead = await readGitLocalHead(targetRoot);
  const hasLocalHead = localHead.ok && Boolean(localHead.stdout);
  const remoteBranch = context.remoteDefaultBranch;

  if (!hasLocalHead && !remoteBranch) {
    return passCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local and remote histories are not divergent.",
      observed: "No local commits and remote has no default branch.",
      explanation: "This is a fresh repository pair."
    });
  }

  if (!hasLocalHead && remoteBranch) {
    return hardStopCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Remote content is mirrored locally before Studio writes files.",
      observed: `Remote default branch exists: ${remoteBranch}; local has no commits.`,
      explanation: "Clone the existing repository into this target directory. Studio will not overlay remote files into an empty local repo."
    });
  }

  if (hasLocalHead && !remoteBranch) {
    return passCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local and remote histories are not divergent.",
      observed: `Local HEAD: ${localHead.stdout}\nRemote has no default branch.`,
      explanation: "The remote is empty, so there is no remote history to reconcile."
    });
  }

  const remoteHead = await readRemoteBranchShaWithGit(targetRoot, remoteBranch);
  const remoteSha = remoteHead.sha;

  if (!remoteHead.ok || !remoteSha) {
    return hardStopCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Remote default branch SHA can be read.",
      observed: remoteHead.output,
      explanation: "Studio cannot prove local and remote histories agree."
    });
  }

  if (remoteSha !== localHead.stdout && await remoteHeadIsAncestorOfLocalHead(targetRoot, remoteSha)) {
    return passCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local HEAD contains origin default branch HEAD.",
      observed: `Local HEAD: ${localHead.stdout}\norigin/${remoteBranch}: ${remoteSha}`,
      explanation: "Local history includes the remote default branch and is ahead. The later Git checkpoint stage will require publishing the local HEAD."
    });
  }

  if (remoteSha !== localHead.stdout) {
    return hardStopCheck({
      id: "remote-sync",
      label: "Remote/local sync",
      expected: "Local HEAD equals or contains origin default branch HEAD.",
      observed: `Local HEAD: ${localHead.stdout}\norigin/${remoteBranch}: ${remoteSha}`,
      explanation: "Studio hard-stops on divergent histories. Pull, clone, or reconcile manually before continuing."
    });
  }

  return passCheck({
    id: "remote-sync",
    label: "Remote/local sync",
    expected: "Local HEAD equals origin default branch HEAD.",
    observed: `HEAD ${localHead.stdout} matches origin/${remoteBranch}.`,
    explanation: "Local and remote histories are aligned."
  });
}

async function checkGitCheckpoint(targetRoot, context) {
  const status = await readGitStatus(targetRoot);

  if (!status.ok) {
    return hardStopCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "Git working tree status can be read.",
      observed: status.output,
      explanation: "Studio cannot create a setup checkpoint until Git status is readable."
    });
  }

  const localHead = await readGitLocalHead(targetRoot);
  if (!localHead.ok || !localHead.stdout) {
    const observed = [
      localHead.output || "No local commits exist.",
      status.stdout ? `Working tree:\n${status.stdout.split(/\r?\n/u).slice(0, 40).join("\n")}` : ""
    ].filter(Boolean).join("\n\n");
    return blockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "A setup checkpoint commit exists and is pushed to origin.",
      observed,
      explanation: "Create the first setup checkpoint commit and push it before Studio continues.",
      repair: gitCheckpointRepair()
    });
  }

  const branchResult = context?.branch
    ? { ok: true, stdout: context.branch }
    : await readGitRepositoryShape(targetRoot).then((shape) => shape.branch);
  const branch = String(branchResult.stdout || "").trim();
  if (!branchResult.ok || !branch) {
    return hardStopCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "A named branch is available for pushing the setup checkpoint.",
      observed: branchResult.output || "No current branch.",
      explanation: "Studio cannot push a baseline from a detached or unnamed branch."
    });
  }

  const repoSlug = repoSlugFromRemoteUrl(context?.originUrl || "");
  if (!repoSlug) {
    return hardStopCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: "origin is a GitHub remote that can be checked through gh.",
      observed: context?.originUrl || "origin URL is unavailable.",
      explanation: "Studio cannot prove the setup checkpoint was published without the GitHub repository identity."
    });
  }

  const remoteHead = await readRemoteBranchShaWithGh(targetRoot, repoSlug, branch);
  const remoteSha = remoteHead.sha;
  if (!remoteHead.ok || !remoteSha) {
    return blockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: `Local HEAD is present on origin/${branch}.`,
      observed: remoteHead.output || `origin/${branch} is missing.`,
      explanation: "The setup checkpoint exists locally but has not been published to the GitHub remote yet.",
      repair: gitCheckpointRepair({
        includeInitialCommit: false
      })
    });
  }

  if (remoteSha !== localHead.stdout) {
    return blockedCheck({
      id: "git-checkpoint",
      label: "Git checkpoint",
      expected: `Local HEAD matches origin/${branch}.`,
      observed: `Local HEAD: ${localHead.stdout}\norigin/${branch}: ${remoteSha}`,
      explanation: "Push the setup checkpoint to origin. If Git rejects the push, reconcile the remote branch manually before continuing.",
      repair: gitCheckpointRepair({
        includeInitialCommit: false
      })
    });
  }

  return passCheck({
    id: "git-checkpoint",
    label: "Git checkpoint",
    expected: "A checkpoint commit exists and is pushed to origin.",
    observed: [
      `HEAD ${localHead.stdout} matches origin/${branch}.`,
      status.stdout ? `Uncommitted work is present:\n${status.stdout.split(/\r?\n/u).slice(0, 40).join("\n")}` : "Working tree is clean."
    ].join("\n"),
    explanation: "The target has a published baseline commit. Uncommitted work can remain for normal development and later Studio sessions."
  });
}

function readyStage() {
  return passCheck({
    id: "ready",
    label: "Ready",
    expected: "The target project is ready for Studio workflows.",
    observed: "All setup stages passed.",
    explanation: "Studio can now inspect and operate on this app."
  });
}

function genericSetupChecks(targetRoot, context) {
  return [
    {
      expected: "Target directory is empty or already a Git repository.",
      id: "directory",
      label: "Directory admissibility",
      run: () => checkDirectory(targetRoot, context)
    },
    {
      expected: "Git repository exists, is non-bare, and has a named branch.",
      id: "git-ready",
      label: "Git ready",
      run: () => checkGitReady(targetRoot, context)
    },
    {
      expected: "origin points at an accessible GitHub repository.",
      id: "remote-ready",
      label: "Remote ready",
      run: () => checkRemoteReady(targetRoot, context)
    },
    {
      expected: "Local HEAD and the remote default branch are not divergent.",
      id: "remote-sync",
      label: "Remote/local sync",
      run: () => checkRemoteSync(targetRoot, context)
    }
  ];
}

function finalSetupChecks(targetRoot, context) {
  return [
    {
      expected: "A checkpoint commit exists and is pushed to origin.",
      id: "git-checkpoint",
      label: "Git checkpoint",
      run: () => checkGitCheckpoint(targetRoot, context)
    },
    {
      expected: "The target project is ready for Studio workflows.",
      id: "ready",
      label: "Ready",
      run: readyStage
    }
  ];
}

async function setupCheckChain({
  context,
  setupPlugins = [],
  targetRoot
}) {
  const checks = [
    ...genericSetupChecks(targetRoot, context),
    ...await listDoctorPluginChecks({
      context,
      plugins: setupPlugins
    }),
    ...finalSetupChecks(targetRoot, context)
  ];
  assertUniqueCheckIds(checks);
  return checks;
}

async function runCoreSetupChecks({
  config = {},
  configEnvironment = {},
  emit = null,
  setupPlugins = [],
  studioRoot = "",
  targetRoot
} = {}) {
  const resolvedTargetRoot = path.resolve(String(targetRoot || process.cwd()));
  const context = {
    config,
    configEnvironment,
    studioRoot,
    targetRoot: resolvedTargetRoot
  };
  const checks = await setupCheckChain({
    context,
    setupPlugins,
    targetRoot: resolvedTargetRoot
  });
  const stages = [];

  for (let index = 0; index < checks.length; index += 1) {
    const result = await runDoctorCheck({
      check: checks[index],
      context,
      emit
    });
    stages.push(result);
    if (!checkPassed(result)) {
      return finalizeStatus({
        context,
        stages: appendPendingChecks(stages, checks, index + 1),
        targetRoot: resolvedTargetRoot
      });
    }
  }

  return finalizeStatus({
    context,
    stages,
    targetRoot: resolvedTargetRoot
  });
}

async function inspectProjectSetup(options = {}) {
  return runCoreSetupChecks(options);
}

function startGitInitTerminal(targetRoot, env = {}) {
  return startSharedGitInitTerminal({
    env,
    extraArgs: hostWritableWorkspaceDockerArgs(),
    namespace: TERMINAL_NAMESPACE,
    targetRoot
  });
}

function startGhCreateRepoTerminal(targetRoot, env = {}) {
  return startSharedGhCreateRepoTerminal({
    env,
    namespace: TERMINAL_NAMESPACE,
    targetRoot
  });
}

function startLinkRemoteTerminal(targetRoot, input = {}, env = {}) {
  return startSharedLinkGithubRemoteTerminal({
    env,
    input,
    namespace: TERMINAL_NAMESPACE,
    targetRoot
  });
}

function startGitCheckpointTerminal(targetRoot, input = {}, env = {}, {
  allowCreate = true
} = {}) {
  return startSharedGitCheckpointTerminal({
    allowCreate,
    env,
    input,
    namespace: TERMINAL_NAMESPACE,
    targetRoot
  });
}

function createService({
  projectService = null,
  studioRoot = "",
  targetRoot
} = {}) {
  const resolvedTargetRoot = path.resolve(String(targetRoot || process.cwd()));
  const resolvedStudioRoot = path.resolve(String(studioRoot || process.cwd()));
  const readyStatusCache = createRepositoryReadyStatusCache({
    doctorId: "project-setup",
    studioRoot: resolvedStudioRoot,
    targetRoot: resolvedTargetRoot
  });

  async function loadAdapterSetupRuntime() {
    if (!projectService || typeof projectService.createRuntime !== "function") {
      return {
        config: {},
        configEnvironment: {},
        setupPlugins: []
      };
    }
    const runtime = await projectService.createRuntime();
    if (typeof runtime.adapter?.getSetupDoctorPlugins !== "function") {
      return {
        config: runtime.projectConfig || {},
        configEnvironment: {},
        setupPlugins: []
      };
    }
    const configEnvironment = typeof projectService.projectConfigEnvironment === "function"
      ? await projectService.projectConfigEnvironment()
      : {};
    return {
      config: runtime.projectConfig || {},
      configEnvironment,
      setupPlugins: await runtime.adapter.getSetupDoctorPlugins({
        config: runtime.projectConfig || {},
        configEnvironment,
        startTerminalSession,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot,
        terminalNamespace: TERMINAL_NAMESPACE
      })
    };
  }

  return Object.freeze({
    async getStatus(input = {}) {
      if (!refreshRequested(input)) {
        const cachedStatus = await readyStatusCache.read();
        if (cachedStatus) {
          return cachedStatus;
        }
      }
      const setupRuntime = await loadAdapterSetupRuntime();
      return readyStatusCache.remember(await inspectProjectSetup({
        config: setupRuntime.config,
        configEnvironment: setupRuntime.configEnvironment,
        setupPlugins: setupRuntime.setupPlugins,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      }));
    },

    async streamStatus({
      emit,
      refresh = false
    } = {}) {
      if (!refreshRequested({ refresh })) {
        const cachedStatus = await readyStatusCache.read();
        if (cachedStatus) {
          return cachedStatus;
        }
      }
      const setupRuntime = await loadAdapterSetupRuntime();
      return readyStatusCache.remember(await inspectProjectSetup({
        config: setupRuntime.config,
        configEnvironment: setupRuntime.configEnvironment,
        emit,
        setupPlugins: setupRuntime.setupPlugins,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      }));
    },

    async startTerminal({
      actionId,
      inputs = {}
    } = {}) {
      const setupRuntime = await loadAdapterSetupRuntime();
      if (actionId === "terminal-git-init") {
        return startGitInitTerminal(resolvedTargetRoot, setupRuntime.configEnvironment);
      }
      if (actionId === "terminal-gh-create-repo") {
        return startGhCreateRepoTerminal(resolvedTargetRoot, setupRuntime.configEnvironment);
      }
      if (actionId === "terminal-link-github-remote") {
        return startLinkRemoteTerminal(resolvedTargetRoot, inputs, setupRuntime.configEnvironment);
      }
      if (actionId === CREATE_GIT_CHECKPOINT_ACTION_ID) {
        return startGitCheckpointTerminal(resolvedTargetRoot, inputs, setupRuntime.configEnvironment, {
          allowCreate: true
        });
      }
      if (actionId === PUSH_GIT_CHECKPOINT_ACTION_ID) {
        return startGitCheckpointTerminal(resolvedTargetRoot, inputs, setupRuntime.configEnvironment, {
          allowCreate: false
        });
      }

      if (!await pluginTerminalActionIsAvailable({
        actionId,
        setupRuntime,
        studioRoot: resolvedStudioRoot,
        targetRoot: resolvedTargetRoot
      })) {
        return {
          error: "This terminal action is not available in the current project setup state.",
          ok: false
        };
      }

      const pluginTerminal = await startDoctorPluginTerminal({
        actionId,
        context: {
          config: setupRuntime.config,
          configEnvironment: setupRuntime.configEnvironment,
          studioRoot: resolvedStudioRoot,
          targetRoot: resolvedTargetRoot
        },
        input: inputs,
        plugins: setupRuntime.setupPlugins
      });
      if (pluginTerminal) {
        return pluginTerminal;
      }
      return {
        error: "Unknown terminal action.",
        ok: false
      };
    },

    readTerminal(sessionId) {
      return readTerminalSession(sessionId, { namespace: TERMINAL_NAMESPACE });
    },

    writeTerminal(sessionId, data) {
      return writeTerminalSession(sessionId, data, { namespace: TERMINAL_NAMESPACE });
    },

    closeTerminal(sessionId) {
      return closeTerminalSession(sessionId, { namespace: TERMINAL_NAMESPACE });
    }
  });
}

export {
  createService,
  ghRepoCreateScript,
  gitCheckpointScript,
  githubBranchRefApiPath,
  inspectProjectSetup
};
