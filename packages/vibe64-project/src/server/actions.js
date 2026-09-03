import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";

import {
  projectCollaborationInputValidator,
  projectCreateInputValidator,
  projectDevelopmentDatabaseScopeInputValidator,
  projectEngineeringProfileInputValidator,
  projectEngineeringSettingsReadInputValidator,
  projectEnvReadInputValidator,
  projectEnvUserValuesInputValidator,
  projectsReadInputValidator,
  projectSelectInputValidator,
  projectSettingsReadInputValidator,
  projectPromptHintsInputValidator,
  previewApplicationIdentitiesInputValidator,
  previewApplicationIdentitiesReadInputValidator
} from "./inputSchemas.js";

const ACTION_CREATE_PROJECT = "vibe64.project.projects.create";
const ACTION_LIST_PROJECTS = "vibe64.project.projects.list";
const ACTION_SELECT_PROJECT = "vibe64.project.projects.select";
const ACTION_READ_ENV = "vibe64.project.env.read";
const ACTION_SAVE_ENV_USER_VALUES = "vibe64.project.env.user-values.save";
const ACTION_READ_PROJECT_SETTINGS = "vibe64.project.settings.read";
const ACTION_READ_ENGINEERING_SETTINGS = "vibe64.project.engineering.read";
const ACTION_SAVE_COLLABORATION_SETTINGS = "vibe64.project.collaboration.save";
const ACTION_SAVE_ENGINEERING_PROFILE = "vibe64.project.engineering.profile.save";
const ACTION_SAVE_PROJECT_PROMPT_HINTS = "vibe64.project.prompt-hints.save";
const ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE = "vibe64.project.development-database.scope.save";
const ACTION_READ_PREVIEW_APPLICATION_IDENTITIES = "vibe64.project.preview-identities.read";
const ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES = "vibe64.project.preview-identities.save";
const VIBE64_PROJECT_CHANGED_EVENT = "vibe64.project.changed";

function projectChangedEvent({ operation = "updated" } = {}) {
  return createEntityChangedActionEvent({
    source: "vibe64",
    entity: "project",
    operation,
    entityId: ({ input, result }) => result?.ok === false
      ? null
      : projectSlug(result) || projectSlug(input) || "projects",
    realtime: {
      audience: "all_clients",
      event: VIBE64_PROJECT_CHANGED_EVENT,
      payload: ({ result }) => projectRealtimePayload(result)
    }
  });
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function projectRecord(value = {}) {
  const result = record(value);
  if (result.currentProject && typeof result.currentProject === "object" && !Array.isArray(result.currentProject)) {
    return result.currentProject;
  }
  if (result.project && typeof result.project === "object" && !Array.isArray(result.project)) {
    return result.project;
  }
  return {};
}

function projectSlug(value = {}) {
  const source = record(value);
  const project = projectRecord(source);
  return String(
    source.projectSlug || source.slug || source.name || project.slug || project.name || ""
  ).trim();
}

function projectRealtimePayload(value = {}) {
  const source = record(value);
  const slug = projectSlug(source);
  return {
    ...(slug ? { projectSlug: slug } : {}),
    ...(typeof source.hasSelection === "boolean" ? { hasSelection: source.hasSelection } : {})
  };
}

function action({ events = [], execute, id, input, kind }) {
  return Object.freeze({
    id,
    version: 1,
    kind,
    input,
    output: null,
    idempotency: kind === "query" ? "none" : "optional",
    audit: {
      actionName: id
    },
    observability: {},
    events,
    execute
  });
}

function createProjectActions({ project } = {}) {
  if (!project) {
    throw new TypeError("createProjectActions requires project.");
  }

  return Object.freeze([
    action({
      id: ACTION_LIST_PROJECTS,
      kind: "query",
      input: projectsReadInputValidator,
      execute: () => project.listProjects()
    }),
    action({
      id: ACTION_CREATE_PROJECT,
      kind: "command",
      input: projectCreateInputValidator,
      events: [projectChangedEvent({ operation: "created" })],
      execute: (input) => project.createProject(input)
    }),
    action({
      id: ACTION_SELECT_PROJECT,
      kind: "command",
      input: projectSelectInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.selectProject(input)
    }),
    action({
      id: ACTION_READ_ENV,
      kind: "query",
      input: projectEnvReadInputValidator,
      execute: (input) => project.readEnv(input)
    }),
    action({
      id: ACTION_SAVE_ENV_USER_VALUES,
      kind: "command",
      input: projectEnvUserValuesInputValidator,
      execute: (input) => project.saveEnvUserValues(input)
    }),
    action({
      id: ACTION_READ_PROJECT_SETTINGS,
      kind: "query",
      input: projectSettingsReadInputValidator,
      execute: (input) => project.readSettings(input)
    }),
    action({
      id: ACTION_READ_ENGINEERING_SETTINGS,
      kind: "query",
      input: projectEngineeringSettingsReadInputValidator,
      execute: (input) => project.readEngineeringSettings(input)
    }),
    action({
      id: ACTION_SAVE_COLLABORATION_SETTINGS,
      kind: "command",
      input: projectCollaborationInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.saveCollaborationSettings(input)
    }),
    action({
      id: ACTION_SAVE_PROJECT_PROMPT_HINTS,
      kind: "command",
      input: projectPromptHintsInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.savePromptHints(input)
    }),
    action({
      id: ACTION_SAVE_ENGINEERING_PROFILE,
      kind: "command",
      input: projectEngineeringProfileInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.saveEngineeringProfile(input)
    }),
    action({
      id: ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
      kind: "command",
      input: projectDevelopmentDatabaseScopeInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.saveDevelopmentDatabaseScope(input)
    }),
    action({
      id: ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
      kind: "query",
      input: previewApplicationIdentitiesReadInputValidator,
      execute: (input) => project.readPreviewApplicationIdentities(input)
    }),
    action({
      id: ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
      kind: "command",
      input: previewApplicationIdentitiesInputValidator,
      events: [projectChangedEvent()],
      execute: (input) => project.savePreviewApplicationIdentities(input)
    })
  ]);
}

export {
  ACTION_CREATE_PROJECT,
  ACTION_LIST_PROJECTS,
  ACTION_READ_ENV,
  ACTION_READ_ENGINEERING_SETTINGS,
  ACTION_READ_PROJECT_SETTINGS,
  ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_SAVE_ENV_USER_VALUES,
  ACTION_SAVE_COLLABORATION_SETTINGS,
  ACTION_SAVE_ENGINEERING_PROFILE,
  ACTION_SAVE_PROJECT_PROMPT_HINTS,
  ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
  ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_SELECT_PROJECT,
  createProjectActions
};
