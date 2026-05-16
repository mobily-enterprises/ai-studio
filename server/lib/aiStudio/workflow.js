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
          id: "create_worktree",
          label: "Create worktree",
          type: "command"
        }
      ],
      description: "Create the isolated worktree or target-specific working area.",
      id: "worktree_created",
      label: "Create worktree"
    },
    {
      actions: [
        {
          id: "install_dependencies",
          label: "Install dependencies",
          type: "command"
        }
      ],
      description: "Install target dependencies when the adapter requires them.",
      id: "dependencies_installed",
      label: "Install dependencies"
    },
    {
      actions: [
        {
          id: "send_issue_prompt",
          label: "Send prompt",
          type: "prompt"
        },
        {
          id: "create_issue_file",
          label: "Create issue file",
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
          id: "edit_issue",
          label: "Edit issue",
          type: "editor"
        },
        {
          id: "create_issue_on_gh",
          label: "Create issue on GH",
          type: "command"
        }
      ],
      description: "Review the issue files and submit the GitHub issue.",
      id: "issue_submitted",
      label: "Edit and submit issue"
    },
    {
      actions: [
        {
          id: "make_plan",
          label: "Make plan",
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
          type: "prompt"
        },
        {
          id: "resolve_deslop",
          label: "Resolve deslop",
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
          id: "accept_changes",
          label: "Accept changes",
          type: "command"
        }
      ],
      description: "Accept the finished work for commit.",
      id: "changes_accepted",
      label: "Accept changes"
    },
    {
      actions: [
        {
          id: "update_project_knowledge",
          label: "Update project knowledge",
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
          id: "commit_changes",
          label: "Commit changes",
          type: "command"
        }
      ],
      description: "Commit the accepted changes.",
      id: "changes_committed",
      label: "Commit changes"
    },
    {
      actions: [
        {
          id: "create_pr_file",
          label: "Create PR file",
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
          id: "edit_pr",
          label: "Edit PR",
          type: "editor"
        },
        {
          id: "create_pr_on_gh",
          label: "Create PR on GH",
          type: "command"
        }
      ],
      description: "Review and create the GitHub pull request.",
      id: "pr_created",
      label: "Edit and create PR"
    },
    {
      actions: [
        {
          id: "prepare_for_merge",
          label: "Prepare for merge",
          type: "prompt"
        },
        {
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
          id: "finish_session",
          label: "Finish",
          type: "command"
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
