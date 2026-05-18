import {
  aiStudioError,
  normalizeText
} from "../core.js";
import { deepFreeze } from "../deepFreeze.js";
import {
  JSKIT_ADAPTER_MANIFEST
} from "./jskit/manifest.js";
import {
  CPP_ADAPTER_MANIFEST
} from "./cpp/manifest.js";
import {
  LARAVEL_ADAPTER_MANIFEST
} from "./laravel/manifest.js";
import {
  NEXTJS_ADAPTER_MANIFEST
} from "./nextjs/manifest.js";
import {
  VINEXT_ADAPTER_MANIFEST
} from "./vinext/manifest.js";

const DISABLED_ADAPTER_MANIFESTS = deepFreeze([
  {
    disabledReason: "Python adapter is not implemented yet.",
    enabled: false,
    id: "python",
    label: "Python"
  },
  {
    disabledReason: "Generic web adapter is not implemented yet.",
    enabled: false,
    id: "web",
    label: "Generic web"
  }
]);

const DEFAULT_ADAPTER_MANIFESTS = deepFreeze([
  JSKIT_ADAPTER_MANIFEST,
  CPP_ADAPTER_MANIFEST,
  LARAVEL_ADAPTER_MANIFEST,
  NEXTJS_ADAPTER_MANIFEST,
  VINEXT_ADAPTER_MANIFEST,
  ...DISABLED_ADAPTER_MANIFESTS
]);

function publicProjectType(definition = {}) {
  const techStack = Array.isArray(definition.techStack)
    ? definition.techStack.map(normalizeText).filter(Boolean)
    : [];
  return {
    bestFor: normalizeText(definition.bestFor),
    description: normalizeText(definition.description),
    disabledReason: normalizeText(definition.disabledReason),
    enabled: definition.enabled === true,
    id: normalizeText(definition.id),
    label: normalizeText(definition.label || definition.id),
    outcome: normalizeText(definition.outcome),
    projectUrl: normalizeText(definition.projectUrl),
    projectUrlLabel: normalizeText(definition.projectUrlLabel),
    summary: normalizeText(definition.summary),
    techStack
  };
}

function normalizeAdapterManifest(manifest = {}) {
  const definition = publicProjectType(manifest);
  return {
    ...definition,
    createAdapter: typeof manifest.createAdapter === "function" ? manifest.createAdapter : null
  };
}

function assertUniqueAdapterIds(definitions = []) {
  const seen = new Set();
  for (const definition of definitions) {
    if (!definition.id) {
      throw aiStudioError("AI Studio adapter manifest is missing an id.", "ai_studio_adapter_manifest_invalid");
    }
    if (seen.has(definition.id)) {
      throw aiStudioError(`Duplicate AI Studio adapter id: ${definition.id}.`, "ai_studio_adapter_manifest_duplicate");
    }
    seen.add(definition.id);
  }
}

function createAiStudioAdapterRegistry({
  adapterManifests = DEFAULT_ADAPTER_MANIFESTS
} = {}) {
  const definitions = adapterManifests.map(normalizeAdapterManifest);
  assertUniqueAdapterIds(definitions);

  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));

  function availableProjectTypes() {
    return definitions
      .filter((definition) => definition.enabled === true)
      .map(publicProjectType);
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
    if (typeof definition.createAdapter !== "function") {
      throw aiStudioError(
        `AI Studio project type has no adapter factory: ${definition.label}.`,
        "ai_studio_project_type_adapter_missing"
      );
    }
    return definition.createAdapter();
  }

  return Object.freeze({
    availableProjectTypes,
    createAdapter,
    projectTypeDefinition,
    requireImplementedProjectType: assertImplementedProjectType
  });
}

const AI_STUDIO_PROJECT_TYPES = deepFreeze(DEFAULT_ADAPTER_MANIFESTS.map(publicProjectType));

export {
  AI_STUDIO_PROJECT_TYPES,
  createAiStudioAdapterRegistry,
  DEFAULT_ADAPTER_MANIFESTS
};
