import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import {
  VIBE64_AGENT_RUN_STATE
} from "@local/vibe64-runtime/server/sessionStore";
import { vibe64SessionBriefing } from "@local/vibe64-runtime/server/vibeSessionBriefing";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_ASSISTANT_ENGINE_IDS,
  resolveVibe64AssistantSelection,
  vibe64AgentExecutionProfileAuditSnapshot,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

import { openCodeAssistantCapabilities } from "./agent/providers/opencodeAssistantCatalog.js";
import {
  aiTurnMetadata,
  projectAiPolicyInstructions,
  promptWithHiddenAiTurnContext,
  resolveAiTurnContext
} from "./aiTurnContext.js";
import {
  prepareAgentSessionCommandEnvironment
} from "./agentCommandEnvironment.js";
import {
  OPENCODE_ECONOMY_AGENT_ID,
  createOpenCodeServerProcess
} from "./opencodeServerProcess.js";
import {
  defineSessionRenewalApprovedHandover,
  defineSessionRenewalOperationId,
  parseSessionRenewalAcknowledgement,
  parseSessionRenewalHandoverOutput,
  sessionRenewalClientMessageId,
  sessionRenewalHandoverPrompt,
  sessionRenewalSeedPrompt
} from "./sessionRenewalHandover.js";
import { recordSessionGitCommandActor } from "./sessionGitCommandActor.js";
import { terminalSessionSourceRoot } from "./terminalShared.js";

const OPENCODE_AGENT_RUN_ID = "opencode_server";
const OPENCODE_CATALOG_CACHE_MS = 10 * 60 * 1000;
const OPENCODE_CATALOG_IDLE_MS = 15 * 1000;
const OPENCODE_MESSAGE_POLL_MS = 250;
const OPENCODE_SESSION_PREFIX = "ses_vibe64_";
const OPENCODE_RENEWAL_TIMEOUT_MS = 3 * 60 * 1000;

function text(value = "") {
  return String(value ?? "").trim();
}

function record(value = null) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function openCodeError(code, message, details = {}, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details };
  error.statusCode = statusCode;
  return error;
}

function safeSessionId(value = "") {
  const sessionId = text(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(sessionId)) {
    throw new TypeError("OpenCode operations require a valid Vibe64 session id.");
  }
  return sessionId;
}

function fingerprint(...values) {
  return createHash("sha256").update(values.map((value) => String(value ?? "")).join("\0")).digest("hex");
}

function upstreamSessionId(runtimeRoot = "", sessionId = "") {
  return `${OPENCODE_SESSION_PREFIX}${fingerprint(runtimeRoot, sessionId).slice(0, 40)}`;
}

function upstreamMessageId(value = "") {
  return `msg_vibe64_${fingerprint(value || randomUUID()).slice(0, 40)}`;
}

function conversationMessageId(...values) {
  return `oc_${fingerprint(...values).slice(0, 48)}`;
}

function openCodeModel(selection = {}, executionProfile = null) {
  const modelId = text(executionProfile?.model) || text(selection.modelId);
  const variantId = executionProfile
    ? text(executionProfile.thinking)
    : text(selection.variantId);
  return {
    id: modelId,
    providerID: text(selection.modelProviderId),
    ...(variantId ? { variant: variantId } : {})
  };
}

function openCodeExecutionProfile(input = {}) {
  if (!input?.executionProfile) {
    return null;
  }
  const profile = vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile);
  if (profile.profileId !== VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY) {
    throw openCodeError(
      "vibe64_opencode_execution_profile_unsupported",
      `OpenCode does not support execution profile ${profile.profileId}.`
    );
  }
  return profile;
}

function openCodeAgent(selection = {}, executionProfile = null) {
  return executionProfile ? OPENCODE_ECONOMY_AGENT_ID : text(selection.agentId);
}

function openCodeDetachedPrompt(input = {}) {
  const prompt = text(input.prompt || input.message);
  if (!input.outputSchema) {
    return prompt;
  }
  return [
    prompt,
    "",
    "Return only one JSON value matching this JSON Schema. Do not wrap it in Markdown code fences:",
    JSON.stringify(input.outputSchema)
  ].join("\n");
}

function boundedOpenCodeExecutionInput(prompt = "", executionProfile = null) {
  if (!executionProfile) {
    return;
  }
  if (prompt.length > executionProfile.limits.maxInputCharacters) {
    throw openCodeError(
      "vibe64_opencode_execution_input_too_large",
      "The bounded OpenCode helper input exceeded its execution-profile limit.",
      { maximum: executionProfile.limits.maxInputCharacters },
      413
    );
  }
}

function boundedOpenCodeExecutionOutput(result = {}, executionProfile = null) {
  if (
    executionProfile &&
    String(result.text || "").length > executionProfile.limits.maxOutputCharacters
  ) {
    throw openCodeError(
      "vibe64_opencode_execution_output_too_large",
      "The bounded OpenCode helper output exceeded its execution-profile limit.",
      { maximum: executionProfile.limits.maxOutputCharacters },
      502
    );
  }
  return result;
}

function openCodeExecutionTimeout(input = {}, executionProfile = null) {
  const requested = Number(input.timeoutMs);
  const requestedTimeout = Number.isSafeInteger(requested) && requested > 0 ? requested : 0;
  if (!executionProfile) {
    return requestedTimeout;
  }
  return requestedTimeout
    ? Math.min(requestedTimeout, executionProfile.limits.timeoutMs)
    : executionProfile.limits.timeoutMs;
}

function openCodeSelection(session = {}) {
  const selection = vibe64AssistantSelectionFromMetadata(session?.metadata, {
    required: false
  });
  if (!selection || selection.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE) {
    throw openCodeError(
      "vibe64_opencode_selection_required",
      "This session does not have a durable OpenCode selection."
    );
  }
  return selection;
}

function openCodeSessionInstructions(session = {}, policy = {}) {
  return [
    vibe64SessionBriefing({ session }),
    "",
    "Session briefing instruction:",
    "Keep this Vibe64 briefing as the source of truth for this OpenCode session. Do not start project work from this briefing alone.",
    "",
    "Live progress instruction:",
    "Keep progress updates short, calm, and friendly to non-technical users.",
    "Describe visible work in plain language. Reserve detailed commands and logs for the final answer when they matter.",
    "",
    "GitHub operation instruction:",
    "`git` and `gh` are available through Vibe64's session-scoped command boundary.",
    "They run as the GitHub account recorded as this session's Git command actor.",
    "If GitHub authentication is unavailable, report the command error clearly instead of trying to log in or inspect credentials.",
    "",
    projectAiPolicyInstructions(policy)
  ].join("\n").trim();
}

function connectionIdentity(connection = {}, apiKey = "") {
  const value = text(connection.fingerprint);
  return /^sha256:[a-f0-9]{64}$/u.test(value)
    ? value
    : `sha256:${fingerprint(apiKey)}`;
}

function requireOpenCodeConnection(value = null, modelProviderId = "") {
  const connection = record(value);
  const apiKey = String(connection.apiKey || connection.key || "");
  const actualProviderId = text(
    connection.modelProviderId || connection.providerId || connection.id || modelProviderId
  );
  if (!apiKey || actualProviderId !== text(modelProviderId)) {
    throw openCodeError(
      "vibe64_assistant_connection_required",
      `Connect ${text(modelProviderId) || "this provider"} with an API key before using OpenCode.`,
      { modelProviderId: text(modelProviderId) }
    );
  }
  const canonicalUrl = text(connection.canonicalUrl);
  const endpointCode = text(connection.endpointCode);
  if (
    !canonicalUrl ||
    !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(endpointCode)
  ) {
    throw openCodeError(
      "vibe64_assistant_connection_route_invalid",
      "The selected OpenCode connection has no billing endpoint. Ask the owner to choose one.",
      { modelProviderId: actualProviderId }
    );
  }
  return {
    apiKey,
    canonicalUrl,
    economyModelId: text(connection.economyModelId),
    endpointCode,
    fingerprint: connectionIdentity(connection, apiKey),
    modelProviderId: actualProviderId
  };
}

function openCodeMessageRows(value = null) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
  return rows
    .map((message, index) => ({ index, message }))
    .sort((left, right) => (
      (Number(left.message?.time?.created) || 0) - (Number(right.message?.time?.created) || 0) ||
      left.index - right.index
    ))
    .map(({ message }) => message);
}

function openCodeMessageResultForInput(value = null, inputMessageId = "") {
  const rows = openCodeMessageRows(value);
  const index = rows.findIndex((message) => text(message?.id) === text(inputMessageId));
  if (index < 0) {
    return null;
  }
  const turnRows = rows.slice(index + 1);
  const nextUserIndex = turnRows.findIndex((message) => message?.type === "user");
  const assistantRows = (nextUserIndex < 0 ? turnRows : turnRows.slice(0, nextUserIndex))
    .filter((message) => message?.type === "assistant");
  if (!assistantRows.length) {
    return { admitted: true, complete: false, error: "", text: "", turnId: "" };
  }
  const result = lastAssistantResult(assistantRows);
  return {
    admitted: true,
    complete: Boolean(result.message?.time?.completed || result.message?.finish || result.error),
    error: result.error,
    text: result.text,
    turnId: text(result.message?.id)
  };
}

function assistantMessageText(message = {}) {
  const values = [
    text(message.text),
    ...(Array.isArray(message.content) ? message.content : [])
      .filter((part) => part?.type === "text")
      .map((part) => text(part.text))
  ].filter(Boolean);
  return [...new Set(values)].join("\n\n");
}

function lastAssistantResult(value = null) {
  const message = [...openCodeMessageRows(value)]
    .reverse()
    .find((candidate) => candidate?.type === "assistant");
  return {
    error: text(message?.error?.message || message?.error),
    message,
    text: assistantMessageText(message)
  };
}

function latestOpenCodeMessageResult(value = null) {
  const result = lastAssistantResult(value);
  if (!result.message) {
    return null;
  }
  return {
    admitted: true,
    complete: Boolean(result.message.time?.completed || result.message.finish || result.error),
    error: result.error,
    text: result.text,
    turnId: text(result.message.id)
  };
}

async function waitForOpenCodeMessages(client, conversationId = "", inputMessageId = "", {
  signal
} = {}) {
  const resolveInputMessageId = typeof inputMessageId === "function"
    ? inputMessageId
    : () => text(inputMessageId);
  let completedInputMessageId = null;
  while (true) {
    signal?.throwIfAborted();
    const expectedInputMessageId = text(resolveInputMessageId());
    const messages = await client.messages(conversationId, {
      limit: 100,
      order: "desc"
    }, { signal });
    const result = expectedInputMessageId
      ? openCodeMessageResultForInput(messages, expectedInputMessageId)
      : latestOpenCodeMessageResult(messages);
    if (result?.complete) {
      if (completedInputMessageId === expectedInputMessageId) {
        return { messages, result };
      }
      completedInputMessageId = expectedInputMessageId;
    } else {
      completedInputMessageId = null;
    }
    await delay(OPENCODE_MESSAGE_POLL_MS, undefined, { signal });
  }
}

function eventSummary(event = {}) {
  const payload = record(event.data);
  const properties = record(payload.properties);
  const data = Object.keys(properties).length ? properties : record(payload.data);
  const info = record(data.info);
  const part = record(data.part);
  const model = record(info.model || data.model);
  return {
    agent: text(info.agent || data.agent),
    at: Number(data.timestamp || part.time?.start || part.time?.created) || Date.now(),
    eventId: text(event.id || payload.id || part.id),
    modelId: text(model.id || model.modelID || info.modelID),
    modelProviderId: text(model.providerID || info.providerID),
    text: ["reasoning", "text"].includes(text(part.type))
      ? text(part.text || data.delta).slice(0, 32_000)
      : ["session.next.text.ended", "session.next.reasoning.ended"].includes(text(payload.type))
        ? text(data.text).slice(0, 32_000)
        : "",
    tool: text(part.tool || data.tool),
    type: text(payload.type || event.event)
  };
}

function openCodeTurnSnapshot(turn = null, threadId = "") {
  const source = record(turn);
  const active = source.active === true;
  return active || text(source.id)
    ? {
        active,
        error: text(source.error),
        id: text(source.id),
        startedAt: text(source.startedAt),
        state: text(source.state) || (active ? "active" : "completed"),
        status: text(source.state) || (active ? "active" : "completed"),
        threadId: text(source.threadId || threadId),
        updatedAt: text(source.updatedAt)
      }
    : null;
}

function createOpenCodeTerminalController({
  agentDatabaseCommand = null,
  agentEnvCommand = null,
  agentPreviewCommand = null,
  codexGitCommand = null,
  command = "opencode",
  createServerProcess = createOpenCodeServerProcess,
  env = process.env,
  listConnections = async () => [],
  prepareCommandEnvironment = prepareAgentSessionCommandEnvironment,
  projectService,
  publishSessionChanged = async () => null,
  recordGitActor = recordSessionGitCommandActor,
  resolveConnection = async () => null
} = {}) {
  if (!projectService) {
    throw new TypeError("OpenCode terminal controllers require vibe64.project.");
  }
  const processes = new Map();
  const processStarts = new Map();
  const monitors = new Map();
  const turns = new Map();
  const temporaryConversations = new Map();
  const processExitProofs = new Map();
  let catalogProcess = null;
  let catalogStart = null;
  let catalogIdleTimer = null;
  let catalogSnapshot = null;
  let closed = false;

  async function contextFor(sessionId = "", options = {}) {
    const id = safeSessionId(sessionId);
    const runtime = options.runtime || await projectService.createRuntime({
      inspectSource: false
    });
    const session = options.session?.sessionId === id
      ? options.session
      : await runtime.getSession(id, { inspectSource: false });
    if (!session) {
      throw openCodeError("vibe64_session_not_found", "Vibe64 session is not available.", {
        sessionId: id
      }, 404);
    }
    const workdir = terminalSessionSourceRoot(session);
    if (!workdir || !text(session.sessionRoot) || !text(runtime.stateRoot)) {
      throw openCodeError(
        "vibe64_opencode_session_roots_missing",
        "OpenCode cannot start until the session workspace and state roots are ready.",
        { sessionId: id }
      );
    }
    return {
      key: `${path.resolve(runtime.stateRoot)}\0${id}`,
      runtime,
      session,
      sessionId: id,
      selection: openCodeSelection(session),
      workdir: path.resolve(workdir)
    };
  }

  function catalogRoots(runtime = {}) {
    const root = path.join(path.resolve(runtime.stateRoot), "assistant-runtimes", "opencode");
    return {
      cacheRoot: path.join(root, "cache"),
      dbPath: path.join(root, "catalog", "opencode.db"),
      privateRoot: path.join(root, "catalog", `private-${randomUUID()}`),
      workdir: path.resolve(runtime.projectContextRoot || runtime.stateRoot)
    };
  }

  function projectExecutionSlug(runtime = {}) {
    return text(path.basename(path.resolve(runtime.projectContextRoot || runtime.stateRoot)));
  }

  function scheduleCatalogStop() {
    clearTimeout(catalogIdleTimer);
    catalogIdleTimer = setTimeout(() => {
      const target = catalogProcess;
      catalogProcess = null;
      void target?.stop().catch(() => null);
    }, OPENCODE_CATALOG_IDLE_MS);
    catalogIdleTimer.unref?.();
  }

  async function ensureCatalogProcess() {
    if (catalogProcess) {
      scheduleCatalogStop();
      return catalogProcess;
    }
    if (catalogStart) {
      return catalogStart;
    }
    catalogStart = Promise.resolve().then(async () => {
      const runtime = await projectService.createRuntime({ inspectSource: false });
      const roots = catalogRoots(runtime);
      const started = await createServerProcess({
        cacheRoot: roots.cacheRoot,
        command,
        dbPath: roots.dbPath,
        env,
        execution: {
          label: "OpenCode model catalogue",
          operationId: "opencode-catalog",
          ownerId: `opencode-catalog-${fingerprint(runtime.stateRoot).slice(0, 40)}`,
          projectSlug: projectExecutionSlug(runtime)
        },
        privateRoot: roots.privateRoot,
        workdir: roots.workdir
      });
      catalogProcess = started;
      scheduleCatalogStop();
      return started;
    });
    try {
      return await catalogStart;
    } finally {
      catalogStart = null;
    }
  }

  async function readCatalog() {
    if (catalogSnapshot && Date.now() - catalogSnapshot.readAt < OPENCODE_CATALOG_CACHE_MS) {
      return catalogSnapshot;
    }
    const server = await ensureCatalogProcess();
    const [providers, agents] = await Promise.all([
      server.client.providers({ directory: server.workdir }),
      server.client.agents({ directory: server.workdir })
    ]);
    catalogSnapshot = {
      agents,
      providers,
      readAt: Date.now()
    };
    scheduleCatalogStop();
    return catalogSnapshot;
  }

  async function capabilities(input = {}, options = {}) {
    const [catalog, connections] = await Promise.all([
      readCatalog(),
      listConnections({
        engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
        vibe64User: options.vibe64User || null
      })
    ]);
    return openCodeAssistantCapabilities({
      agents: catalog.agents,
      connections,
      input,
      providers: catalog.providers
    });
  }

  function processRoots(context = {}) {
    const root = path.join(
      path.resolve(context.runtime.stateRoot),
      "assistant-runtimes",
      "opencode"
    );
    const privateSessionRoot = path.join(root, "private", context.sessionId);
    return {
      cacheRoot: path.join(root, "cache"),
      dbPath: path.join(path.resolve(context.session.sessionRoot), "opencode", "opencode.db"),
      privateRoot: path.join(privateSessionRoot, randomUUID()),
      privateSessionRoot
    };
  }

  function renewalSession(context = {}) {
    return Boolean(text(context.session?.metadata?.renewed_from));
  }

  async function writeSessionMetadata(context = {}, values = {}) {
    const store = context.runtime?.store;
    const entries = Object.entries(values)
      .filter(([name, value]) => text(name) && value !== undefined && value !== null);
    if (!entries.length) {
      return;
    }
    const internal = renewalSession(context) &&
      typeof store?.writeMetadataValueForRenewal === "function";
    const write = internal
      ? store.writeMetadataValueForRenewal.bind(store)
      : store?.writeMetadataValue?.bind(store);
    const mutate = internal
      ? store?.mutateSessionForRenewal?.bind(store)
      : store?.mutateSession?.bind(store);
    if (typeof write !== "function") {
      throw new TypeError("OpenCode requires writable Vibe64 session metadata.");
    }
    const operation = async () => {
      await Promise.all(entries.map(([name, value]) => (
        write(context.sessionId, name, String(value))
      )));
    };
    if (typeof mutate === "function") {
      await mutate(context.sessionId, operation);
    } else {
      await operation();
    }
  }

  async function managedCommandEnvironment(context = {}) {
    if (!codexGitCommand) {
      return { env: {}, shimDirs: [] };
    }
    const project = typeof projectService?.readCurrentProject === "function"
      ? await projectService.readCurrentProject()
      : projectService?.selectedProject || {};
    const prepared = await prepareCommandEnvironment({
      agentDatabaseCommand,
      agentEnvCommand,
      agentPreviewCommand,
      env,
      gitCommand: codexGitCommand,
      project,
      runtime: context.runtime,
      sessionId: context.sessionId,
      worktreePath: context.workdir
    });
    if (prepared?.ok !== true) {
      throw openCodeError(
        "vibe64_opencode_command_boundary_unavailable",
        "Vibe64 could not prepare session-scoped Git commands for OpenCode.",
        {},
        503
      );
    }
    return {
      env: record(prepared.env),
      shimDirs: prepared.shimDirs
    };
  }

  async function stopProcessRecord(target = null) {
    if (!target) {
      return { exited: true };
    }
    target.abortController.abort();
    const proof = await target.server.stop();
    if (target.sessionId) {
      processExitProofs.set(target.sessionId, proof);
    }
    if (processes.get(target.key) === target) {
      processes.delete(target.key);
    }
    return proof;
  }

  async function ensureProcess(context = {}, options = {}) {
    if (closed) {
      throw openCodeError("vibe64_opencode_closed", "The OpenCode bridge is shutting down.", {}, 503);
    }
    const currentCapabilities = await capabilities({
      limit: "1",
      modelId: context.selection.modelId,
      modelProviderId: context.selection.modelProviderId
    }, options);
    resolveVibe64AssistantSelection(currentCapabilities, {
      ...context.selection,
      catalogRevision: currentCapabilities.revision
    });
    const connection = requireOpenCodeConnection(await resolveConnection({
      engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
      modelProviderId: context.selection.modelProviderId,
      sessionId: context.sessionId,
      vibe64User: options.vibe64User || null
    }), context.selection.modelProviderId);
    const existing = processes.get(context.key);
    if (
      existing &&
      existing.connectionFingerprint === connection.fingerprint &&
      existing.endpointCode === connection.endpointCode &&
      existing.modelProviderId === connection.modelProviderId &&
      existing.workdir === context.workdir
    ) {
      try {
        await existing.server.client.health({ signal: AbortSignal.timeout(1_000) });
        existing.selection = context.selection;
        return existing;
      } catch {
        await stopProcessRecord(existing).catch(() => null);
      }
    } else if (existing) {
      await stopProcessRecord(existing);
    }
    const pending = processStarts.get(context.key);
    if (pending) {
      return pending;
    }
    const start = Promise.resolve().then(async () => {
      const roots = processRoots(context);
      const commands = await managedCommandEnvironment(context);
      await rm(roots.privateSessionRoot, { force: true, recursive: true });
      const server = await createServerProcess({
        apiKey: connection.apiKey,
        cacheRoot: roots.cacheRoot,
        canonicalUrl: connection.canonicalUrl,
        command,
        dbPath: roots.dbPath,
        env,
        execution: {
          label: "OpenCode assistant",
          operationId: "opencode-server",
          ownerId: context.sessionId,
          projectSlug: projectExecutionSlug(context.runtime),
          sessionId: context.sessionId
        },
        managedEnv: commands.env,
        modelProviderId: connection.modelProviderId,
        privateRoot: roots.privateRoot,
        shimDirs: commands.shimDirs,
        workdir: context.workdir
      });
      const created = {
        abortController: new AbortController(),
        connectionFingerprint: connection.fingerprint,
        endpointCode: connection.endpointCode,
        key: context.key,
        modelProviderId: connection.modelProviderId,
        selection: context.selection,
        server,
        sessionId: context.sessionId,
        upstreamSessionId: upstreamSessionId(context.runtime.stateRoot, context.sessionId),
        workdir: context.workdir
      };
      processes.set(context.key, created);
      return created;
    });
    processStarts.set(context.key, start);
    try {
      return await start;
    } finally {
      if (processStarts.get(context.key) === start) {
        processStarts.delete(context.key);
      }
    }
  }

  async function ensureUpstreamSession(context = {}, options = {}) {
    const target = await ensureProcess(context, options);
    let upstream = null;
    try {
      upstream = await target.server.client.readSession(target.upstreamSessionId);
    } catch (error) {
      if (error?.statusCode !== 404) {
        throw error;
      }
    }
    if (!upstream) {
      upstream = await target.server.client.createSession({
        agent: context.selection.agentId,
        id: target.upstreamSessionId,
        location: { directory: context.workdir },
        model: openCodeModel(context.selection)
      });
    } else {
      await target.server.client.switchModel(
        target.upstreamSessionId,
        openCodeModel(context.selection)
      );
      await target.server.client.switchAgent(
        target.upstreamSessionId,
        context.selection.agentId
      );
    }
    if (
      text(context.session?.metadata?.agent_identity_conversation_id) !== target.upstreamSessionId ||
      text(context.session?.metadata?.agent_identity_provider) !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE ||
      text(context.session?.metadata?.agent_transport_id) !== "opencode_server"
    ) {
      const capturedAt = new Date().toISOString();
      await writeSessionMetadata(context, {
        agent_identity_captured_at: capturedAt,
        agent_identity_conversation_id: target.upstreamSessionId,
        agent_identity_provider: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
        agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready",
        agent_identity_updated_at: capturedAt,
        agent_identity_workdir: context.workdir,
        agent_transport_id: "opencode_server",
        agent_transport_kind: "loopback-http"
      });
    }
    return { ...target, upstream };
  }

  async function publishConversationTurn(context = {}, turn = null, reason = "") {
    if (!turn) {
      return;
    }
    await publishSessionChanged(context.sessionId, {
      payload: {
        conversationLogPatch: {
          turn,
          type: "upsert-turn"
        }
      },
      reason
    });
  }

  async function writeConversationProjection(context = {}, messages = null) {
    let failure = "";
    for (const message of openCodeMessageRows(messages)) {
      if (message?.type !== "assistant") {
        continue;
      }
      failure ||= text(message.error?.message || message.error);
      const parts = Array.isArray(message.content) ? message.content : [];
      for (const part of parts.filter((candidate) => candidate?.type === "reasoning" && text(candidate.text))) {
        const turn = await context.runtime.store.writeConversationThinkingMessage(context.sessionId, {
          at: message.time?.created ? new Date(message.time.created).toISOString() : "",
          messageId: conversationMessageId(message.id, part.id, "reasoning"),
          text: text(part.text)
        });
        await publishConversationTurn(context, turn, "opencode-server-reasoning");
      }
      for (const part of parts.filter((candidate) => candidate?.type === "tool")) {
        const status = text(part.state?.status || part.state?.type) || "used";
        const turn = await context.runtime.store.writeConversationCommentaryMessage(context.sessionId, {
          at: part.time?.created ? new Date(part.time.created).toISOString() : "",
          messageId: conversationMessageId(message.id, part.id, "tool"),
          text: `${text(part.name) || "Tool"}: ${status}`
        });
        await publishConversationTurn(context, turn, "opencode-server-tool");
      }
      const assistantText = assistantMessageText(message);
      if (assistantText) {
        const turn = await context.runtime.store.writeConversationAssistantMessage(context.sessionId, {
          messageId: conversationMessageId(message.id, "assistant"),
          text: assistantText
        });
        await publishConversationTurn(context, turn, "opencode-server-assistant-message");
      }
    }
    return { failure };
  }

  async function writeRun(context = {}, turn = {}, state = VIBE64_AGENT_RUN_STATE.ACTIVE, error = "") {
    if (typeof context.runtime.store?.writeAgentRunEvent !== "function") {
      return null;
    }
    return context.runtime.store.writeAgentRunEvent(context.sessionId, OPENCODE_AGENT_RUN_ID, {
      event: {
        kind: `opencode-${state}`,
        message: error,
        state
      },
      patch: {
        engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
        error,
        model: context.selection.modelId,
        modelProviderId: context.selection.modelProviderId,
        state,
        threadId: text(turn.threadId),
        turnId: text(turn.id)
      }
    });
  }

  async function consumeEvents(target = {}, context = {}, after = "", {
    onEvent = null,
    signal
  } = {}) {
    for await (const event of target.server.client.events(target.upstreamSessionId, {
      after,
      signal
    })) {
      const summary = eventSummary(event);
      if (summary.type && typeof onEvent === "function") {
        onEvent({
          ...summary,
          threadId: target.upstreamSessionId,
          turnId: turns.get(context.key)?.id || ""
        });
      }
      if (summary.type) {
        await publishSessionChanged(context.sessionId, {
          payload: { assistantProgress: summary },
          reason: "opencode-server-progress"
        });
      }
    }
  }

  function beginMonitor(target = {}, context = {}, admitted = {}, options = {}) {
    const existing = monitors.get(context.key);
    if (existing) {
      return existing;
    }
    const startedAt = new Date().toISOString();
    const turn = {
      active: true,
      error: "",
      id: text(admitted.id),
      inputMessageId: text(admitted.id),
      startedAt,
      state: "active",
      threadId: target.upstreamSessionId,
      updatedAt: startedAt
    };
    turns.set(context.key, turn);
    const monitor = Promise.resolve().then(async () => {
      await writeRun(context, turn, VIBE64_AGENT_RUN_STATE.ACTIVE);
      const eventAbort = new AbortController();
      const abortEvents = () => eventAbort.abort();
      target.abortController.signal.addEventListener("abort", abortEvents, { once: true });
      const events = consumeEvents(target, context, String(admitted.admittedSeq ?? ""), {
        onEvent: options.onEvent,
        signal: eventAbort.signal
      }).catch((error) => {
        if (error?.name !== "AbortError") {
          vibe64SessionDebugLog("server.opencode.events.error", {
            error: vibe64SessionDebugError(error),
            sessionId: context.sessionId
          });
        }
      });
      let finalState = VIBE64_AGENT_RUN_STATE.COMPLETED;
      let failure = "";
      try {
        const completion = await waitForOpenCodeMessages(
          target.server.client,
          target.upstreamSessionId,
          () => turn.inputMessageId,
          {
          signal: target.abortController.signal
          }
        );
        const projection = await writeConversationProjection(context, completion.messages);
        failure = projection.failure;
        if (failure) {
          finalState = VIBE64_AGENT_RUN_STATE.FAILED;
        } else if (turn.interruptRequested) {
          finalState = VIBE64_AGENT_RUN_STATE.INTERRUPTED;
        }
      } catch (error) {
        failure = text(error?.message) || "OpenCode turn failed.";
        finalState = target.abortController.signal.aborted
          ? VIBE64_AGENT_RUN_STATE.CANCELLED
          : VIBE64_AGENT_RUN_STATE.FAILED;
      } finally {
        eventAbort.abort();
        await events;
        target.abortController.signal.removeEventListener("abort", abortEvents);
        turn.active = false;
        turn.error = failure;
        turn.state = finalState;
        turn.updatedAt = new Date().toISOString();
        await writeRun(context, turn, finalState, failure).catch(() => null);
        await publishSessionChanged(context.sessionId, {
          reason: "opencode-server-turn-idle"
        });
      }
      return openCodeTurnSnapshot(turn, target.upstreamSessionId);
    }).finally(() => {
      if (monitors.get(context.key) === monitor) {
        monitors.delete(context.key);
      }
    });
    monitors.set(context.key, monitor);
    void monitor.catch((error) => {
      vibe64SessionDebugLog("server.opencode.turn.error", {
        error: vibe64SessionDebugError(error),
        sessionId: context.sessionId
      });
    });
    return monitor;
  }

  async function sendMessage(sessionId = "", input = {}, options = {}) {
    const message = text(input.message);
    if (!message) {
      return {
        code: "vibe64_opencode_message_empty",
        delivered: false,
        error: "OpenCode message input is empty.",
        ok: false
      };
    }
    const context = await contextFor(sessionId, options);
    const messageId = text(input.messageId) || randomUUID();
    if (
      typeof context.runtime.store?.conversationMessageIdExists === "function" &&
      await context.runtime.store.conversationMessageIdExists(context.sessionId, messageId)
    ) {
      const currentTurn = openCodeTurnSnapshot(turns.get(context.key));
      return {
        delivered: true,
        duplicate: true,
        ok: true,
        thread: { id: currentTurn?.threadId || upstreamSessionId(context.runtime.stateRoot, context.sessionId) },
        turn: currentTurn
      };
    }
    const currentMonitor = monitors.get(context.key);
    const currentTurn = turns.get(context.key);
    const currentThreadId = upstreamSessionId(context.runtime.stateRoot, context.sessionId);
    const ownershipMatchesTurn = Boolean(
      currentMonitor &&
      options.turnOwnership &&
      text(options.turnOwnership.threadId) === currentThreadId &&
      text(options.turnOwnership.turnId) === text(currentTurn?.id)
    );
    if (ownershipMatchesTurn && options.turnOwnership.reusable !== true) {
      return {
        code: "vibe64_agent_turn_owner_conflict",
        delivered: false,
        error: "This assistant turn belongs to another user. Your message will be sent when that turn finishes.",
        ok: false,
        refreshRecommended: true,
        retryable: true,
        thread: { id: currentThreadId },
        turn: openCodeTurnSnapshot(currentTurn, currentThreadId)
      };
    }
    const actor = await recordGitActor({
      env,
      overwrite: !currentMonitor,
      reason: "agent-message",
      runtime: context.runtime,
      session: context.session,
      sourceRoot: terminalSessionSourceRoot(context.session),
      threadId: currentThreadId,
      vibe64User: options.vibe64User || null,
      workdir: context.workdir
    });
    if (actor?.ok === false) {
      return {
        code: actor.code || "vibe64_opencode_git_actor_unavailable",
        delivered: false,
        error: actor.error || "GitHub identity is not available for this OpenCode message.",
        ok: false,
        refreshRecommended: true,
        retryable: true
      };
    }
    const target = await ensureUpstreamSession(context, options);
    const aiContext = await resolveAiTurnContext({
      projectService,
      vibe64User: options.vibe64User || null
    });
    const rendered = typeof context.runtime.renderPrompt === "function"
      ? await context.runtime.renderPrompt(context.sessionId, {
          input,
          request: message,
          task: "work"
        })
      : { prompt: message };
    const renderedPrompt = text(rendered?.prompt) || message;
    const admitted = await target.server.client.prompt(target.upstreamSessionId, {
      agent: context.selection.agentId,
      delivery: currentMonitor ? "steer" : "queue",
      id: upstreamMessageId(messageId),
      model: openCodeModel(context.selection),
      prompt: {
        text: promptWithHiddenAiTurnContext([
          openCodeSessionInstructions(actor?.session || context.session, aiContext.policy),
          renderedPrompt
        ].join("\n\n"), aiContext)
      },
      resume: true
    });
    const conversationTurn = await context.runtime.store.writeConversationUserMessage(
      context.sessionId,
      {
        messageId,
        text: text(input.displayMessage) || message,
        turnMetadata: {
          assistantSelection: context.selection,
          ...aiTurnMetadata(aiContext),
          engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
          upstreamMessageId: text(admitted?.id)
        }
      }
    );
    await publishConversationTurn(context, conversationTurn, "opencode-server-message-delivered");
    const activeMonitor = monitors.get(context.key);
    if (activeMonitor) {
      const activeTurn = turns.get(context.key);
      activeTurn.inputMessageId = text(admitted.id);
      activeTurn.updatedAt = new Date().toISOString();
    } else {
      beginMonitor(target, context, admitted, options);
    }
    const turn = openCodeTurnSnapshot(turns.get(context.key), target.upstreamSessionId);
    return {
      conversationTurn,
      delivered: true,
      deliveryMode: currentMonitor ? "steer" : "new_turn",
      ok: true,
      thread: { id: target.upstreamSessionId },
      turn,
      workdir: context.workdir
    };
  }

  async function readDetachedConversation(target = {}, conversationId = "") {
    const messages = await target.server.client.messages(conversationId, {
      limit: 100,
      order: "desc"
    });
    const result = lastAssistantResult(messages);
    return {
      conversationId,
      error: result.error,
      ok: !result.error,
      status: result.error ? "failed" : "completed",
      text: result.text
    };
  }

  async function createConversation(sessionId = "", input = {}, options = {}) {
    const context = await contextFor(sessionId, options);
    const target = await ensureProcess(context, options);
    const executionProfile = openCodeExecutionProfile(input);
    const conversation = await target.server.client.createSession({
      agent: openCodeAgent(context.selection, executionProfile),
      location: { directory: context.workdir },
      model: openCodeModel(context.selection)
    });
    temporaryConversations.set(`${context.key}\0${conversation.id}`, {
      active: false,
      target
    });
    return {
      conversationId: conversation.id,
      ephemeral: input.ephemeral === true,
      ok: true,
      status: "ready"
    };
  }

  async function detachedTarget(sessionId = "", input = {}, options = {}, {
    createIfMissing = true
  } = {}) {
    const context = await contextFor(sessionId, options);
    const target = await ensureProcess(context, options);
    const executionProfile = openCodeExecutionProfile(input);
    const agent = openCodeAgent(context.selection, executionProfile);
    let conversationId = text(input.conversationId || input.threadId);
    if (!conversationId) {
      if (!createIfMissing) {
        throw openCodeError(
          "vibe64_opencode_conversation_id_required",
          "OpenCode conversation id is required.",
          {},
          400
        );
      }
      const created = await target.server.client.createSession({
        agent,
        location: { directory: context.workdir },
        model: openCodeModel(context.selection, executionProfile)
      });
      conversationId = created.id;
    } else {
      await target.server.client.switchModel(
        conversationId,
        openCodeModel(context.selection, executionProfile)
      );
      await target.server.client.switchAgent(conversationId, agent);
    }
    const key = `${context.key}\0${conversationId}`;
    const tracked = temporaryConversations.get(key) || { active: false, target };
    tracked.target = target;
    temporaryConversations.set(key, tracked);
    return { context, conversationId, executionProfile, key, target, tracked };
  }

  async function existingDetachedTarget(sessionId = "", input = {}, options = {}) {
    const context = await contextFor(sessionId, options);
    const target = processes.get(context.key) || null;
    const conversationId = text(input.conversationId || input.threadId);
    if (!conversationId) {
      throw openCodeError(
        "vibe64_opencode_conversation_id_required",
        "OpenCode conversation id is required.",
        {},
        400
      );
    }
    return {
      context,
      conversationId,
      key: `${context.key}\0${conversationId}`,
      target
    };
  }

  function openCodeReadUnavailable() {
    return openCodeError(
      "vibe64_opencode_process_not_running",
      "The OpenCode conversation is not connected. Reading it must not start AI infrastructure.",
      {},
      409
    );
  }

  async function runDetachedChatTurn(sessionId = "", input = {}, options = {}) {
    const prompt = openCodeDetachedPrompt(input);
    if (!prompt) {
      throw openCodeError("vibe64_opencode_prompt_empty", "OpenCode prompt input is empty.", {}, 400);
    }
    boundedOpenCodeExecutionInput(prompt, openCodeExecutionProfile(input));
    const {
      context,
      conversationId,
      executionProfile,
      target,
      tracked
    } = await detachedTarget(sessionId, input, options);
    options.onEvent?.({
      threadId: conversationId,
      type: "thread"
    });
    const inputMessageId = upstreamMessageId(input.messageId || input.operationId || randomUUID());
    const admitted = await target.server.client.prompt(conversationId, {
      agent: openCodeAgent(context.selection, executionProfile),
      delivery: "queue",
      id: inputMessageId,
      model: openCodeModel(context.selection, executionProfile),
      prompt: { text: prompt },
      resume: true
    });
    const eventAbort = new AbortController();
    const events = typeof options.onEvent === "function"
      ? consumeEvents({ ...target, upstreamSessionId: conversationId }, context, String(admitted.admittedSeq ?? ""), {
          onEvent: options.onEvent,
          signal: eventAbort.signal
        }).catch((error) => {
          if (error?.name !== "AbortError") {
            throw error;
          }
        })
      : Promise.resolve();
    tracked.active = true;
    try {
      const timeoutMs = openCodeExecutionTimeout(input, executionProfile);
      await waitForOpenCodeMessages(target.server.client, conversationId, inputMessageId, {
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined
      });
    } catch (error) {
      await target.server.client.interrupt(conversationId).catch(() => null);
      throw error;
    } finally {
      tracked.active = false;
      eventAbort.abort();
      await events;
    }
    const result = boundedOpenCodeExecutionOutput(
      await readDetachedConversation(target, conversationId),
      executionProfile
    );
    return {
      ...result,
      runId: text(admitted.id),
      threadId: conversationId,
      turnId: text(admitted.id)
    };
  }

  async function runRenewalTurn(target = {}, {
    clientMessageId = "",
    prompt = ""
  } = {}) {
    const inputMessageId = upstreamMessageId(clientMessageId);
    let messages = await target.server.client.messages(target.upstreamSessionId, {
      limit: 100,
      order: "desc"
    });
    let result = openCodeMessageResultForInput(messages, inputMessageId);
    let admitted = null;
    if (!result) {
      admitted = await target.server.client.prompt(target.upstreamSessionId, {
        agent: text(target.selection?.agentId),
        delivery: "queue",
        id: inputMessageId,
        model: openCodeModel(target.selection),
        prompt: { text: String(prompt || "") },
        resume: true
      });
    }
    if (!result?.complete) {
      const completion = await waitForOpenCodeMessages(
        target.server.client,
        target.upstreamSessionId,
        inputMessageId,
        {
        signal: AbortSignal.timeout(OPENCODE_RENEWAL_TIMEOUT_MS)
        }
      );
      messages = completion.messages;
      result = completion.result;
    }
    if (!result?.complete || (!result.text && !result.error)) {
      throw openCodeError(
        "vibe64_session_renewal_turn_unreadable",
        "The exact OpenCode renewal turn did not produce a readable result.",
        { clientMessageId, threadId: target.upstreamSessionId },
        502
      );
    }
    if (result.error) {
      throw openCodeError(
        "vibe64_session_renewal_turn_failed",
        result.error,
        { clientMessageId, threadId: target.upstreamSessionId, turnId: result.turnId },
        502
      );
    }
    return {
      admitted,
      clientMessageId,
      reconciled: !admitted,
      text: result.text,
      threadId: target.upstreamSessionId,
      turnId: result.turnId || text(admitted?.id)
    };
  }

  async function generateSessionRenewalHandover(sessionId = "", input = {}, options = {}) {
    const operationId = defineSessionRenewalOperationId(input.operationId || input.operationKey);
    const context = await contextFor(sessionId, options);
    const target = await ensureUpstreamSession(context, options);
    const expectedThreadId = text(input.expectedThreadId);
    if (expectedThreadId && expectedThreadId !== target.upstreamSessionId) {
      throw openCodeError(
        "vibe64_session_renewal_thread_mismatch",
        "The OpenCode predecessor history changed before handover generation.",
        { actualThreadId: target.upstreamSessionId, expectedThreadId }
      );
    }
    const clientMessageId = sessionRenewalClientMessageId("handover", operationId);
    const result = await runRenewalTurn(target, {
      clientMessageId,
      prompt: sessionRenewalHandoverPrompt({ source: input.source })
    });
    const parsed = parseSessionRenewalHandoverOutput(result.text, {
      source: input.source
    });
    await writeSessionMetadata(context, {
      agent_renewal_handover_hash: parsed.handoverHash,
      agent_renewal_handover_operation_id: operationId,
      agent_renewal_handover_thread_id: result.threadId,
      agent_renewal_handover_turn_id: result.turnId
    });
    return {
      ...parsed,
      ...result,
      ok: true,
      operationId,
      source: input.source
    };
  }

  async function seedSessionRenewalHandover(sessionId = "", input = {}, options = {}) {
    const operationId = defineSessionRenewalOperationId(input.operationId || input.operationKey);
    const approved = defineSessionRenewalApprovedHandover({
      handover: input.handover,
      handoverHash: input.handoverHash,
      source: input.source
    });
    const context = await contextFor(sessionId, options);
    const target = await ensureUpstreamSession(context, options);
    const expectedThreadId = text(input.expectedThreadId);
    const forbiddenThreadId = text(input.forbiddenThreadId || input.oldThreadId);
    if (
      (expectedThreadId && expectedThreadId !== target.upstreamSessionId) ||
      (forbiddenThreadId && forbiddenThreadId === target.upstreamSessionId)
    ) {
      throw openCodeError(
        "vibe64_session_renewal_fresh_thread_required",
        "The renewed OpenCode session does not own the expected fresh native history.",
        {
          actualThreadId: target.upstreamSessionId,
          expectedThreadId,
          forbiddenThreadId
        }
      );
    }
    const clientMessageId = sessionRenewalClientMessageId("seed", operationId);
    const inputMessageId = upstreamMessageId(clientMessageId);
    const existingMessages = openCodeMessageRows(await target.server.client.messages(
      target.upstreamSessionId,
      { limit: 100, order: "desc" }
    ));
    const unrelatedUserMessage = existingMessages.find((message) => (
      message?.type === "user" && text(message.id) !== inputMessageId
    ));
    if (unrelatedUserMessage) {
      throw openCodeError(
        "vibe64_session_renewal_fresh_thread_required",
        "The successor OpenCode history contains unrelated conversation and cannot be used for renewal.",
        { threadId: target.upstreamSessionId }
      );
    }
    const result = await runRenewalTurn(target, {
      clientMessageId,
      prompt: sessionRenewalSeedPrompt(approved)
    });
    const acknowledgement = parseSessionRenewalAcknowledgement(result.text, {
      handoverHash: approved.handoverHash,
      source: approved.source
    });
    const acknowledgedAt = new Date().toISOString();
    await writeSessionMetadata(context, {
      agent_briefing_delivered: "yes",
      agent_briefing_delivered_at: acknowledgedAt,
      agent_briefing_transport: "opencode_server",
      agent_renewal_seed_acknowledged_at: acknowledgedAt,
      agent_renewal_seed_handover_hash: approved.handoverHash,
      agent_renewal_seed_operation_id: operationId,
      agent_renewal_seed_thread_id: result.threadId,
      agent_renewal_seed_turn_id: result.turnId
    });
    const proof = await stopProcessRecord(target);
    return {
      ...result,
      acknowledgement,
      acknowledgedAt,
      freshThread: existingMessages.length === 0,
      handoverHash: approved.handoverHash,
      ok: proof?.exited !== false,
      operationId,
      processExitProof: proof,
      source: approved.source,
      subscriptionDeferred: true
    };
  }

  async function closeAllForSession(sessionId = "", options = {}) {
    void options;
    const id = safeSessionId(sessionId);
    const pending = [...processStarts.entries()]
      .filter(([key]) => key.endsWith(`\0${id}`))
      .map(([, start]) => start.catch(() => null));
    await Promise.all(pending);
    const targets = [...processes.values()].filter((target) => target.sessionId === id);
    const proofs = await Promise.all(targets.map((target) => stopProcessRecord(target)));
    for (const key of [...turns.keys()]) {
      if (key.endsWith(`\0${id}`)) {
        turns.delete(key);
      }
    }
    for (const key of [...temporaryConversations.keys()]) {
      if (temporaryConversations.get(key)?.target?.sessionId === id) {
        temporaryConversations.delete(key);
      }
    }
    return {
      closed: targets.length,
      ok: proofs.every((proof) => proof?.exited !== false),
      processExitProof: proofs.at(-1) || processExitProofs.get(id) || { exited: true },
      processExitProofs: proofs
    };
  }

  async function closeAllForProject() {
    await Promise.all([
      ...[...processStarts.values()].map((start) => start.catch(() => null)),
      ...(catalogStart ? [catalogStart.catch(() => null)] : [])
    ]);
    const results = [];
    for (const target of [...processes.values()]) {
      results.push(await stopProcessRecord(target));
    }
    if (catalogProcess) {
      const target = catalogProcess;
      catalogProcess = null;
      results.push(await target.stop());
    }
    clearTimeout(catalogIdleTimer);
    return {
      closed: results.length,
      ok: results.every((result) => result?.exited !== false)
    };
  }

  function releaseProcessExitProof(sessionId = "") {
    const id = safeSessionId(sessionId);
    const proof = processExitProofs.get(id) || null;
    processExitProofs.delete(id);
    return {
      ok: Boolean(proof?.exited),
      processExitProof: proof,
      released: Boolean(proof?.exited)
    };
  }

  return Object.freeze({
    capabilities,
    closeAllForProject,
    closeAllForSession,
    createConversation,
    async deleteConversation(sessionId, input = {}, options = {}) {
      const { context, conversationId, target } = await existingDetachedTarget(
        sessionId,
        input,
        options
      );
      if (!target) {
        temporaryConversations.delete(`${context.key}\0${conversationId}`);
        return { conversationId, deleted: false, ok: true };
      }
      await target.server.client.deleteSession(conversationId);
      temporaryConversations.delete(`${context.key}\0${conversationId}`);
      return { conversationId, deleted: true, ok: true };
    },
    async describeProvider(sessionId, options = {}) {
      const context = await contextFor(sessionId, options);
      const connection = requireOpenCodeConnection(await resolveConnection({
        engineId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
        modelProviderId: context.selection.modelProviderId,
        sessionId: context.sessionId,
        vibe64User: options.vibe64User || null
      }), context.selection.modelProviderId);
      return {
        accountIdentitySignature: connection.fingerprint,
        providerId: VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE,
        transportId: "opencode_server"
      };
    },
    async ensureSession(sessionId, options = {}) {
      const context = await contextFor(sessionId, options);
      const target = await ensureUpstreamSession(context, options);
      return {
        ok: true,
        thread: { id: target.upstreamSessionId },
        turn: openCodeTurnSnapshot(turns.get(context.key), target.upstreamSessionId),
        workdir: context.workdir
      };
    },
    generateSessionRenewalHandover,
    hasActiveTemporaryConversation(sessionId = "") {
      const id = safeSessionId(sessionId);
      return [...temporaryConversations.values()].some((entry) => (
        entry.active === true && entry.target?.sessionId === id
      ));
    },
    async interruptTurn(sessionId, input = {}, options = {}) {
      void input;
      const context = await contextFor(sessionId, options);
      const target = processes.get(context.key) || null;
      const turn = turns.get(context.key);
      if (!target) {
        return {
          interrupted: false,
          ok: true,
          thread: { id: upstreamSessionId(context.runtime.stateRoot, context.sessionId) },
          turn: openCodeTurnSnapshot(turn)
        };
      }
      if (turn) {
        turn.interruptRequested = true;
      }
      await target.server.client.interrupt(target.upstreamSessionId);
      return {
        interrupted: Boolean(turn?.active),
        ok: true,
        thread: { id: target.upstreamSessionId },
        turn: openCodeTurnSnapshot(turn, target.upstreamSessionId)
      };
    },
    async invalidateRuntimes(input = {}) {
      if (text(input.reason) === "server-shutdown") {
        closed = true;
      }
      catalogSnapshot = null;
      const providerId = text(input.modelProviderId);
      if (!providerId) {
        return closeAllForProject();
      }
      await Promise.all([...processStarts.values()].map((start) => start.catch(() => null)));
      const targets = [...processes.values()].filter((target) => (
        target.modelProviderId === providerId
      ));
      const results = await Promise.all(targets.map((target) => stopProcessRecord(target)));
      return {
        closed: results.length,
        ok: results.every((result) => result?.exited !== false)
      };
    },
    async readConversation(sessionId, input = {}, options = {}) {
      const { conversationId, target } = await existingDetachedTarget(sessionId, input, options);
      if (!target) {
        throw openCodeReadUnavailable();
      }
      return readDetachedConversation(target, conversationId);
    },
    async reconcileSessions(sessions = [], options = {}) {
      const results = [];
      for (const session of sessions) {
        const sessionId = text(session?.sessionId || session?.id);
        try {
          const context = await contextFor(sessionId, { ...options, session });
          const activeRun = (Array.isArray(session?.agentRuns) ? session.agentRuns : [])
            .find((run) => run?.id === OPENCODE_AGENT_RUN_ID && run.active === true);
          if (activeRun) {
            const target = await ensureUpstreamSession(context, options);
            beginMonitor(target, context, {
              admittedSeq: "",
              id: text(activeRun.turnId) || upstreamMessageId(randomUUID())
            }, options);
          }
          results.push({ ok: true, resumed: Boolean(activeRun), sessionId });
        } catch (error) {
          results.push({ error: text(error?.message), ok: false, sessionId });
        }
      }
      return {
        failed: results.filter((result) => result.ok === false),
        ok: results.every((result) => result.ok),
        results,
        sessionCount: results.length
      };
    },
    releaseProcessExitProof,
    runDetachedChatTurn,
    seedSessionRenewalHandover,
    sendMessage,
    async sessionState(sessionId, options = {}) {
      const context = await contextFor(sessionId, options);
      const threadId = processes.get(context.key)?.upstreamSessionId ||
        upstreamSessionId(context.runtime.stateRoot, context.sessionId);
      return {
        ok: true,
        terminal: null,
        thread: { id: threadId },
        turn: openCodeTurnSnapshot(turns.get(context.key), threadId),
        workdir: context.workdir
      };
    },
    async startConversationTurn(sessionId, input = {}, options = {}) {
      const result = await runDetachedChatTurn(sessionId, input, options);
      return {
        ...result,
        runId: result.turnId,
        status: result.ok === false ? "failed" : "completed"
      };
    },
    async stopConversation(sessionId, input = {}, options = {}) {
      const { conversationId, target } = await existingDetachedTarget(sessionId, input, options);
      if (!target) {
        return { conversationId, ok: true, stopped: false };
      }
      await target.server.client.interrupt(conversationId);
      return { conversationId, ok: true, stopped: true };
    },
    streamDetachedChatTurn: runDetachedChatTurn,
    async waitForConversationTurn(sessionId, input = {}, options = {}) {
      const { conversationId, target } = await existingDetachedTarget(sessionId, input, options);
      if (!target) {
        throw openCodeReadUnavailable();
      }
      await waitForOpenCodeMessages(target.server.client, conversationId, "", {
        signal: input.timeoutMs ? AbortSignal.timeout(Number(input.timeoutMs)) : undefined
      });
      return readDetachedConversation(target, conversationId);
    },
    async waitForTurn(sessionId = "", options = {}) {
      const context = await contextFor(sessionId, options);
      return monitors.get(context.key) || openCodeTurnSnapshot(turns.get(context.key));
    }
  });
}

export {
  OPENCODE_AGENT_RUN_ID,
  OPENCODE_CATALOG_CACHE_MS,
  OPENCODE_CATALOG_IDLE_MS,
  createOpenCodeTerminalController,
  upstreamMessageId,
  upstreamSessionId
};
