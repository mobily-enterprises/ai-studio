import {
  metadataPath,
  normalizeText,
  shellQuote,
  worktreeCommandSpec,
  writeMetadataLineScript
} from "./shared.js";

function runAutomatedChecksScript() {
  return [
    "set -e",
    "printf '[studio] Running JSKIT automated checks.\\n'",
    "printf '[studio] $ npm run build\\n\\n'",
    "npm run build"
  ].join("\n");
}

function commitChangesScript(session = {}) {
  const commitPath = metadataPath(session, "accepted_commit");
  const pushedPath = metadataPath(session, "branch_pushed");
  const issueTitlePath = metadataPath(session, "issue_title");
  const directExistingPr = normalizeText(session.metadata?.work_source) === "existing_pr" &&
    normalizeText(session.metadata?.source_pr_update_mode) === "direct";
  const baseBranch = normalizeText(session.metadata?.base_branch) ||
    normalizeText(session.metadata?.source_pr_base_ref) ||
    "main";
  const sourcePrHeadRef = normalizeText(session.metadata?.source_pr_head_ref);
  const sourcePrHeadRepo = normalizeText(session.metadata?.source_pr_head_repo);
  return [
    "set -e",
    `COMMIT_TITLE="$(cat ${shellQuote(issueTitlePath)} 2>/dev/null | head -n 1 | sed 's/[[:space:]]*$//')"`,
    "if [ -z \"$COMMIT_TITLE\" ]; then",
    `  COMMIT_TITLE="AI Studio session ${session.sessionId}"`,
    "fi",
    "if [ -n \"$(git status --short)\" ]; then",
    "  printf '[studio] Committing changes: %s\\n' \"$COMMIT_TITLE\"",
    "  git add -A",
    "  git commit -m \"$COMMIT_TITLE\"",
    "else",
    "  printf '[studio] No working tree changes to commit; checking existing branch commits.\\n'",
    "fi",
    "CURRENT_BRANCH=\"$(git branch --show-current)\"",
    "if [ -z \"$CURRENT_BRANCH\" ]; then",
    "  printf '[studio] Cannot push from a detached HEAD.\\n' >&2",
    "  exit 1",
    "fi",
    `BASE_BRANCH=${shellQuote(baseBranch)}`,
    "git fetch origin \"$BASE_BRANCH\"",
    "BASE_REF=\"origin/$BASE_BRANCH\"",
    "COMMITS_AHEAD=\"$(git rev-list --count \"$BASE_REF\"..HEAD)\"",
    "if [ \"$COMMITS_AHEAD\" = \"0\" ]; then",
    "  printf '[studio] No commits exist between %s and %s. Nothing to push.\\n' \"$BASE_REF\" \"$CURRENT_BRANCH\" >&2",
    "  exit 1",
    "fi",
    "ACCEPTED_COMMIT=\"$(git rev-parse --verify HEAD)\"",
    ...(directExistingPr ? [
      `SOURCE_PR_HEAD_REF=${shellQuote(sourcePrHeadRef)}`,
      `SOURCE_PR_HEAD_REPO=${shellQuote(sourcePrHeadRepo)}`,
      "if [ -z \"$SOURCE_PR_HEAD_REF\" ] || [ -z \"$SOURCE_PR_HEAD_REPO\" ]; then",
      "  printf '[studio] Existing PR push target is missing.\\n' >&2",
      "  exit 1",
      "fi",
      "PR_HEAD_REMOTE=\"ai-studio-pr-head\"",
      "git remote remove \"$PR_HEAD_REMOTE\" >/dev/null 2>&1 || true",
      "git remote add \"$PR_HEAD_REMOTE\" \"https://github.com/$SOURCE_PR_HEAD_REPO.git\"",
      "printf '[studio] Pushing changes to existing PR branch %s/%s\\n' \"$SOURCE_PR_HEAD_REPO\" \"$SOURCE_PR_HEAD_REF\"",
      "git push \"$PR_HEAD_REMOTE\" \"HEAD:refs/heads/$SOURCE_PR_HEAD_REF\"",
      writeMetadataLineScript(pushedPath, "\"$SOURCE_PR_HEAD_REF\"")
    ] : [
      "printf '[studio] Pushing branch %s\\n' \"$CURRENT_BRANCH\"",
      "git push -u origin \"$CURRENT_BRANCH\"",
      writeMetadataLineScript(pushedPath, "\"$CURRENT_BRANCH\"")
    ]),
    writeMetadataLineScript(commitPath, "\"$ACCEPTED_COMMIT\""),
    "printf '[studio] Committed %s\\n' \"$ACCEPTED_COMMIT\""
  ].join("\n");
}

async function runAutomatedChecksTerminalSpec({ session = {} } = {}) {
  return worktreeCommandSpec({
    commandPreview: "npm run build",
    label: "Run automated checks",
    metadata: {
      automated_checks_passed: "yes"
    },
    script: runAutomatedChecksScript(),
    session
  });
}

async function commitChangesTerminalSpec({ session = {} } = {}) {
  return worktreeCommandSpec({
    commandPreview: "git add -A && git commit && git push",
    label: "Commit and push changes",
    script: commitChangesScript(session),
    session
  });
}

export {
  commitChangesTerminalSpec,
  runAutomatedChecksTerminalSpec
};
