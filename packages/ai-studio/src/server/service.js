import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  closeTerminalSession,
  closeTerminalSessionsForNamespace,
  readTerminalSession,
  startTerminalSession,
  subscribeTerminalSession,
  writeTerminalSession
} from "../../../../server/lib/terminalSessions.js";
import {
  STUDIO_DAEMON_PID_LABEL
} from "../../../../server/lib/studioTerminalLabels.js";
import {
  AI_STUDIO_SESSION_STATUS,
  AiStudioSessionRuntime,
  createAiStudioAdapterRegistry,
  createAiStudioProjectTypeStore
} from "../../../../server/lib/aiStudio/index.js";

const execFileAsync = promisify(execFile);

const TOOLCHAIN_IMAGE = "jskit-ai-studio-toolchain:0.1.0";
const TOOL_HOME_VOLUME = "jskit_ai_studio_tool_home";
const AI_STUDIO_CODEX_TERMINAL_NAMESPACE = "ai-studio-codex";
const AI_STUDIO_CODEX_TERMINAL_NAMESPACE_PREFIX = `${AI_STUDIO_CODEX_TERMINAL_NAMESPACE}:`;
const AI_STUDIO_COMMAND_TERMINAL_NAMESPACE = "ai-studio-command";
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CODEX_THREAD_PROBE = "!echo $CODEX_THREAD_ID";
const CODEX_SESSION_MODEL = "gpt-5.5";
const CODEX_SESSION_REASONING_EFFORT = "xhigh";
const MAX_OPEN_AI_STUDIO_SESSIONS = 3;
const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);
const STUDIO_DAEMON_ID = crypto.randomUUID();
const ATTACHMENT_CONTAINER_ROOT = "/studio-attachments";
const ATTACHMENT_HOST_ROOT = path.join(tmpdir(), "jskit-ai-studio", "attachments", STUDIO_DAEMON_ID);
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const ATTACHMENT_TTL_MS = 30 * 60 * 1000;
const attachmentCleanupTimers = new Map();

const AI_STUDIO_EDITABLE_ARTIFACTS = Object.freeze({
  "issue.md": Object.freeze({
    blockedMetadata: "issue_url",
    blockedMessage: "The GitHub issue already exists; edit it on GitHub instead.",
    editorActionId: "edit_issue",
    requiredMessage: "Issue body is required."
  }),
  issue_title: Object.freeze({
    blockedMetadata: "issue_url",
    blockedMessage: "The GitHub issue already exists; edit it on GitHub instead.",
    editorActionId: "edit_issue",
    metadataName: "issue_title",
    requiredMessage: "Issue title is required."
  }),
  "pull_request.md": Object.freeze({
    blockedMetadata: "pr_url",
    blockedMessage: "The GitHub pull request already exists; edit it on GitHub instead.",
    editorActionId: "edit_pr",
    requiredMessage: "Pull request body is required."
  })
});

function resolveAiStudioTargetRoot(targetRoot) {
  const configuredRoot = String(targetRoot || process.env.JSKIT_STUDIO_TARGET_ROOT || "").trim();
  return path.resolve(configuredRoot || process.cwd());
}

function normalizePlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function shellQuote(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:=@,+-]+$/.test(stringValue)) {
    return stringValue;
  }
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
}

function dockerCommand(args) {
  return ["docker", ...args].map(shellQuote).join(" ");
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 12);
}

function aiStudioErrorResponse(error, fallback = "AI Studio request failed.") {
  return {
    errors: [
      {
        code: String(error?.code || "ai_studio_request_failed"),
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

function isOpenAiStudioSession(session = {}) {
  return !CLOSED_SESSION_STATUSES.has(String(session.status || ""));
}

function aiStudioSessionLimits(sessions = []) {
  return {
    maxOpenSessions: MAX_OPEN_AI_STUDIO_SESSIONS,
    openSessionCount: sessions.filter(isOpenAiStudioSession).length
  };
}

function aiStudioSessionListResponse(sessions = []) {
  return {
    limits: aiStudioSessionLimits(sessions),
    ok: true,
    sessions
  };
}

function aiStudioActionById(session = {}, actionId = "") {
  return (Array.isArray(session.actions) ? session.actions : [])
    .find((action) => action.id === actionId) || null;
}

function aiStudioArtifactPath(session = {}, artifactName = "") {
  return session.artifactsRoot && artifactName ? path.join(session.artifactsRoot, artifactName) : "";
}

function aiStudioEditableArtifactNames() {
  return Object.keys(AI_STUDIO_EDITABLE_ARTIFACTS)
    .sort((left, right) => left.localeCompare(right));
}

function aiStudioArtifactErrorResponse(session = {}, code = "", message = "") {
  return {
    ...session,
    errors: [
      {
        code,
        message
      }
    ],
    ok: false
  };
}

function aiStudioArtifactPolicy(artifactName = "") {
  return AI_STUDIO_EDITABLE_ARTIFACTS[String(artifactName || "").trim()] || null;
}

function aiStudioArtifactState(session = {}, artifactName = "") {
  const policy = aiStudioArtifactPolicy(artifactName);
  if (!policy) {
    return {
      disabledReason: `Artifact is not editable: ${artifactName}`,
      editable: false
    };
  }

  const action = aiStudioActionById(session, policy.editorActionId);
  if (!action || action.type !== "editor") {
    return {
      disabledReason: `Editor action ${policy.editorActionId} is not available on this AI Studio step.`,
      editable: false
    };
  }
  if (policy.blockedMetadata && session.metadata?.[policy.blockedMetadata]) {
    return {
      disabledReason: policy.blockedMessage,
      editable: false
    };
  }
  if (action.enabled !== true) {
    return {
      disabledReason: action.disabledReason || `Editor action ${policy.editorActionId} is disabled.`,
      editable: false
    };
  }

  return {
    disabledReason: "",
    editable: true
  };
}

function normalizeAiStudioArtifactInput(input = {}) {
  const artifactEntries = Object.entries(normalizePlainObject(input.artifacts))
    .map(([name, value]) => [
      String(name || "").trim(),
      String(value || "").trim()
    ])
    .filter(([name]) => Boolean(name));
  return Object.fromEntries(artifactEntries);
}

function aiStudioArtifactsResponse(session = {}, artifacts = {}) {
  const editableArtifacts = aiStudioEditableArtifactNames();
  const artifactPaths = Object.fromEntries(editableArtifacts.map((artifactName) => {
    return [artifactName, aiStudioArtifactPath(session, artifactName)];
  }));
  const artifactStates = Object.fromEntries(editableArtifacts.map((artifactName) => {
    return [artifactName, aiStudioArtifactState(session, artifactName)];
  }));
  return {
    ...session,
    artifactPaths,
    artifacts,
    artifactStates,
    editableArtifacts,
    ok: true
  };
}

async function readAiStudioEditableArtifacts(runtime, session = {}) {
  const artifactEntries = await Promise.all(aiStudioEditableArtifactNames().map(async (artifactName) => {
    return [artifactName, await runtime.store.readArtifact(session.sessionId, artifactName)];
  }));
  return Object.fromEntries(artifactEntries);
}

function normalizeCodexThreadId(value) {
  const threadId = String(value || "").trim();
  if (!CODEX_THREAD_ID_PATTERN.test(threadId)) {
    return "";
  }
  return threadId.toLowerCase();
}

function normalizeCodexPromptHandoffSignature(sessionId, signature) {
  const normalizedSessionId = String(sessionId || "").trim();
  const normalizedSignature = String(signature || "").trim();
  if (
    !normalizedSessionId ||
    !normalizedSignature ||
    normalizedSignature.length > 512 ||
    normalizedSignature.includes("\n") ||
    normalizedSignature.includes("\r") ||
    !normalizedSignature.startsWith(`${normalizedSessionId}:`)
  ) {
    return "";
  }
  return normalizedSignature;
}

function normalizeCodexPromptHandoffOutputStart(value) {
  const normalizedValue = String(value ?? "").trim();
  if (!/^\d+$/u.test(normalizedValue)) {
    return 0;
  }
  const outputStart = Number(normalizedValue);
  return Number.isSafeInteger(outputStart) && outputStart >= 0 ? outputStart : 0;
}

function aiStudioTerminalWorkdir(session = {}) {
  return path.resolve(
    String(session.metadata?.worktree_path || session.worktree || session.targetRoot || "").trim()
  );
}

function aiStudioCodexState(session = {}) {
  const metadata = session.metadata || {};
  const codexThreadId = normalizeCodexThreadId(metadata.codex_thread_id);
  return {
    codexPromptHandoffOutputStart: normalizeCodexPromptHandoffOutputStart(metadata.codex_prompt_handoff_output_start),
    codexPromptHandoffSignature: normalizeCodexPromptHandoffSignature(
      session.sessionId,
      metadata.codex_prompt_handoff_signature
    ),
    codexThreadId,
    needsThreadCapture: !codexThreadId,
    threadProbe: CODEX_THREAD_PROBE
  };
}

function withAiStudioCodexState(response = {}, session = {}) {
  return {
    ...response,
    ...aiStudioCodexState(session)
  };
}

function aiStudioCodexTerminalNamespace(sessionId) {
  return `${AI_STUDIO_CODEX_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function aiStudioCommandTerminalNamespace(sessionId) {
  return `${AI_STUDIO_COMMAND_TERMINAL_NAMESPACE}:${String(sessionId || "")}`;
}

function containerWorkspacePath(targetRoot, absolutePath) {
  const relativePath = path.relative(targetRoot, absolutePath);
  if (!relativePath || relativePath === ".") {
    return "/workspace";
  }
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return "";
  }
  return path.posix.join("/workspace", ...relativePath.split(path.sep));
}

function attachmentSessionKey(targetRoot, sessionId) {
  return path.join(stableHash(targetRoot), stableHash(sessionId));
}

function attachmentHostDirectory(targetRoot, sessionId, attachmentId = "") {
  const parts = [
    ATTACHMENT_HOST_ROOT,
    ...attachmentSessionKey(targetRoot, sessionId).split(path.sep)
  ];
  if (attachmentId) {
    parts.push(attachmentId);
  }
  return path.join(...parts);
}

function attachmentContainerPath(targetRoot, sessionId, attachmentId, fileName) {
  return path.posix.join(
    ATTACHMENT_CONTAINER_ROOT,
    ...attachmentSessionKey(targetRoot, sessionId).split(path.sep),
    attachmentId,
    fileName
  );
}

function sanitizeAttachmentFileName(fileName = "") {
  const baseName = path.basename(String(fileName || "attachment").replaceAll("\\", "/"));
  const sanitized = baseName
    .replace(/[^\w .@+-]/gu, "_")
    .replace(/^\.+/u, "")
    .trim()
    .slice(0, 160);
  return sanitized || "attachment";
}

function decodeAttachmentData(value = "") {
  const raw = String(value || "").trim();
  const data = raw.includes(",") && /^data:[^,]+;base64,/iu.test(raw)
    ? raw.slice(raw.indexOf(",") + 1)
    : raw;
  const normalized = data.replace(/\s/gu, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    return null;
  }
  return Buffer.from(normalized, "base64");
}

async function prepareAttachmentRoot() {
  await mkdir(ATTACHMENT_HOST_ROOT, {
    recursive: true
  });
}

async function cleanupCodexAttachments(targetRoot, sessionId, attachmentId = "") {
  const cleanupPath = attachmentId
    ? attachmentHostDirectory(targetRoot, sessionId, attachmentId)
    : attachmentHostDirectory(targetRoot, sessionId);
  const timerKey = `${stableHash(targetRoot)}:${stableHash(sessionId)}:${attachmentId}`;
  const timer = attachmentCleanupTimers.get(timerKey);
  if (timer) {
    clearTimeout(timer);
    attachmentCleanupTimers.delete(timerKey);
  }
  await rm(cleanupPath, {
    force: true,
    recursive: true
  });
}

function scheduleAttachmentCleanup(targetRoot, sessionId, attachmentId) {
  const timerKey = `${stableHash(targetRoot)}:${stableHash(sessionId)}:${attachmentId}`;
  const existingTimer = attachmentCleanupTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    attachmentCleanupTimers.delete(timerKey);
    void cleanupCodexAttachments(targetRoot, sessionId, attachmentId);
  }, ATTACHMENT_TTL_MS);
  timer.unref?.();
  attachmentCleanupTimers.set(timerKey, timer);
}

function hostUserIdentityEnvArgs() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    return [];
  }
  return [
    "-e",
    `JSKIT_HOST_UID=${process.getuid()}`,
    "-e",
    `JSKIT_HOST_GID=${process.getgid()}`
  ];
}

function codexStartupScript(codexThreadId = "") {
  const normalizedThreadId = normalizeCodexThreadId(codexThreadId);
  const codexReasoningConfig = `model_reasoning_effort="${CODEX_SESSION_REASONING_EFFORT}"`;
  const codexOptions = [
    "--model",
    shellQuote(CODEX_SESSION_MODEL),
    "-c",
    shellQuote(codexReasoningConfig),
    "--dangerously-bypass-approvals-and-sandbox"
  ].join(" ");
  const codexCommand = normalizedThreadId
    ? `codex ${codexOptions} resume ${shellQuote(normalizedThreadId)}`
    : `codex ${codexOptions}`;
  return [
    "set -e",
    "if [ -n \"${JSKIT_HOST_UID:-}\" ] && [ -n \"${JSKIT_HOST_GID:-}\" ] && command -v setpriv >/dev/null 2>&1; then",
    "  mkdir -p /home/studio/.codex /home/studio/.config",
    "  chown -R \"$JSKIT_HOST_UID:$JSKIT_HOST_GID\" /home/studio/.codex /home/studio/.config",
    `  exec setpriv --reuid "$JSKIT_HOST_UID" --regid "$JSKIT_HOST_GID" --clear-groups env HOME=/home/studio ${codexCommand}`,
    "fi",
    `exec env HOME=/home/studio ${codexCommand}`
  ].join("\n");
}

function codexTerminalArgs({
  codexThreadId,
  containerName,
  sessionId,
  targetRoot,
  terminalId,
  worktree
}) {
  return [
    "run",
    "--rm",
    "-it",
    "--name",
    containerName,
    "--label",
    "jskit-ai-studio.kind=codex-terminal",
    "--label",
    `jskit-ai-studio.daemon=${STUDIO_DAEMON_ID}`,
    "--label",
    `${STUDIO_DAEMON_PID_LABEL}=${process.pid}`,
    "--label",
    `jskit-ai-studio.session=${sessionId}`,
    "--label",
    `jskit-ai-studio.terminal=${terminalId}`,
    "--label",
    `jskit-ai-studio.target=${stableHash(targetRoot)}`,
    "-v",
    `${TOOL_HOME_VOLUME}:/home/studio`,
    "-e",
    "HOME=/home/studio",
    ...hostUserIdentityEnvArgs(),
    "-v",
    `${targetRoot}:/workspace`,
    "-v",
    `${targetRoot}:${targetRoot}`,
    "-v",
    `${ATTACHMENT_HOST_ROOT}:${ATTACHMENT_CONTAINER_ROOT}:ro`,
    "-w",
    worktree,
    TOOLCHAIN_IMAGE,
    "bash",
    "-lc",
    codexStartupScript(codexThreadId)
  ];
}

function codexContainerName({ sessionId, terminalId }) {
  return `jskit-ai-studio-codex-${stableHash(sessionId)}-${stableHash(terminalId)}`;
}

async function removeDockerContainer(containerName) {
  if (!containerName) {
    return;
  }
  await execFileAsync("docker", ["rm", "-f", containerName], {
    timeout: 10000,
    maxBuffer: 1024 * 1024
  }).catch(() => null);
}

async function writeAiStudioActionTerminalResult({
  action = {},
  exitCode,
  input = {},
  runtime,
  session = {},
  spec = {}
} = {}) {
  const completed = exitCode === 0;
  const metadata = completed ? spec.successMetadata || {} : {};
  const message = completed
    ? spec.successMessage || `${action.label || action.id} completed.`
    : spec.failureMessage || `${action.label || action.id} failed with exit code ${exitCode}.`;
  const actionResult = await runtime.store.writeActionResult(
    session.sessionId,
    action.id,
    {
      actionLabel: action.label,
      actionType: action.type,
      artifacts: {},
      input,
      message,
      metadata,
      status: completed ? "completed" : "blocked",
      stepId: session.currentStep
    }
  );
  if (completed) {
    await Promise.all(Object.entries(metadata).map(([name, value]) => {
      return runtime.store.writeMetadataValue(session.sessionId, name, value);
    }));
  }
  await runtime.store.appendCommandLogEntry(session.sessionId, {
    actionId: action.id,
    actionLabel: action.label,
    actionType: action.type,
    kind: "terminal-action",
    status: actionResult.status,
    stepId: session.currentStep
  });
}

function createProjectTypeService({ adapterRegistry, projectTypeStore }) {
  async function readProjectType() {
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
    const projectType = await readProjectType();
    if (!projectType.ready) {
      const error = new Error(projectType.message);
      error.code = projectType.errorCode;
      error.projectType = projectType;
      throw error;
    }
    return projectType;
  }

  async function saveProjectType(input = {}) {
    const projectType = String(input?.projectType || "").trim();
    adapterRegistry.requireImplementedProjectType(projectType);
    await projectTypeStore.writeProjectType(projectType);
    return readProjectType();
  }

  return Object.freeze({
    readProjectType,
    requireProjectType,
    saveProjectType
  });
}

function createService({ targetRoot = "" } = {}) {
  const resolvedTargetRoot = resolveAiStudioTargetRoot(targetRoot);
  const adapterRegistry = createAiStudioAdapterRegistry();
  const projectTypeStore = createAiStudioProjectTypeStore({
    targetRoot: resolvedTargetRoot
  });
  const projectTypes = createProjectTypeService({
    adapterRegistry,
    projectTypeStore
  });

  async function createAiStudioRuntime() {
    const projectType = await projectTypes.requireProjectType();
    const adapter = await adapterRegistry.createAdapter(projectType.projectType);
    return new AiStudioSessionRuntime({
      adapter,
      targetRoot: resolvedTargetRoot
    });
  }

  return Object.freeze({
    async readProjectType() {
      return aiStudioResult(async () => {
        return {
          ok: true,
          projectType: await projectTypes.readProjectType()
        };
      });
    },

    async saveProjectType(input = {}) {
      return aiStudioResult(async () => {
        return {
          ok: true,
          projectType: await projectTypes.saveProjectType(input)
        };
      });
    },

    async listSessions() {
      return aiStudioResult(async () => {
        const runtime = await createAiStudioRuntime();
        return aiStudioSessionListResponse(await runtime.listSessions());
      });
    },

    async createSession() {
      return aiStudioResult(async () => {
        const projectType = await projectTypes.requireProjectType();
        const runtime = await createAiStudioRuntime();
        const existingSessions = await runtime.listSessions();
        const limits = aiStudioSessionLimits(existingSessions);
        if (limits.openSessionCount >= limits.maxOpenSessions) {
          return {
            errors: [
              {
                code: "open_session_limit",
                message: `Studio allows up to ${limits.maxOpenSessions} active sessions at once. Finish or abandon one before creating another.`
              }
            ],
            limits,
            ok: false,
            sessions: existingSessions,
            status: "blocked"
          };
        }
        return runtime.createSession({
          metadata: {
            adapter_id: projectType.adapter?.id || projectType.projectType,
            project_type: projectType.projectType
          }
        });
      });
    },

    async inspectSession(sessionId) {
      return aiStudioResult(async () => {
        const runtime = await createAiStudioRuntime();
        return runtime.getSession(sessionId);
      });
    },

    async runSessionAction(sessionId, actionId, input = {}) {
      return aiStudioResult(async () => {
        const runtime = await createAiStudioRuntime();
        return runtime.runAction(sessionId, actionId, input);
      });
    },

    async advanceSession(sessionId) {
      return aiStudioResult(async () => {
        const runtime = await createAiStudioRuntime();
        return runtime.advance(sessionId);
      });
    },

    async abandonSession(sessionId) {
      return aiStudioResult(async () => {
        const runtime = await createAiStudioRuntime();
        await runtime.store.writeStatus(sessionId, AI_STUDIO_SESSION_STATUS.ABANDONED);
        await closeTerminalSessionsForNamespace(aiStudioCodexTerminalNamespace(sessionId));
        await closeTerminalSessionsForNamespace(aiStudioCommandTerminalNamespace(sessionId));
        return runtime.getSession(sessionId);
      });
    },

    async startCodexTerminal(sessionId) {
      return aiStudioResult(async () => {
        const runtime = await createAiStudioRuntime();
        const session = await runtime.getSession(sessionId);
        const workdir = aiStudioTerminalWorkdir(session);
        if (!containerWorkspacePath(resolvedTargetRoot, workdir)) {
          return {
            ok: false,
            error: "AI Studio Codex workdir is outside the target root."
          };
        }

        await prepareAttachmentRoot();
        const namespace = aiStudioCodexTerminalNamespace(sessionId);
        return withAiStudioCodexState(startTerminalSession({
          args: ({ id }) => codexTerminalArgs({
            codexThreadId: normalizeCodexThreadId(session.metadata?.codex_thread_id),
            containerName: codexContainerName({
              sessionId,
              terminalId: id
            }),
            sessionId,
            targetRoot: resolvedTargetRoot,
            terminalId: id,
            worktree: workdir
          }),
          command: "docker",
          commandPreview: ({ args }) => dockerCommand(args),
          cwd: resolvedTargetRoot,
          maxRunning: MAX_OPEN_AI_STUDIO_SESSIONS,
          namespace,
          namespaceLimitPrefix: AI_STUDIO_CODEX_TERMINAL_NAMESPACE_PREFIX,
          onClose: async ({ id }) => {
            await removeDockerContainer(codexContainerName({
              sessionId,
              terminalId: id
            }));
            await cleanupCodexAttachments(resolvedTargetRoot, sessionId);
          },
          reuseRunning: true
        }), session);
      });
    },

    async startCommandTerminal(sessionId, input = {}) {
      return aiStudioResult(async () => {
        const actionId = String(input?.actionId || "").trim();
        const runtime = await createAiStudioRuntime();
        const session = await runtime.getSession(sessionId);
        const action = aiStudioActionById(session, actionId);
        if (!action) {
          return {
            ok: false,
            error: `Action ${actionId || "(empty)"} is not available on this AI Studio step.`
          };
        }
        if (action.type !== "command") {
          return {
            ok: false,
            error: `Action ${action.label || action.id} does not run in the command terminal.`
          };
        }
        if (action.enabled !== true) {
          return {
            ok: false,
            error: action.disabledReason || `Action ${action.label || action.id} is disabled.`
          };
        }

        const commandInput = normalizePlainObject(input?.input);
        const spec = await runtime.adapter.createCommandTerminalSpec(action.id, {
          action,
          input: commandInput,
          runtime,
          session,
          store: runtime.store
        });
        if (spec?.ok === false) {
          return {
            ok: false,
            error: spec.message || `Command ${action.label || action.id} cannot start.`
          };
        }

        const namespace = aiStudioCommandTerminalNamespace(sessionId);
        return startTerminalSession({
          args: spec.args || [],
          command: spec.command,
          commandPreview: spec.commandPreview,
          cwd: spec.cwd || resolvedTargetRoot,
          maxRunning: 1,
          metadata: {
            actionId: action.id,
            actionLabel: action.label,
            sessionId
          },
          namespace,
          namespaceLimitPrefix: namespace,
          onClose: async ({ exitCode }) => {
            await writeAiStudioActionTerminalResult({
              action,
              exitCode,
              input: commandInput,
              runtime,
              session,
              spec
            });
          },
          reuseRunning: true
        });
      });
    },

    async uploadCodexAttachment(sessionId, input = {}) {
      return aiStudioResult(async () => {
        const runtime = await createAiStudioRuntime();
        await runtime.getSession(sessionId);
        const fileName = sanitizeAttachmentFileName(input?.fileName);
        const data = decodeAttachmentData(input?.dataBase64);
        if (!data || data.length < 1) {
          return {
            ok: false,
            error: "Attachment data is invalid."
          };
        }
        if (data.length > MAX_ATTACHMENT_BYTES) {
          return {
            ok: false,
            error: `Attachment is too large. Maximum size is ${Math.floor(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`
          };
        }

        const attachmentId = crypto.randomUUID();
        const hostDirectory = attachmentHostDirectory(resolvedTargetRoot, sessionId, attachmentId);
        const hostPath = path.join(hostDirectory, fileName);
        await mkdir(hostDirectory, {
          recursive: true
        });
        await writeFile(hostPath, data);
        scheduleAttachmentCleanup(resolvedTargetRoot, sessionId, attachmentId);

        return {
          ok: true,
          attachmentId,
          containerPath: attachmentContainerPath(resolvedTargetRoot, sessionId, attachmentId, fileName),
          contentType: String(input?.contentType || ""),
          expiresInMs: ATTACHMENT_TTL_MS,
          fileName,
          size: data.length
        };
      });
    },

    async saveCodexThread(sessionId, input = {}) {
      return aiStudioResult(async () => {
        const codexThreadId = normalizeCodexThreadId(input?.threadId);
        if (!codexThreadId) {
          return {
            ok: false,
            error: "Invalid Codex thread id."
          };
        }
        const runtime = await createAiStudioRuntime();
        await runtime.getSession(sessionId);
        await runtime.store.writeMetadataValue(sessionId, "codex_thread_id", codexThreadId);
        return {
          ok: true,
          codexThreadId
        };
      });
    },

    async saveCodexPromptHandoff(sessionId, input = {}) {
      return aiStudioResult(async () => {
        const signature = normalizeCodexPromptHandoffSignature(sessionId, input?.signature);
        if (!signature) {
          return {
            ok: false,
            error: "Invalid Codex prompt handoff."
          };
        }
        const runtime = await createAiStudioRuntime();
        await runtime.getSession(sessionId);
        const outputStart = normalizeCodexPromptHandoffOutputStart(input?.outputStart);
        await Promise.all([
          runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_signature", signature),
          runtime.store.writeMetadataValue(sessionId, "codex_prompt_handoff_output_start", String(outputStart))
        ]);
        return {
          ok: true,
          codexPromptHandoffOutputStart: outputStart,
          codexPromptHandoffSignature: signature
        };
      });
    },

    async readArtifacts(sessionId) {
      return aiStudioResult(async () => {
        const runtime = await createAiStudioRuntime();
        const session = await runtime.getSession(sessionId);
        return aiStudioArtifactsResponse(
          session,
          await readAiStudioEditableArtifacts(runtime, session)
        );
      });
    },

    async saveArtifacts(sessionId, input = {}) {
      return aiStudioResult(async () => {
        const runtime = await createAiStudioRuntime();
        const session = await runtime.getSession(sessionId);
        const artifacts = normalizeAiStudioArtifactInput(input);
        if (Object.keys(artifacts).length < 1) {
          return aiStudioArtifactErrorResponse(
            session,
            "ai_studio_artifacts_required",
            "At least one editable artifact is required."
          );
        }

        for (const [artifactName, artifactText] of Object.entries(artifacts)) {
          const policy = aiStudioArtifactPolicy(artifactName);
          if (!policy) {
            return aiStudioArtifactErrorResponse(
              session,
              "ai_studio_artifact_not_editable",
              `Artifact is not editable: ${artifactName}`
            );
          }
          const state = aiStudioArtifactState(session, artifactName);
          if (!state.editable) {
            return aiStudioArtifactErrorResponse(
              session,
              "ai_studio_artifact_edit_not_available",
              state.disabledReason
            );
          }
          if (!artifactText) {
            return aiStudioArtifactErrorResponse(
              session,
              "ai_studio_artifact_required",
              policy.requiredMessage || `Artifact text is required: ${artifactName}`
            );
          }
        }

        await Promise.all(Object.entries(artifacts).flatMap(([artifactName, artifactText]) => {
          const writes = [
            runtime.store.writeArtifact(sessionId, artifactName, `${artifactText}\n`)
          ];
          const metadataName = aiStudioArtifactPolicy(artifactName)?.metadataName;
          if (metadataName) {
            writes.push(runtime.store.writeMetadataValue(sessionId, metadataName, artifactText));
          }
          return writes;
        }));

        const updatedSession = await runtime.getSession(sessionId);
        return aiStudioArtifactsResponse(
          updatedSession,
          await readAiStudioEditableArtifacts(runtime, updatedSession)
        );
      });
    },

    async subscribeCodexTerminal(sessionId, terminalSessionId, subscriber) {
      const runtime = await createAiStudioRuntime();
      const session = await runtime.getSession(sessionId);
      return withAiStudioCodexState(subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: aiStudioCodexTerminalNamespace(sessionId)
      }), session);
    },

    async readCodexTerminal(sessionId, terminalSessionId) {
      const runtime = await createAiStudioRuntime();
      const session = await runtime.getSession(sessionId);
      return withAiStudioCodexState(readTerminalSession(terminalSessionId, {
        namespace: aiStudioCodexTerminalNamespace(sessionId)
      }), session);
    },

    subscribeCommandTerminal(sessionId, terminalSessionId, subscriber) {
      return subscribeTerminalSession(terminalSessionId, subscriber, {
        namespace: aiStudioCommandTerminalNamespace(sessionId)
      });
    },

    readCommandTerminal(sessionId, terminalSessionId) {
      return readTerminalSession(terminalSessionId, {
        namespace: aiStudioCommandTerminalNamespace(sessionId)
      });
    },

    writeCodexTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: aiStudioCodexTerminalNamespace(sessionId)
      });
    },

    writeCommandTerminal(sessionId, terminalSessionId, data) {
      return writeTerminalSession(terminalSessionId, data, {
        namespace: aiStudioCommandTerminalNamespace(sessionId)
      });
    },

    closeCodexTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: aiStudioCodexTerminalNamespace(sessionId)
      });
    },

    closeCommandTerminal(sessionId, terminalSessionId) {
      return closeTerminalSession(terminalSessionId, {
        namespace: aiStudioCommandTerminalNamespace(sessionId)
      });
    }
  });
}

export {
  createService,
  resolveAiStudioTargetRoot
};
