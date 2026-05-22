import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import {
  useAiStudioAutopilotController
} from "../../src/composables/useAiStudioAutopilotController.js";
import {
  useAiStudioCodexQuestionExchange
} from "../../src/composables/useAiStudioCodexQuestionExchange.js";

const STEP_LABELS = Object.freeze({
  agent_conversation: "Make changes",
  changes_accepted: "Final review",
  changes_committed: "Commit and push changes",
  deep_ui_check_run: "Run deep UI check",
  dependencies_installed: "Install dependencies",
  implementation_reviewed: "Human review",
  issue_file_created: "Define or select issue",
  issue_submitted: "Edit and submit issue",
  main_checkout_synced: "Sync main checkout",
  plan_executed: "Execute plan",
  plan_made: "Make plan",
  pr_created: "Edit and create PR",
  pr_file_created: "Create PR file",
  pr_merged: "Merge PR",
  project_knowledge_updated: "Update project knowledge",
  project_validated: "Validate project",
  report_created: "Write report",
  review_run: "Run review/deslop",
  session_created: "Create session",
  session_finished: "Congratulations!",
  work_source_selected: "Choose work source",
  worktree_created: "Create worktree"
});

const NEXT_STEP = Object.freeze({
  agent_conversation: "deep_ui_check_run",
  changes_accepted: "report_created",
  changes_committed: "pr_file_created",
  deep_ui_check_run: "review_run",
  dependencies_installed: "issue_file_created",
  implementation_reviewed: "deep_ui_check_run",
  issue_file_created: "issue_submitted",
  issue_submitted: "plan_made",
  main_checkout_synced: "session_finished",
  plan_executed: "implementation_reviewed",
  plan_made: "plan_executed",
  pr_created: "pr_merged",
  pr_file_created: "pr_created",
  pr_merged: "main_checkout_synced",
  project_knowledge_updated: "changes_committed",
  project_validated: "changes_accepted",
  report_created: "project_knowledge_updated",
  review_run: "project_validated",
  session_created: "work_source_selected",
  work_source_selected: "worktree_created",
  worktree_created: "dependencies_installed"
});

const STEP_AUTOPILOT = Object.freeze({
  agent_conversation: {
    actionId: "agent_conversation",
    kind: "agent_conversation",
    responseArtifact: "response.md",
    stop: true
  },
  changes_accepted: {
    actionId: "final_review_conversation",
    kind: "final_review",
    responseArtifact: "response.md",
    stop: true
  },
  changes_committed: {
    actionId: "commit_changes",
    completeWhen: ["metadata:accepted_commit", "metadata:branch_pushed"],
    label: "Commit and push changes"
  },
  deep_ui_check_run: {
    actionId: "run_deep_ui_check",
    label: "Run deep UI check",
    userDecision: true
  },
  dependencies_installed: {
    actionId: "install_dependencies",
    completeWhen: ["metadata:dependencies_installed"],
    label: "Install dependencies"
  },
  implementation_reviewed: {
    actionId: "human_review_conversation",
    kind: "implementation_review",
    responseArtifact: "response.md",
    stop: true
  },
  issue_file_created: {
    kind: "issue_discussion",
    stop: true
  },
  issue_submitted: {
    actionId: "create_issue_on_gh",
    completeWhen: ["metadata:issue_url"],
    label: "Edit and submit issue"
  },
  main_checkout_synced: {
    actionId: "sync_main_checkout",
    completeWhen: ["metadata:main_checkout_synced"],
    label: "Sync main checkout"
  },
  plan_executed: {
    actionId: "execute_plan",
    label: "Execute plan"
  },
  plan_made: {
    actionId: "make_plan",
    label: "Make plan"
  },
  pr_created: {
    actionId: "create_pr_on_gh",
    completeWhen: ["metadata:pr_url"],
    label: "Create PR on GH"
  },
  pr_file_created: {
    actionId: "create_pr_file",
    completeWhen: ["any:metadata:pr_url;artifact:pull_request.md"],
    label: "Create PR file"
  },
  pr_merged: {
    kind: "merge_review",
    stop: true
  },
  project_knowledge_updated: {
    actionId: "update_project_knowledge",
    label: "Update project knowledge"
  },
  project_validated: {
    actionSequence: [
      {
        actionId: "update_code_index",
        completeWhen: ["metadata:code_index_updated"],
        label: "Update code index"
      },
      {
        actionId: "run_automated_checks",
        completeWhen: ["metadata:automated_checks_passed"],
        label: "Run automated checks"
      }
    ],
    label: "Validate project"
  },
  report_created: {
    actionId: "write_report",
    completeWhen: ["artifact:report.md"],
    label: "Write report"
  },
  review_run: {
    actionId: "run_deslop",
    label: "Run deslop"
  },
  session_finished: {
    kind: "finished",
    stop: true
  },
  work_source_selected: {
    actionId: "use_new_branch",
    advanceOnSuccess: true,
    completeWhen: ["metadata:work_source"],
    label: "Choose work source"
  },
  worktree_created: {
    actionId: "create_worktree",
    completeWhen: ["metadata:worktree_path"],
    label: "Create worktree"
  }
});

const COMMAND_METADATA = Object.freeze({
  commit_changes: {
    accepted_commit: "abc123",
    branch_pushed: "origin/ai-studio/test-session"
  },
  create_issue_on_gh: {
    issue_url: "https://github.com/example/project/issues/123"
  },
  create_pr_on_gh: {
    pr_number: "123",
    pr_url: "https://github.com/example/project/pull/123"
  },
  create_worktree: {
    worktree_path: "/tmp/ai-studio-worktree"
  },
  install_dependencies: {
    dependencies_installed: "1"
  },
  merge_pr: {
    pr_merged: "1"
  },
  run_automated_checks: {
    automated_checks_passed: "1"
  },
  sync_main_checkout: {
    main_checkout_synced: "1"
  },
  update_code_index: {
    code_index_updated: "1"
  },
  use_new_branch: {
    work_source: "new_branch"
  }
});

const PROMPT_ACTION_IDS = new Set([
  "agent_conversation",
  "create_pr_file",
  "execute_plan",
  "final_review_conversation",
  "human_review_conversation",
  "make_plan",
  "prepare_for_merge",
  "run_deep_ui_check",
  "run_deslop",
  "update_project_knowledge",
  "write_report"
]);

describe("useAiStudioAutopilotController", () => {
  it("runs setup automation and stops at issue definition", async () => {
    const context = createControllerContext({
      stepId: "session_created"
    });

    await context.controller.start();

    expect(context.session.value.currentStep).toBe("issue_file_created");
    expect(context.commandRunner.runCommandAction).toHaveBeenCalledTimes(2);
    expect(context.actions.runAction).toHaveBeenCalledWith(expect.objectContaining({
      id: "use_new_branch"
    }));
  });

  it("continues the big-feature workflow to the implementation review stop", async () => {
    const context = createControllerContext({
      metadata: {
        issue_title: "Issue",
        issue_url: "https://github.com/example/project/issues/1"
      },
      stepId: "plan_made"
    });

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("implementation_reviewed");
    expect(context.promptActions()).toEqual([
      "make_plan",
      "execute_plan"
    ]);
  });

  it("continues from existing done conversation files without resending the prompt", async () => {
    const context = createControllerContext({
      stepId: "plan_executed"
    });
    context.writeConversationDone("Execute plan complete.");

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("implementation_reviewed");
    expect(context.actions.runAction).not.toHaveBeenCalled();
  });

  it("pauses for Codex questions and resumes after plain-text answers", async () => {
    const context = createControllerContext({
      stepId: "plan_executed"
    });
    context.promptBehavior.execute_plan = () => {
      context.writeConversationQuestions([
        "Which database should Codex use?"
      ]);
    };

    await context.controller.resume();

    expect(context.controller.screenState.value.kind).toBe("questions");
    context.questionExchange.setAnswer("q1", "Use the managed MariaDB service.");
    await context.questionExchange.submitAnswers();

    expect(context.codexTerminal.injectPrompt).toHaveBeenCalledWith(
      expect.stringContaining("Use the managed MariaDB service."),
      expect.any(Object)
    );
    expect(context.session.value.currentStep).toBe("implementation_reviewed");
  });

  it("keeps interactive agent conversation on the same step until the user continues", async () => {
    const context = createControllerContext({
      metadata: {
        dependencies_installed: "1",
        work_source: "new_branch",
        worktree_path: "/tmp/worktree"
      },
      stepId: "agent_conversation",
      workflowSteps: [
        "session_created",
        "work_source_selected",
        "worktree_created",
        "dependencies_installed",
        "agent_conversation",
        "deep_ui_check_run",
        "review_run"
      ]
    });

    await context.controller.submitAgentConversationRequest("Add a small readme note.");

    expect(context.session.value.currentStep).toBe("agent_conversation");
    expect(context.controller.conversationResponse.value).toContain("agent_conversation complete");

    await context.controller.finishAgentConversation();

    expect(context.session.value.currentStep).toBe("deep_ui_check_run");
  });

  it("does nothing while Autopilot is disabled", async () => {
    const context = createControllerContext({
      enabled: false,
      stepId: "session_created"
    });

    await context.controller.start();

    expect(context.session.value.currentStep).toBe("session_created");
    expect(context.actions.runAction).not.toHaveBeenCalled();
    expect(context.commandRunner.runCommandAction).not.toHaveBeenCalled();
  });

  it("stops on command failure and retries from the same step", async () => {
    const context = createControllerContext({
      metadata: {
        code_index_updated: "1"
      },
      stepId: "project_validated"
    });
    context.commandFailures.add("run_automated_checks");

    await context.controller.resume();

    expect(context.session.value.currentStep).toBe("project_validated");
    expect(context.controller.screenState.value.kind).toBe("command");
    expect(context.controller.commandResult.value.ok).toBe(false);

    context.commandFailures.clear();
    await context.controller.retry();

    expect(context.session.value.currentStep).toBe("changes_accepted");
  });
});

function createControllerContext({
  enabled = true,
  metadata = {},
  stepId = "session_created",
  workflowSteps = Object.keys(STEP_LABELS)
} = {}) {
  const commandFailures = new Set();
  const enabledRef = ref(enabled);
  const session = ref(null);
  const autopilotArtifacts = ref(emptyConversationFiles());
  const codexBusy = ref(false);
  const codexWorking = ref(false);
  const commandRunning = ref(false);
  const commandOutput = ref("");
  const commandPreview = ref("");
  const commandResult = ref(null);
  const runActionCalls = [];
  const promptBehavior = {};

  function syncSession(nextStepId = session.value?.currentStep || stepId) {
    const currentStepDefinition = stepDefinition(nextStepId, workflowSteps);
    session.value = {
      actions: actionsForStep(nextStepId),
      artifactReadiness: artifactReadinessForMetadata(metadata),
      artifactsRoot: "/tmp/session/artifacts",
      completedSteps: workflowSteps.slice(0, Math.max(0, workflowSteps.indexOf(nextStepId))),
      currentStep: nextStepId,
      currentStepDefinition,
      metadata: {
        ...metadata
      },
      next: nextForStep(nextStepId, metadata, workflowSteps),
      sessionId: "session-1",
      stepDefinitions: workflowSteps.map((id) => stepDefinition(id, workflowSteps))
    };
  }

  function setMetadata(values = {}) {
    Object.assign(metadata, values);
    syncSession();
  }

  function writeConversation(inputFormat, response = "") {
    autopilotArtifacts.value = {
      conversation: {
        history: response && inputFormat
          ? [
            {
              inputFormat,
              response: String(response || "").trim()
            }
          ]
          : [],
        inputFormat,
        response
      },
      inputFormat,
      ok: true,
      response,
      sessionId: "session-1"
    };
  }

  function clearConversation() {
    autopilotArtifacts.value = emptyConversationFiles();
  }

  function writeConversationDone(response = "Done.") {
    writeConversation({
      inputKind: "none",
      issueDraft: null,
      message: "Done.",
      questions: [],
      status: "done"
    }, response);
  }

  function writeConversationQuestions(questions = []) {
    writeConversation({
      inputKind: "questions",
      issueDraft: null,
      message: "Codex needs answers.",
      questions: questions.map((text, index) => ({
        answer: "",
        id: `q${index + 1}`,
        text
      })),
      status: "awaiting_input"
    }, "Codex needs answers.");
  }

  const actions = {
    currentActions: computed(() => session.value?.actions || []),
    currentNext: computed(() => session.value?.next || null),
    goNext: vi.fn(async () => {
      const nextStepId = session.value?.next?.stepId;
      if (!nextStepId || session.value?.next?.enabled !== true) {
        throw new Error("Next step is not ready.");
      }
      clearConversation();
      syncSession(nextStepId);
    }),
    rewindToStep: vi.fn(async (step = {}) => {
      clearConversation();
      syncSession(step.rewindStepId || step.id);
    }),
    runAction: vi.fn(async (action = {}, { input = {} } = {}) => {
      runActionCalls.push({
        actionId: action.id,
        input
      });
      if (action.id === "use_new_branch") {
        setMetadata(COMMAND_METADATA.use_new_branch);
        if (action.advanceOnSuccess === true) {
          await actions.goNext();
        }
        return;
      }
      if (PROMPT_ACTION_IDS.has(action.id)) {
        const behavior = promptBehavior[action.id];
        if (typeof behavior === "function") {
          behavior(action, input);
        } else {
          setMetadata(promptSideEffects(action.id));
          writeConversationDone(`${action.id} complete.`);
        }
      }
    })
  };

  const commandRunner = {
    commandPreview,
    lastResult: commandResult,
    output: commandOutput,
    running: commandRunning,
    status: ref(""),
    runCommandAction: vi.fn(async ({ action = {} } = {}) => {
      commandRunning.value = true;
      commandPreview.value = action.label || action.id;
      commandOutput.value = `${action.id} output`;
      commandRunning.value = false;
      if (commandFailures.has(action.id)) {
        commandResult.value = {
          actionId: action.id,
          actionLabel: action.label,
          error: `${action.label} failed.`,
          exitCode: 1,
          ok: false,
          output: commandOutput.value
        };
        return commandResult.value;
      }
      setMetadata(COMMAND_METADATA[action.id] || {});
      commandResult.value = {
        actionId: action.id,
        actionLabel: action.label,
        exitCode: 0,
        ok: true,
        output: commandOutput.value
      };
      return commandResult.value;
    }),
    stopCommandAction: vi.fn()
  };

  const codexTerminal = {
    busy: codexBusy,
    injectPrompt: vi.fn(async () => {
      codexBusy.value = true;
      writeConversationDone("Answers accepted.");
      codexBusy.value = false;
      return true;
    }),
    promptInjectionError: ref(""),
    working: codexWorking
  };
  const questionExchange = useAiStudioCodexQuestionExchange({
    codexTerminal
  });
  const controller = useAiStudioAutopilotController({
    actions,
    autopilotArtifacts,
    clearAutopilotArtifacts: async () => clearConversation(),
    codexTerminal,
    commandRunner,
    enabled: enabledRef,
    questionExchange,
    refreshSessionData: async () => {
      syncSession();
    },
    session
  });

  syncSession(stepId);

  return {
    actions,
    autopilotArtifacts,
    codexTerminal,
    commandFailures,
    commandRunner,
    controller,
    enabledRef,
    promptActions: () => runActionCalls
      .filter((call) => PROMPT_ACTION_IDS.has(call.actionId))
      .map((call) => call.actionId),
    promptBehavior,
    questionExchange,
    session,
    writeConversationDone,
    writeConversationQuestions
  };
}

function emptyConversationFiles() {
  return {
    conversation: {
      history: [],
      inputFormat: null,
      response: ""
    },
    inputFormat: null,
    ok: true,
    response: "",
    sessionId: "session-1"
  };
}

function stepDefinition(stepId = "", workflowSteps = []) {
  return {
    actions: actionsForStep(stepId),
    autopilot: STEP_AUTOPILOT[stepId] || {},
    id: stepId,
    label: STEP_LABELS[stepId] || stepId,
    next: {
      stepId: NEXT_STEP[stepId] || ""
    },
    status: workflowSteps.includes(stepId) ? "pending" : ""
  };
}

function actionsForStep(stepId = "") {
  const autopilot = STEP_AUTOPILOT[stepId] || {};
  const actions = [];
  if (autopilot.actionId) {
    actions.push(actionForId(autopilot.actionId, autopilot.label || STEP_LABELS[stepId]));
  }
  if (Array.isArray(autopilot.actionSequence)) {
    for (const actionStage of autopilot.actionSequence) {
      actions.push(actionForId(actionStage.actionId, actionStage.label));
    }
  }
  if (stepId === "pr_merged") {
    actions.push(actionForId("prepare_for_merge", "Prepare for merge"));
    actions.push(actionForId("merge_pr", "Merge"));
    actions.push({
      enabled: true,
      id: "skip_merge",
      label: "Do not merge",
      type: "record"
    });
  }
  if (stepId === "session_finished") {
    actions.push({
      enabled: true,
      id: "finish_session",
      label: "Archive",
      type: "finish"
    });
  }
  return actions;
}

function actionForId(actionId = "", label = "") {
  const promptAction = PROMPT_ACTION_IDS.has(actionId);
  return {
    enabled: true,
    id: actionId,
    label: label || actionId,
    promptId: promptAction ? actionId : "",
    type: promptAction ? "prompt" : actionId === "use_new_branch" ? "adapter" : "command"
  };
}

function nextForStep(stepId = "", metadata = {}, workflowSteps = []) {
  const nextStepId = NEXT_STEP[stepId] || "";
  if (!nextStepId || !workflowSteps.includes(nextStepId)) {
    return {
      enabled: false,
      stepId: "",
      visible: false
    };
  }
  return {
    enabled: stepIsComplete(stepId, metadata),
    stepId: nextStepId,
    visible: true
  };
}

function stepIsComplete(stepId = "", metadata = {}) {
  const autopilot = STEP_AUTOPILOT[stepId] || {};
  if (Array.isArray(autopilot.actionSequence)) {
    return autopilot.actionSequence.every((stage) => conditionsAreMet(stage.completeWhen, metadata));
  }
  if (Array.isArray(autopilot.completeWhen)) {
    return conditionsAreMet(autopilot.completeWhen, metadata);
  }
  if (stepId === "issue_file_created") {
    return Boolean(metadata.issue_title);
  }
  return true;
}

function conditionsAreMet(conditions = [], metadata = {}) {
  return (Array.isArray(conditions) ? conditions : []).every((condition) => {
    if (condition.startsWith("metadata:")) {
      return Boolean(metadata[condition.slice("metadata:".length)]);
    }
    if (condition === "artifact:report.md") {
      return Boolean(metadata.report_ready);
    }
    if (condition === "artifact:pull_request.md") {
      return Boolean(metadata.pull_request_ready);
    }
    if (condition.startsWith("any:")) {
      return condition
        .slice("any:".length)
        .split(";")
        .some((candidate) => conditionsAreMet([candidate], metadata));
    }
    return false;
  });
}

function artifactReadinessForMetadata(metadata = {}) {
  return {
    "pull_request.md": {
      nonEmpty: Boolean(metadata.pull_request_ready)
    },
    "report.md": {
      nonEmpty: Boolean(metadata.report_ready)
    },
    "response.md": {
      nonEmpty: Boolean(metadata.response_ready)
    }
  };
}

function promptSideEffects(actionId = "") {
  if (actionId === "write_report") {
    return {
      report_ready: "1"
    };
  }
  if (actionId === "create_pr_file") {
    return {
      pull_request_ready: "1"
    };
  }
  return {};
}
