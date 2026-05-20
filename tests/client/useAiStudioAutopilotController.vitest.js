import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ISSUE_STEP_ID,
  useAiStudioAutopilotController
} from "../../src/composables/useAiStudioAutopilotController.js";

const STEP_LABELS = Object.freeze({
  dependencies_installed: "Install dependencies",
  issue_file_created: "Define or select issue",
  session_created: "Create session",
  work_source_selected: "Choose work source",
  worktree_created: "Create worktree"
});

describe("useAiStudioAutopilotController", () => {
  let context;

  beforeEach(() => {
    context = createAutopilotContext();
  });

  it("runs setup actions and stops at the issue definition step", async () => {
    await context.controller.start();

    expect(context.session.value.currentStep).toBe(ISSUE_STEP_ID);
    expect(context.actions.runAction).toHaveBeenCalledWith(expect.objectContaining({
      id: "use_new_branch"
    }));
    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "create_worktree",
      "install_dependencies"
    ]);
    expect(context.controller.readyForIssue.value).toBe(true);
    expect(context.controller.failure.value).toBeNull();
  });

  it("stores command failure details and retries from the same workflow step", async () => {
    context.commandResults.create_worktree = {
      error: "Create worktree failed with exit code 1.",
      exitCode: 1,
      ok: false,
      output: "fatal: branch exists"
    };

    await context.controller.start();

    expect(context.session.value.currentStep).toBe("worktree_created");
    expect(context.controller.failure.value).toMatchObject({
      actionId: "create_worktree",
      error: "Create worktree failed with exit code 1.",
      output: "fatal: branch exists"
    });

    context.commandResults.create_worktree = {
      exitCode: 0,
      ok: true,
      output: "created"
    };

    await context.controller.retry();

    expect(context.session.value.currentStep).toBe(ISSUE_STEP_ID);
    expect(context.commandRunner.runCommandAction.mock.calls.map(([input]) => input.action.id)).toEqual([
      "create_worktree",
      "create_worktree",
      "install_dependencies"
    ]);
    expect(context.controller.failure.value).toBeNull();
  });
});

function createAutopilotContext() {
  const session = ref(sessionForStep("session_created"));
  const commandResults = {
    create_worktree: {
      exitCode: 0,
      ok: true,
      output: "created"
    },
    install_dependencies: {
      exitCode: 0,
      ok: true,
      output: "installed"
    }
  };
  const actions = {
    currentActions: computed(() => session.value.actions),
    currentNext: computed(() => session.value.next),
    goNext: vi.fn(async () => {
      session.value = sessionForStep(session.value.next.stepId);
    }),
    runAction: vi.fn(async (action) => {
      if (action.id === "use_new_branch") {
        session.value = {
          ...session.value,
          metadata: {
            work_source: "new_branch"
          },
          next: {
            ...session.value.next,
            enabled: true
          }
        };
      }
    })
  };
  const commandRunner = {
    running: ref(false),
    runCommandAction: vi.fn(async ({ action }) => {
      const result = commandResults[action.id];
      if (result?.ok === true) {
        session.value = {
          ...session.value,
          next: {
            ...session.value.next,
            enabled: true
          }
        };
      }
      return {
        actionId: action.id,
        actionLabel: action.label,
        error: result?.error || "",
        exitCode: result?.exitCode ?? null,
        ok: result?.ok === true,
        output: result?.output || ""
      };
    })
  };
  const controller = useAiStudioAutopilotController({
    actions,
    commandRunner,
    refreshSessionData: async () => null,
    session
  });

  return {
    actions,
    commandResults,
    commandRunner,
    controller,
    session
  };
}

function sessionForStep(stepId) {
  return {
    actions: actionsForStep(stepId),
    currentStep: stepId,
    currentStepDefinition: {
      label: STEP_LABELS[stepId]
    },
    next: nextForStep(stepId),
    sessionId: "session-1",
    stepDefinitions: Object.entries(STEP_LABELS).map(([id, label]) => ({
      id,
      label
    }))
  };
}

function actionsForStep(stepId) {
  if (stepId === "work_source_selected") {
    return [
      {
        enabled: true,
        id: "use_new_branch",
        label: "Use new branch",
        type: "adapter"
      }
    ];
  }
  if (stepId === "worktree_created") {
    return [
      {
        enabled: true,
        id: "create_worktree",
        label: "Create worktree",
        type: "command"
      }
    ];
  }
  if (stepId === "dependencies_installed") {
    return [
      {
        enabled: true,
        id: "install_dependencies",
        label: "Install dependencies",
        type: "command"
      }
    ];
  }
  return [];
}

function nextForStep(stepId) {
  if (stepId === ISSUE_STEP_ID) {
    return {
      enabled: false,
      visible: false
    };
  }
  return {
    enabled: stepId === "session_created",
    label: "Next",
    stepId: nextStepId(stepId),
    visible: true
  };
}

function nextStepId(stepId) {
  if (stepId === "session_created") {
    return "work_source_selected";
  }
  if (stepId === "work_source_selected") {
    return "worktree_created";
  }
  if (stepId === "worktree_created") {
    return "dependencies_installed";
  }
  if (stepId === "dependencies_installed") {
    return ISSUE_STEP_ID;
  }
  return "";
}
