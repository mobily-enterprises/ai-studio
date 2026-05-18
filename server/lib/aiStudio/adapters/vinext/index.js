import {
  VINEXT_CONFIG_FIELDS,
  VINEXT_MARKERS,
  VINEXT_PROMPT_PACK_ROOT,
  VinextTargetAdapter
} from "./adapter.js";
import {
  deepFreeze
} from "../../deepFreeze.js";
import {
  AI_STUDIO_WORKFLOW_COMMANDS,
  createAiStudioWorkflowCommandTerminalSpec
} from "../../workflowAdapter.js";
import {
  createVinextAppReviewTerminalSpec,
  createVinextReviewDescriptor
} from "./appReviewTerminal.js";

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createVinextTargetScriptTerminalSpec,
  inspectVinextCurrentApp,
  inspectVinextTargetScripts
} from "./currentApp.js";
export {
  VINEXT_PROJECT_KNOWLEDGE_RELATIVE_PATH,
  VINEXT_REVIEW_MODE_CONFIG
} from "./constants.js";

const VINEXT_AI_STUDIO_COMMANDS = deepFreeze(AI_STUDIO_WORKFLOW_COMMANDS);
const createVinextAiStudioCommandTerminalSpec = createAiStudioWorkflowCommandTerminalSpec;

function createVinextTargetAdapter({
  appReviewTerminalSpecFactory = createVinextAppReviewTerminalSpec,
  commandTerminalSpecFactory = null
} = {}) {
  return new VinextTargetAdapter({
    appReviewTerminalSpecFactory,
    commandTerminalSpecFactory,
    commands: VINEXT_AI_STUDIO_COMMANDS
  });
}

export {
  createVinextAiStudioCommandTerminalSpec,
  createVinextAppReviewTerminalSpec,
  createVinextReviewDescriptor,
  createVinextTargetAdapter,
  VINEXT_AI_STUDIO_COMMANDS,
  VINEXT_CONFIG_FIELDS,
  VINEXT_MARKERS,
  VINEXT_PROMPT_PACK_ROOT,
  VinextTargetAdapter
};
