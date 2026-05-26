import {
  registerWorkflowStepFactories,
  registerWorkflowSteps,
  registerWorkflows
} from "./workflowRegistry.js";
import {
  coreWorkflowStepFactories
} from "./workflowStepFactories.js";
import {
  coreCodingWorkflowModule
} from "./workflowModules/coreCoding.js";
import {
  coreLifecycleWorkflowModule
} from "./workflowModules/coreLifecycle.js";
import {
  coreMaintenanceWorkflowModule
} from "./workflowModules/coreMaintenance.js";

const coreWorkflowModules = [
  coreLifecycleWorkflowModule,
  coreCodingWorkflowModule,
  coreMaintenanceWorkflowModule
];

registerWorkflowStepFactories(coreWorkflowStepFactories.id, coreWorkflowStepFactories.factories);

coreWorkflowModules.forEach((module) => {
  registerWorkflowSteps(module.id, module.steps);
});

coreWorkflowModules.forEach((module) => {
  if (module.workflowDefinitions.length > 0) {
    registerWorkflows(module.id, module.workflowDefinitions);
  }
});
