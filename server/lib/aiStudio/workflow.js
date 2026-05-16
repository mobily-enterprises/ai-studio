import { deepFreeze } from "./deepFreeze.js";

const DEFAULT_AI_STUDIO_WORKFLOW = deepFreeze({
  id: "default",
  steps: [
    {
      description: "Create the AI Studio session.",
      id: "session_created",
      label: "Create session"
    },
    {
      actions: [
        {
          adapterCapability: "create_worktree",
          advanceOnSuccess: true,
          disabledReason: "Worktree already exists.",
          disabledWhen: ["metadata:worktree_path"],
          id: "create_worktree",
          label: "Create worktree",
          type: "command"
        }
      ],
      description: "Create the isolated worktree or target-specific working area.",
      id: "worktree_created",
      label: "Create worktree",
      next: {
        disabledReason: "Create the worktree before continuing.",
        enabledWhen: ["metadata:worktree_path"]
      }
    },
    {
      actions: [
        {
          adapterCapability: "install_dependencies",
          advanceOnSuccess: true,
          disabledReason: "Dependencies are already installed.",
          disabledWhen: ["metadata:dependencies_installed"],
          id: "install_dependencies",
          label: "Install dependencies",
          type: "command"
        }
      ],
      description: "Install target dependencies when the adapter requires them.",
      id: "dependencies_installed",
      label: "Install dependencies",
      next: {
        disabledReason: "Install dependencies before continuing.",
        enabledWhen: ["metadata:dependencies_installed"]
      }
    },
    {
      actions: [
        {
          id: "send_issue_prompt",
          label: "Send prompt",
          promptId: "send_issue_prompt",
          type: "prompt"
        },
        {
          id: "create_issue_file",
          label: "Create issue file",
          promptId: "create_issue_file",
          type: "prompt"
        }
      ],
      description: "Define the issue and create the local issue files.",
      id: "issue_file_created",
      label: "Define issue and create file"
    },
    {
      actions: [
        {
          disabledReason: "The GitHub issue already exists; edit it on GitHub instead.",
          disabledWhen: ["metadata:issue_url"],
          id: "edit_issue",
          label: "Edit issue",
          type: "editor"
        },
        {
          adapterCapability: "create_issue_on_gh",
          id: "create_issue_on_gh",
          label: "Create issue on GH",
          type: "command"
        }
      ],
      description: "Review the issue files and submit the GitHub issue.",
      id: "issue_submitted",
      label: "Edit and submit issue",
      next: {
        enabledWhen: ["metadata:issue_url"]
      }
    },
    {
      actions: [
        {
          id: "make_plan",
          label: "Make plan",
          promptId: "make_plan",
          type: "prompt"
        }
      ],
      description: "Ask Codex to create the implementation plan.",
      id: "plan_made",
      label: "Make plan"
    },
    {
      actions: [
        {
          id: "execute_plan",
          label: "Execute plan",
          promptId: "execute_plan",
          type: "prompt"
        }
      ],
      description: "Ask Codex to execute the plan.",
      id: "plan_executed",
      label: "Execute plan"
    },
    {
      actions: [
        {
          id: "run_deep_ui_check",
          label: "Run deep UI check",
          promptId: "run_deep_ui_check",
          type: "prompt"
        }
      ],
      description: "Run the deeper UI review when the target supports it.",
      id: "deep_ui_check_run",
      label: "Run deep UI check"
    },
    {
      actions: [
        {
          id: "run_deslop",
          label: "Run deslop",
          promptId: "run_deslop",
          type: "prompt"
        },
        {
          id: "resolve_deslop",
          label: "Resolve deslop",
          promptId: "resolve_deslop",
          type: "prompt"
        }
      ],
      description: "Run the review/deslop prompts.",
      id: "review_run",
      label: "Run review/deslop"
    },
    {
      actions: [
        {
          adapterCapability: "run_automated_checks",
          id: "run_automated_checks",
          label: "Run automated checks",
          type: "command"
        }
      ],
      description: "Run the adapter-provided automated checks.",
      id: "automated_checks_run",
      label: "Run automated checks"
    },
    {
      actions: [
        {
          adapterCapability: "accept_changes",
          id: "accept_changes",
          label: "Accept changes",
          type: "command"
        }
      ],
      description: "Accept the finished work for commit.",
      id: "changes_accepted",
      label: "Accept changes",
      next: {
        disabledReason: "Accept changes before continuing.",
        enabledWhen: ["metadata:changes_accepted"]
      }
    },
    {
      actions: [
        {
          id: "update_project_knowledge",
          label: "Update project knowledge",
          promptId: "update_project_knowledge",
          type: "prompt"
        }
      ],
      description: "Update adapter-supported project knowledge.",
      id: "project_knowledge_updated",
      label: "Update project knowledge"
    },
    {
      actions: [
        {
          adapterCapability: "commit_changes",
          id: "commit_changes",
          label: "Commit changes",
          type: "command"
        }
      ],
      description: "Commit the accepted changes.",
      id: "changes_committed",
      label: "Commit changes",
      next: {
        disabledReason: "Commit changes before continuing.",
        enabledWhen: ["metadata:accepted_commit"]
      }
    },
    {
      actions: [
        {
          id: "create_pr_file",
          label: "Create PR file",
          promptId: "create_pr_file",
          type: "prompt"
        }
      ],
      description: "Create the local pull request file.",
      id: "pr_file_created",
      label: "Create PR file"
    },
    {
      actions: [
        {
          disabledReason: "The GitHub pull request already exists; edit it on GitHub instead.",
          disabledWhen: ["metadata:pr_url"],
          id: "edit_pr",
          label: "Edit PR",
          type: "editor"
        },
        {
          adapterCapability: "create_pr_on_gh",
          id: "create_pr_on_gh",
          label: "Create PR on GH",
          type: "command"
        }
      ],
      description: "Review and create the GitHub pull request.",
      id: "pr_created",
      label: "Edit and create PR",
      next: {
        disabledReason: "Create the pull request before continuing.",
        enabledWhen: ["metadata:pr_url"]
      }
    },
    {
      actions: [
        {
          disabledReason: "Create the pull request before preparing for merge.",
          enabledWhen: ["metadata:pr_url"],
          id: "prepare_for_merge",
          label: "Prepare for merge",
          promptId: "prepare_for_merge",
          type: "prompt"
        },
        {
          adapterCapability: "merge_pr",
          disabledReason: "Create the pull request before merging.",
          enabledWhen: ["metadata:pr_url"],
          id: "merge_pr",
          label: "Merge",
          type: "command"
        }
      ],
      description: "Prepare and merge the pull request.",
      id: "pr_merged",
      label: "Merge PR"
    },
    {
      actions: [
        {
          adapterCapability: "sync_main_checkout",
          disabledReason: "Merge the pull request before syncing the main checkout.",
          enabledWhen: ["metadata:pr_url", "metadata:pr_merged"],
          id: "sync_main_checkout",
          label: "Sync main checkout",
          type: "command"
        }
      ],
      description: "Sync the main checkout after a successful merge.",
      id: "main_checkout_synced",
      label: "Sync main checkout"
    },
    {
      actions: [
        {
          adapterCapability: "finish_session",
          disabledReason: "Create the pull request before finishing the session.",
          enabledWhen: ["metadata:pr_url"],
          id: "finish_session",
          label: "Finish",
          type: "finish"
        }
      ],
      description: "Congratulations. Finish the session.",
      id: "session_finished",
      label: "Congratulations!",
      next: {
        visible: false
      }
    }
  ]
});

export {
  DEFAULT_AI_STUDIO_WORKFLOW
};
