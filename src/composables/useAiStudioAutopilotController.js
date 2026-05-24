import { computed, nextTick, ref } from "vue";
import {
  useAiStudioHeadlessCommandRunner
} from "@/composables/useAiStudioHeadlessCommandRunner.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const MAX_AUTOPILOT_OPERATIONS = 40;
const OPERATION_ROUTES = Object.freeze({
  COMMAND_TERMINAL: "command-terminal",
  SESSION_ACTION: "session-action",
  SESSION_ADVANCE: "session-advance",
  SESSION_INTENT: "session-intent"
});

function readSession(session) {
  return readRefOrGetterValue(session) || null;
}

function currentPresentation(session = {}) {
  const presentation = session?.presentation;
  return presentation && typeof presentation === "object" && !Array.isArray(presentation)
    ? presentation
    : {};
}

function currentScreen(session = {}) {
  const screen = currentPresentation(session).screen;
  return screen && typeof screen === "object" && !Array.isArray(screen)
    ? screen
    : {};
}

function currentOperation(session = {}) {
  const operation = currentPresentation(session).auto?.nextOperation;
  return operation && typeof operation === "object" && !Array.isArray(operation)
    ? operation
    : { executable: false, kind: "stop" };
}

function operationInput(operation = {}) {
  const input = operation.input || operation.fields;
  return input && typeof input === "object" && !Array.isArray(input) ? input : {};
}

function operationCanDispatch(operation = {}) {
  return operation.executable === true &&
    Object.values(OPERATION_ROUTES).includes(String(operation.route || ""));
}

function operationKey(operation = {}) {
  return [
    operation.route || "",
    operation.id || "",
    operation.kind || "",
    operation.actionId || "",
    operation.intentId || "",
    operation.label || "",
    operation.executable === true ? "1" : "0"
  ].join(":");
}

function missingOperationFailure(operation = {}) {
  return {
    actionId: String(operation.actionId || operation.intentId || ""),
    actionLabel: String(operation.label || "Autopilot"),
    error: `${operation.label || operation.actionId || operation.intentId || "The next operation"} is not dispatchable.`,
    exitCode: null,
    ok: false,
    output: ""
  };
}

function autopilotStoppedFailure() {
  return {
    actionId: "",
    actionLabel: "Autopilot",
    error: "Autopilot stopped. Use Inspect to continue manually.",
    exitCode: null,
    ok: false,
    output: ""
  };
}

function useAiStudioAutopilotController({
  actions = {},
  commandRunner = useAiStudioHeadlessCommandRunner(),
  enabled = true,
  refreshSessionData = async () => null,
  session
} = {}) {
  const active = ref(false);
  const activeStage = ref("");
  const failure = ref(null);
  const lastCommandResult = ref(null);

  let autopilotPromise = null;
  let stopRequested = false;

  const autopilotEnabled = computed(() => readRefOrGetterValue(enabled) !== false);
  const currentSession = computed(() => readSession(session));
  const nextOperation = computed(() => currentOperation(currentSession.value));
  const commandOutput = computed(() => String(readRefOrGetterValue(commandRunner.output) || ""));
  const commandPreview = computed(() => String(readRefOrGetterValue(commandRunner.commandPreview) || ""));
  const commandResult = computed(() => readRefOrGetterValue(commandRunner.lastResult) || lastCommandResult.value || null);
  const commandRunning = computed(() => readRefOrGetterValue(commandRunner.running) === true);
  const commandFailed = computed(() => commandResult.value?.ok === false);
  const running = computed(() => active.value || commandRunning.value);
  const canDispatchNextOperation = computed(() => Boolean(
    autopilotEnabled.value &&
    currentSession.value?.sessionId &&
    operationCanDispatch(nextOperation.value) &&
    !running.value &&
    !failure.value &&
    !commandFailed.value
  ));
  const nextOperationKey = computed(() => operationKey(nextOperation.value));
  const screenState = computed(() => {
    if (commandRunning.value || commandFailed.value) {
      return {
        icon: "none",
        kind: "command",
        showProgress: false,
        title: commandRunning.value ? "Command running." : "Command needs attention."
      };
    }
    if (failure.value) {
      return {
        icon: "warning",
        kind: "failure",
        message: String(failure.value.error || ""),
        showProgress: false,
        title: "Attention required"
      };
    }
    const screen = currentScreen(currentSession.value);
    return {
      icon: screen.icon || "cog",
      input: screen.input && typeof screen.input === "object" && !Array.isArray(screen.input)
        ? screen.input
        : null,
      kind: screen.kind || "idle",
      message: screen.message || "",
      primaryIntentId: screen.primaryIntentId || "",
      sections: Array.isArray(screen.sections) ? screen.sections : [],
      showProgress: screen.showProgress === true,
      stopAction: screen.stopAction || "",
      title: screen.title || "AI Studio",
      variant: screen.variant || ""
    };
  });

  function clearFailure() {
    failure.value = null;
    lastCommandResult.value = null;
  }

  function stopWithFailure(result = {}) {
    failure.value = {
      actionId: String(result.actionId || ""),
      actionLabel: String(result.actionLabel || result.actionId || "Action"),
      commandPreview: String(result.commandPreview || ""),
      error: String(result.error || "Autopilot action failed."),
      exitCode: result.exitCode ?? null,
      output: String(result.output || ""),
      source: String(result.source || "")
    };
  }

  async function runNextOperation() {
    if (!canDispatchNextOperation.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  async function retry() {
    if (!autopilotEnabled.value || running.value) {
      return;
    }
    stopRequested = false;
    clearFailure();
    await runUntilStopPoint();
  }

  function stop() {
    stopRequested = true;
    if (commandRunning.value && typeof commandRunner.stopCommandAction === "function") {
      commandRunner.stopCommandAction();
      return;
    }
    active.value = false;
    activeStage.value = "";
    stopWithFailure(autopilotStoppedFailure());
  }

  function stopCommandAction() {
    if (!commandRunning.value || typeof commandRunner.stopCommandAction !== "function") {
      return false;
    }
    stopRequested = true;
    return commandRunner.stopCommandAction();
  }

  async function runUntilStopPoint() {
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
        const sessionNow = currentSession.value;
        if (!autopilotEnabled.value || stopRequested || !sessionNow?.sessionId) {
          return;
        }
        const operation = currentOperation(sessionNow);
        if (!operationCanDispatch(operation)) {
          return;
        }
        await dispatchOperation(operation);
        if (failure.value || stopRequested) {
          return;
        }
      }
      stopWithFailure({
        actionLabel: "Autopilot",
        error: "Autopilot stopped because the session did not make progress."
      });
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function dispatchOperation(operation = {}) {
    activeStage.value = String(operation.label || operation.actionId || operation.intentId || "Autopilot");
    if (!operationCanDispatch(operation)) {
      stopWithFailure(missingOperationFailure(operation));
      return;
    }

    const route = String(operation.route || "");
    if (route === OPERATION_ROUTES.SESSION_ADVANCE) {
      await actions.advanceSession?.({
        sessionId: currentSession.value?.sessionId || ""
      });
      await refreshSessionData();
      await nextTick();
      return;
    }

    if (route === OPERATION_ROUTES.SESSION_INTENT) {
      await actions.runIntentById?.({
        fields: operationInput(operation),
        intentId: operation.intentId,
        sessionId: currentSession.value?.sessionId || "",
        stepId: operation.stepId || currentSession.value?.currentStep || "",
        stepStatus: operation.stepStatus || currentSession.value?.stepMachine?.status || ""
      });
      await refreshSessionData();
      await nextTick();
      return;
    }

    if (route === OPERATION_ROUTES.SESSION_ACTION) {
      await actions.runActionById?.({
        actionId: operation.actionId,
        advanceOnSuccess: operation.advanceOnSuccess === true,
        input: operationInput(operation),
        sessionId: currentSession.value?.sessionId || ""
      });
      await refreshSessionData();
      await nextTick();
      return;
    }

    if (route === OPERATION_ROUTES.COMMAND_TERMINAL) {
      await runCommandTerminalOperation(operation);
    }
  }

  async function runPresentedIntent(intent = {}, {
    continueAfterCompletion = true,
    fields = {}
  } = {}) {
    if (!autopilotEnabled.value || running.value && !active.value || intent.enabled !== true) {
      return false;
    }
    clearFailure();
    active.value = true;
    activeStage.value = intent.label || "Run intent";
    try {
      await actions.runIntentById?.({
        fields,
        intentId: intent.id,
        sessionId: currentSession.value?.sessionId || "",
        stepId: currentSession.value?.currentStep || "",
        stepStatus: currentSession.value?.stepMachine?.status || ""
      });
      await refreshSessionData();
      await nextTick();
      if (failure.value) {
        return false;
      }
      if (continueAfterCompletion) {
        await runUntilStopPoint();
      }
      return !failure.value;
    } catch (error) {
      stopWithFailure({
        actionId: intent.id,
        actionLabel: intent.label,
        error: String(error?.message || error || `${intent.label || intent.id} failed.`)
      });
      return false;
    } finally {
      active.value = false;
      activeStage.value = "";
    }
  }

  async function runCommandTerminalOperation(operation = {}) {
    lastCommandResult.value = null;
    const result = await commandRunner.runCommandAction({
      action: {
        id: String(operation.actionId || ""),
        label: String(operation.label || operation.actionId || "Command")
      },
      advanceOnSuccess: operation.advanceOnSuccess === true,
      input: operationInput(operation),
      sessionId: currentSession.value?.sessionId || ""
    });
    lastCommandResult.value = result;
    await refreshSessionData();
    await nextTick();
    if (result?.ok !== true) {
      stopWithFailure(result);
    }
  }

  return {
    canDispatchNextOperation,
    clearFailure,
    commandOutput,
    commandPreview,
    commandResult,
    commandRunning,
    failure,
    nextOperation,
    nextOperationKey,
    retry,
    runNextOperation,
    runPresentedIntent,
    running,
    screenState,
    stop,
    stopCommandAction
  };
}

export {
  useAiStudioAutopilotController
};
