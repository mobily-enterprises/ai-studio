import { computed, nextTick, ref } from "vue";
import {
  useAiStudioHeadlessCommandRunner
} from "@/composables/useAiStudioHeadlessCommandRunner.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const ISSUE_STEP_ID = "issue_file_created";
const MAX_AUTOPILOT_OPERATIONS = 12;

const AUTOPILOT_STEP_ACTIONS = Object.freeze({
  dependencies_installed: {
    actionId: "install_dependencies",
    label: "Install dependencies"
  },
  work_source_selected: {
    actionId: "use_new_branch",
    label: "Choose work source"
  },
  worktree_created: {
    actionId: "create_worktree",
    label: "Create worktree"
  }
});

function readSession(session) {
  return readRefOrGetterValue(session) || null;
}

function readActions(actions = {}) {
  const currentActions = readRefOrGetterValue(actions.currentActions);
  return Array.isArray(currentActions) ? currentActions : [];
}

function readNext(actions = {}) {
  return readRefOrGetterValue(actions.currentNext) || null;
}

function actionById(actions = [], actionId = "") {
  return actions.find((action) => action.id === actionId) || null;
}

function stepLabel(session = {}) {
  return String(session?.currentStepDefinition?.label || session?.currentStep || "Current step");
}

function sessionStepLabel(session = {}, stepId = "") {
  return (Array.isArray(session.stepDefinitions) ? session.stepDefinitions : [])
    .find((step) => step.id === stepId)?.label || "";
}

function nextIsReady(next = {}) {
  return next?.visible === true && next.enabled === true;
}

function disabledActionFailure(action = {}, stage = {}) {
  return {
    actionId: String(action.id || stage.actionId || ""),
    actionLabel: String(action.label || stage.label || "Action"),
    error: String(action.disabledReason || `${action.label || stage.label || "Action"} is disabled.`),
    exitCode: null,
    ok: false,
    output: ""
  };
}

function missingActionFailure(stage = {}) {
  return {
    actionId: stage.actionId,
    actionLabel: stage.label,
    error: `${stage.label} is not available on this session step.`,
    exitCode: null,
    ok: false,
    output: ""
  };
}

function blockedStepFailure(session = {}) {
  return {
    actionId: "",
    actionLabel: stepLabel(session),
    error: `Autopilot cannot continue from ${stepLabel(session)}.`,
    exitCode: null,
    ok: false,
    output: ""
  };
}

function useAiStudioAutopilotController({
  actions = {},
  commandRunner = useAiStudioHeadlessCommandRunner(),
  refreshSessionData = async () => null,
  session
} = {}) {
  const active = ref(false);
  const activeStage = ref("");
  const failure = ref(null);

  let autopilotPromise = null;

  const currentStep = computed(() => readSession(session)?.currentStep || "");
  const readyForIssue = computed(() => currentStep.value === ISSUE_STEP_ID);
  const running = computed(() => active.value || commandRunner.running.value);
  const canStart = computed(() => Boolean(readSession(session)?.sessionId && !running.value));
  const statusText = computed(() => {
    if (failure.value) {
      return failure.value.error || "Autopilot stopped.";
    }
    if (running.value) {
      return `Executing: ${activeStage.value || stepLabel(readSession(session))}`;
    }
    if (readyForIssue.value) {
      return "What would you like to do?";
    }
    return "Let's get started";
  });

  async function start() {
    if (!canStart.value) {
      return;
    }
    failure.value = null;
    await runUntilIssueStep();
  }

  async function retry() {
    if (running.value) {
      return;
    }
    failure.value = null;
    await runUntilIssueStep();
  }

  async function runUntilIssueStep() {
    if (autopilotPromise) {
      return autopilotPromise;
    }

    autopilotPromise = executeAutopilot();
    try {
      return await autopilotPromise;
    } finally {
      autopilotPromise = null;
    }
  }

  async function executeAutopilot() {
    active.value = true;
    try {
      for (let operationCount = 0; operationCount < MAX_AUTOPILOT_OPERATIONS; operationCount += 1) {
        const currentSession = readSession(session);
        if (!currentSession?.sessionId || currentSession.currentStep === ISSUE_STEP_ID) {
          return;
        }

        if (await advanceCurrentStepIfReady()) {
          continue;
        }

        const stage = AUTOPILOT_STEP_ACTIONS[currentSession.currentStep];
        if (!stage) {
          stopWithFailure(blockedStepFailure(currentSession));
          return;
        }
        await runStageAction(currentSession, stage);
        if (failure.value) {
          return;
        }
      }

      stopWithFailure({
        actionId: "",
        actionLabel: "Autopilot",
        error: "Autopilot stopped because the session did not make progress.",
        exitCode: null,
        ok: false,
        output: ""
      });
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function advanceCurrentStepIfReady() {
    const next = readNext(actions);
    if (!nextIsReady(next)) {
      return false;
    }

    activeStage.value = String(sessionStepLabel(readSession(session), next.stepId) || next.label || "Next");
    await actions.goNext?.();
    await refreshSessionData();
    await nextTick();
    return true;
  }

  async function runStageAction(currentSession = {}, stage = {}) {
    const action = actionById(readActions(actions), stage.actionId);
    if (!action) {
      stopWithFailure(missingActionFailure(stage));
      return;
    }
    if (action.enabled !== true) {
      stopWithFailure(disabledActionFailure(action, stage));
      return;
    }

    activeStage.value = stage.label;
    if (action.type === "command") {
      await runTerminalAction(currentSession, action);
      return;
    }

    try {
      await actions.runAction?.(action);
      await refreshSessionData();
      await nextTick();
    } catch (error) {
      stopWithFailure({
        actionId: action.id,
        actionLabel: action.label,
        error: String(error?.message || error || `${action.label || action.id} failed.`),
        exitCode: null,
        ok: false,
        output: ""
      });
    }
  }

  async function runTerminalAction(currentSession = {}, action = {}) {
    const result = await commandRunner.runCommandAction({
      action,
      input: {},
      sessionId: currentSession.sessionId
    });
    await refreshSessionData();
    await nextTick();
    if (result.ok !== true) {
      stopWithFailure(result);
    }
  }

  function stopWithFailure(result = {}) {
    failure.value = {
      actionId: String(result.actionId || ""),
      actionLabel: String(result.actionLabel || result.actionId || "Action"),
      commandPreview: String(result.commandPreview || ""),
      error: String(result.error || "Autopilot action failed."),
      exitCode: result.exitCode ?? null,
      output: String(result.output || "")
    };
  }

  return {
    canStart,
    failure,
    readyForIssue,
    retry,
    running,
    start,
    statusText
  };
}

export {
  ISSUE_STEP_ID,
  useAiStudioAutopilotController
};
