const BASE_URL = String(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:5173").replace(/\/+$/u, "");

const viewports = [
  { name: "compact", width: 390, height: 844 },
  { name: "medium", width: 768, height: 1024 },
  { name: "expanded", width: 1280, height: 900 }
];

const blockedBootstrapPayload = {
  ready: false,
  checks: [
    {
      id: "docker",
      label: "Docker engine",
      status: "pass",
      required: true,
      expected: "Docker engine is reachable.",
      observed: "Docker responded.",
      explanation: "Studio uses Docker for managed local toolchain services."
    },
    {
      id: "mysql-capability",
      label: "MySQL capability",
      status: "fail",
      required: true,
      expected: "Managed MySQL can create and drop a probe database and table.",
      observed: "Probe database is not ready.",
      explanation: "Studio needs a managed MySQL runtime before it can operate on apps that need one.",
      repair: {
        kind: "command",
        actionId: "mysql-capability",
        label: "Repair MySQL",
        commandPreview: "docker compose up -d mysql"
      }
    },
    {
      id: "toolchain-image",
      label: "Managed toolchain image",
      status: "pass",
      required: true,
      expected: "The managed toolchain image exists.",
      observed: "jskit-ai-studio-toolchain:0.1.0",
      explanation: "Node, npm, git, GitHub CLI, and Codex run inside this managed image."
    },
    {
      id: "gh-auth",
      label: "GitHub login",
      status: "fail",
      required: true,
      expected: "GitHub CLI is logged in inside the managed toolchain.",
      observed: "gh auth status failed.",
      explanation: "Studio needs GitHub CLI authentication for repository operations.",
      repair: {
        kind: "terminal",
        actionId: "gh-auth",
        label: "Log in to GitHub",
        commandPreview: "gh auth login"
      }
    },
    {
      id: "codex-auth",
      label: "Codex login",
      status: "fail",
      required: true,
      expected: "Codex CLI is logged in inside the managed toolchain.",
      observed: "Codex is installed but not authenticated.",
      explanation: "Studio needs a local Codex session before it can delegate implementation work.",
      repair: {
        kind: "terminal",
        actionId: "codex-auth",
        label: "Log in to Codex",
        commandPreview: "codex login"
      }
    }
  ]
};

const readyBootstrapPayload = {
  ready: true,
  checks: [
    {
      id: "docker",
      label: "Docker engine",
      status: "pass",
      required: true,
      expected: "Docker engine is reachable.",
      observed: "Docker responded.",
      explanation: "Docker is reachable."
    },
    {
      id: "gh-auth",
      label: "GitHub login",
      status: "pass",
      required: true,
      expected: "GitHub CLI is logged in inside the managed toolchain.",
      observed: "Logged in.",
      explanation: "GH is authenticated inside the managed toolchain."
    },
    {
      id: "codex-auth",
      label: "Codex login",
      status: "pass",
      required: true,
      expected: "Codex login status succeeds inside the managed toolchain.",
      observed: "Logged in.",
      explanation: "Codex is authenticated inside the managed toolchain."
    }
  ]
};

const blockedTargetAppPayload = {
  ready: false,
  studioRoot: "/studio/jskit-ai-studio",
  targetRoot: "/workspace/example-target-app",
  checks: [
    {
      id: "target-directory",
      label: "Target directory",
      status: "pass",
      required: true,
      expected: "Target root exists and is readable/writable by Studio.",
      observed: "/workspace/example-target-app",
      explanation: "Studio can reach the target root without reading app metadata."
    },
    {
      id: "target-identity",
      label: "Target identity",
      status: "pass",
      required: true,
      expected: "Target root and Studio root are separate.",
      observed: "Studio root: /studio/jskit-ai-studio\nTarget root: /workspace/example-target-app",
      explanation: "Studio is pointed at a separate target directory."
    },
    {
      id: "git-repository",
      label: "Git repository",
      status: "fail",
      required: true,
      expected: "Target root is inside a git work tree.",
      observed: "fatal: not a git repository",
      explanation: "Target App Doctor needs a git repository before Studio can create branches, commits, issues, or PRs.",
      repair: {
        kind: "terminal",
        actionId: "terminal-git-init",
        label: "Initialize Git",
        commandPreview: "docker run --rm jskit-ai-studio-toolchain:0.1.0 git init"
      }
    },
    {
      id: "git-identity",
      label: "Git identity",
      status: "fail",
      required: true,
      expected: "Git user.name and user.email are configured.",
      observed: "user.name: missing\nuser.email: missing",
      explanation: "Studio will not write files until commit identity is configured.",
      repair: {
        kind: "terminal",
        actionId: "terminal-git-identity",
        label: "Set Git identity",
        commandPreview: "git config --global user.name \"<name>\"\ngit config --global user.email \"<email>\"",
        fields: [
          {
            id: "name",
            label: "Git user.name",
            placeholder: "Your Name",
            required: true,
            type: "text"
          },
          {
            id: "email",
            label: "Git user.email",
            placeholder: "you@example.com",
            required: true,
            type: "email"
          }
        ]
      }
    },
    {
      id: "github-auth",
      label: "GitHub CLI auth",
      status: "pass",
      required: true,
      expected: "gh is authenticated and can call the GitHub API.",
      observed: "merc",
      explanation: "GitHub CLI can call the GitHub API from the managed toolchain."
    },
    {
      id: "github-repository",
      label: "GitHub repository",
      status: "fail",
      required: true,
      expected: "Target origin resolves to a GitHub repository.",
      observed: "origin remote is not configured.",
      explanation: "Studio can create a GitHub repo for the target after confirmation.",
      repair: {
        kind: "terminal",
        actionId: "terminal-gh-create-repo",
        label: "Create/link GitHub repo",
        commandPreview: "gh repo create example-target-app --source=. --remote=origin --private --push"
      }
    }
  ]
};

const readyTargetAppPayload = {
  ready: true,
  studioRoot: "/studio/jskit-ai-studio",
  targetRoot: "/workspace/example-target-app",
  checks: [
    {
      id: "target-directory",
      label: "Target directory",
      status: "pass",
      required: true,
      expected: "Target root exists and is readable/writable by Studio.",
      observed: "/workspace/example-target-app",
      explanation: "Studio can reach the target root without reading app metadata."
    },
    {
      id: "git-repository",
      label: "Git repository",
      status: "pass",
      required: true,
      expected: "Target root is inside a git work tree.",
      observed: "true",
      explanation: "Git is available for the target app."
    }
  ]
};

const blockedAppSetupPayload = {
  ready: false,
  targetRoot: "/workspace/example-target-app",
  currentStageId: "scaffold",
  hardStop: false,
  stages: [
    {
      id: "directory",
      label: "Directory admissibility",
      status: "pass",
      required: true,
      expected: "Target directory is empty or already a Git repository.",
      observed: ".git directory exists.",
      explanation: "Studio can continue with Git safety checks."
    },
    {
      id: "git-ready",
      label: "Git ready",
      status: "pass",
      required: true,
      expected: "A non-bare Git repository exists with a named branch.",
      observed: "Branch: main",
      explanation: "Git has the minimum local shape Studio needs."
    },
    {
      id: "remote-ready",
      label: "Remote ready",
      status: "pass",
      required: true,
      expected: "origin points at an accessible GitHub repository.",
      observed: "merc/example-target-app",
      explanation: "gh can inspect the repository Studio will use for issues and PRs."
    },
    {
      id: "remote-sync",
      label: "Remote/local sync",
      status: "pass",
      required: true,
      expected: "Local and remote histories are not divergent.",
      observed: "No local commits and remote has no default branch.",
      explanation: "This is a fresh repository pair."
    },
    {
      id: "scaffold",
      label: "Seed JSKIT app",
      status: "blocked",
      required: true,
      expected: "Minimal JSKIT scaffold markers exist.",
      observed: "No scaffold files are present yet.",
      explanation: "Seed this target with the selected JSKIT configuration before installing dependencies or checking runtime readiness.",
      repair: {
        kind: "terminal",
        actionId: "terminal-scaffold-jskit",
        label: "Seed this project",
        commandPreview: "npx @jskit-ai/create-app example-target-app --target . --force --tenancy-mode none --title \"Example Target App\" --initial-bundles none"
      }
    },
    {
      id: "dependencies",
      label: "Dependencies runnable",
      status: "pending",
      required: true,
      expected: "Node dependencies are installed enough to run JSKIT commands.",
      observed: "Waiting for previous stage.",
      explanation: "This stage runs after the previous required stages pass."
    },
    {
      id: "runtime-services",
      label: "Runtime services",
      status: "pending",
      required: true,
      expected: "Only runtime services required by the target app are reachable.",
      observed: "Waiting for previous stage.",
      explanation: "This stage runs after the previous required stages pass."
    },
    {
      id: "jskit-doctor",
      label: "JSKIT doctor",
      status: "pending",
      required: true,
      expected: "The official JSKIT verification command passes.",
      observed: "Waiting for previous stage.",
      explanation: "This stage runs after the previous required stages pass."
    },
    {
      id: "git-checkpoint",
      label: "Git checkpoint",
      status: "pending",
      required: true,
      expected: "Working tree is clean after setup changes.",
      observed: "Waiting for previous stage.",
      explanation: "This stage runs after the previous required stages pass."
    },
    {
      id: "ready",
      label: "Ready",
      status: "pending",
      required: true,
      expected: "The target app is ready for Studio workflows.",
      observed: "Waiting for previous stage.",
      explanation: "This stage runs after the previous required stages pass."
    }
  ]
};

const readyAppSetupPayload = {
  ready: true,
  targetRoot: "/workspace/example-target-app",
  currentStageId: "",
  hardStop: false,
  stages: [
    {
      id: "directory",
      label: "Directory admissibility",
      status: "pass",
      required: true,
      expected: "Target directory is empty or already a Git repository.",
      observed: ".git directory exists.",
      explanation: "Studio can continue with Git safety checks."
    },
    {
      id: "jskit-doctor",
      label: "JSKIT doctor",
      status: "pass",
      required: true,
      expected: "Official JSKIT verification passes.",
      observed: "Verification passed.",
      explanation: "The target app passes the authoritative JSKIT readiness check."
    },
    {
      id: "git-checkpoint",
      label: "Git checkpoint",
      status: "pass",
      required: true,
      expected: "Working tree is clean after setup changes.",
      observed: "Clean",
      explanation: "Setup changes have been committed or there were no setup changes."
    },
    {
      id: "ready",
      label: "Ready",
      status: "pass",
      required: true,
      expected: "The target app is ready for Studio workflows.",
      observed: "All setup stages passed.",
      explanation: "Studio can now inspect and operate on this app."
    }
  ]
};

const currentAppPayload = {
  rootPath: "/workspace/example-target-app",
  isJskitApp: true,
  packageJson: {
    name: "example-target-app",
    scripts: [
      { name: "dev", command: "vite" }
    ]
  },
  jskitLock: {
    installedPackages: [
      {
        packageId: "@local/main",
        packagePath: "packages/main",
        sourceType: "local",
        version: "0.1.0"
      }
    ]
  },
  config: {
    tenancyMode: "none",
    surfaceDefaultId: "home",
    surfaces: [
      {
        id: "home",
        label: "Sessions",
        enabled: true,
        requiresAuth: false,
        requiresWorkspace: false,
        pagesRoot: "home"
      }
    ]
  },
  runtimeNeeds: {
    auth: false,
    database: false,
    users: false,
    workspaces: false
  },
  markers: [
    { id: "package-json", label: "package.json", exists: true },
    { id: "jskit-lock", label: ".jskit/lock.json", exists: true }
  ],
  git: {
    checked: true,
    isRepo: true,
    dirty: false,
    branch: "main",
    changedFiles: []
  }
};

const targetScriptsPayload = {
  ok: true,
  config: {
    exists: false,
    path: ".ai-studio/config/starred_scripts"
  },
  starredScriptIds: ["jskit:update", "build", "server", "verify"],
  scripts: [
    { id: "build", name: "build", label: "build", command: "vite build", source: "project", starred: true },
    { id: "dev", name: "dev", label: "dev", command: "vite", source: "project", starred: false },
    { id: "jskit:update", name: "jskit:update", label: "jskit:update", command: "jskit app update-packages", source: "project", starred: true },
    { id: "lint", name: "lint", label: "lint", command: "eslint .", source: "project", starred: false },
    { id: "preview", name: "preview", label: "preview", command: "vite preview", source: "project", starred: false },
    { id: "server", name: "server", label: "server", command: "node server.js", source: "project", starred: true },
    { id: "test", name: "test", label: "test", command: "node --test", source: "project", starred: false },
    { id: "verify", name: "verify", label: "verify", command: "jskit app verify", source: "project", starred: true }
  ]
};

const completedArchiveSession = {
  sessionId: "2026-05-12_03-10-00",
  status: "finished",
  branch: "issue-2-session-history",
  issueUrl: "https://github.com/merc/example-target-app/issues/2",
  prUrl: "https://github.com/merc/example-target-app/pull/12",
  completedSteps: ["issue_created", "plan_made", "plan_executed"],
  finalReportText: "Completed archive report."
};

const abandonedArchiveSession = {
  sessionId: "2026-05-12_03-11-00",
  status: "abandoned",
  branch: "issue-2-abandoned-session",
  issueUrl: "https://github.com/merc/example-target-app/issues/2",
  completedSteps: ["issue_created", "plan_made"]
};

const codexPromptText = "Create the GitHub issue for the requested Studio session UI.";
const codexPlanPromptText = "Create an implementation plan for the approved GitHub issue.";
const codexPromptSessionId = "2026-05-12_01-02-39";
const secondCodexPromptText = "Create another GitHub issue while the first terminal keeps running.";
const secondCodexPromptSessionId = "2026-05-12_01-03-40";
const thirdCodexPromptText = "Create a third GitHub issue while two terminals keep running.";
const thirdCodexPromptSessionId = "2026-05-12_01-04-41";
const nonCodexStepSessionId = "2026-05-12_01-05-42";
const sessionWorktreePath = (sessionId: string) =>
  `/workspace/example-target-app/.jskit/sessions/active/${sessionId}/worktree`;
const codexThreadProbe = "! echo $CODEX_THREAD_ID";
const codexThreadCommand = "echo $CODEX_THREAD_ID";
const codexThreadId = "019e1575-2458-7b93-bf9d-e7d7ffd49ad2";
const codexShellSubmitSequence = ["\u001b", "\u0015", "! ", codexThreadCommand, " ", "\u001b", "\r"];
function codexPromptSignature(session) {
  return [
    session?.sessionId || "",
    session?.currentStep || "",
    session?.prompt || ""
  ].join(":::");
}

const codexPromptStepDefinitions = [
  {
    id: "session_created",
    index: 0,
    label: "Session created",
    kind: "automatic",
    description: "Create the durable session directory."
  },
  {
    id: "worktree_created",
    index: 1,
    label: "Worktree created",
    kind: "automatic",
    description: "Prepare the isolated session worktree."
  },
  {
    id: "dependencies_installed",
    index: 2,
    label: "Dependencies installed",
    kind: "automatic",
    description: "Install dependencies in the session worktree."
  },
  {
    id: "issue_prompt_rendered",
    index: 3,
    label: "Initial issue prompt",
    kind: "human_input",
    description: "Capture the developer request."
  },
  {
    id: "issue_drafted",
    index: 4,
    label: "Issue drafted",
    kind: "codex_prompt",
    description: "Ask Codex to draft issue.md."
  },
  {
    id: "issue_created",
    index: 5,
    label: "Issue created",
    kind: "automatic",
    description: "Create the GitHub issue."
  },
  {
    id: "plan_made",
    index: 6,
    label: "Plan made",
    kind: "codex_prompt",
    description: "Ask Codex to create an implementation plan in the terminal."
  }
];
const codexPromptSessionPayload = {
  ok: true,
  sessionId: codexPromptSessionId,
  status: "waiting_for_user",
  currentStep: "issue_drafted",
  completedSteps: ["session_created", "worktree_created", "dependencies_installed", "issue_prompt_rendered"],
  stepDefinitions: codexPromptStepDefinitions,
  currentStepAction: {
    stepId: "issue_drafted",
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    buttonLabel: "Record issue draft",
    description: "Codex writes issue.md and issue_title; continue after review.",
    input: { type: "none" }
  },
  codex: {
    autoInject: true,
    mode: "inject_prompt",
    promptField: "prompt",
    promptActionLabel: "Start issue draft"
  },
  prompt: codexPromptText,
  receipts: [],
  issueTitle: "",
  issueText: "",
  errors: [],
  issueUrl: "",
  prUrl: "",
  transcriptLog: "",
  worktree: sessionWorktreePath(codexPromptSessionId),
  worktreeReady: true
};
const secondCodexPromptSessionPayload = {
  ...codexPromptSessionPayload,
  sessionId: secondCodexPromptSessionId,
  prompt: secondCodexPromptText,
  worktree: sessionWorktreePath(secondCodexPromptSessionId)
};
const thirdCodexPromptSessionPayload = {
  ...codexPromptSessionPayload,
  sessionId: thirdCodexPromptSessionId,
  prompt: thirdCodexPromptText,
  worktree: sessionWorktreePath(thirdCodexPromptSessionId)
};
const nonCodexStepSessionPayload = {
  ...codexPromptSessionPayload,
  sessionId: nonCodexStepSessionId,
  currentStep: "prompt",
  completedSteps: ["session-created", "worktree", "dependencies_installed"],
  currentStepAction: {
    stepId: "prompt",
    kind: "input",
    buttonLabel: "Save prompt",
    description: "Capture the developer request.",
    input: {
      type: "text",
      name: "prompt",
      label: "Request",
      multiline: true,
      required: true
    }
  },
  codex: null,
  prompt: "",
  worktree: sessionWorktreePath(nonCodexStepSessionId)
};
const codexIssueDraftedPayload = {
  ...codexPromptSessionPayload,
  completedSteps: [...codexPromptSessionPayload.completedSteps, "issue_drafted"],
  codex: null,
  currentStep: "issue_created",
  currentStepAction: {
    stepId: "issue_created",
    kind: "automatic",
    automation: { mode: "immediate" },
    buttonLabel: "Create issue",
    description: "Create the GitHub issue with gh.",
    input: {
      type: "none"
    },
    requiresExplicitRun: false
  },
  issueTitle: "Add session UI",
  issueText: "Make sessions clearer.",
  prompt: "",
  status: "running"
};
const codexIssueCreatedPayload = {
  ...codexIssueDraftedPayload,
  completedSteps: [...codexIssueDraftedPayload.completedSteps, "issue_created"],
  currentStep: "plan_made",
  currentStepAction: {
    stepId: "plan_made",
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    buttonLabel: "Record plan",
    description: "Codex writes the plan in the terminal; continue after review.",
    input: { type: "none" }
  },
  codex: {
    autoInject: true,
    mode: "inject_prompt",
    promptActionLabel: "Start plan",
    promptField: "prompt"
  },
  issueUrl: "https://github.com/merc/example-target-app/issues/123",
  status: "running"
};
const codexPlanPromptPayload = {
  ...codexIssueCreatedPayload,
  prompt: codexPlanPromptText,
  status: "waiting_for_user"
};
const deepUiSkipSessionId = "2026-05-12_02-06-43";
const deepUiPromptSessionId = "2026-05-12_02-06-44";
const deepUiSkipStepDefinitions = [
  {
    id: "deep_ui_check_run",
    index: 12,
    label: "Deep UI check run",
    kind: "codex_prompt",
    description: "Run or skip the focused UI quality pass before review."
  },
  {
    id: "review_prompt_rendered",
    index: 13,
    displayGroupId: "review_deslop",
    displayGroupLabel: "Review/deslop",
    label: "Review/deslop",
    kind: "codex_prompt",
    description: "Start the review pass."
  },
  {
    id: "automated_checks_run",
    index: 14,
    label: "Automated checks",
    kind: "codex_prompt",
    description: "Run checks after review/deslop."
  }
];
const deepUiSkipSessionPayload = {
  ok: true,
  sessionId: deepUiSkipSessionId,
  status: "running",
  currentStep: "deep_ui_check_run",
  completedSteps: [],
  stepDefinitions: deepUiSkipStepDefinitions,
  currentStepAction: {
    buttonLabel: "Run Deep UI check",
    conditional: true,
    description: "Run or skip the focused UI quality pass before review.",
    input: {
      type: "none"
    },
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    label: "Run Deep UI check",
    requiresExplicitRun: false,
    skipReason: "User skipped Deep UI check.",
    stepId: "deep_ui_check_run"
  },
  codex: null,
  prompt: "",
  receipts: [],
  issueTitle: "Add health endpoint",
  issueText: "Add a server-only health endpoint.",
  issueUrl: "https://github.com/merc/example-target-app/issues/124",
  errors: [],
  prUrl: "",
  transcriptLog: "",
  uiChecks: [],
  worktree: sessionWorktreePath(deepUiSkipSessionId),
  worktreeReady: true
};
const deepUiSkippedSessionPayload = {
  ...deepUiSkipSessionPayload,
  currentStep: "review_prompt_rendered",
  completedSteps: [
    ...deepUiSkipSessionPayload.completedSteps,
    "deep_ui_check_run"
  ],
  currentStepAction: {
    buttonLabel: "Run deslop",
    description: "Start the review pass.",
    input: {
      type: "none"
    },
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    label: "Run deslop",
    requiresExplicitRun: false,
    stepId: "review_prompt_rendered"
  },
  uiChecks: [
    {
      ok: true,
      phase: "pre_review",
      reason: "User skipped Deep UI check.",
      status: "skipped",
      stepId: "deep_ui_check_run"
    }
  ]
};
const deepUiPromptedSessionPayload = {
  ...deepUiSkipSessionPayload,
  sessionId: deepUiPromptSessionId,
  codex: {
    autoInject: true,
    mode: "inject_prompt",
    promptActionLabel: "Run Deep UI check",
    promptField: "prompt"
  },
  completedSteps: [
    "session_created",
    "worktree_created",
    "dependencies_installed",
    "issue_prompt_rendered",
    "issue_drafted",
    "issue_created",
    "plan_made",
    "plan_executed"
  ],
  currentStepAction: {
    ...deepUiSkipSessionPayload.currentStepAction,
    buttonLabel: "Go to next step",
    skipReason: ""
  },
  prompt: "Deep UI quality check prompt for this session.",
  worktree: sessionWorktreePath(deepUiPromptSessionId)
};
const planExecutionRejectSessionId = "2026-05-12_02-06-46";
const planExecutionRejectStepDefinitions = [
  {
    id: "plan_made",
    index: 6,
    label: "Plan made",
    kind: "codex_prompt",
    description: "Codex writes an implementation plan in the terminal."
  },
  {
    id: "plan_executed",
    index: 7,
    label: "Plan executed",
    kind: "codex_prompt",
    description: "Codex has the execution prompt. Studio advances when Codex finishes."
  },
  {
    id: "deep_ui_check_run",
    index: 10,
    label: "Deep UI check run",
    kind: "codex_prompt",
    description: "Run or skip the focused UI quality pass before review."
  }
];
const planExecutionRejectPayload = {
  ok: true,
  sessionId: planExecutionRejectSessionId,
  status: "running",
  currentStep: "plan_executed",
  completedSteps: [
    "session_created",
    "worktree_created",
    "dependencies_installed",
    "issue_prompt_rendered",
    "issue_drafted",
    "issue_created",
    "plan_made"
  ],
  stepDefinitions: planExecutionRejectStepDefinitions,
  currentStepAction: {
    buttonLabel: "Go to next step",
    description: "Codex has the execution prompt. Review the result, then use Go to next step when ready.",
    input: { type: "none" },
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    label: "Go to next step",
    requiresExplicitRun: false,
    stepId: "plan_executed"
  },
  codex: {
    autoInject: true,
    mode: "inject_prompt",
    promptActionLabel: "Get Codex to execute plan",
    promptField: "prompt"
  },
  prompt: [
    "Execute the approved implementation plan.",
  ].join("\n"),
  errors: [],
  issueTitle: "Add victory file",
  issueText: "Add a victory file.",
  issueUrl: "https://github.com/merc/example-target-app/issues/127",
  prUrl: "",
  transcriptLog: "",
  worktree: sessionWorktreePath(planExecutionRejectSessionId),
  worktreeReady: true
};
const reviewDeslopSessionId = "2026-05-12_02-06-45";
const reviewDeslopStepDefinitions = [
  {
    id: "review_prompt_rendered",
    index: 13,
    displayGroupId: "review_deslop",
    displayGroupLabel: "Review/deslop",
    label: "Review/deslop",
    kind: "codex_prompt",
    description: "Run the review/deslop pass."
  },
  {
    id: "review_changes_accepted",
    index: 14,
    displayGroupId: "review_deslop",
    displayGroupLabel: "Review/deslop",
    label: "Review/deslop",
    kind: "user_check",
    description: "Accept a review/deslop pass or request another one.",
    submitOptions: {
      reviewFindingsRemaining: false
    }
  },
  {
    id: "automated_checks_run",
    index: 15,
    label: "Automated checks",
    kind: "codex_prompt",
    description: "Run checks after review/deslop."
  }
];
const reviewDeslopAcceptedPayload = {
  ok: true,
  sessionId: reviewDeslopSessionId,
  status: "running",
  currentStep: "review_changes_accepted",
  completedSteps: ["review_prompt_rendered"],
  stepDefinitions: reviewDeslopStepDefinitions,
  currentStepAction: {
    buttonLabel: "I am done",
    description: "Accept a review/deslop pass or request another one.",
    input: { type: "none" },
    kind: "user_check",
    label: "I am done",
    requiresExplicitRun: false,
    submitOptions: {
      reviewFindingsRemaining: false
    },
    stepId: "review_changes_accepted",
    utilityActions: [
      {
        id: "session_diff",
        kind: "diff",
        label: "Review changes"
      }
    ]
  },
  codex: null,
  prompt: "",
  reviewPasses: [
    {
      commit: "",
      maxPasses: 0,
      pass: "001",
      status: "accepted"
    }
  ],
  issueTitle: "Clean up UI",
  issueText: "Run a review/deslop pass.",
  issueUrl: "https://github.com/merc/example-target-app/issues/126",
  errors: [],
  prUrl: "",
  transcriptLog: "",
  worktree: sessionWorktreePath(reviewDeslopSessionId),
  worktreeReady: true
};
const reviewDeslopNextPromptPayload = {
  ...reviewDeslopAcceptedPayload,
  currentStep: "review_prompt_rendered",
  completedSteps: ["review_prompt_rendered", "review_changes_accepted"],
  currentStepAction: {
    buttonLabel: "Run deslop",
    description: "Run the review/deslop pass.",
    input: { type: "none" },
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    label: "Run deslop",
    requiresExplicitRun: false,
    stepId: "review_prompt_rendered"
  },
  reviewPasses: [
    ...reviewDeslopAcceptedPayload.reviewPasses,
    {
      maxPasses: 0,
      pass: "002",
      status: "pending"
    }
  ]
};
const reviewDeslopUnexpectedAdvancedPayload = {
  ...reviewDeslopNextPromptPayload,
  currentStep: "automated_checks_run",
  currentStepAction: {
    buttonLabel: "Run automated checks",
    input: { type: "none" },
    kind: "codex_prompt",
    automation: { mode: "codex_prompt" },
    label: "Run automated checks",
    stepId: "automated_checks_run"
  }
};

export {
  BASE_URL,
  viewports,
  blockedBootstrapPayload,
  readyBootstrapPayload,
  blockedTargetAppPayload,
  readyTargetAppPayload,
  blockedAppSetupPayload,
  readyAppSetupPayload,
  currentAppPayload,
  targetScriptsPayload,
  completedArchiveSession,
  abandonedArchiveSession,
  codexPromptText,
  codexPlanPromptText,
  codexPromptSessionId,
  secondCodexPromptText,
  secondCodexPromptSessionId,
  thirdCodexPromptText,
  thirdCodexPromptSessionId,
  nonCodexStepSessionId,
  sessionWorktreePath,
  codexThreadProbe,
  codexThreadCommand,
  codexThreadId,
  codexShellSubmitSequence,
  codexPromptSignature,
  codexPromptStepDefinitions,
  codexPromptSessionPayload,
  secondCodexPromptSessionPayload,
  thirdCodexPromptSessionPayload,
  nonCodexStepSessionPayload,
  codexIssueDraftedPayload,
  codexIssueCreatedPayload,
  codexPlanPromptPayload,
  deepUiSkipSessionId,
  deepUiPromptSessionId,
  deepUiSkipStepDefinitions,
  deepUiSkipSessionPayload,
  deepUiSkippedSessionPayload,
  deepUiPromptedSessionPayload,
  planExecutionRejectSessionId,
  planExecutionRejectStepDefinitions,
  planExecutionRejectPayload,
  reviewDeslopSessionId,
  reviewDeslopStepDefinitions,
  reviewDeslopAcceptedPayload,
  reviewDeslopNextPromptPayload,
  reviewDeslopUnexpectedAdvancedPayload
};
