import {
  aiStudioError,
  normalizeText
} from "../core.js";
import { deepFreeze } from "../deepFreeze.js";

const AI_STUDIO_PROJECT_TYPES = deepFreeze([
  {
    enabled: true,
    id: "jskit",
    label: "JSKIT"
  },
  {
    disabledReason: "Python adapter is not implemented yet.",
    enabled: false,
    id: "python",
    label: "Python"
  },
  {
    disabledReason: "C++ adapter is not implemented yet.",
    enabled: false,
    id: "cpp",
    label: "C++"
  },
  {
    disabledReason: "Generic web adapter is not implemented yet.",
    enabled: false,
    id: "web",
    label: "Generic web"
  }
]);

const DEFAULT_ADAPTER_LOADERS = deepFreeze({
  jskit: async () => {
    const adapterModule = await import("./jskit/index.js");
    return adapterModule.createJskitTargetAdapter;
  }
});

function publicProjectType(definition = {}) {
  return {
    disabledReason: normalizeText(definition.disabledReason),
    enabled: definition.enabled === true,
    id: normalizeText(definition.id),
    label: normalizeText(definition.label || definition.id)
  };
}

function createAiStudioAdapterRegistry({
  adapterLoaders = DEFAULT_ADAPTER_LOADERS,
  projectTypes = AI_STUDIO_PROJECT_TYPES
} = {}) {
  const definitions = projectTypes.map(publicProjectType);
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const loadersById = new Map(Object.entries(adapterLoaders));

  function availableProjectTypes() {
    return definitions.map(publicProjectType);
  }

  function projectTypeDefinition(projectType) {
    return definitionsById.get(normalizeText(projectType)) || null;
  }

  function assertKnownProjectType(projectType) {
    const definition = projectTypeDefinition(projectType);
    if (!definition) {
      throw aiStudioError(
        `Unknown AI Studio project type: ${normalizeText(projectType) || "(empty)"}.`,
        "ai_studio_unknown_project_type"
      );
    }
    return definition;
  }

  function assertImplementedProjectType(projectType) {
    const definition = assertKnownProjectType(projectType);
    if (definition.enabled !== true) {
      throw aiStudioError(
        definition.disabledReason || `AI Studio project type is not implemented: ${definition.label}.`,
        "ai_studio_project_type_unimplemented"
      );
    }
    return definition;
  }

  async function createAdapter(projectType) {
    const definition = assertImplementedProjectType(projectType);
    const loadAdapterFactory = loadersById.get(definition.id);
    if (typeof loadAdapterFactory !== "function") {
      throw aiStudioError(
        `AI Studio project type has no adapter factory: ${definition.label}.`,
        "ai_studio_project_type_adapter_missing"
      );
    }
    const factory = await loadAdapterFactory();
    if (typeof factory !== "function") {
      throw aiStudioError(
        `AI Studio adapter loader did not return a factory: ${definition.label}.`,
        "ai_studio_project_type_adapter_invalid"
      );
    }
    return factory();
  }

  return Object.freeze({
    availableProjectTypes,
    createAdapter,
    projectTypeDefinition,
    requireImplementedProjectType: assertImplementedProjectType
  });
}

export {
  AI_STUDIO_PROJECT_TYPES,
  createAiStudioAdapterRegistry
};
