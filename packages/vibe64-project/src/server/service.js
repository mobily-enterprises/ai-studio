import path from "node:path";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server/runtime";
import {
  createVibe64SessionStore
} from "@local/vibe64-runtime/server/sessionStore";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES,
  normalizeRuntimeConfigKey,
  resolveRuntimeConfig,
  runtimeConfigEnv,
  runtimeConfigEnvViewModel,
  runtimeConfigKeyIsVibe64Reserved
} from "@local/vibe64-core/server/runtimeConfig";
import {
  readEnvUserValues,
  saveEnvUserValues
} from "@local/vibe64-core/server/envUserValues";
import {
  resolveStudioTargetRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  createStudioProjectContext,
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import {
  currentProjectLocalRoot,
  currentProjectRequestContext,
  currentProjectRuntimeRoot,
  currentProjectSessionSourceRoot,
  currentProjectSourceConfigRoot,
  currentProjectSourceRoot,
  currentProjectTargetRoot,
  runWithResolvedProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  resolveProjectRuntimeRoot,
  resolveSourceConfigRoot
} from "@local/vibe64-core/server/projectState";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  inspectGenesisEnvironment
} from "@local/vibe64-genesis/server";
import {
  PROJECT_TEMPLATES,
  applyProjectTemplate as materializeProjectTemplate,
  readProjectTemplates as readAvailableProjectTemplates
} from "./projectTemplates.js";
import {
  readPreviewApplicationIdentities as readStoredPreviewApplicationIdentities,
  savePreviewApplicationIdentities as saveStoredPreviewApplicationIdentities
} from "./previewApplicationIdentities.js";
import {
  materializeProjectEnvironmentFiles
} from "./projectEnvironmentFiles.js";

function resolveVibe64TargetRoot(targetRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: targetRoot
  });
}

function projectResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_project_request_failed",
    fallbackMessage: "Vibe64 project request failed."
  });
}

function catalogUnavailable() {
  return {
    errors: [{
      code: "vibe64_project_catalog_unavailable",
      message: "Project catalog operations are not available in local editor mode."
    }],
    ok: false
  };
}

function publicProject(project = {}, {
  context = null,
  selected = false
} = {}) {
  const projectRoot = context?.targetRoot || project.projectRoot || project.path || "";
  const slug = context?.slug || project.slug || project.name || path.basename(projectRoot);
  return {
    canonicalRepositoryPath: project.canonicalRepositoryPath || "",
    githubMirrorPath: project.githubMirrorPath || "",
    ...(project.githubRepository ? { githubRepository: project.githubRepository } : {}),
    name: slug,
    path: projectRoot,
    projectLocalRoot: context?.projectLocalRoot || project.projectLocalRoot || project.projectRuntimeRoot || "",
    projectRecordPath: context?.projectRecordPath || project.projectRecordPath || "",
    projectRoot,
    projectRuntimeRoot: context?.projectRuntimeRoot || project.projectRuntimeRoot || project.projectLocalRoot || "",
    projectSessionSourceRoot: context?.projectSessionSourceRoot || project.projectSessionSourceRoot || "",
    ...(project.repository ? { repository: project.repository } : {}),
    repositoryMode: project.repositoryMode || project.repository?.mode || "",
    runtime: project.runtime || null,
    selected: Boolean(selected),
    slug,
    source: project.source || "workspace",
    sourceConfigRoot: context?.sourceConfigRoot || project.sourceConfigRoot || "",
    sourceRoot: context?.sourceRoot || project.sourceRoot || ""
  };
}

function valuePresent(environment = {}, name = "", allowEmpty = []) {
  if (!Object.hasOwn(environment, name) || typeof environment[name] !== "string") {
    return false;
  }
  const value = environment[name].trim();
  if (value === `$${name}` || value === `\${${name}}`) {
    return false;
  }
  return value.length > 0 || allowEmpty.includes(name);
}

function requiredAlternative(resource = {}, environment = {}) {
  const alternatives = Array.isArray(resource.environmentAlternatives)
    ? resource.environmentAlternatives
    : [];
  const satisfied = alternatives.find((alternative) => (
    alternative.required.every((name) => valuePresent(environment, name, alternative.allowEmpty))
  ));
  if (satisfied) {
    return null;
  }
  return alternatives
    .map((alternative, index) => ({
      alternative,
      index,
      present: alternative.required.filter((name) => (
        valuePresent(environment, name, alternative.allowEmpty)
      )).length
    }))
    .sort((left, right) => right.present - left.present || left.index - right.index)[0]?.alternative || null;
}

function stackResourceRecords(resources = [], environment = {}) {
  const records = new Map();
  for (const declaration of resources) {
    const alternative = requiredAlternative(declaration.resource, environment);
    for (const key of alternative?.required || []) {
      if (records.has(key)) {
        continue;
      }
      records.set(key, {
        editable: true,
        key,
        materialize: false,
        owner: "user",
        requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        secret: undefined,
        source: `genesis-stack:${declaration.component}:${declaration.resource.id}`,
        value: ""
      });
    }
  }
  return [...records.values()];
}

function environmentRecord(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [String(key || "").trim(), String(entry ?? "")])
    .filter(([key]) => /^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)));
}

function systemEnvironmentRecords(environment = {}, {
  source = "system"
} = {}) {
  return Object.entries(environmentRecord(environment)).map(([key, value]) => ({
    editable: false,
    key,
    owner: "system",
    requiredFor: [],
    scope: RUNTIME_CONFIG_SCOPES.DEV,
    source,
    value,
    valuePresent: true
  }));
}

function declaredEnvironmentDefaults(defaults = []) {
  if (!Array.isArray(defaults)) {
    return {};
  }
  return environmentRecord(Object.fromEntries(defaults
    .filter((entry) => entry && typeof entry.name === "string" && typeof entry.value === "string")
    .map((entry) => [entry.name, entry.value])));
}

function genesisEnvironmentIsUnconfigured(error) {
  return error?.code === "STACK_REQUIRED";
}

function createService({
  env = process.env,
  inspectEnvironment = inspectGenesisEnvironment,
  projectContext = null,
  projectTemplates = PROJECT_TEMPLATES,
  runCommand = undefined,
  targetRoot = ""
} = {}) {
  let resourceEnvironmentProvider = null;
  const studioProjectContext = projectContext || (String(targetRoot || "").trim()
    ? createStudioProjectContext({
        explicitTargetRoot: targetRoot
      })
    : getStudioProjectContext());

  function selectedTargetRoot() {
    return String(currentProjectTargetRoot() || studioProjectContext.targetRoot || "").trim();
  }

  function requireSelectedTargetRoot() {
    const target = selectedTargetRoot();
    if (target) {
      return target;
    }
    return studioProjectContext.requireSelectedTargetRoot();
  }

  function selectedSourceRoot() {
    const requestSource = currentProjectSourceRoot();
    if (requestSource) {
      return requestSource;
    }
    const target = selectedTargetRoot();
    if (!target) {
      return "";
    }
    return typeof studioProjectContext.sourceRootForTarget === "function"
      ? studioProjectContext.sourceRootForTarget(target)
      : target;
  }

  function selectedSourceConfigRoot() {
    const requestRoot = currentProjectSourceConfigRoot();
    if (requestRoot) {
      return requestRoot;
    }
    const sourceRoot = selectedSourceRoot();
    if (!sourceRoot) {
      return "";
    }
    return typeof studioProjectContext.sourceConfigRootForTarget === "function" && sourceRoot === selectedTargetRoot()
      ? studioProjectContext.sourceConfigRootForTarget(sourceRoot)
      : resolveSourceConfigRoot({
          sourceRoot
        });
  }

  function selectedProjectRuntimeRoot() {
    const requestRoot = currentProjectRuntimeRoot() || currentProjectLocalRoot();
    if (requestRoot) {
      return requestRoot;
    }
    const target = selectedTargetRoot();
    if (!target) {
      return "";
    }
    if (typeof studioProjectContext.projectRuntimeRootForTarget === "function") {
      return studioProjectContext.projectRuntimeRootForTarget(target);
    }
    return resolveProjectRuntimeRoot({
      projectRoot: target
    });
  }

  function selectedSessionSourceRoot() {
    const requestRoot = currentProjectSessionSourceRoot();
    if (requestRoot) {
      return requestRoot;
    }
    const target = selectedTargetRoot();
    return target && typeof studioProjectContext.projectSessionSourceRootForTarget === "function"
      ? studioProjectContext.projectSessionSourceRootForTarget(target)
      : target;
  }

  function sessionStore() {
    const target = requireSelectedTargetRoot();
    return createVibe64SessionStore({
      projectLocalRoot: selectedProjectRuntimeRoot(),
      projectSessionSourceRoot: selectedSessionSourceRoot(),
      targetRoot: selectedSourceRoot() || target
    });
  }

  async function sourceForInput(input = {}) {
    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) {
      return {
        label: "Project baseline",
        rootKind: "project-root",
        sessionId: "",
        sourceRoot: selectedSourceRoot() || selectedTargetRoot()
      };
    }
    const session = await sessionStore().readSession(sessionId);
    return {
      label: "Session source",
      rootKind: "session-source",
      sessionId,
      sourceRoot: sessionSourcePath(session)
    };
  }

  async function userEnvRecords() {
    return (await readEnvUserValues({
      projectLocalRoot: selectedProjectRuntimeRoot()
    })).records;
  }

  async function resolvedProjectEnvironment(input = {}, userRecords = []) {
    const source = await sourceForInput(input);
    const projectRoot = source.sourceRoot;
    const userEnvironment = runtimeConfigEnv(userRecords, {
      scope: input.environment || input.scope || RUNTIME_CONFIG_SCOPES.DEV,
      target: input.target
    });
    if (!projectRoot) {
      return {
        effectiveEnvironment: {
          ...env,
          ...userEnvironment
        },
        environmentFiles: [],
        projectEnvironment: userEnvironment,
        resources: [],
        source,
        warning: ""
      };
    }
    let declaration;
    try {
      declaration = await inspectEnvironment({
        environment: {
          ...env,
          ...userEnvironment
        },
        projectRoot
      });
    } catch (error) {
      return {
        effectiveEnvironment: {
          ...env,
          ...userEnvironment
        },
        environmentFiles: [],
        projectEnvironment: userEnvironment,
        resources: [],
        source,
        warning: genesisEnvironmentIsUnconfigured(error)
          ? ""
          : String(error?.message || "")
      };
    }
    const provided = resourceEnvironmentProvider && source.sessionId && declaration.resources.length > 0
      ? await resourceEnvironmentProvider.environmentForResources({
          components: declaration.components,
          projectLocalRoot: selectedProjectRuntimeRoot(),
          resources: declaration.resources,
          serviceDataRoot: String(studioProjectContext.serviceDataRoot || "").trim(),
          sessionId: source.sessionId,
          sourceRoot: projectRoot,
          targetRoot: selectedTargetRoot()
        })
      : {};
    const platformEnvironment = environmentRecord(provided?.environment || provided);
    const defaultEnvironment = declaredEnvironmentDefaults(declaration.environmentDefaults);
    const projectEnvironment = {
      ...defaultEnvironment,
      ...userEnvironment,
      ...platformEnvironment
    };
    return {
      defaultEnvironment,
      effectiveEnvironment: {
        ...env,
        ...projectEnvironment
      },
      environmentFiles: declaration.files,
      platformEnvironment,
      projectEnvironment,
      resources: declaration.resources,
      source,
      warning: ""
    };
  }

  async function stackEnvRecords(input = {}, userRecords = []) {
    const resolved = await resolvedProjectEnvironment(input, userRecords);
    return {
      records: [
        ...systemEnvironmentRecords(resolved.defaultEnvironment, {
          source: "genesis-stack:default"
        }),
        ...systemEnvironmentRecords(resolved.platformEnvironment, {
          source: "vibe64-host:managed-resource"
        }),
        ...stackResourceRecords(resolved.resources, resolved.effectiveEnvironment)
      ],
      source: resolved.source,
      warning: resolved.warning
    };
  }

  async function envConfig(input = {}) {
    const userRecords = await userEnvRecords();
    const stack = await stackEnvRecords(input, userRecords);
    const config = await resolveRuntimeConfig([
      ...stack.records,
      ...userRecords
    ], {
      scope: input.environment || input.scope,
      target: input.target
    });
    return {
      config,
      stack
    };
  }

  async function readEnvState(input = {}) {
    const { config, stack } = await envConfig(input);
    return {
      env: {
        ...runtimeConfigEnvViewModel(config),
        configSource: {
          label: stack.source.label,
          rootKind: stack.source.rootKind,
          sessionId: stack.source.sessionId,
          sourceRoot: stack.source.sourceRoot
        },
        ...(stack.warning ? { stackWarning: stack.warning } : {})
      },
      ok: true
    };
  }

  async function saveEnvState(input = {}) {
    const values = input.values && typeof input.values === "object" && !Array.isArray(input.values)
      ? input.values
      : {};
    const { records } = await stackEnvRecords(input, await userEnvRecords());
    const stackKeys = new Set(records.map((record) => record.key));
    for (const key of Object.keys(values)) {
      const normalizedKey = normalizeRuntimeConfigKey(key);
      if (runtimeConfigKeyIsVibe64Reserved(normalizedKey) && !stackKeys.has(normalizedKey)) {
        const error = new Error(`${normalizedKey} is reserved for Vibe64 and is not declared by the Genesis Stack.`);
        error.code = "vibe64_env_reserved_key";
        throw error;
      }
    }
    await saveEnvUserValues({
      environment: input.environment || input.scope,
      projectLocalRoot: selectedProjectRuntimeRoot(),
      values
    });
    const resolved = await resolvedProjectEnvironment(input, await userEnvRecords());
    await materializeProjectEnvironmentFiles({
      environment: resolved.projectEnvironment,
      files: resolved.environmentFiles,
      sourceRoot: resolved.source.sourceRoot
    });
    return readEnvState(input);
  }

  async function listProjectsState() {
    const requestContext = currentProjectRequestContext();
    if (!requestContext?.targetRoot || studioProjectContext.requestContextMatchesSelectedProject(requestContext)) {
      const listed = await studioProjectContext.listProjects();
      const currentProject = listed.currentProject
        ? publicProject(listed.currentProject, {
            selected: true
          })
        : null;
      const projects = listed.projects.map((project) => publicProject(project, {
        selected: project.selected
      }));
      if (currentProject && !projects.some((project) => project.slug === currentProject.slug)) {
        projects.push(currentProject);
        projects.sort((left, right) => left.slug.localeCompare(right.slug));
      }
      return {
        ...listed,
        currentProject,
        projects
      };
    }
    const listed = await studioProjectContext.listWorkspaceProjects();
    const current = listed.projects.find((project) => project.slug === requestContext.slug) || {};
    const projects = listed.projects.map((project) => publicProject(project, {
      context: project.slug === requestContext.slug ? requestContext : null,
      selected: project.slug === requestContext.slug
    }));
    return {
      currentProject: publicProject(current, {
        context: requestContext,
        selected: true
      }),
      hasSelection: true,
      ok: true,
      projects,
      projectsRoot: requestContext.projectsRoot || listed.projectsRoot,
      targetRoot: requestContext.targetRoot
    };
  }

  async function currentProjectState() {
    const listed = await listProjectsState();
    return listed.currentProject || null;
  }

  async function templateContext(input = {}) {
    return {
      env,
      input,
      project: await currentProjectState(),
      projectRuntimeRoot: selectedProjectRuntimeRoot(),
      runCommand,
      sourceRoot: selectedSourceRoot(),
      targetRoot: selectedTargetRoot(),
      templates: projectTemplates
    };
  }

  async function promptEnvironment() {
    return (await resolvedProjectEnvironment({}, await userEnvRecords())).effectiveEnvironment;
  }

  async function previewApplicationIdentitiesState() {
    const { identities } = await readStoredPreviewApplicationIdentities({
      projectLocalRoot: selectedProjectRuntimeRoot()
    });
    return {
      identities,
      ok: true
    };
  }

  async function createRuntime(options = {}) {
    const target = requireSelectedTargetRoot();
    return new Vibe64SessionRuntime({
      createSessionSource: options.createSessionSource,
      inspectSourceByDefault: options.inspectSource !== false,
      projectLocalRoot: selectedProjectRuntimeRoot(),
      projectSessionSourceRoot: selectedSessionSourceRoot(),
      promptEnvironment: await promptEnvironment(),
      store: sessionStore(),
      targetRoot: selectedSourceRoot() || target
    });
  }

  async function runInProjectContext(slug = "", operation, {
    allowDeleting = false
  } = {}) {
    return runWithResolvedProjectRequestContext({
      projectContext: studioProjectContext,
      request: {
        allowDeleting,
        params: {
          slug
        }
      }
    }, operation);
  }

  return Object.freeze({
    get selectedProject() {
      return studioProjectContext.selectedProject;
    },

    get targetRoot() {
      return selectedTargetRoot();
    },

    async applyProjectTemplate(templateId = "", input = {}) {
      return projectResult(async () => materializeProjectTemplate({
        ...await templateContext(input),
        templateId
      }));
    },

    async createProject(input = {}) {
      if (studioProjectContext.runtimeProfile?.projectCatalogEnabled === false) {
        return catalogUnavailable();
      }
      return projectResult(() => studioProjectContext.createWorkspaceProject(input));
    },

    async createRuntime(options = {}) {
      return createRuntime(options);
    },

    async createSessionStore() {
      requireSelectedTargetRoot();
      return sessionStore();
    },

    async readSelectedSessionSource(input = {}) {
      const explicitTargetRoot = String(input.targetRoot || "").trim();
      const store = explicitTargetRoot
        ? createVibe64SessionStore({
            projectLocalRoot: String(input.projectRuntimeRoot || input.projectLocalRoot || "").trim(),
            projectSessionSourceRoot: String(input.projectSessionSourceRoot || explicitTargetRoot).trim(),
            targetRoot: explicitTargetRoot
          })
        : sessionStore();
      const session = await store.readCurrentSession();
      if (!session) {
        return null;
      }
      const sourceRoot = sessionSourcePath(session);
      if (!sourceRoot) {
        throw vibe64Error(
          `The selected session ${session.sessionId} has no usable source.`,
          "vibe64_selected_session_source_unavailable"
        );
      }
      return {
        sessionId: session.sessionId,
        sourceRoot
      };
    },

    currentProjectLocalRoot: selectedProjectRuntimeRoot,
    currentProjectRuntimeRoot: selectedProjectRuntimeRoot,
    currentProjectSessionSourceRoot: selectedSessionSourceRoot,
    currentProjectSourceConfigRoot: selectedSourceConfigRoot,
    currentProjectSourceRoot: selectedSourceRoot,
    currentServiceDataRoot() {
      return String(studioProjectContext.serviceDataRoot || "").trim();
    },
    currentTargetRoot: selectedTargetRoot,

    async listProjects() {
      return projectResult(() => listProjectsState());
    },

    async projectExecutionEnvironment(input = {}) {
      const resolved = await resolvedProjectEnvironment(input, await userEnvRecords());
      await materializeProjectEnvironmentFiles({
        environment: resolved.projectEnvironment,
        files: resolved.environmentFiles,
        sourceRoot: resolved.source.sourceRoot
      });
      return resolved.projectEnvironment;
    },

    async readCurrentProject() {
      return currentProjectState();
    },

    async readEnv(input = {}) {
      return projectResult(() => readEnvState(input));
    },

    async readPreviewApplicationIdentities() {
      return projectResult(() => previewApplicationIdentitiesState());
    },

    async readProjectTemplates(input = {}) {
      return projectResult(async () => readAvailableProjectTemplates(await templateContext(input)));
    },

    async releaseSessionResources(input = {}) {
      const sessionId = String(input.sessionId || "").trim();
      if (!sessionId || typeof resourceEnvironmentProvider?.removeSessionResources !== "function") {
        return { ok: true };
      }
      const source = await sourceForInput({ sessionId });
      return resourceEnvironmentProvider.removeSessionResources({
        projectLocalRoot: selectedProjectRuntimeRoot(),
        sessionId,
        serviceDataRoot: String(studioProjectContext.serviceDataRoot || "").trim(),
        sourceRoot: source.sourceRoot,
        targetRoot: selectedTargetRoot()
      });
    },

    requireSelectedTargetRoot,
    runInProjectContext,

    setResourceEnvironmentProvider(provider = null) {
      if (
        provider !== null &&
        (!provider || typeof provider !== "object" || typeof provider.environmentForResources !== "function")
      ) {
        throw new TypeError("Vibe64 resource environment provider must expose environmentForResources() or be null.");
      }
      resourceEnvironmentProvider = provider;
    },

    async saveEnvUserValues(input = {}) {
      return projectResult(() => saveEnvState(input));
    },

    async savePreviewApplicationIdentities(input = {}) {
      return projectResult(async () => {
        const { identities } = await saveStoredPreviewApplicationIdentities({
          identities: input.identities,
          projectLocalRoot: selectedProjectRuntimeRoot()
        });
        return {
          identities,
          ok: true
        };
      });
    },

    async selectProject(input = {}) {
      if (studioProjectContext.runtimeProfile?.projectCatalogEnabled === false) {
        return catalogUnavailable();
      }
      return projectResult(() => studioProjectContext.selectWorkspaceProject(input));
    }
  });
}

export {
  createService,
  resolveVibe64TargetRoot
};
