import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  GITHUB_MIRROR_REFRESH_SCRIPT,
  shellQuote
} from "@local/vibe64-execution/server";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  resolveProjectGithubMirrorPath
} from "@local/vibe64-core/server/projectState";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  configValues
} from "../configValues.js";
import {
  repositoryCommandProfileForSession
} from "./repositoryCommandProfile.js";
import {
  gitCompletedMetadataSpec,
  gitWorktreeCommandSpec,
  normalizeHookCommandResult
} from "./shellHelpers.js";

function mergePrScript({
  beforeMergeScript = "",
  mergeMethod = "merge",
  session = {}
} = {}) {
  const prUrl = normalizeText(session.metadata?.pr_url);
  const mergePreparationSummary = normalizeText(session.metadata?.merge_preparation_summary);
  const mergeFlag = {
    merge: "--merge",
    rebase: "--rebase",
    squash: "--squash"
  }[normalizeText(mergeMethod)] || "--merge";
  return [
    "set -e",
    beforeMergeScript,
    `printf '[studio] Merging pull request %s\\n' ${shellQuote(prUrl)}`,
    `gh pr merge ${shellQuote(prUrl)} ${mergeFlag}`,
    mergePreparationCommentScript({
      prUrl,
      summary: mergePreparationSummary
    })
  ].filter(Boolean).join("\n");
}

function mergePreparationCommentScript({
  prUrl = "",
  summary = ""
} = {}) {
  const normalizedSummary = normalizeText(summary);
  if (!normalizedSummary) {
    return "";
  }
  const comment = [
    "## Vibe64 merge preparation",
    "",
    "Additional merge-preparation work was performed after this pull request was created and before it was merged.",
    "",
    normalizedSummary
  ].join("\n");
  return [
    `MERGE_PREPARATION_COMMENT_FILE="$(mktemp)"`,
    `printf '%s\\n' ${shellQuote(comment)} > "$MERGE_PREPARATION_COMMENT_FILE"`,
    `if ! gh pr comment ${shellQuote(prUrl)} --body-file "$MERGE_PREPARATION_COMMENT_FILE"; then`,
    `  printf '[studio] Merge-preparation comment failed; pull request was already merged.\\n' >&2`,
    "fi",
    `rm -f "$MERGE_PREPARATION_COMMENT_FILE"`
  ].join("\n");
}

function refreshGithubMirrorScript({
  baseBranch = "main",
  githubMirrorPath = "",
  remoteUrl = ""
} = {}) {
  const normalizedBaseBranch = normalizeText(baseBranch) || "main";
  const normalizedGithubMirrorPath = normalizeText(githubMirrorPath);
  const normalizedRemoteUrl = normalizeText(remoteUrl);
  return [
    "set -e",
    `BASE_BRANCH=${shellQuote(normalizedBaseBranch)}`,
    `VIBE64_GITHUB_MIRROR_PATH=${shellQuote(normalizedGithubMirrorPath)}`,
    `VIBE64_GIT_REMOTE_URL=${shellQuote(normalizedRemoteUrl)}`,
    "if [ -z \"$VIBE64_GIT_REMOTE_URL\" ]; then",
    "  printf '[studio] Cannot refresh the GitHub mirror because no GitHub remote is configured.\\n' >&2",
    "  exit 1",
    "fi",
    "if [ -z \"$VIBE64_GITHUB_MIRROR_PATH\" ]; then",
    "  printf '[studio] Cannot refresh the GitHub mirror because no project runtime root is configured.\\n' >&2",
    "  exit 1",
    "fi",
    `if ! bash -c ${shellQuote(GITHUB_MIRROR_REFRESH_SCRIPT)} vibe64-github-mirror-refresh "$VIBE64_GITHUB_MIRROR_PATH" "$VIBE64_GIT_REMOTE_URL"; then`,
    "  printf '[studio] GitHub mirror refresh failed; the next mirror use will retry.\\n' >&2",
    "fi",
    "printf '[studio] GitHub mirror refresh attempted for %s.\\n' \"$BASE_BRANCH\""
  ].join("\n");
}

async function projectGithubRepository({
  projectRecordPath = ""
} = {}) {
  const metadataPath = normalizeText(projectRecordPath);
  if (!metadataPath) {
    return null;
  }
  try {
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    return metadata?.repository?.github || null;
  } catch {
    return null;
  }
}

function projectGithubMirrorPath(targetRoot = "") {
  const projectRoot = normalizeText(targetRoot);
  return projectRoot
    ? resolveProjectGithubMirrorPath({
        projectRoot
      })
    : "";
}

function githubMirrorProjectRoot(value = "") {
  const projectRoot = normalizeText(value);
  return projectRoot && path.isAbsolute(projectRoot) ? projectRoot : "";
}

async function githubMirrorRefreshTerminalSpec({
  baseBranch = "main",
  context = {},
  projectRoot = "",
  remoteUrl = ""
} = {}) {
  const normalizedProjectRoot = githubMirrorProjectRoot(projectRoot);
  if (!normalizedProjectRoot) {
    return {
      ok: false,
      message: "GitHub mirror refresh requires an absolute project root."
    };
  }
  const repository = await projectGithubRepository({
    projectRecordPath: context.projectRecordPath
  });
  const resolvedRemoteUrl = normalizeText(remoteUrl) ||
    normalizeText(repository?.cloneUrl) ||
    (normalizeText(repository?.fullName) ? `https://github.com/${normalizeText(repository.fullName)}.git` : "");
  if (!resolvedRemoteUrl) {
    return {
      ok: false,
      message: "GitHub mirror refresh requires repository remote metadata."
    };
  }
  const githubMirrorPath = projectGithubMirrorPath(normalizedProjectRoot);
  return gitCompletedMetadataSpec({
    commandPreview: "git fetch --prune origin",
    cwd: normalizedProjectRoot,
    label: "Refresh GitHub mirror",
    metadata: {
      github_mirror_path: githubMirrorPath,
      github_mirror_refresh_attempted: "yes"
    },
    requiresHostGithubCredentials: true,
    script: refreshGithubMirrorScript({
      baseBranch,
      githubMirrorPath,
      remoteUrl: resolvedRemoteUrl
    })
  });
}

async function mergePrTerminalSpec({
  context = {},
  hooks = {},
  session = {},
  targetRoot = ""
} = {}) {
  if (!repositoryCommandProfileForSession(session).githubPr) {
    return {
      ok: false,
      message: "GitHub pull request merge is only available for GitHub projects."
    };
  }
  if (!normalizeText(session.metadata?.pr_url)) {
    return {
      ok: false,
      message: "Create the pull request before merging."
    };
  }
  const config = context.config || session.config || {};
  const hook = hooks?.beforeMerge;
  const hookResult = typeof hook === "function"
    ? normalizeHookCommandResult(await hook({
        context,
        session,
        targetRoot,
        worktreePath: sessionSourcePath(session)
      }))
    : null;
  const beforeMergeScript = normalizeText(hookResult?.script);
  const values = configValues(config);
  return gitWorktreeCommandSpec({
    commandPreview: "gh pr merge",
    label: "Merge PR",
    metadata: {
      pr_merged: "yes"
    },
    requiresHostGithubCredentials: true,
    runtimes: ["gh", ...(hookResult?.runtimes || [])],
    script: mergePrScript({
      beforeMergeScript,
      mergeMethod: values.github_pr_merge_method || "merge",
      session
    }),
    session
  });
}

async function refreshGithubMirrorTerminalSpec({
  context = {},
  session = {},
  targetRoot = ""
} = {}) {
  if (!repositoryCommandProfileForSession(session).githubPr) {
    return {
      ok: false,
      message: "GitHub mirror refresh is only available for GitHub projects."
    };
  }
  if (!normalizeText(session.metadata?.pr_merged)) {
    return {
      ok: false,
      message: "Merge the pull request before refreshing the GitHub mirror."
    };
  }
  return githubMirrorRefreshTerminalSpec({
    baseBranch: session.metadata?.base_branch,
    context,
    projectRoot: targetRoot || session.targetRoot,
    remoteUrl: session.metadata?.source_remote_url
  });
}

async function projectRefreshGithubMirrorTerminalSpec({
  baseBranch = "main",
  context = {},
  targetRoot = ""
} = {}) {
  return githubMirrorRefreshTerminalSpec({
    baseBranch,
    context,
    projectRoot: targetRoot
  });
}

export {
  mergePrTerminalSpec,
  projectRefreshGithubMirrorTerminalSpec,
  refreshGithubMirrorScript,
  refreshGithubMirrorTerminalSpec
};
