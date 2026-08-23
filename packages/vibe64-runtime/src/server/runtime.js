import process from "node:process";
import { rm } from "node:fs/promises";

import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  managedSessionSourcePath,
  sessionHasSource,
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  assertGenesisPromptTask,
  renderGenesisPrompt
} from "@local/vibe64-genesis/server";

import {
  VIBE64_SESSION_STATUS,
  createVibe64SessionStore
} from "./sessionStore.js";
import {
  assertSourceInspectionHealthy,
  sourceInspectionFailure
} from "./sessionSourceInspection.js";
import {
  inspectSessionSourceMergeState
} from "./sessionSourceGit.js";
import {
  VIBE64_SESSION_CLOSING_AT_METADATA,
  VIBE64_SESSION_CLOSING_REASON_METADATA,
  sessionClosingMetadata
} from "./sessionLifecycle.js";
import {
  archiveSessionSource as archiveStoredSessionSource
} from "./sessionWorktreeArchive.js";
import {
  publicSessionMetadata,
  workspaceSetupStateFromMetadata
} from "./workspaceSetupState.js";

const GENESIS_SESSION_KIND = "genesis";

function unsupportedSessionError(session = {}) {
  const sessionId = normalizeText(session.sessionId || session.id) || "(unknown)";
  return vibe64Error(
    `Session ${sessionId} uses an unsupported runtime format and cannot be opened.`,
    "vibe64_session_runtime_unsupported"
  );
}

function sessionIsSupported(session = {}) {
  return normalizeText(session.manifest?.runtimeKind) === GENESIS_SESSION_KIND;
}

function assertSupportedSession(session = {}) {
  if (!sessionIsSupported(session)) {
    throw unsupportedSessionError(session);
  }
  return session;
}

function requireSessionSourceRoot(session = {}) {
  const sourceRoot = sessionSourcePath(session);
  if (!sourceRoot) {
    const sessionId = normalizeText(session.sessionId || session.id) || "(unknown)";
    throw vibe64Error(
      `Session ${sessionId} has no usable source checkout. Create or select a session with source before using this operation.`,
      "vibe64_session_source_required"
    );
  }
  return sourceRoot;
}

function plainManifest(manifest = {}) {
  return {
    createdAt: normalizeText(manifest.createdAt),
    product: normalizeText(manifest.product) || "vibe64",
    revision: Number(manifest.revision) || 1,
    schemaVersion: Number(manifest.schemaVersion) || 1,
    sessionId: normalizeText(manifest.sessionId),
    updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt)
  };
}

function plainSessionView(session = {}, {
  sourceInspection = null
} = {}) {
  const sourcePath = sessionSourcePath(session);
  const workspaceSetup = workspaceSetupStateFromMetadata(session.metadata);
  return {
    ...(session.archived === true
      ? {
          archiveMetadataPath: normalizeText(session.archiveMetadataPath),
          archivePath: normalizeText(session.archivePath),
          archived: true,
          archivedAt: normalizeText(session.archivedAt)
        }
      : {}),
    agentRuns: Array.isArray(session.agentRuns) ? session.agentRuns : [],
    backgroundTasks: Array.isArray(session.backgroundTasks) ? session.backgroundTasks : [],
    companion: {
      id: GENESIS_SESSION_KIND,
      label: "Genesis"
    },
    conversationLogRoot: normalizeText(session.conversationLogRoot),
    manifest: plainManifest(session.manifest),
    metadata: publicSessionMetadata(session.metadata),
    revision: Number(session.revision) || 1,
    sessionId: normalizeText(session.sessionId),
    sessionName: normalizeText(session.sessionName),
    sessionRoot: normalizeText(session.sessionRoot),
    sourceInspection,
    sourcePath,
    sourceReady: Boolean(sourcePath),
    stateRoot: normalizeText(session.stateRoot),
    status: normalizeText(session.status) || VIBE64_SESSION_STATUS.ACTIVE,
    updatedAt: normalizeText(session.updatedAt),
    workspaceSetup
  };
}

function closedSessionStatus(status = "") {
  return normalizeText(status) === VIBE64_SESSION_STATUS.ABANDONED;
}

function sessionSourceCreationFailed(session = {}) {
  return normalizeText(session?.metadata?.source_creation_failed).toLowerCase() === "yes";
}

async function sessionIsListable(session = {}) {
  if (!sessionIsSupported(session)) {
    return false;
  }
  if (session.archived === true || closedSessionStatus(session.status)) {
    return true;
  }
  if (sessionSourceCreationFailed(session)) {
    return true;
  }
  const sourcePath = sessionSourcePath(session);
  return Boolean(sourcePath && await pathExists(sourcePath));
}

class Vibe64SessionRuntime {
  constructor({
    clock = undefined,
    createSessionSource = null,
    inspectSourceByDefault = true,
    projectContextRoot = process.cwd(),
    projectRuntimeRoot = "",
    projectSessionSourceRoot = "",
    promptEnvironment = process.env,
    promptRenderer = renderGenesisPrompt,
    sourceInspectionAvailable = true,
    sourceInspectionError = null,
    store = undefined
  } = {}) {
    this.inspectSourceByDefault = inspectSourceByDefault !== false;
    this.createSessionSource = typeof createSessionSource === "function"
      ? createSessionSource
      : null;
    this.projectSessionSourceRoot = normalizeText(projectSessionSourceRoot);
    this.promptEnvironment = promptEnvironment && typeof promptEnvironment === "object"
      ? promptEnvironment
      : process.env;
    this.promptRenderer = typeof promptRenderer === "function"
      ? promptRenderer
      : renderGenesisPrompt;
    this.sourceInspectionAvailable = sourceInspectionAvailable !== false;
    this.sourceInspectionError = sourceInspectionError || null;
    this.projectContextRoot = projectContextRoot;
    this.stateRoot = normalizeText(projectRuntimeRoot);
    if (!this.stateRoot && !store) {
      throw vibe64Error(
        "Vibe64 session runtime requires projectRuntimeRoot.",
        "vibe64_project_runtime_root_required"
      );
    }
    this.store = store || createVibe64SessionStore({
      clock,
      projectContextRoot,
      projectRuntimeRoot: this.stateRoot,
      projectSessionSourceRoot: this.projectSessionSourceRoot
    });
  }

  async createSession({
    metadata = {},
    sessionId = "",
    sourceContext = {},
    status = VIBE64_SESSION_STATUS.ACTIVE
  } = {}) {
    let session = await this.store.createSession({
      runtimeKind: GENESIS_SESSION_KIND,
      metadata,
      sessionId,
      status
    });
    try {
      if (this.createSessionSource) {
        await this.createSessionSource({
          ...(sourceContext && typeof sourceContext === "object" ? sourceContext : {}),
          runtime: this,
          session,
          store: this.store
        });
        session = await this.store.readSession(session.sessionId);
      }
      if (!sessionHasSource(session)) {
        throw vibe64Error(
          this.createSessionSource
            ? "Session source creation completed without attaching a source directory."
            : "Session creation requires an existing source or a createSessionSource callback.",
          this.createSessionSource
            ? "vibe64_session_source_not_attached"
            : "vibe64_session_source_creator_required"
        );
      }
    } catch (error) {
      await this.store.mutateSession(session.sessionId, async () => {
        await Promise.all([
          this.store.writeMetadataValue(session.sessionId, "source_creation_error", normalizeText(error?.message)),
          this.store.writeMetadataValue(session.sessionId, "source_creation_failed", "yes"),
          this.store.writeStatus(session.sessionId, VIBE64_SESSION_STATUS.BLOCKED)
        ]);
      });
      throw error;
    }
    return this.sessionView(session);
  }

  async getSession(sessionId, {
    inspectSource = this.inspectSourceByDefault
  } = {}) {
    return this.sessionView(await this.store.readSession(sessionId), {
      inspectSource
    });
  }

  async listSessions(options = {}) {
    const sessions = await this.store.listSessions(options);
    const listable = await Promise.all(sessions.map(sessionIsListable));
    return Promise.all(sessions
      .filter((_session, index) => listable[index])
      .map((session) => this.sessionView(session)));
  }

  async listSessionSummaries(options = {}) {
    const sessions = await this.store.listSessions(options);
    const listable = await Promise.all(sessions.map(sessionIsListable));
    return sessions
      .filter((_session, index) => listable[index])
      .map((session) => plainSessionView(session, {
        sourceInspection: null
      }));
  }

  async updateCurrentSession(sessionId = "") {
    if (sessionId) {
      assertSupportedSession(await this.store.readSession(sessionId));
    }
    return this.store.updateCurrentSession(sessionId);
  }

  async sessionView(session = {}, {
    inspectSource = this.inspectSourceByDefault
  } = {}) {
    assertSupportedSession(session);
    const sourceInspection = inspectSource
      ? await this.inspectSourceForSession(session)
      : null;
    return plainSessionView(session, {
      sourceInspection
    });
  }

  async inspectSourceForSession(session = {}) {
    assertSupportedSession(session);
    if (!sessionHasSource(session)) {
      return null;
    }
    if (!this.sourceInspectionAvailable || this.sourceInspectionError) {
      return {
        ...sourceInspectionFailure(),
        status: "error"
      };
    }
    try {
      const merge = await inspectSessionSourceMergeState(sessionSourcePath(session));
      if (merge.hasConflicts) {
        return {
          ...sourceInspectionFailure({
            merge
          }),
          status: "error"
        };
      }
      return null;
    } catch {
      return {
        ...sourceInspectionFailure(),
        status: "error"
      };
    }
  }

  async assertSourceHealthy(sessionOrId = {}) {
    const session = typeof sessionOrId === "string"
      ? await this.store.readSession(sessionOrId)
      : sessionOrId;
    assertSupportedSession(session);
    const inspection = await this.inspectSourceForSession(session);
    assertSourceInspectionHealthy(inspection);
    return sessionSourcePath(session);
  }

  async renderPrompt(sessionId, {
    input = {},
    request = "",
    task = "work"
  } = {}) {
    const session = assertSupportedSession(await this.store.readSession(sessionId));
    const sourceRoot = requireSessionSourceRoot(session);
    let genesisTask = assertGenesisPromptTask(task, {
      required: true
    });
    if (genesisTask === "work") {
      const conversation = await this.store.readConversationLog(sessionId);
      const hasUserMessage = conversation.some((turn) => Boolean(turn?.user));
      if (!hasUserMessage) {
        genesisTask = "start";
      }
    }
    return this.promptRenderer({
      action: {
        genesisTask,
        id: genesisTask,
        label: normalizeText(request) || genesisTask
      },
      environment: this.promptEnvironment,
      input: {
        ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
        ...(normalizeText(request) ? { request: normalizeText(request) } : {})
      },
      projectRoot: sourceRoot
    });
  }

  async archiveSessionSource(sessionOrId = {}, {
    reason = "archive"
  } = {}) {
    const sessionId = normalizeText(typeof sessionOrId === "string"
      ? sessionOrId
      : sessionOrId.sessionId || sessionOrId.id);
    return this.store.mutateSession(sessionId, async () => {
      const session = assertSupportedSession(await this.store.readSession(sessionId));
      await this.assertSourceHealthy(session);
      return archiveStoredSessionSource({
        reason,
        session,
        store: this.store
      });
    });
  }

  async markSessionClosing(sessionId = "", {
    reason = "closing"
  } = {}) {
    return this.store.mutateSession(sessionId, async () => {
      assertSupportedSession(await this.store.readSession(sessionId));
      const metadata = sessionClosingMetadata(reason);
      await Promise.all(Object.entries(metadata).map(([name, value]) => (
        this.store.writeMetadataValue(sessionId, name, value)
      )));
      return this.getSession(sessionId);
    });
  }

  async clearSessionClosing(sessionId = "") {
    return this.store.mutateSession(sessionId, async () => {
      assertSupportedSession(await this.store.readSession(sessionId));
      await this.store.deleteMetadataValues(sessionId, [
        VIBE64_SESSION_CLOSING_AT_METADATA,
        VIBE64_SESSION_CLOSING_REASON_METADATA
      ]);
      return this.getSession(sessionId);
    });
  }

  async abandonSession(sessionId = "", {
    reason = "abandoned"
  } = {}) {
    const session = assertSupportedSession(await this.store.readSession(sessionId));
    if (closedSessionStatus(session.status)) {
      return this.getSession(sessionId);
    }
    await this.markSessionClosing(sessionId, {
      reason
    });
    try {
      if (sessionHasSource(session)) {
        await this.archiveSessionSource(sessionId, {
          reason
        });
      } else if (sessionSourceCreationFailed(session)) {
        const failedSourcePath = managedSessionSourcePath(this.projectSessionSourceRoot, sessionId);
        if (failedSourcePath) {
          await rm(failedSourcePath, {
            force: true,
            recursive: true
          });
        }
      } else {
        await this.assertSourceHealthy(session);
      }
      await this.store.writeStatus(sessionId, VIBE64_SESSION_STATUS.ABANDONED);
      if (typeof this.store.compactClosedSession === "function") {
        await this.store.compactClosedSession(sessionId);
      }
      return this.getSession(sessionId);
    } catch (error) {
      await this.clearSessionClosing(sessionId).catch(() => null);
      throw error;
    }
  }

  readConversationLog(sessionId) {
    return this.store.readConversationLog(sessionId);
  }

  readConversationLogPage(sessionId, options = {}) {
    return this.store.readConversationLogPage(sessionId, options);
  }

  writeConversationUserMessage(sessionId, message = {}) {
    return this.store.writeConversationUserMessage(sessionId, message);
  }

  writeConversationAssistantMessage(sessionId, message = {}) {
    return this.store.writeConversationAssistantMessage(sessionId, message);
  }

  upsertConversationAssistantMessage(sessionId, message = {}) {
    return this.store.upsertConversationAssistantMessage(sessionId, message);
  }

  writeConversationCommentaryMessage(sessionId, message = {}) {
    return this.store.writeConversationCommentaryMessage(sessionId, message);
  }

  writeConversationThinkingMessage(sessionId, message = {}) {
    return this.store.writeConversationThinkingMessage(sessionId, message);
  }

  writeConversationSystemMessage(sessionId, message = {}) {
    return this.store.writeConversationSystemMessage(sessionId, message);
  }

  readAgentRun(sessionId, runId) {
    return this.store.readAgentRun(sessionId, runId);
  }

  writeAgentRunEvent(sessionId, runId, event = {}) {
    return this.store.writeAgentRunEvent(sessionId, runId, event);
  }
}

export {
  GENESIS_SESSION_KIND,
  Vibe64SessionRuntime,
  assertSupportedSession,
  plainSessionView,
  sessionIsSupported
};
