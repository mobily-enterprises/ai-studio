import {
  normalizeText
} from "@local/vibe64-core/server/core";

const WORKSPACE_SETUP_METADATA_NAME = "workspace_setup";
const WORKSPACE_SETUP_DIAGNOSTIC_MAX_LENGTH = 1600;
const WORKSPACE_SETUP_STATUSES = new Set([
  "ambiguous",
  "failed",
  "running",
  "succeeded",
  "unconfigured"
]);

function boundedText(value = "", maxLength = undefined) {
  const normalized = normalizeText(value);
  return Number.isSafeInteger(maxLength)
    ? normalized.slice(0, maxLength)
    : normalized;
}

function workspaceSetupState(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const status = normalizeText(source.status);
  return {
    currentLabel: boundedText(source.currentLabel, 160),
    diagnostic: boundedText(source.diagnostic, WORKSPACE_SETUP_DIAGNOSTIC_MAX_LENGTH),
    finishedAt: normalizeText(source.finishedAt),
    recipeHash: boundedText(source.recipeHash, 128),
    startedAt: normalizeText(source.startedAt),
    status: WORKSPACE_SETUP_STATUSES.has(status) ? status : "unconfigured",
    updatedAt: normalizeText(source.updatedAt)
  };
}

function workspaceSetupStateFromMetadata(metadata = {}) {
  const serialized = normalizeText(metadata?.[WORKSPACE_SETUP_METADATA_NAME]);
  if (!serialized) {
    return workspaceSetupState();
  }
  try {
    return workspaceSetupState(JSON.parse(serialized));
  } catch {
    return workspaceSetupState({
      diagnostic: "Stored workspace preparation status is invalid.",
      status: "failed"
    });
  }
}

function publicSessionMetadata(metadata = {}) {
  return Object.fromEntries(Object.entries(
    metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}
  ).filter(([name]) => name !== WORKSPACE_SETUP_METADATA_NAME));
}

async function writeWorkspaceSetupState(store, sessionId = "", value = {}) {
  const state = workspaceSetupState(value);
  await store.writeMetadataValue(
    sessionId,
    WORKSPACE_SETUP_METADATA_NAME,
    JSON.stringify(state)
  );
  return state;
}

export {
  WORKSPACE_SETUP_METADATA_NAME,
  publicSessionMetadata,
  workspaceSetupState,
  workspaceSetupStateFromMetadata,
  writeWorkspaceSetupState
};
