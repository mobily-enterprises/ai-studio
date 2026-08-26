import {
  stopDetachedExecution
} from "./engines/detached.js";
import {
  stopPtyExecution
} from "./engines/pty.js";
import {
  commandErrorResult
} from "./result.js";

let installedProvider = null;
const VIBE64_MANAGED_EXECUTION_REQUIRED_ENV = "VIBE64_MANAGED_EXECUTION_REQUIRED";

function installVibe64ManagedExecutionProvider(provider = null) {
  if (!provider || typeof provider.runCommand !== "function" || typeof provider.stopExecution !== "function") {
    throw new TypeError("A managed execution provider requires runCommand and stopExecution operations.");
  }
  if (installedProvider && installedProvider !== provider) {
    throw new Error("A managed execution provider is already installed.");
  }
  installedProvider = provider;
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    if (installedProvider === provider) {
      installedProvider = null;
    }
  };
}

function vibe64ManagedExecutionProvider() {
  return installedProvider;
}

function vibe64ManagedExecutionRequired(env = process.env) {
  return ["1", "true"].includes(String(env?.[VIBE64_MANAGED_EXECUTION_REQUIRED_ENV] || "")
    .trim()
    .toLowerCase());
}

function vibe64CapacityRejectedResult(execution = {}, {
  code = "vibe64_capacity_rejected",
  estimatedMemoryBytes = 0,
  message = "This work cannot start while available memory is this low.",
  safelyAvailableMemoryBytes = 0
} = {}) {
  return commandErrorResult(message, code, {
    execution: {
      estimatedMemoryBytes: Math.max(0, Number(estimatedMemoryBytes) || 0),
      id: String(execution.id || "").trim(),
      kind: String(execution.kind || "").trim(),
      outcome: "capacity_rejected",
      safelyAvailableMemoryBytes: Math.max(0, Number(safelyAvailableMemoryBytes) || 0),
      state: "rejected"
    },
    retryable: false
  });
}

async function stopVibe64Execution(executionId = "", options = {}) {
  const normalizedExecutionId = String(executionId || "").trim();
  if (!normalizedExecutionId) {
    return {
      code: "vibe64_execution_id_required",
      error: "An execution id is required.",
      ok: false
    };
  }
  if (installedProvider) {
    return installedProvider.stopExecution(normalizedExecutionId, options);
  }
  const detached = await stopDetachedExecution(normalizedExecutionId, options);
  if (detached.code !== "vibe64_execution_not_found") {
    return detached;
  }
  return stopPtyExecution(normalizedExecutionId, options);
}

export {
  VIBE64_MANAGED_EXECUTION_REQUIRED_ENV,
  installVibe64ManagedExecutionProvider,
  stopVibe64Execution,
  vibe64CapacityRejectedResult,
  vibe64ManagedExecutionProvider,
  vibe64ManagedExecutionRequired
};
