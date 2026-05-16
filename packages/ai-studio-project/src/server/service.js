import path from "node:path";
import process from "node:process";

import {
  AiStudioSessionRuntime,
  createAiStudioAdapterRegistry,
  createAiStudioProjectTypeStore
} from "../../../../server/lib/aiStudio/index.js";

function resolveAiStudioTargetRoot(targetRoot) {
  const configuredRoot = String(targetRoot || process.env.JSKIT_STUDIO_TARGET_ROOT || "").trim();
  return path.resolve(configuredRoot || process.cwd());
}

function aiStudioErrorResponse(error, fallback = "AI Studio project request failed.") {
  return {
    errors: [
      {
        code: String(error?.code || "ai_studio_project_request_failed"),
        message: String(error?.message || error || fallback)
      }
    ],
    ok: false,
    projectType: error?.projectType || null
  };
}

async function aiStudioResult(operation) {
  try {
    return await operation();
  } catch (error) {
    return aiStudioErrorResponse(error);
  }
}

function projectTypeErrorCode(status = "") {
  return {
    missing: "ai_studio_project_type_missing",
    unimplemented: "ai_studio_project_type_unimplemented",
    unknown: "ai_studio_unknown_project_type"
  }[status] || "ai_studio_project_type_invalid";
}

function projectTypeMessage(status = "", projectType = "") {
  if (status === "missing") {
    return "Choose an AI Studio project type before using project-specific tools.";
  }
  if (status === "unknown") {
    return `Unknown AI Studio project type: ${projectType}.`;
  }
  if (status === "unimplemented") {
    return `AI Studio project type is not implemented yet: ${projectType}.`;
  }
  return "AI Studio project type is not ready.";
}

function createService({ targetRoot = "" } = {}) {
  const resolvedTargetRoot = resolveAiStudioTargetRoot(targetRoot);
  const adapterRegistry = createAiStudioAdapterRegistry();
  const projectTypeStore = createAiStudioProjectTypeStore({
    targetRoot: resolvedTargetRoot
  });

  async function readProjectTypeState() {
    const projectType = await projectTypeStore.readProjectType();
    const definition = adapterRegistry.projectTypeDefinition(projectType);
    const status = projectType
      ? definition
        ? definition.enabled
          ? "ready"
          : "unimplemented"
        : "unknown"
      : "missing";
    const ready = status === "ready";
    return {
      adapter: ready
        ? {
            id: definition.id,
            label: definition.label
          }
        : null,
      availableProjectTypes: adapterRegistry.availableProjectTypes(),
      errorCode: ready ? "" : projectTypeErrorCode(status),
      message: ready ? "" : (definition?.disabledReason || projectTypeMessage(status, projectType)),
      path: projectTypeStore.path,
      projectType,
      ready,
      status
    };
  }

  async function requireProjectType() {
    const projectType = await readProjectTypeState();
    if (!projectType.ready) {
      const error = new Error(projectType.message);
      error.code = projectType.errorCode;
      error.projectType = projectType;
      throw error;
    }
    return projectType;
  }

  async function saveProjectTypeState(input = {}) {
    const projectType = String(input?.projectType || "").trim();
    adapterRegistry.requireImplementedProjectType(projectType);
    await projectTypeStore.writeProjectType(projectType);
    return readProjectTypeState();
  }

  async function createRuntime() {
    const projectType = await requireProjectType();
    const adapter = await adapterRegistry.createAdapter(projectType.projectType);
    return new AiStudioSessionRuntime({
      adapter,
      targetRoot: resolvedTargetRoot
    });
  }

  return Object.freeze({
    async createRuntime() {
      return createRuntime();
    },

    async readProjectType() {
      return aiStudioResult(async () => {
        return {
          ok: true,
          projectType: await readProjectTypeState()
        };
      });
    },

    async requireProjectType() {
      return requireProjectType();
    },

    async saveProjectType(input = {}) {
      return aiStudioResult(async () => {
        return {
          ok: true,
          projectType: await saveProjectTypeState(input)
        };
      });
    },

    targetRoot: resolvedTargetRoot
  });
}

export {
  createService,
  resolveAiStudioTargetRoot
};
