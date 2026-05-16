import {
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JskitTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  createJskitAiStudioCommandRunner,
  createJskitAiStudioCommandTerminalSpec
} from "./commandRunner.js";

const JSKIT_AI_STUDIO_COMMANDS = deepFreeze([
  {
    id: "accept_changes",
    label: "Accept changes"
  },
  {
    id: "commit_changes",
    label: "Commit changes"
  },
  {
    id: "create_issue_on_gh",
    label: "Create issue on GH"
  },
  {
    id: "create_pr_on_gh",
    label: "Create PR on GH"
  },
  {
    id: "create_worktree",
    label: "Create worktree"
  },
  {
    id: "finish_session",
    label: "Finish session"
  },
  {
    id: "install_dependencies",
    label: "Install dependencies"
  },
  {
    id: "merge_pr",
    label: "Merge PR"
  },
  {
    id: "run_automated_checks",
    label: "Run automated checks"
  },
  {
    id: "sync_main_checkout",
    label: "Sync main checkout"
  }
]);

function createJskitTargetAdapter({
  commandTerminalSpecFactory = createJskitAiStudioCommandTerminalSpec,
  commandRunner = createJskitAiStudioCommandRunner()
} = {}) {
  return new JskitTargetAdapter({
    commandTerminalSpecFactory,
    commandRunner,
    commands: JSKIT_AI_STUDIO_COMMANDS
  });
}

export {
  createJskitTargetAdapter,
  createJskitAiStudioCommandRunner,
  createJskitAiStudioCommandTerminalSpec,
  JSKIT_MARKERS,
  JSKIT_PROMPT_PACK_ROOT,
  JSKIT_AI_STUDIO_COMMANDS,
  JskitTargetAdapter
};
