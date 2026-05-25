import { deepFreeze } from "./deepFreeze.js";

const AI_STUDIO_WORKFLOW_PROFILE_IDS = deepFreeze({
  BIG_FEATURE: "big_feature",
  GENERAL_CODING: "general_coding",
  SEED_APPLICATION: "seed_application"
});

const DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID = AI_STUDIO_WORKFLOW_PROFILE_IDS.BIG_FEATURE;

export {
  AI_STUDIO_WORKFLOW_PROFILE_IDS,
  DEFAULT_AI_STUDIO_WORKFLOW_PROFILE_ID
};
