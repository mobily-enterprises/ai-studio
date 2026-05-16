import {
  assertSafeActionId,
  createAiStudioSessionStore
} from "./sessionStore.js";
import {
  aiStudioError,
  normalizeText
} from "./core.js";
import { DEFAULT_AI_STUDIO_WORKFLOW } from "./workflow.js";
import { WorkflowMachine } from "./workflowMachine.js";

function defaultActionHandler({ action }) {
  return {
    message: `Recorded ${action.label}.`,
    status: "completed"
  };
}

function actionNotAvailableError(session, actionId) {
  return aiStudioError(
    `Action ${actionId} is not available on step ${session.currentStep || "(none)"}.`,
    "ai_studio_action_not_available"
  );
}

function actionDisabledError(action) {
  return aiStudioError(
    action.disabledReason || `Action ${action.id} is disabled.`,
    "ai_studio_action_disabled"
  );
}

function currentAction(session, actionId) {
  return session.actions.find((action) => action.id === actionId) || null;
}

function actionResultRecord(action, session, input, handlerResult = {}) {
  const result = handlerResult || {};
  return {
    actionLabel: action.label,
    actionType: action.type,
    input,
    message: normalizeText(result.message),
    status: normalizeText(result.status || "completed"),
    stepId: session.currentStep
  };
}

function actionLogEntry(action, session, actionResult) {
  return {
    actionId: action.id,
    actionLabel: action.label,
    actionType: action.type,
    kind: "action",
    status: actionResult.status,
    stepId: session.currentStep
  };
}

class AiStudioSessionRuntime {
  constructor({
    actionHandlers = {},
    clock = undefined,
    defaultHandler = defaultActionHandler,
    store = undefined,
    targetRoot = process.cwd(),
    workflow = DEFAULT_AI_STUDIO_WORKFLOW
  } = {}) {
    this.actionHandlers = {
      ...actionHandlers
    };
    this.defaultHandler = typeof defaultHandler === "function"
      ? defaultHandler
      : defaultActionHandler;
    this.workflowMachine = new WorkflowMachine({
      workflow
    });
    this.store = store || createAiStudioSessionStore({
      clock,
      targetRoot
    });
  }

  async createSession(input = {}) {
    const initialStep = input.initialStep
      ? this.workflowMachine.assertStepId(input.initialStep)
      : this.workflowMachine.firstStepId();
    const session = await this.store.createSession({
      ...input,
      initialStep
    });
    return this.workflowMachine.buildSessionView(session);
  }

  async getSession(sessionId) {
    return this.workflowMachine.buildSessionView(await this.store.readSession(sessionId));
  }

  async listSessions() {
    return (await this.store.listSessions()).map((session) => {
      return this.workflowMachine.buildSessionView(session);
    });
  }

  actionHandler(actionId) {
    return this.actionHandlers[actionId] || this.defaultHandler;
  }

  async runAction(sessionId, actionId, input = {}) {
    const normalizedActionId = assertSafeActionId(actionId);
    const session = await this.getSession(sessionId);
    const action = currentAction(session, normalizedActionId);
    if (!action) {
      throw actionNotAvailableError(session, normalizedActionId);
    }
    if (!action.enabled) {
      throw actionDisabledError(action);
    }

    const handlerResult = await this.actionHandler(action.id)({
      action,
      input,
      runtime: this,
      session,
      store: this.store
    });
    const actionResult = await this.store.writeActionResult(
      session.sessionId,
      action.id,
      actionResultRecord(action, session, input, handlerResult)
    );
    await this.store.appendCommandLogEntry(
      session.sessionId,
      actionLogEntry(action, session, actionResult)
    );

    return {
      ...await this.getSession(session.sessionId),
      actionResult
    };
  }

  async advance(sessionId) {
    const session = await this.getSession(sessionId);
    if (!session.next.visible || !session.next.enabled || !session.next.stepId) {
      const error = new Error(session.next.disabledReason || "Current AI Studio step cannot advance.");
      error.code = "ai_studio_step_not_ready";
      throw error;
    }
    await this.store.writeCompletedStep(session.sessionId, session.currentStep, {
      message: `Advanced from ${session.currentStep} to ${session.next.stepId}.`
    });
    await this.store.writeCurrentStep(session.sessionId, session.next.stepId);
    return this.getSession(session.sessionId);
  }
}

export {
  AiStudioSessionRuntime
};
