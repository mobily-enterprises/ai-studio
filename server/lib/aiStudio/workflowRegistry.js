import {
  aiStudioError,
  isPlainObject,
  normalizeText,
  plainClone
} from "./core.js";
import { deepFreeze } from "./deepFreeze.js";

const AI_STUDIO_CORE_WORKFLOW_MODULE_ID = "core";

function normalizeWorkflowModuleId(moduleId = "") {
  const normalizedModuleId = normalizeText(moduleId);
  if (!normalizedModuleId) {
    throw aiStudioError(
      "AI Studio workflow modules require an id.",
      "ai_studio_workflow_module_invalid"
    );
  }
  return normalizedModuleId;
}

function normalizeWorkflowStepContribution(moduleId = "", contribution = {}, index = 0) {
  const contributionObject = isPlainObject(contribution) ? contribution : {};
  const definition = isPlainObject(contributionObject.definition)
    ? contributionObject.definition
    : null;
  const machine = isPlainObject(contributionObject.machine)
    ? contributionObject.machine
    : null;
  const stepId = normalizeText(contributionObject.id || definition?.id || machine?.stepId);
  const context = `${moduleId} step ${index + 1}`;

  if (!stepId) {
    throw aiStudioError(
      `AI Studio workflow ${context} requires a step id.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (!definition && !machine) {
    throw aiStudioError(
      `AI Studio workflow ${context} must register a definition or machine.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (definition && normalizeText(definition.id) !== stepId) {
    throw aiStudioError(
      `AI Studio workflow ${context} definition id does not match ${stepId}.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (machine && normalizeText(machine.stepId) !== stepId) {
    throw aiStudioError(
      `AI Studio workflow ${context} machine step id does not match ${stepId}.`,
      "ai_studio_workflow_module_invalid"
    );
  }

  return {
    definition: definition ? deepFreeze(plainClone(definition)) : null,
    id: stepId,
    machine
  };
}

function normalizeWorkflowContribution(moduleId = "", contribution = {}, index = 0) {
  const workflow = isPlainObject(contribution) ? plainClone(contribution) : {};
  const workflowId = normalizeText(workflow.id);
  const context = `${moduleId} workflow ${index + 1}`;
  const stepIds = Array.isArray(workflow.stepIds)
    ? workflow.stepIds.map(normalizeText).filter(Boolean)
    : [];

  if (!workflowId) {
    throw aiStudioError(
      `AI Studio workflow ${context} requires an id.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (stepIds.length === 0) {
    throw aiStudioError(
      `AI Studio workflow ${context} must list at least one step.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  if (stepIds.length !== new Set(stepIds).size) {
    throw aiStudioError(
      `AI Studio workflow ${workflowId} has duplicate step ids.`,
      "ai_studio_workflow_module_invalid"
    );
  }

  return deepFreeze({
    ...workflow,
    id: workflowId,
    stepIds
  });
}

function defineWorkflowModule(module = {}) {
  const moduleId = normalizeWorkflowModuleId(module.id);
  const steps = Array.isArray(module.steps) ? module.steps : [];
  const workflows = Array.isArray(module.workflows) ? module.workflows : [];
  if (steps.length === 0 && workflows.length === 0) {
    throw aiStudioError(
      `AI Studio workflow module ${moduleId} must register steps or workflows.`,
      "ai_studio_workflow_module_invalid"
    );
  }
  return deepFreeze({
    id: moduleId,
    steps: steps.map((step, index) => normalizeWorkflowStepContribution(moduleId, step, index)),
    workflows: workflows.map((workflow, index) => normalizeWorkflowContribution(moduleId, workflow, index))
  });
}

function createWorkflowRegistry() {
  const stepRecords = new Map();
  const workflowRecords = new Map();

  function registerStepContribution(moduleId = "", contribution = {}) {
    const existing = stepRecords.get(contribution.id);
    if (existing && existing.moduleId !== moduleId) {
      throw aiStudioError(
        `AI Studio workflow step ${contribution.id} is already registered by module ${existing.moduleId}.`,
        "ai_studio_workflow_step_duplicate"
      );
    }
    if (existing?.definition && contribution.definition) {
      throw aiStudioError(
        `AI Studio workflow step ${contribution.id} already has a registered definition.`,
        "ai_studio_workflow_step_duplicate"
      );
    }
    if (existing?.machine && contribution.machine) {
      throw aiStudioError(
        `AI Studio workflow step ${contribution.id} already has a registered machine.`,
        "ai_studio_workflow_step_duplicate"
      );
    }
    stepRecords.set(contribution.id, Object.freeze({
      definition: contribution.definition || existing?.definition || null,
      id: contribution.id,
      machine: contribution.machine || existing?.machine || null,
      moduleId
    }));
  }

  function registerWorkflowContribution(moduleId = "", workflow = {}) {
    const existing = workflowRecords.get(workflow.id);
    if (existing) {
      throw aiStudioError(
        `AI Studio workflow ${workflow.id} is already registered by module ${existing.moduleId}.`,
        "ai_studio_workflow_duplicate"
      );
    }
    const missingStepIds = workflow.stepIds.filter((stepId) => !stepRecords.get(stepId)?.definition);
    if (missingStepIds.length > 0) {
      throw aiStudioError(
        `AI Studio workflow ${workflow.id} references unregistered steps: ${missingStepIds.join(", ")}.`,
        "ai_studio_workflow_unknown_step"
      );
    }
    workflowRecords.set(workflow.id, Object.freeze({
      definition: workflow,
      id: workflow.id,
      moduleId
    }));
  }

  function registerModule(module = {}) {
    const normalizedModule = defineWorkflowModule(module);
    normalizedModule.steps.forEach((step) => registerStepContribution(normalizedModule.id, step));
    normalizedModule.workflows.forEach((workflow) => registerWorkflowContribution(normalizedModule.id, workflow));
    return normalizedModule;
  }

  function definitionForStep(stepId = "") {
    const definition = stepRecords.get(normalizeText(stepId))?.definition || null;
    return plainClone(definition);
  }

  function definitionForWorkflow(workflowId = "") {
    const definition = workflowRecords.get(normalizeText(workflowId))?.definition || null;
    return plainClone(definition);
  }

  function presentationForStep(stepId = "") {
    return plainClone(stepRecords.get(normalizeText(stepId))?.definition?.presentation || null);
  }

  function machineForStep(stepId = "") {
    return stepRecords.get(normalizeText(stepId))?.machine || null;
  }

  function registeredStepRecords() {
    return Array.from(stepRecords.values())
      .map((record) => ({
        hasDefinition: Boolean(record.definition),
        hasMachine: Boolean(record.machine),
        id: record.id,
        moduleId: record.moduleId
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function registeredWorkflowRecords() {
    return Array.from(workflowRecords.values())
      .map((record) => ({
        id: record.id,
        moduleId: record.moduleId,
        stepIds: [...record.definition.stepIds]
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function workflowDefinitionsById() {
    return Object.fromEntries(Array.from(workflowRecords.values())
      .map((record) => [record.id, plainClone(record.definition)])
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId)));
  }

  return Object.freeze({
    definitionForStep,
    definitionForWorkflow,
    machineForStep,
    presentationForStep,
    registeredStepRecords,
    registeredWorkflowRecords,
    registerModule,
    workflowDefinitionsById
  });
}

const workflowRegistry = createWorkflowRegistry();

function registerWorkflowModule(module = {}) {
  return workflowRegistry.registerModule(module);
}

function registeredWorkflowStepRecords() {
  return workflowRegistry.registeredStepRecords();
}

function registeredWorkflowRecords() {
  return workflowRegistry.registeredWorkflowRecords();
}

function registeredWorkflowDefinitionsById() {
  return workflowRegistry.workflowDefinitionsById();
}

function workflowDefinitionForProfile(profileId = "") {
  return workflowRegistry.definitionForWorkflow(profileId);
}

function workflowStepDefinitionForStep(stepId = "") {
  return workflowRegistry.definitionForStep(stepId);
}

function workflowStepMachineForStep(stepId = "") {
  return workflowRegistry.machineForStep(stepId);
}

function workflowStepPresentationForStep(stepId = "") {
  return workflowRegistry.presentationForStep(stepId);
}

export {
  AI_STUDIO_CORE_WORKFLOW_MODULE_ID,
  createWorkflowRegistry,
  defineWorkflowModule,
  registeredWorkflowDefinitionsById,
  registeredWorkflowRecords,
  registeredWorkflowStepRecords,
  registerWorkflowModule,
  workflowDefinitionForProfile,
  workflowStepDefinitionForStep,
  workflowStepMachineForStep,
  workflowStepPresentationForStep
};
