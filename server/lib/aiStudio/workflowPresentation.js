import {
  aiStudioError,
  normalizeText
} from "./core.js";
import {
  aiStudioSessionDebugDurationMs,
  aiStudioSessionDebugError,
  aiStudioSessionDebugLog,
  aiStudioSessionDebugSummary
} from "./sessionDebugLog.js";
import { STEP_STATUS } from "./workflowStepMachines.js";

// AI Studio ownership contract:
// - Durable workflow truth remains in the session files, workflow machine, step
//   machines, action results, and metadata.
// - This module is the server-owned projection from workflow truth to UI and
//   automation presentation.
// - Clients render `presentation.screen`, submit server-provided intents/input,
//   and dispatch `presentation.auto.nextOperation` by its explicit route.
// - Clients must not infer workflow meaning from step ids, action names, action
//   types, or raw step-machine statuses.
const ACTION_IDS = Object.freeze({
  AGENT_CONVERSATION: "agent_conversation",
  FINAL_REVIEW_CONVERSATION: "final_review_conversation",
  FINISH_SESSION: "finish_session",
  HUMAN_REVIEW_CONVERSATION: "human_review_conversation",
  MAKE_PLAN: "make_plan",
  MAKE_SEED_PLAN: "make_seed_plan",
  MERGE_PR: "merge_pr",
  PREPARE_FOR_MERGE: "prepare_for_merge",
  RUN_DEEP_UI_CHECK: "run_deep_ui_check"
});

const INTENT_IDS = Object.freeze({
  ACCEPT_REVIEW: "accept_review",
  ARCHIVE_SESSION: "archive_session",
  CONTINUE_STEP: "continue_step",
  MERGE_AND_SYNC: "merge_and_sync",
  RECHECK_AFTER_FINAL_TWEAK: "recheck_after_final_tweak",
  REJECT_AND_REPLAN: "reject_and_replan",
  REQUEST_REVIEW_TWEAK: "request_review_tweak",
  RUN_OPTIONAL_CHECK: "run_optional_check",
  SKIP_MERGE: "skip_merge",
  SKIP_OPTIONAL_CHECK: "skip_optional_check",
  TALK_TO_CODEX: "talk_to_codex"
});

const METADATA_KEYS = Object.freeze({
  FINAL_REVIEW_FOLLOWUP: "autopilot_final_review_followup",
  MERGE_INTENT: "autopilot_merge_intent"
});

const STEP_IDS = Object.freeze({
  CHANGES_ACCEPTED: "changes_accepted",
  PLAN_MADE: "plan_made",
  PR_MERGED: "pr_merged",
  PROJECT_VALIDATED: "project_validated",
  REVIEW_RUN: "review_run",
  SEED_PLAN_MADE: "seed_plan_made"
});

const OPERATION_ROUTES = Object.freeze({
  COMMAND_TERMINAL: "command-terminal",
  SESSION_ACTION: "session-action",
  SESSION_ADVANCE: "session-advance",
  SESSION_INTENT: "session-intent"
});
const INTENT_PRESENTATION_GROUPS = Object.freeze([
  "decision",
  "stop"
]);

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function currentStepDefinition(session = {}) {
  return isObject(session.currentStepDefinition) ? session.currentStepDefinition : {};
}

function currentAutopilot(session = {}) {
  const autopilot = session.workflowAutopilot;
  return isObject(autopilot) ? autopilot : {};
}

function currentStepLabel(session = {}) {
  return normalizeText(currentStepDefinition(session).label || session.currentStep || "Current step");
}

function actionById(session = {}, actionId = "") {
  return (Array.isArray(session.actions) ? session.actions : [])
    .find((action) => normalizeText(action.id) === actionId) || null;
}

function stageAction(session = {}) {
  const stage = currentAutopilot(session).stage;
  if (!isObject(stage) || !stage.actionId) {
    return null;
  }
  return {
    actionId: normalizeText(stage.actionId),
    advanceOnSuccess: stage.advanceOnSuccess === true,
    label: normalizeText(stage.label || stage.actionId)
  };
}

function nextIsReady(session = {}) {
  return session.next?.visible === true && session.next?.enabled === true && Boolean(session.next?.stepId);
}

function stepMachineStatus(session = {}) {
  return normalizeText(session.stepMachine?.status);
}

function stepMachineIsWaitingForCodex(session = {}) {
  return [
    STEP_STATUS.AWAITING_AGENT_RESULT,
    STEP_STATUS.ATTEMPTING_EXECUTION
  ].includes(stepMachineStatus(session));
}

function stepMachineNeedsInput(session = {}) {
  return [
    STEP_STATUS.CONFIRM_FILES,
    STEP_STATUS.WAITING_FOR_INPUT,
    STEP_STATUS.FAILED
  ].includes(stepMachineStatus(session));
}

function screen(kind, {
  icon = "cog",
  input = null,
  message = "",
  primaryIntentId = "",
  sections = [],
  showProgress = false,
  title = "",
  variant = ""
} = {}) {
  return {
    icon,
    ...(isObject(input) ? { input } : {}),
    kind,
    message: normalizeText(message),
    primaryIntentId: normalizeText(primaryIntentId),
    sections,
    showProgress,
    title: normalizeText(title),
    variant: normalizeText(variant)
  };
}

function inputPresentation(input = {}, {
  submitTarget = ""
} = {}) {
  if (!isObject(input)) {
    return null;
  }
  return {
    ...input,
    submitTarget: normalizeText(submitTarget || input.submitTarget)
  };
}

function intent(id, {
  actionId = "",
  clientAction = "",
  disabledReason = "",
  enabled = true,
  inputFields = [],
  label = "",
  style = "secondary"
} = {}) {
  return {
    actionId: normalizeText(actionId),
    clientAction: normalizeText(clientAction),
    disabledReason: enabled ? "" : normalizeText(disabledReason || "This action is not available right now."),
    enabled: enabled === true,
    id,
    inputFields: Array.isArray(inputFields) ? inputFields : [],
    label: normalizeText(label || id),
    style
  };
}

function intentForAction(id, action = {}, options = {}) {
  return intent(id, {
    ...options,
    actionId: action?.id || options.actionId || "",
    disabledReason: action?.disabledReason || options.disabledReason || "",
    enabled: action?.enabled === true,
    inputFields: options.inputFields || action?.inputFields || [],
    label: options.label || action?.label || id
  });
}

function continueIntent(session = {}, {
  id = INTENT_IDS.CONTINUE_STEP,
  label = ""
} = {}) {
  return intent(normalizeText(id) || INTENT_IDS.CONTINUE_STEP, {
    disabledReason: session.next?.disabledReason || "",
    enabled: nextIsReady(session),
    label: label || session.next?.label || "Continue",
    style: "primary"
  });
}

function presentationSections(names = []) {
  return names.map((name) => ({ kind: name }));
}

function stepPresentationConfig(session = {}) {
  const presentation = session.workflowPresentation;
  return isObject(presentation) ? presentation : {};
}

function screenTitleFromConfig(config = {}, session = {}) {
  const title = normalizeText(config.title);
  if (title === "current_step") {
    return currentStepLabel(session);
  }
  if (normalizeText(config.titleActionId)) {
    const action = actionById(session, normalizeText(config.titleActionId));
    return `${action?.label || currentStepLabel(session)}${normalizeText(config.titleSuffix)}`;
  }
  return title || currentStepLabel(session);
}

function screenFromConfig(config = {}, session = {}) {
  const sectionNames = Array.isArray(config.sections) ? config.sections : [];
  return screen(config.kind || "stop", {
    icon: config.icon || "cog",
    message: config.message || "",
    primaryIntentId: config.primaryIntentId || "",
    sections: presentationSections(sectionNames),
    showProgress: config.showProgress === true,
    title: screenTitleFromConfig(config, session),
    variant: config.variant || ""
  });
}

function configuredIntentEnabled(session = {}, config = {}) {
  if (normalizeText(config.enabledWhenAction)) {
    return actionById(session, config.enabledWhenAction)?.enabled === true;
  }
  if (normalizeText(config.enabledWhen) === "has_next_step") {
    return session.next?.visible !== false && Boolean(session.next?.stepId);
  }
  return config.enabled !== false;
}

function configuredIntentDisabledReason(session = {}, config = {}, enabled = true) {
  if (enabled) {
    return "";
  }
  if (normalizeText(config.disabledReason)) {
    return config.disabledReason;
  }
  if (normalizeText(config.enabledWhenAction)) {
    return actionById(session, config.enabledWhenAction)?.disabledReason || "";
  }
  if (normalizeText(config.enabledWhen) === "has_next_step" && session.next?.visible === false) {
    return "There is no next workflow step.";
  }
  return "";
}

function intentFromConfig(session = {}, config = {}) {
  const id = normalizeText(config.id);
  if (!id) {
    return null;
  }
  if (normalizeText(config.type) === "continue") {
    return continueIntent(session, {
      id,
      label: config.label
    });
  }
  if (normalizeText(config.type) === "action") {
    const stage = stageAction(session);
    const action = actionById(session, config.actionId || stage?.actionId || "");
    return intentForAction(id, action, {
      disabledReason: config.disabledReason || "",
      inputFields: config.inputFields,
      label: config.label || "",
      style: config.style || "secondary"
    });
  }
  const enabled = configuredIntentEnabled(session, config);
  return intent(id, {
    clientAction: config.clientAction || "",
    disabledReason: configuredIntentDisabledReason(session, config, enabled),
    enabled,
    inputFields: config.inputFields,
    label: config.label || "",
    style: config.style || "secondary"
  });
}

function presentationFromConfig(session = {}, config = {}) {
  const intents = (Array.isArray(config.intents) ? config.intents : [])
    .map((intentConfig) => intentFromConfig(session, intentConfig))
    .filter(Boolean);
  return {
    intents,
    screen: screenFromConfig(isObject(config.screen) ? config.screen : {}, session)
  };
}

function stopScreenPresentation(session = {}) {
  const configured = stepPresentationConfig(session).stop;
  if (isObject(configured)) {
    return presentationFromConfig(session, configured);
  }

  return {
    intents: [],
    screen: screen("stop", {
      title: currentStepLabel(session)
    })
  };
}

function userDecisionPresentation(session = {}) {
  const configured = stepPresentationConfig(session).decision;
  if (isObject(configured)) {
    return presentationFromConfig(session, configured);
  }

  const action = actionById(session, stageAction(session)?.actionId);
  return {
    intents: [
      intentForAction(INTENT_IDS.RUN_OPTIONAL_CHECK, action, {
        label: action?.label || "Run check",
        style: "primary"
      }),
      intent(INTENT_IDS.SKIP_OPTIONAL_CHECK, {
        disabledReason: session.next?.visible === false ? "There is no next workflow step." : "",
        enabled: session.next?.visible !== false && Boolean(session.next?.stepId),
        label: "Skip"
      })
    ],
    screen: screen("decision", {
      message: "This optional check can take a long time. Run it now, or skip it and continue.",
      title: action?.label ? `${action.label}?` : currentStepLabel(session)
    })
  };
}

function interactionPresentation(session = {}) {
  const interaction = currentStepDefinition(session).interaction;
  if (!isObject(interaction)) {
    return null;
  }
  if (normalizeText(interaction.intentId) === INTENT_IDS.TALK_TO_CODEX || normalizeText(interaction.kind) === "conversation") {
    const action = actionById(session, interaction.actionId || stageAction(session)?.actionId || ACTION_IDS.AGENT_CONVERSATION);
    return {
      intents: [
        intentForAction(INTENT_IDS.TALK_TO_CODEX, action, {
          inputFields: interaction.fields,
          label: interaction.submitLabel || action?.label || "Send to Codex",
          style: "primary"
        })
      ],
      screen: screen("conversation", {
        input: inputPresentation(interaction, {
          submitTarget: "intent"
        }),
        message: interaction.prompt || "",
        primaryIntentId: INTENT_IDS.TALK_TO_CODEX,
        sections: presentationSections(["response_preview"]),
        title: interaction.title || currentStepLabel(session)
      })
    };
  }
  return {
    intents: [],
    screen: screen(stepMachineStatus(session) === STEP_STATUS.CONFIRM_FILES ? "confirm_files" : "input", {
      input: inputPresentation(interaction, {
        submitTarget: "current-step-input"
      }),
      message: interaction.prompt || "",
      title: interaction.title || currentStepLabel(session)
    })
  };
}

function waitingPresentation(session = {}) {
  if (!stepMachineIsWaitingForCodex(session)) {
    return null;
  }
  return {
    intents: [],
    screen: screen("codex_running", {
      icon: "progress",
      message: "Wait for Codex to finish the current step.",
      showProgress: true,
      title: "Terminal is transmitting..."
    })
  };
}

function genericPresentation(session = {}) {
  if (nextIsReady(session)) {
    return {
      intents: [continueIntent(session)],
      screen: screen("ready", {
        title: currentStepLabel(session)
      })
    };
  }
  return {
    intents: [],
    screen: screen("blocked", {
      message: session.next?.disabledReason || "",
      title: currentStepLabel(session)
    })
  };
}

function automationWaitReason(session = {}) {
  if (stepMachineIsWaitingForCodex(session)) {
    return "codex";
  }
  if (stepMachineNeedsInput(session)) {
    return "input";
  }
  if (currentAutopilot(session).stop === true) {
    return "user";
  }
  if (currentAutopilot(session).userDecision === true) {
    return "decision";
  }
  return "";
}

function actionOperation(session = {}, stage = {}) {
  const action = actionById(session, stage.actionId);
  if (!action || action.enabled !== true) {
    return {
      executable: false,
      kind: "stop",
      reason: action?.disabledReason || `${stage.label || stage.actionId || "Action"} is not available.`
    };
  }
  const route = action.dispatchRoute === OPERATION_ROUTES.COMMAND_TERMINAL
    ? OPERATION_ROUTES.COMMAND_TERMINAL
    : OPERATION_ROUTES.SESSION_ACTION;
  return {
    actionId: action.id,
    advanceOnSuccess: stage.advanceOnSuccess === true || action.advanceOnSuccess === true,
    executable: true,
    id: `${route}:${action.id}`,
    input: {},
    kind: route === OPERATION_ROUTES.COMMAND_TERMINAL ? "command" : "action",
    label: stage.label || action.label || action.id,
    route
  };
}

function advanceOperation(session = {}) {
  return {
    executable: true,
    id: `${OPERATION_ROUTES.SESSION_ADVANCE}:${session.next?.stepId || "next"}`,
    kind: "advance",
    label: session.next?.label || "Continue",
    route: OPERATION_ROUTES.SESSION_ADVANCE
  };
}

function intentOperation(intentId = "", {
  label = ""
} = {}) {
  const normalizedIntentId = normalizeText(intentId);
  return {
    executable: Boolean(normalizedIntentId),
    id: `${OPERATION_ROUTES.SESSION_INTENT}:${normalizedIntentId}`,
    intentId: normalizedIntentId,
    kind: "intent",
    label: normalizeText(label || normalizedIntentId),
    route: OPERATION_ROUTES.SESSION_INTENT
  };
}

function waitOperation(reason = "") {
  return {
    executable: false,
    kind: "wait",
    reason: normalizeText(reason)
  };
}

function stopOperation(reason = "") {
  return {
    executable: false,
    kind: "stop",
    reason: normalizeText(reason)
  };
}

function mergeOperation(session = {}, config = {}) {
  const metadata = session.metadata || {};
  if (normalizeText(metadata.merge_skipped)) {
    return nextIsReady(session)
      ? advanceOperation(session)
      : stopOperation(session.next?.disabledReason || "");
  }
  if (normalizeText(metadata.pr_merged)) {
    return nextIsReady(session)
      ? advanceOperation(session)
      : stopOperation(session.next?.disabledReason || "");
  }
  if (stepMachineStatus(session) === STEP_STATUS.READY && session.stepMachine?.promptComplete === true) {
    return actionOperation(session, {
      actionId: config.mergeActionId || ACTION_IDS.MERGE_PR,
      label: "Merge"
    });
  }
  if (stepMachineIsWaitingForCodex(session) || stepMachineNeedsInput(session)) {
    return waitOperation(automationWaitReason(session));
  }
  return actionOperation(session, {
    actionId: config.prepareActionId || ACTION_IDS.PREPARE_FOR_MERGE,
    label: "Prepare for merge"
  });
}

function configuredAutomationOperation(session = {}) {
  const automation = stepPresentationConfig(session).automation;
  if (!isObject(automation)) {
    return null;
  }
  const metadata = session.metadata || {};
  const recheck = isObject(automation.recheckAfterPrompt) ? automation.recheckAfterPrompt : null;
  if (
    recheck &&
    normalizeText(metadata[recheck.metadataName]) === normalizeText(recheck.metadataValue) &&
    (Array.isArray(recheck.statuses) ? recheck.statuses : []).includes(stepMachineStatus(session)) &&
    (recheck.promptComplete !== true || session.stepMachine?.promptComplete === true)
  ) {
    return intentOperation(recheck.intentId, {
      label: recheck.label
    });
  }

  const merge = isObject(automation.mergeIntent) ? automation.mergeIntent : null;
  if (
    merge &&
    normalizeText(metadata[merge.metadataName]) === normalizeText(merge.metadataValue)
  ) {
    return mergeOperation(session, merge);
  }
  return null;
}

function nextAutomationOperation(session = {}) {
  const waitReason = automationWaitReason(session);

  const configuredOperation = configuredAutomationOperation(session);
  if (configuredOperation) {
    return configuredOperation;
  }

  if (waitReason) {
    return waitOperation(waitReason);
  }

  if (stepMachineStatus(session) === STEP_STATUS.DONE && nextIsReady(session)) {
    return advanceOperation(session);
  }

  const stage = stageAction(session);
  if (stage) {
    return actionOperation(session, stage);
  }

  if (nextIsReady(session)) {
    return advanceOperation(session);
  }

  return stopOperation(session.next?.disabledReason || "");
}

function promptPresentation(session = {}) {
  const status = stepMachineStatus(session);
  switch (status) {
    case STEP_STATUS.AWAITING_AGENT_RESULT:
    case STEP_STATUS.ATTEMPTING_EXECUTION:
      return {
        state: "waiting_for_agent",
        statusText: "Waiting for Codex."
      };
    case STEP_STATUS.CONFIRM_FILES:
    case STEP_STATUS.WAITING_FOR_INPUT:
      return {
        state: "needs_user_input",
        statusText: "Input is required."
      };
    case STEP_STATUS.FAILED:
      return {
        state: "failed",
        statusText: "The current step needs attention."
      };
    case STEP_STATUS.DONE:
      return {
        state: "complete",
        statusText: "Complete."
      };
    case STEP_STATUS.READY:
    default:
      return {
        state: "idle",
        statusText: ""
      };
  }
}

function buildPresentation(session = {}) {
  const interaction = interactionPresentation(session);
  const waiting = waitingPresentation(session);
  const autopilot = currentAutopilot(session);
  const kind = normalizeText(autopilot.kind);
  let base = interaction || waiting;

  if (!base && autopilot.userDecision === true) {
    base = userDecisionPresentation(session);
  }
  if (!base && autopilot.stop === true) {
    base = stopScreenPresentation(session);
  }
  if (!base) {
    base = genericPresentation(session);
  }

  const nextOperation = nextAutomationOperation(session);
  return {
    actions: Array.isArray(session.actions) ? session.actions : [],
    auto: {
      nextOperation
    },
    intents: base.intents,
    next: session.next || null,
    prompt: promptPresentation(session),
    screen: base.screen,
    step: {
      id: normalizeText(session.currentStep),
      label: currentStepLabel(session),
      status: stepMachineStatus(session),
      workflowKind: kind
    },
    terminal: {}
  };
}

function applyWorkflowPresentation(session = {}) {
  const presentation = buildPresentation(session);
  const {
    workflowAutopilot,
    workflowPresentation,
    ...publicSession
  } = session;
  void workflowAutopilot;
  void workflowPresentation;
  return {
    ...publicSession,
    intents: presentation.intents,
    presentation
  };
}

function assertIntentMatchesCurrentState(session = {}, input = {}) {
  const stepId = normalizeText(input.stepId);
  const stepStatus = normalizeText(input.stepStatus);
  if (!stepId && !stepStatus) {
    return;
  }
  if (stepId !== normalizeText(session.currentStep) || stepStatus !== normalizeText(session.stepMachine?.status)) {
    throw aiStudioError(
      `Reload state. This intent was prepared for ${stepId || "(missing step)"}:${stepStatus || "(missing status)"}, but the current workflow state is ${session.currentStep || "(no current step)"}:${session.stepMachine?.status || "(no machine status)"}.`,
      "ai_studio_intent_state_changed"
    );
  }
}

function intentById(session = {}, intentId = "") {
  return (Array.isArray(session.intents) ? session.intents : [])
    .find((candidate) => candidate.id === intentId) || null;
}

function automationIntentById(session = {}, intentId = "") {
  const operation = session.presentation?.auto?.nextOperation;
  if (
    operation?.kind !== "intent" ||
    normalizeText(operation.intentId) !== intentId ||
    operation.executable !== true
  ) {
    return null;
  }
  return intent(intentId, {
    enabled: true,
    label: operation.label || intentId
  });
}

function selectedIntentById(session = {}, intentId = "") {
  return intentById(session, intentId) || automationIntentById(session, intentId);
}

// Public session payloads intentionally strip `workflowPresentation`; intent
// execution re-reads the current step contract from the workflow machine.
function currentStepPresentationContract(runtime, session = {}) {
  if (isObject(session.workflowPresentation)) {
    return session.workflowPresentation;
  }
  const machine = typeof runtime?.workflowMachineForSession === "function"
    ? runtime.workflowMachineForSession(session)
    : null;
  const step = typeof machine?.currentStepForSession === "function"
    ? machine.currentStepForSession(session)
    : null;
  return isObject(step?.presentation) ? step.presentation : {};
}

function presentationIntentConfigById(presentation = {}, intentId = "") {
  for (const groupName of INTENT_PRESENTATION_GROUPS) {
    const presentationGroup = presentation[groupName];
    const found = (Array.isArray(presentationGroup?.intents) ? presentationGroup.intents : [])
      .find((candidate) => normalizeText(candidate.id) === intentId);
    if (found) {
      return found;
    }
  }
  return null;
}

function automationIntentConfigById(presentation = {}, intentId = "") {
  const recheck = presentation?.automation?.recheckAfterPrompt;
  if (normalizeText(recheck?.intentId) !== intentId) {
    return null;
  }
  return recheck;
}

function defaultServerOperationForIntentConfig(intentConfig = {}) {
  const type = normalizeText(intentConfig.type);
  if (type === "continue") {
    return {
      kind: "advance"
    };
  }
  if (type === "action") {
    return {
      actionId: normalizeText(intentConfig.actionId),
      input: "fields",
      kind: "run_action"
    };
  }
  return null;
}

function fallbackActionServerOperation(selectedIntent = {}) {
  if (!selectedIntent.actionId) {
    return null;
  }
  return {
    actionId: selectedIntent.actionId,
    input: "fields",
    kind: "run_action"
  };
}

function serverOperationForIntent(runtime, session = {}, intentId = "", selectedIntent = {}) {
  const presentation = currentStepPresentationContract(runtime, session);
  const intentConfig = presentationIntentConfigById(presentation, intentId) ||
    automationIntentConfigById(presentation, intentId);
  if (!intentConfig) {
    return fallbackActionServerOperation(selectedIntent);
  }
  if (isObject(intentConfig.serverOperation)) {
    return intentConfig.serverOperation;
  }
  return defaultServerOperationForIntentConfig(intentConfig) ||
    fallbackActionServerOperation(selectedIntent);
}

function fieldNamesForOperation(operation = {}, fallback = []) {
  return Array.isArray(operation.feedbackFields)
    ? operation.feedbackFields
    : fallback;
}

function firstPresentField(fields = {}, names = []) {
  return normalizeText(names.map((name) => fields[name]).find(Boolean));
}

function replanTargetForSession(session = {}, operation = {}) {
  if (replanStepIdForSession(session) === STEP_IDS.SEED_PLAN_MADE) {
    return {
      actionId: normalizeText(operation.seedActionId || ACTION_IDS.MAKE_SEED_PLAN),
      stepId: normalizeText(operation.seedPlanStepId || STEP_IDS.SEED_PLAN_MADE)
    };
  }
  return {
    actionId: normalizeText(operation.planActionId || ACTION_IDS.MAKE_PLAN),
    stepId: normalizeText(operation.planStepId || STEP_IDS.PLAN_MADE)
  };
}

function finalReviewRecheckTargetStepForSession(session = {}, operation = {}) {
  return finalReviewRecheckStepIdForSession(session) === STEP_IDS.REVIEW_RUN
    ? normalizeText(operation.reviewStepId || STEP_IDS.REVIEW_RUN)
    : normalizeText(operation.validationStepId || STEP_IDS.PROJECT_VALIDATED);
}

async function runActionServerOperation(runtime, session = {}, selectedIntent = {}, operation = {}, fields = {}) {
  await writeOperationMetadata(runtime, session.sessionId, operation.metadataBeforeAction);
  return runtime.runAction(
    session.sessionId,
    normalizeText(operation.actionId) || selectedIntent.actionId,
    actionInputForOperation(operation, fields)
  );
}

async function rejectAndReplanServerOperation(runtime, session = {}, operation = {}, fields = {}) {
  const feedback = firstPresentField(fields, fieldNamesForOperation(operation, ["feedback", "message", "response"]));
  if (!feedback) {
    throw aiStudioError("Describe what should change before sending the work back to Codex.", "ai_studio_intent_input_required");
  }
  const target = replanTargetForSession(session, operation);
  await runtime.rewind(session.sessionId, target.stepId);
  return runtime.runAction(session.sessionId, target.actionId, {
    autopilotFeedback: feedback,
    autopilotReason: normalizeText(operation.reason || "changes_rejected")
  });
}

async function deleteMetadataAndRewindServerOperation(runtime, session = {}, operation = {}) {
  await runtime.store.deleteMetadataValue(
    session.sessionId,
    normalizeText(operation.metadataName || METADATA_KEYS.FINAL_REVIEW_FOLLOWUP)
  );
  return runtime.rewind(
    session.sessionId,
    finalReviewRecheckTargetStepForSession(session, operation)
  );
}

async function writeMetadataServerOperation(runtime, session = {}, operation = {}) {
  await runtime.store.writeMetadataValue(
    session.sessionId,
    normalizeText(operation.metadataName || METADATA_KEYS.MERGE_INTENT),
    normalizeText(operation.metadataValue)
  );
  return runtime.getSession(session.sessionId);
}

function workflowStepIds(session = {}) {
  return (Array.isArray(session.stepDefinitions) ? session.stepDefinitions : [])
    .map((step) => normalizeText(step.id))
    .filter(Boolean);
}

async function advanceToStepServerOperation(runtime, session = {}, operation = {}) {
  const startedAtMs = Date.now();
  const targetStepId = normalizeText(operation.stepId || operation.targetStepId);
  if (!targetStepId) {
    throw aiStudioError("advance_to_step requires a target step id.", "ai_studio_operation_target_required");
  }

  let currentSession = await runtime.getSession(session.sessionId);
  const stepIds = workflowStepIds(currentSession);
  if (!stepIds.includes(targetStepId)) {
    throw aiStudioError(`Workflow target step does not exist: ${targetStepId}`, "ai_studio_unknown_workflow_step");
  }

  aiStudioSessionDebugLog("server.workflowPresentation.advanceToStep.start", {
    ...aiStudioSessionDebugSummary(currentSession),
    targetStepId
  });

  for (let count = 0; normalizeText(currentSession.currentStep) !== targetStepId; count += 1) {
    if (count >= stepIds.length) {
      throw aiStudioError(`Workflow could not advance to ${targetStepId}.`, "ai_studio_advance_target_not_reached");
    }
    aiStudioSessionDebugLog("server.workflowPresentation.advanceToStep.advance", {
      ...aiStudioSessionDebugSummary(currentSession),
      count: count + 1,
      targetStepId
    });
    currentSession = await runtime.advance(currentSession.sessionId);
  }

  aiStudioSessionDebugLog("server.workflowPresentation.advanceToStep.done", {
    ...aiStudioSessionDebugSummary(currentSession),
    durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
    targetStepId
  });
  return currentSession;
}

async function sequenceServerOperation(runtime, session = {}, selectedIntent = {}, operation = {}, fields = {}) {
  const operations = Array.isArray(operation.operations) ? operation.operations : [];
  if (operations.length === 0) {
    throw aiStudioError("sequence requires at least one operation.", "ai_studio_operation_sequence_empty");
  }

  let currentSession = session;
  for (const nextOperation of operations) {
    currentSession = await runServerOperation(runtime, currentSession, selectedIntent, nextOperation, fields);
  }
  return currentSession;
}

async function runServerOperation(runtime, session = {}, selectedIntent = {}, operation = {}, fields = {}) {
  const safeOperation = isObject(operation) ? operation : {};
  switch (normalizeText(safeOperation.kind)) {
    case "advance":
      return runtime.advance(session.sessionId);
    case "force_advance":
      return forceAdvanceCurrentStep(runtime, session, safeOperation.message || "Advanced by server intent.");
    case "run_action":
      return runActionServerOperation(runtime, session, selectedIntent, safeOperation, fields);
    case "reject_and_replan":
      return rejectAndReplanServerOperation(runtime, session, safeOperation, fields);
    case "delete_metadata_and_rewind":
      return deleteMetadataAndRewindServerOperation(runtime, session, safeOperation);
    case "write_metadata":
      return writeMetadataServerOperation(runtime, session, safeOperation);
    case "advance_to_step":
      return advanceToStepServerOperation(runtime, session, safeOperation);
    case "sequence":
      return sequenceServerOperation(runtime, session, selectedIntent, safeOperation, fields);
    default:
      throw aiStudioError(
        `Intent ${selectedIntent.id || "(empty)"} has no server handler.`,
        "ai_studio_intent_not_handled"
      );
    }
}

function intentFields(input = {}) {
  if (isObject(input.fields)) {
    return input.fields;
  }
  if (isObject(input.input)) {
    return input.input;
  }
  return {};
}

function conversationInput(fields = {}) {
  return {
    conversationRequest: normalizeText(fields.conversationRequest || fields.feedback || fields.message || fields.response)
  };
}

function actionInputForOperation(operation = {}, fields = {}) {
  const inputMode = normalizeText(operation.input || operation.inputMode || "fields");
  if (inputMode === "empty") {
    return {};
  }
  if (inputMode === "conversation") {
    return conversationInput(fields);
  }
  return fields;
}

async function writeOperationMetadata(runtime, sessionId = "", metadata = {}) {
  for (const [name, value] of Object.entries(isObject(metadata) ? metadata : {})) {
    await runtime.store.writeMetadataValue(sessionId, name, value);
  }
}

function replanStepIdForSession(session = {}) {
  const stepDefinitions = Array.isArray(session.stepDefinitions) ? session.stepDefinitions : [];
  return stepDefinitions.some((step) => step.id === STEP_IDS.SEED_PLAN_MADE)
    ? STEP_IDS.SEED_PLAN_MADE
    : STEP_IDS.PLAN_MADE;
}

function finalReviewRecheckStepIdForSession(session = {}) {
  const stepDefinitions = Array.isArray(session.stepDefinitions) ? session.stepDefinitions : [];
  return stepDefinitions.some((step) => step.id === STEP_IDS.REVIEW_RUN)
    ? STEP_IDS.REVIEW_RUN
    : STEP_IDS.PROJECT_VALIDATED;
}

async function forceAdvanceCurrentStep(runtime, session = {}, message = "Advanced by server intent.") {
  const startedAtMs = Date.now();
  aiStudioSessionDebugLog("server.workflowPresentation.forceAdvance.start", {
    ...aiStudioSessionDebugSummary(session),
    message
  });
  try {
    if (typeof runtime?.forceAdvance !== "function") {
      throw aiStudioError(
        "AI Studio runtime force-advance is not available.",
        "ai_studio_force_advance_not_available"
      );
    }
    const advancedSession = await runtime.forceAdvance(session.sessionId, {
      message
    });
    aiStudioSessionDebugLog("server.workflowPresentation.forceAdvance.done", {
      ...aiStudioSessionDebugSummary(advancedSession),
      durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
      fromStepId: session.currentStep
    });
    return advancedSession;
  } catch (error) {
    aiStudioSessionDebugLog("server.workflowPresentation.forceAdvance.error", {
      durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
      error: aiStudioSessionDebugError(error),
      sessionId: session.sessionId
    });
    throw error;
  }
}

async function runWorkflowIntent(runtime, sessionId = "", intentId = "", input = {}) {
  const session = await runtime.getSession(sessionId);
  const normalizedIntentId = normalizeText(intentId);
  const selectedIntent = selectedIntentById(session, normalizedIntentId);
  if (!selectedIntent) {
    throw aiStudioError(
      `Intent ${normalizedIntentId || "(empty)"} is not available on step ${session.currentStep || "(none)"}.`,
      "ai_studio_intent_not_available"
    );
  }
  if (selectedIntent.enabled !== true) {
    throw aiStudioError(
      selectedIntent.disabledReason || `Intent ${normalizedIntentId} is disabled.`,
      "ai_studio_intent_disabled"
    );
  }
  assertIntentMatchesCurrentState(session, input);

  const fields = intentFields(input);
  const operation = serverOperationForIntent(runtime, session, normalizedIntentId, selectedIntent);
  return runServerOperation(runtime, session, selectedIntent, operation, fields);
}

export {
  INTENT_IDS,
  METADATA_KEYS,
  applyWorkflowPresentation,
  runWorkflowIntent
};
