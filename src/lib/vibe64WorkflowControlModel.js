function arrayItems(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeControlList(controls = []) {
  return arrayItems(controls).filter((control) => control && control.id && control.label);
}

function currentStepPresentationControls({
  interaction = {},
  session = {}
} = {}) {
  const sources = [
    session?.intents,
    session?.presentation?.intents,
    interaction?.intents
  ];
  for (const source of sources) {
    const controls = normalizeControlList(source);
    if (controls.length > 0) {
      return controls;
    }
  }
  return [];
}

function actionWorkflowControl(action = {}) {
  const sourceAction = objectValue(action);
  const id = String(sourceAction?.id || "").trim();
  const inputFields = arrayItems(sourceAction?.inputFields);
  if (!sourceAction || !id || sourceAction.visible === false || inputFields.length < 1) {
    return null;
  }
  return {
    actionId: id,
    disabledReason: String(sourceAction.disabledReason || ""),
    enabled: sourceAction.enabled === true,
    id,
    inputFields,
    label: String(sourceAction.label || id),
    sourceAction,
    style: sourceAction.style || "primary"
  };
}

function actionWorkflowControls(actions = []) {
  return arrayItems(actions)
    .map(actionWorkflowControl)
    .filter(Boolean);
}

function currentStepWorkflowControls({
  actions = [],
  interaction = {},
  session = {}
} = {}) {
  const presentationControls = currentStepPresentationControls({
    interaction,
    session
  });
  return presentationControls.length > 0
    ? presentationControls
    : actionWorkflowControls(actions);
}

function workflowControlSourceAction(control = {}) {
  return objectValue(control?.sourceAction);
}

export {
  actionWorkflowControl,
  actionWorkflowControls,
  currentStepPresentationControls,
  currentStepWorkflowControls,
  workflowControlSourceAction
};
