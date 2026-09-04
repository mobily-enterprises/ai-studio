import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { genesisCommandShimDirectory } from "@local/vibe64-genesis/server";

import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  serializeVibe64AssistantSelection
} from "../../packages/vibe64-runtime/src/shared/index.js";
import {
  startTerminalSession
} from "../../packages/vibe64-execution/src/server/engines/terminalSessions.js";
import {
  openCodeAssistantCapabilities
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js";
import {
  resolveOpenCodeEconomyExecutionProfile
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js";
import {
  OPENCODE_ECONOMY_AGENT_ID
} from "../../packages/vibe64-terminals/src/server/opencodeServerProcess.js";
import {
  createOpenCodeTerminalController
} from "../../packages/vibe64-terminals/src/server/opencodeTerminal.js";

const providerDefinition = {
  id: "deepseek",
  models: {
    "deepseek-chat": {
      capabilities: {
        reasoning: true,
        toolcall: true
      },
      id: "deepseek-chat",
      name: "DeepSeek Chat",
      status: "active",
      variants: {
        high: {},
        low: {}
      }
    }
  },
  name: "DeepSeek",
  source: "api"
};
const providerResult = {
  all: [providerDefinition],
  default: { deepseek: "deepseek-chat" }
};
const agents = [{
  description: "Make changes",
  hidden: false,
  mode: "primary",
  name: "build"
}];
const providerRevision = openCodeAssistantCapabilities({
  agents,
  providers: providerResult
}).modelProviders[0].definitionRevision;

async function controllerHarness({
  assistantParts = [],
  assistantResponses = [],
  assistantError = null,
  catalogProviders = providerResult,
  commandEnvironmentGate = null,
  gitActorFailure = null,
  helperResponse = '{"subject":"Add durable OpenCode sessions"}',
  providerEvents = [],
  realAttachedTerminal = false,
  withCommandBoundary = false
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-opencode-controller-"));
  const sourceRoot = path.join(root, "sessions", "active", "session-1", "source");
  const sessionRoot = path.join(root, "session-state", "session-1");
  await Promise.all([
    mkdir(sourceRoot, { recursive: true }),
    mkdir(sessionRoot, { recursive: true })
  ]);
  const selection = {
    agentId: "build",
    catalogRevision: `sha256:${"a".repeat(64)}`,
    engineId: "opencode",
    modelId: "deepseek-chat",
    modelProviderId: "deepseek",
    variantId: "high"
  };
  const session = {
    metadata: {
      assistant_selection: serializeVibe64AssistantSelection(selection),
      source_kind: "session_clone",
      source_path: sourceRoot,
      source_path_authority: "managed_session_source"
    },
    revision: 7,
    sessionId: "session-1",
    sessionRoot
  };
  const userMessages = [];
  const assistantMessages = [];
  const commentaryMessages = [];
  const thinkingMessages = [];
  const systemMessages = [];
  const metadataWrites = [];
  const agentRunEvents = [];
  const renderPromptCalls = [];
  let runStartedAt = "";
  const runtime = {
    projectContextRoot: root,
    stateRoot: path.join(root, "runtime"),
    async getSession() {
      return session;
    },
    async renderPrompt(_sessionId, input = {}) {
      renderPromptCalls.push(input);
      return { prompt: `GENESIS ${input.task}: ${input.request}` };
    },
    store: {
      async conversationMessageIdExists() {
        return false;
      },
      async mutateSession(_sessionId, operation) {
        return operation();
      },
      async readConversationLogPage() {
        return {
          conversationLog: userMessages.slice(-1).map((message) => ({ user: message })),
          pagination: {
            totalTurnCount: userMessages.length
          }
        };
      },
      async writeAgentRunEvent(_sessionId, id, input = {}) {
        const updatedAt = new Date().toISOString();
        runStartedAt ||= updatedAt;
        const state = input.patch?.state || input.event?.state || "active";
        const active = state === "active";
        const run = {
          ...input.patch,
          active,
          ...(active ? {} : { finishedAt: updatedAt }),
          id,
          startedAt: input.patch?.startedAt || runStartedAt,
          state,
          updatedAt
        };
        agentRunEvents.push({ input, run });
        return run;
      },
      async writeConversationAssistantMessage(_sessionId, input) {
        assistantMessages.push(input);
        return { id: input.messageId, text: input.text, type: "assistant" };
      },
      async writeConversationCommentaryMessage(_sessionId, input) {
        commentaryMessages.push(input);
        return { id: input.messageId, text: input.text, type: "commentary" };
      },
      async writeConversationThinkingMessage(_sessionId, input) {
        thinkingMessages.push(input);
        return { id: input.messageId, text: input.text, type: "thinking" };
      },
      async writeConversationSystemMessage(_sessionId, input) {
        systemMessages.push(input);
        return {
          system: { text: input.text },
          turnId: `system-${systemMessages.length}`
        };
      },
      async writeConversationUserMessage(_sessionId, input) {
        userMessages.push(input);
        return { id: input.messageId, text: input.text, type: "user" };
      },
      async writeMetadataValue(_sessionId, name, value) {
        metadataWrites.push({ name, value });
        session.metadata[name] = value;
      }
    }
  };
  const connection = {
    apiKey: "deepseek-key-one",
    canonicalUrl: "https://api.deepseek.com",
    economyModelId: "deepseek-chat",
    endpointCode: "deepseek_api",
    fingerprint: `sha256:${"1".repeat(64)}`,
    modelProviderId: "deepseek",
    providerRevision
  };
  const processStarts = [];
  const processStops = [];
  const terminalStarts = [];
  const commandEnvironmentCalls = [];
  const catalogReadCalls = [];
  const createdSessions = [];
  const createdSessionDirectories = [];
  const promptCalls = [];
  const promptDirectories = [];
  const publishedSessionChanges = [];
  const switchedAgents = [];
  const switchedModels = [];
  const verifyConnectionCalls = [];
  const upstreamSessions = new Map();
  const outputs = new Map();
  const queuedAssistantResponses = [...assistantResponses];
  let failNextHealth = false;
  let failNextPrompt = false;
  let listConnectionCalls = 0;
  let nextSession = 1;
  let readSessionCalls = 0;
  let runtimeCreateCalls = 0;

  function client(directory = "") {
    return {
      async *events() {
        for (const event of providerEvents) {
          yield event;
        }
      },
      async agents() {
        return agents;
      },
      async createSession(input = {}) {
        const id = input.id || `ses_detached_${nextSession++}`;
        const created = { ...input, id };
        createdSessions.push(created);
        createdSessionDirectories.push({ directory, id });
        upstreamSessions.set(id, created);
        return created;
      },
      async deleteSession(id) {
        upstreamSessions.delete(id);
        return true;
      },
      async health() {
        if (failNextHealth) {
          failNextHealth = false;
          throw new Error("health failed");
        }
        return { healthy: true, version: "1.18.22" };
      },
      async interrupt() {
        return true;
      },
      async messages(id) {
        const output = outputs.get(id);
        const response = output && typeof output === "object" && !Array.isArray(output)
          ? output
          : { text: output };
        const promptCall = [...promptCalls].reverse().find((entry) => entry.id === id);
        const created = Date.now();
        return {
          data: output === undefined ? [] : [
            {
              id: promptCall.input.id,
              text: promptCall.input.prompt.text,
              time: { created },
              type: "user"
            },
            {
              ...(response.error || assistantError
                ? { error: response.error || assistantError }
                : { text: response.text }),
              ...((response.content || assistantParts).length
                ? { content: response.content || assistantParts }
                : {}),
              id: "msg_assistant",
              time: { completed: created + 1, created: created + 1 },
              type: "assistant"
            }
          ]
        };
      },
      async prompt(id, input = {}) {
        promptCalls.push({ id, input });
        promptDirectories.push({ directory, id });
        if (failNextPrompt) {
          failNextPrompt = false;
          throw Object.assign(new Error("admission failed"), { statusCode: 503 });
        }
        outputs.set(id, id.startsWith("ses_detached_")
          ? helperResponse
          : queuedAssistantResponses.shift() || "Main turn complete");
        return { admittedSeq: promptCalls.length, id: input.id };
      },
      async providers() {
        return catalogProviders;
      },
      forDirectory(nextDirectory = "") {
        return client(path.resolve(nextDirectory));
      },
      async readSession(id) {
        readSessionCalls += 1;
        if (!upstreamSessions.has(id)) {
          throw Object.assign(new Error("missing"), { statusCode: 404 });
        }
        return upstreamSessions.get(id);
      },
      async switchAgent(id, agent) {
        switchedAgents.push({ agent, id });
      },
      async switchModel(id, model) {
        switchedModels.push({ id, model });
      },
      async wait() {
        return true;
      }
    };
  }

  const controller = createOpenCodeTerminalController({
    env: {
      ...process.env,
      VIBE64_AGENT_RUNTIME_DIR: path.join(root, "agent-providers")
    },
    ...(withCommandBoundary ? {
      agentDatabaseCommand: { id: "database" },
      agentEnvCommand: { id: "environment" },
      agentPreviewCommand: { id: "preview" },
      codexGitCommand: { id: "git" },
      async prepareCommandEnvironment(input) {
        commandEnvironmentCalls.push(input);
        await commandEnvironmentGate?.(input);
        return {
          env: {
            VIBE64_AGENT_DATABASE_COMMAND_SOCKET: "/managed/database.sock",
            VIBE64_AGENT_ENV_COMMAND_SOCKET: "/managed/environment.sock",
            VIBE64_AGENT_PREVIEW_COMMAND_SOCKET: "/managed/preview.sock",
            VIBE64_CODEX_GIT_COMMAND_SOCKET: "/managed/git.sock"
          },
          hostWrapperDir: "/managed/wrappers",
          ok: true,
          shimDirs: ["/managed/wrappers"]
        };
      }
    } : {}),
    async createServerProcess(options) {
      const started = {
        client: client(),
        options,
        workdir: options.workdir,
        async startAttachedTerminal(input) {
          terminalStarts.push(input);
          if (realAttachedTerminal) {
            return startTerminalSession({
              args: ["-e", "setInterval(() => {}, 1000)"],
              command: process.execPath,
              commandPreview: "opencode attach",
              cwd: sourceRoot,
              maxRunning: 1,
              namespace: input.namespace,
              reuseRunning: true
            });
          }
          return {
            commandPreview: "opencode attach",
            id: `opencode-terminal-${terminalStarts.length}`,
            ok: true,
            status: "running"
          };
        },
        async stop() {
          processStops.push(options);
          return { exited: true, signal: "SIGTERM" };
        }
      };
      processStarts.push(started);
      return started;
    },
    async listConnections() {
      listConnectionCalls += 1;
      return [{
        accessLabel: "Workspace use",
        billingLabel: "Usage-based API billing",
        connected: true,
        economyModelId: connection.economyModelId,
        fingerprint: connection.fingerprint,
        modelProviderId: connection.modelProviderId,
        productLabel: "DeepSeek",
        providerRevision: connection.providerRevision
      }];
    },
    projectService: {
      async createRuntime() {
        runtimeCreateCalls += 1;
        return runtime;
      },
      async readPromptHints() {
        return { ok: true, promptHints: true };
      }
    },
    async readCatalogCommand(options) {
      catalogReadCalls.push(options);
      return {
        agents,
        providers: catalogProviders
      };
    },
    async publishSessionChanged(...args) {
      publishedSessionChanges.push(args);
    },
    async recordGitActor(input) {
      return gitActorFailure || { ok: true, session: input.session };
    },
    async resolveConnection() {
      return { ...connection };
    },
    async verifyConnectionCommand(input) {
      verifyConnectionCalls.push(input);
      return { ok: true };
    }
  });

  return {
    agentRunEvents,
    assistantMessages,
    catalogReadCalls,
    commentaryMessages,
    connection,
    commandEnvironmentCalls,
    controller,
    createdSessionDirectories,
    createdSessions,
    failHealth() {
      failNextHealth = true;
    },
    failPrompt() {
      failNextPrompt = true;
    },
    listConnectionCalls: () => listConnectionCalls,
    metadataWrites,
    processStarts,
    processStops,
    promptDirectories,
    promptCalls,
    publishedSessionChanges,
    root,
    readSessionCalls: () => readSessionCalls,
    renderPromptCalls,
    runtime,
    runtimeCreateCalls: () => runtimeCreateCalls,
    selection,
    session,
    switchedAgents,
    switchedModels,
    systemMessages,
    terminalStarts,
    thinkingMessages,
    upstreamSessions,
    userMessages,
    verifyConnectionCalls
  };
}

test("OpenCode cold catalog discovery never loads configured credentials", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.capabilities({ engineId: "opencode" });

  assert.equal(harness.processStarts.length, 0);
  assert.equal(harness.runtimeCreateCalls(), 0);
  assert.equal(path.basename(harness.catalogReadCalls[0].workdir), "workspace");
  assert.equal(Object.hasOwn(harness.catalogReadCalls[0], "providerConnections"), false);
  assert.equal(typeof harness.catalogReadCalls[0].createServerProcess, "function");
});

test("configured OpenCode choices never read or start OpenCode", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const result = await harness.controller.capabilities({ configuredOnly: "true" }, {
    vibe64User: { username: "ada" }
  });

  assert.equal(result.health.status, "ready");
  assert.deepEqual(result.modelProviders.map(({ id }) => id), ["deepseek"]);
  assert.equal(harness.catalogReadCalls.length, 0);
  assert.equal(harness.processStarts.length, 0);
  assert.equal(harness.runtimeCreateCalls(), 0);
});

test("OpenCode runtime invalidation preserves its credential-free catalog snapshot", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.capabilities({ engineId: "opencode" });
  await harness.controller.invalidateRuntimes({
    modelProviderId: "deepseek",
    reason: "created"
  });
  await harness.controller.capabilities({ engineId: "opencode" });

  assert.equal(harness.catalogReadCalls.length, 1);
});

test("OpenCode exposes a finite connection verifier through its controller", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const result = await harness.controller.verifyConnection({
    apiKey: "deepseek-key",
    engineId: "opencode",
    modelId: "deepseek-chat",
    modelProviderId: "deepseek"
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(harness.verifyConnectionCalls.length, 1);
  assert.equal(harness.verifyConnectionCalls[0].apiKey, "deepseek-key");
  assert.equal(Object.hasOwn(harness.verifyConnectionCalls[0], "canonicalUrl"), false);
  assert.equal(harness.verifyConnectionCalls[0].modelId, "deepseek-chat");
  assert.equal(harness.verifyConnectionCalls[0].modelProviderId, "deepseek");
  assert.equal(path.basename(harness.verifyConnectionCalls[0].workdir), "workspace");
  await assert.rejects(
    () => harness.controller.verifyConnection({ engineId: "codex" }),
    (error) => error?.code === "vibe64_assistant_engine_invalid" && error.statusCode === 400
  );
  assert.equal(harness.verifyConnectionCalls.length, 1);
  await assert.rejects(
    () => harness.controller.verifyConnection({
      apiKey: "deepseek-key",
      engineId: "opencode",
      modelId: "removed-model",
      modelProviderId: "deepseek"
    }),
    (error) => error?.code === "vibe64_assistant_catalog_stale" && error.statusCode === 409
  );
  assert.equal(harness.verifyConnectionCalls.length, 1);
});

test("OpenCode connections use native provider routing when no URL override exists", async (t) => {
  const harness = await controllerHarness();
  harness.connection.canonicalUrl = "";
  harness.connection.endpointCode = "";
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Reply exactly OK",
    messageId: "client-message-native-provider-route"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(harness.processStarts.length, 1);
  assert.equal(harness.processStarts[0].options.providerConnections.length, 1);
  assert.equal(harness.processStarts[0].options.providerConnections[0].canonicalUrl, "");
  assert.equal(harness.processStarts[0].options.providerConnections[0].endpointCode, "");
});

test("OpenCode leaves starting state when Git identity admission fails", async (t) => {
  const harness = await controllerHarness({
    gitActorFailure: {
      code: "vibe64_git_identity_missing",
      error: "Choose a Git identity before sending.",
      ok: false
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const result = await harness.controller.sendMessage("session-1", {
    message: "Try this turn",
    messageId: "client-message-git-identity"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_git_identity_missing");
  assert.deepEqual(
    harness.agentRunEvents.map(({ run }) => run.state),
    ["starting", "failed"]
  );
  assert.equal(harness.userMessages.length, 0);
});

test("OpenCode capability discovery does not start an app server", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const result = await harness.controller.capabilities({}, {
    vibe64User: { username: "ada" }
  });

  assert.equal(result.engineId, "opencode");
  assert.equal(harness.processStarts.length, 0);
});

test("OpenCode persists a user message and its display attachments only after upstream admission", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  harness.failPrompt();
  await assert.rejects(
    () => harness.controller.sendMessage("session-1", {
      message: "First attempt",
      messageId: "client-message-1"
    }, {
      runtime: harness.runtime,
      session: harness.session,
      vibe64User: { username: "ada" }
    }),
    /admission failed/u
  );
  assert.equal(harness.userMessages.length, 0);
  assert.deepEqual(
    harness.agentRunEvents.map(({ run }) => run.state),
    ["starting", "failed"]
  );

  const delivered = await harness.controller.sendMessage("session-1", {
    displayAttachments: [{
      fileName: "report.md",
      size: 15360
    }],
    message: "Second attempt",
    messageId: "client-message-2"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { preferredName: "Ada", username: "ada" }
  });
  assert.equal(delivered.ok, true);
  assert.equal(harness.userMessages.length, 1);
  assert.equal(harness.userMessages[0].messageId, "client-message-2");
  assert.deepEqual(harness.userMessages[0].attachments, [{
    fileName: "report.md",
    size: 15360
  }]);
  assert.equal(harness.userMessages[0].turnMetadata.engineId, "opencode");
  assert.match(harness.userMessages[0].turnMetadata.upstreamMessageId, /^msg_vibe64_/u);
  assert.equal(harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  )).length, 1);
  assert.equal(
    harness.processStarts.find((entry) => (
      entry.options.execution.operationId === "opencode-server"
    )).options.providerConnections[0].apiKey,
    "deepseek-key-one"
  );
  const sessionProcess = harness.processStarts.find((entry) => (
    entry.options.execution.operationId === "opencode-server"
  ));
  assert.deepEqual(sessionProcess.options.execution, {
    label: "OpenCode assistant",
    operationId: "opencode-server",
    ownerId: "opencode"
  });
  const mainPrompt = harness.promptCalls.filter((entry) => (
    entry.id === delivered.thread.id
  )).at(-1).input;
  assert.equal(mainPrompt.agent, "build");
  assert.deepEqual(mainPrompt.model, {
    id: "deepseek-chat",
    providerID: "deepseek",
    variant: "high"
  });
  assert.equal(mainPrompt.prompt.text, "GENESIS start: Second attempt");
  assert.equal(Object.hasOwn(mainPrompt.prompt, "turnContext"), false);
  assert.doesNotMatch(mainPrompt.prompt.text, /Vibe64 session briefing|hidden-turn-context/u);
  const completed = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });
  assert.equal(completed.state, "completed");
  assert.equal(harness.assistantMessages.length, 1);
  assert.equal(harness.assistantMessages[0].text, "Main turn complete");
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-server-assistant-message" &&
    payload.payload?.conversationLogPatch?.turn?.text === "Main turn complete"
  )), true);
  const starting = harness.publishedSessionChanges.find(([, payload]) => (
    payload.reason === "opencode-server-turn-active" &&
    payload.payload?.agentRun?.state === "starting"
  ));
  assert.equal(starting?.[1]?.payload?.agentRun?.active, true);
  assert.equal(starting?.[1]?.payload?.agentSession?.turn?.state, "starting");
  const active = harness.publishedSessionChanges.find(([, payload]) => (
    payload.reason === "opencode-server-turn-active" &&
    payload.payload?.agentRun?.state === "active"
  ));
  assert.deepEqual(active?.[1]?.payload?.agentRun, {
    active: true,
    id: "opencode_server",
    provider: "opencode",
    providerInterface: "opencode_server",
    providerStatus: "active",
    providerThreadId: delivered.thread.id,
    providerTurnId: delivered.turn.id,
    state: "active",
    updatedAt: active[1].payload.agentRun.updatedAt
  });
  assert.equal(active?.[1]?.payload?.agentSession?.providerId, "opencode");
  assert.equal(active?.[1]?.payload?.agentSession?.turn?.active, true);
  assert.equal(active?.[1]?.session?.revision, 7);
  const idle = harness.publishedSessionChanges.findLast(([, payload]) => (
    payload.reason === "opencode-server-turn-idle"
  ));
  assert.equal(idle?.[1]?.payload?.agentRun?.active, false);
  assert.equal(idle?.[1]?.payload?.agentRun?.state, "completed");
  assert.equal(idle?.[1]?.payload?.agentSession?.turn?.active, false);
  assert.equal(idle?.[1]?.payload?.agentSession?.turn?.state, "idle");
});

test("OpenCode reuses an established session without repeating setup or model switches", async (t) => {
  const harness = await controllerHarness({
    assistantResponses: ["First turn", "Second turn"],
    withCommandBoundary: true
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };

  await harness.controller.sendMessage("session-1", {
    message: "First",
    messageId: "client-message-fast-path-1"
  }, options);
  await harness.controller.waitForTurn("session-1", options);
  await harness.controller.sendMessage("session-1", {
    message: "Second",
    messageId: "client-message-fast-path-2"
  }, options);
  await harness.controller.waitForTurn("session-1", options);

  assert.equal(harness.commandEnvironmentCalls.length, 2);
  assert.equal(harness.processStarts.length, 1);
  assert.equal(harness.listConnectionCalls(), 2);
  assert.equal(harness.readSessionCalls(), 1);
  assert.equal(harness.createdSessions.length, 1);
  assert.deepEqual(harness.switchedModels, []);
  assert.deepEqual(harness.switchedAgents, []);
  assert.deepEqual(harness.renderPromptCalls.map(({ task }) => task), ["start"]);
  assert.equal(harness.promptCalls[0].input.prompt.text, "GENESIS start: First");
  assert.equal(harness.promptCalls[1].input.prompt.text, "Second");
  assert.equal(Object.hasOwn(harness.promptCalls[0].input.prompt, "turnContext"), false);
  assert.equal(Object.hasOwn(harness.promptCalls[1].input.prompt, "turnContext"), false);
});

test("OpenCode renders explicit Deslop through Genesis and leaves later follow-ups ordinary", async (t) => {
  const harness = await controllerHarness({
    assistantResponses: ["First turn", "Deslop turn", "Follow-up turn"]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };

  await harness.controller.sendMessage("session-1", {
    message: "First",
    messageId: "client-message-deslop-1"
  }, options);
  await harness.controller.waitForTurn("session-1", options);
  await harness.controller.sendMessage("session-1", {
    genesisTask: "deslop",
    message: `Deslop commit ${"a".repeat(40)}.`,
    messageId: "client-message-deslop-2"
  }, options);
  await harness.controller.waitForTurn("session-1", options);
  await harness.controller.sendMessage("session-1", {
    message: "Explain one cleanup choice.",
    messageId: "client-message-deslop-3"
  }, options);
  await harness.controller.waitForTurn("session-1", options);

  assert.deepEqual(harness.renderPromptCalls.map(({ task }) => task), ["start", "deslop"]);
  assert.match(harness.promptCalls[1].input.prompt.text, /GENESIS deslop: Deslop commit/u);
  assert.doesNotMatch(harness.promptCalls[2].input.prompt.text, /GENESIS/u);
  assert.match(harness.promptCalls[2].input.prompt.text, /Explain one cleanup choice\.$/u);
});

test("OpenCode rechecks its native session after recovering an unhealthy server", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };

  const first = await harness.controller.ensureSession("session-1", options);
  harness.failHealth();
  const recovered = await harness.controller.ensureSession("session-1", options);

  assert.equal(recovered.thread.id, first.thread.id);
  assert.equal(harness.processStarts.length, 2);
  assert.equal(harness.processStops.length, 1);
  assert.equal(harness.readSessionCalls(), 2);
  assert.equal(harness.createdSessions.length, 1);
  assert.equal(harness.switchedModels.length, 1);
  assert.equal(harness.switchedAgents.length, 1);
});

test("OpenCode recovers a reasoning-only completion into a final answer", async (t) => {
  const harness = await controllerHarness({
    assistantResponses: [{
      content: [{
        id: "reasoning-only-part",
        text: "The command completed and the result is 42.",
        type: "reasoning"
      }],
      text: ""
    }, {
      text: "The result is 42."
    }]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Run the command and tell me its result.",
    messageId: "client-message-reasoning-only"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const completed = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(completed.state, "completed");
  assert.equal(harness.promptCalls.length, 2);
  assert.match(
    harness.promptCalls[1].input.prompt.text,
    /previous response ended without a user-facing final answer/u
  );
  assert.equal(harness.userMessages.length, 1);
  assert.equal(harness.thinkingMessages[0].text, "The command completed and the result is 42.");
  assert.deepEqual(
    harness.assistantMessages.map((message) => message.text),
    ["The result is 42."]
  );
});

test("OpenCode fails explicitly after two reasoning-only completions", async (t) => {
  const reasoningOnly = (id) => ({
    content: [{
      id,
      text: "I have the result but did not emit a final answer.",
      type: "reasoning"
    }],
    text: ""
  });
  const harness = await controllerHarness({
    assistantResponses: [
      reasoningOnly("reasoning-only-first"),
      reasoningOnly("reasoning-only-second")
    ]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Run the command and tell me its result.",
    messageId: "client-message-reasoning-only-twice"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const completed = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(harness.promptCalls.length, 2);
  assert.equal(completed.state, "failed");
  assert.equal(
    completed.error,
    "OpenCode finished without a user-facing final response. Please send your message again."
  );
  assert.deepEqual(harness.assistantMessages, []);
});

test("OpenCode shares one lazy server across open sessions and stops it after the last closes", async (t) => {
  const harness = await controllerHarness();
  const secondSourceRoot = path.join(
    harness.root,
    "sessions",
    "active",
    "session-2",
    "source"
  );
  const secondSessionRoot = path.join(harness.root, "session-state", "session-2");
  await Promise.all([
    mkdir(secondSourceRoot, { recursive: true }),
    mkdir(secondSessionRoot, { recursive: true })
  ]);
  const secondSession = {
    ...harness.session,
    metadata: {
      ...harness.session.metadata,
      source_path: secondSourceRoot
    },
    sessionId: "session-2",
    sessionRoot: secondSessionRoot
  };
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const reconciled = await harness.controller.reconcileSessions([
    harness.session,
    secondSession
  ], {
    runtime: harness.runtime,
    vibe64User: { username: "ada" }
  });
  const serverStarts = harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  ));

  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.results.every((result) => result.resumed === false), true);
  assert.equal(serverStarts.length, 1);
  assert.equal(harness.createdSessions.length, 2);

  const firstClose = await harness.controller.closeAllForSession("session-1");
  assert.equal(firstClose.processExitProof.sharedProcessRetained, true);
  assert.equal(harness.processStops.length, 0);

  const lastClose = await harness.controller.closeAllForSession("session-2");
  assert.equal(lastClose.processExitProof.exited, true);
  assert.equal(harness.processStops.length, 1);

  const reopened = await harness.controller.ensureSession("session-1", {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  assert.ok(reopened.thread.id);
  assert.equal(harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  )).length, 2);

  const reopenedClose = await harness.controller.closeAllForSession("session-1");
  assert.equal(reopenedClose.processExitProof.exited, true);
  assert.equal(harness.processStops.length, 2);
});

test("a pending OpenCode session start retains the shared server while another session closes", async (t) => {
  let releaseSecondStart = () => null;
  let secondStartReached = () => null;
  const secondStartGate = new Promise((resolve) => {
    releaseSecondStart = resolve;
  });
  const secondStartReady = new Promise((resolve) => {
    secondStartReached = resolve;
  });
  const harness = await controllerHarness({
    async commandEnvironmentGate(input) {
      if (input.sessionId === "session-2") {
        secondStartReached();
        await secondStartGate;
      }
    },
    withCommandBoundary: true
  });
  const secondSourceRoot = path.join(
    harness.root,
    "sessions",
    "active",
    "session-2",
    "source"
  );
  const secondSessionRoot = path.join(harness.root, "session-state", "session-2");
  await Promise.all([
    mkdir(secondSourceRoot, { recursive: true }),
    mkdir(secondSessionRoot, { recursive: true })
  ]);
  const secondSession = {
    ...harness.session,
    metadata: {
      ...harness.session.metadata,
      source_path: secondSourceRoot
    },
    sessionId: "session-2",
    sessionRoot: secondSessionRoot
  };
  t.after(async () => {
    releaseSecondStart();
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    vibe64User: { username: "ada" }
  };

  await harness.controller.ensureSession("session-1", {
    ...options,
    session: harness.session
  });
  const secondStart = harness.controller.ensureSession("session-2", {
    ...options,
    session: secondSession
  });
  await secondStartReady;

  const firstClose = await harness.controller.closeAllForSession("session-1");
  releaseSecondStart();
  await secondStart;

  assert.equal(firstClose.processExitProof.sharedProcessRetained, true);
  assert.equal(harness.processStops.length, 0);
  assert.equal(harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  )).length, 1);

  const lastClose = await harness.controller.closeAllForSession("session-2");
  assert.equal(lastClose.processExitProof.exited, true);
  assert.equal(harness.processStops.length, 1);
});

test("OpenCode publishes current provider reasoning while its turn is active", async (t) => {
  const historicalReasoning = "This belongs to an earlier provider turn.";
  const reasoning = "I should answer directly and keep the response concise.";
  const harness = await controllerHarness({
    assistantParts: [{
      id: "reasoning-part-current",
      text: reasoning,
      type: "reasoning"
    }],
    providerEvents: [
      {
        data: {
          properties: {
            part: {
              id: "reasoning-part-old",
              messageID: "assistant-message-old",
              text: historicalReasoning,
              time: { start: Date.now() - 60_000 },
              type: "reasoning"
            }
          },
          type: "message.part.updated"
        },
        id: "reasoning-event-old"
      },
      {
        data: {
          properties: {
            part: {
              id: "reasoning-part-current",
              messageID: "assistant-message-current",
              text: reasoning,
              time: { start: Date.now() + 1_000 },
              type: "reasoning"
            }
          },
          type: "message.part.updated"
        },
        id: "reasoning-event-current"
      }
    ]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Give me a concise answer",
    messageId: "client-message-reasoning"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(harness.thinkingMessages.some((message) => (
    message.text === reasoning && message.requireOpenTurn === true
  )), true);
  assert.equal(harness.thinkingMessages.some((message) => (
    message.text === historicalReasoning
  )), false);
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-server-reasoning" &&
    payload.payload?.conversationLogPatch?.turn?.text === reasoning
  )), true);
  const progress = harness.publishedSessionChanges.find(([, payload]) => (
    payload.reason === "opencode-server-progress" &&
    payload.payload?.assistantProgress?.partType === "reasoning"
  ));
  assert.equal(progress?.[1]?.payload?.assistantProgress?.text, reasoning);
});

test("OpenCode presents long provider reasoning as compact progress and omits tool completion noise", async (t) => {
  const first = "I should find current sources before answering.";
  const second = "I will compare the useful results and keep the answer concise.";
  const third = "The evidence is ready, so I can now write the response.";
  const reasoning = `${first} ${second}\n\n${third}`;
  const harness = await controllerHarness({
    assistantParts: [
      {
        id: "reasoning-part-current",
        text: reasoning,
        type: "reasoning"
      },
      {
        id: "tool-part-current",
        state: { status: "completed" },
        type: "tool"
      }
    ],
    providerEvents: [
      {
        data: {
          properties: {
            part: {
              id: "reasoning-part-current",
              messageID: "msg_assistant",
              text: `${first} ${second}`,
              time: { start: Date.now() + 1_000 },
              type: "reasoning"
            }
          },
          type: "message.part.updated"
        },
        id: "reasoning-event-current-1"
      },
      {
        data: {
          properties: {
            part: {
              id: "reasoning-part-current",
              messageID: "msg_assistant",
              text: reasoning,
              time: { start: Date.now() + 1_000 },
              type: "reasoning"
            }
          },
          type: "message.part.updated"
        },
        id: "reasoning-event-current-2"
      }
    ]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Research this, then answer",
    messageId: "client-message-segmented-reasoning"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  const latestById = new Map(harness.thinkingMessages.map((message) => [
    message.messageId,
    message.text
  ]));
  assert.deepEqual([...latestById.values()], [first, second, third]);
  assert.equal(harness.thinkingMessages.some((message) => message.text === reasoning), false);
  assert.deepEqual(harness.commentaryMessages, []);
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-server-tool"
  )), false);
});

test("OpenCode preserves structured provider errors as readable turn failures", async (t) => {
  const harness = await controllerHarness({
    assistantError: {
      data: { message: "Aborted" },
      name: "MessageAbortedError"
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Reply exactly OK",
    messageId: "client-message-1"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const result = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(result.error, "Aborted");
  assert.equal(result.state, "failed");
  assert.equal(harness.systemMessages.length, 1);
  assert.equal(
    harness.systemMessages[0].text,
    "OpenCode could not finish.\n\nAborted\n\nSaved project changes remain."
  );
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-provider-failure" &&
    payload.payload?.conversationLogPatch?.type === "upsert-turn"
  )), true);
});

test("OpenCode makes structured provider API failures actionable", async (t) => {
  const harness = await controllerHarness({
    assistantError: {
      data: { message: "Insufficient balance. Top up your account." },
      name: "APIError"
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Reply exactly OK",
    messageId: "client-message-provider-api-failure"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const result = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(result.error, "Insufficient balance. Top up your account.");
  assert.equal(result.state, "failed");
  assert.equal(harness.systemMessages.length, 1);
  assert.match(harness.systemMessages[0].text, /Insufficient balance\. Top up your account\./u);
  assert.match(harness.systemMessages[0].text, /Saved project changes remain/u);
  assert.match(harness.systemMessages[0].text, /\[Manage AI accounts\]\(\/app\/manage\/accounts\)/u);
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-provider-failure" &&
    payload.payload?.conversationLogPatch?.type === "upsert-turn"
  )), true);
});

test("OpenCode does not misclassify model token limits as credential failures", async (t) => {
  const harness = await controllerHarness({
    assistantError: {
      data: { message: "Maximum output token limit exceeded" },
      name: "ModelOutputError"
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Reply exactly OK",
    messageId: "client-message-token-limit"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const result = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(result.error, "Maximum output token limit exceeded");
  assert.equal(result.state, "failed");
  assert.equal(harness.systemMessages.length, 1);
  assert.match(harness.systemMessages[0].text, /Maximum output token limit exceeded/u);
  assert.doesNotMatch(harness.systemMessages[0].text, /Manage AI accounts/u);
});

test("OpenCode turns make revoked provider keys actionable without exposing raw provider errors", async (t) => {
  const harness = await controllerHarness({
    assistantError: {
      data: { message: "Authentication failed: API key expired or revoked" },
      name: "AuthenticationError"
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Reply exactly OK",
    messageId: "client-message-revoked-key"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const result = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(result.state, "failed");
  assert.match(result.error, /OpenCode needs attention/u);
  assert.match(result.error, /Open AI Accounts/u);
  assert.doesNotMatch(result.error, /Authentication failed/u);
  assert.equal(harness.systemMessages.length, 1);
  assert.match(harness.systemMessages[0].text, /expired or been revoked/u);
  assert.match(harness.systemMessages[0].text, /\[Open AI Accounts\]\(\/app\/manage\/accounts\)/u);
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-credential-failure" &&
    payload.payload?.conversationLogPatch?.type === "upsert-turn"
  )), true);
});

test("OpenCode restarts on key replacement while preserving its database and native session id", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };
  const first = await harness.controller.ensureSession("session-1", options);
  harness.connection.apiKey = "deepseek-key-two";
  harness.connection.fingerprint = `sha256:${"2".repeat(64)}`;
  const second = await harness.controller.ensureSession("session-1", options);
  const sessionStarts = harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  ));

  assert.equal(first.thread.id, second.thread.id);
  assert.equal(sessionStarts.length, 2);
  assert.equal(sessionStarts[0].options.dbPath, sessionStarts[1].options.dbPath);
  assert.equal(sessionStarts[0].options.workdir, sessionStarts[1].options.workdir);
  assert.equal(sessionStarts[0].options.providerConnections[0].apiKey, "deepseek-key-one");
  assert.equal(sessionStarts[1].options.providerConnections[0].apiKey, "deepseek-key-two");
  assert.equal(harness.processStops.includes(sessionStarts[0].options), true);
  assert.equal(harness.createdSessions.filter((entry) => entry.id === first.thread.id).length, 1);
});

test("OpenCode switches connected providers while preserving its database and native session id", async (t) => {
  const zaiProvider = {
    id: "zai-coding-plan",
    models: {
      "glm-5.3": {
        capabilities: {
          reasoning: true,
          toolcall: true
        },
        id: "glm-5.3",
        name: "GLM 5.3",
        status: "active",
        variants: {
          high: {},
          low: {}
        }
      }
    },
    name: "Z.AI Coding Plan",
    source: "api"
  };
  const catalogProviders = {
    all: [providerDefinition, zaiProvider],
    default: {
      deepseek: "deepseek-chat",
      "zai-coding-plan": "glm-5.3"
    }
  };
  const zaiRevision = openCodeAssistantCapabilities({
    agents,
    providers: catalogProviders
  }).modelProviders.find(({ id }) => id === zaiProvider.id).definitionRevision;
  const harness = await controllerHarness({ catalogProviders });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };
  const first = await harness.controller.ensureSession("session-1", options);

  harness.connection.apiKey = "zai-key-one";
  harness.connection.canonicalUrl = "https://api.z.ai/api/coding/paas/v4";
  harness.connection.economyModelId = "glm-5.3";
  harness.connection.endpointCode = "zai_coding_plan";
  harness.connection.fingerprint = `sha256:${"3".repeat(64)}`;
  harness.connection.modelProviderId = "zai-coding-plan";
  harness.connection.providerRevision = zaiRevision;
  harness.session.metadata.assistant_selection = serializeVibe64AssistantSelection({
    ...harness.selection,
    modelId: "glm-5.3",
    modelProviderId: "zai-coding-plan"
  });

  const second = await harness.controller.ensureSession("session-1", options);
  const sessionStarts = harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  ));

  assert.equal(first.thread.id, second.thread.id);
  assert.equal(sessionStarts.length, 2);
  assert.equal(sessionStarts[0].options.dbPath, sessionStarts[1].options.dbPath);
  assert.equal(sessionStarts[0].options.workdir, sessionStarts[1].options.workdir);
  assert.equal(sessionStarts[0].options.providerConnections[0].modelProviderId, "deepseek");
  assert.equal(sessionStarts[1].options.providerConnections[0].modelProviderId, "zai-coding-plan");
  assert.equal(sessionStarts[1].options.providerConnections[0].apiKey, "zai-key-one");
  assert.equal(harness.processStops.includes(sessionStarts[0].options), true);
  assert.deepEqual(harness.switchedModels.at(-1), {
    id: second.thread.id,
    model: {
      id: "glm-5.3",
      providerID: "zai-coding-plan",
      variant: "high"
    }
  });
  assert.equal(harness.createdSessions.filter((entry) => entry.id === first.thread.id).length, 1);
});

test("OpenCode helper turns use the hidden deny-all agent and bounded structured output", async (t) => {
  const harness = await controllerHarness({
    helperResponse: '```json\n{"subject":"Add durable OpenCode sessions"}\n```',
    providerEvents: [{
      data: {
        properties: { timestamp: Date.now() },
        type: "session.next.reasoning.started"
      },
      id: "detached-progress"
    }]
  });
  const events = [];
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const executionProfile = resolveOpenCodeEconomyExecutionProfile({
    assistantSelection: {
      ...harness.selection,
      schema: "vibe64.assistant-selection.v1"
    },
    assistantAccess: {
      economyModelId: harness.connection.economyModelId
    }
  }, {
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
    workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE
  });
  const conversation = await harness.controller.createConversation("session-1", {
    executionProfile
  }, {
    runtime: harness.runtime,
    session: harness.session
  });
  const result = await harness.controller.runDetachedChatTurn("session-1", {
    conversationId: conversation.conversationId,
    executionProfile,
    outputSchema: {
      properties: { subject: { type: "string" } },
      required: ["subject"],
      type: "object"
    },
    prompt: "Name this work"
  }, {
    onEvent(event) {
      events.push(event);
    },
    runtime: harness.runtime,
    session: harness.session
  });

  assert.deepEqual(events[0], {
    threadId: result.threadId,
    type: "thread"
  });
  const helperSession = harness.createdSessions.find((entry) => entry.id === result.threadId);
  assert.equal(helperSession.agent, OPENCODE_ECONOMY_AGENT_ID);
  assert.deepEqual(helperSession.model, {
    id: "deepseek-chat",
    providerID: "deepseek"
  });
  const helperWorkdir = harness.processStarts[0].options.workdir;
  assert.equal(helperSession.location.directory, helperWorkdir);
  assert.notEqual(helperWorkdir, path.join(
    harness.root,
    "sessions",
    "active",
    "session-1",
    "source"
  ));
  assert.deepEqual(
    harness.createdSessionDirectories.find(({ id }) => id === result.threadId),
    { directory: helperWorkdir, id: result.threadId }
  );
  assert.equal(result.text, '{"subject":"Add durable OpenCode sessions"}');
  const helperPrompt = harness.promptCalls.find((entry) => entry.id === result.threadId).input;
  assert.deepEqual(
    harness.promptDirectories.find(({ id }) => id === result.threadId),
    { directory: helperWorkdir, id: result.threadId }
  );
  assert.equal(helperPrompt.agent, OPENCODE_ECONOMY_AGENT_ID);
  assert.deepEqual(helperPrompt.model, {
    id: "deepseek-chat",
    providerID: "deepseek"
  });
  assert.match(helperPrompt.prompt.text, /Return only one JSON value matching this JSON Schema/u);
  assert.match(helperPrompt.prompt.text, /"required":\["subject"\]/u);
  assert.equal(Object.hasOwn(helperPrompt.prompt, "turnContext"), false);
  assert.equal(events.some((event) => event.type === "session.next.reasoning.started"), true);
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-server-progress"
  )), false);
  const registry = JSON.parse(await readFile(
    harness.processStarts[0].options.sessionEnvironmentRegistry,
    "utf8"
  ));
  assert.equal(Object.hasOwn(registry, "promptContexts"), false);

  const tinyProfile = {
    ...executionProfile,
    limits: {
      ...executionProfile.limits,
      maxInputCharacters: 5
    }
  };
  const startsBeforeRejectedInput = harness.processStarts.length;
  await assert.rejects(
    () => harness.controller.runDetachedChatTurn("session-1", {
      executionProfile: tinyProfile,
      prompt: "This input is too long"
    }, {
      runtime: harness.runtime,
      session: harness.session
    }),
    (error) => error?.code === "vibe64_opencode_execution_input_too_large"
  );
  assert.equal(harness.processStarts.length, startsBeforeRejectedInput);
});

test("OpenCode receives the same complete session command boundary as Codex", async (t) => {
  const harness = await controllerHarness({ withCommandBoundary: true });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.ensureSession("session-1", {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });

  assert.equal(harness.commandEnvironmentCalls.length, 1);
  assert.equal(harness.commandEnvironmentCalls[0].sessionId, "session-1");
  assert.equal(harness.commandEnvironmentCalls[0].worktreePath, path.join(
    harness.root,
    "sessions",
    "active",
    "session-1",
    "source"
  ));
  const sessionProcess = harness.processStarts.find((entry) => (
    entry.options.execution.operationId === "opencode-server"
  ));
  assert.deepEqual(sessionProcess.options.shimDirs, [genesisCommandShimDirectory()]);
  assert.match(sessionProcess.options.hostContextResolver, /vibe64-genesis-host-context$/u);
  const registry = JSON.parse(await readFile(
    sessionProcess.options.sessionEnvironmentRegistry,
    "utf8"
  ));
  assert.deepEqual(registry.sessions[0].env, {
    VIBE64_AGENT_DATABASE_COMMAND_SOCKET: "/managed/database.sock",
    VIBE64_AGENT_ENV_COMMAND_SOCKET: "/managed/environment.sock",
    VIBE64_AGENT_PREVIEW_COMMAND_SOCKET: "/managed/preview.sock",
    VIBE64_CODEX_GIT_COMMAND_SOCKET: "/managed/git.sock"
  });
  assert.deepEqual(registry.sessions[0].pathEntries, ["/managed/wrappers"]);
  assert.equal(registry.sessions[0].sessionId, "session-1");
  assert.deepEqual(registry.sessions[0].promptContext, {
    conversationKind: "main",
    scope: "session",
    session: {
      managedDatabaseRefresh: true,
      managedEnvironment: true,
      managedGit: true,
      managedPreview: true
    }
  });

  const conversation = await harness.controller.createConversation("session-1", {}, {
    runtime: harness.runtime,
    session: harness.session
  });
  await harness.controller.runDetachedChatTurn("session-1", {
    conversationId: conversation.conversationId,
    policy: "workspace_write",
    prompt: "Run one temporary task"
  }, {
    runtime: harness.runtime,
    session: harness.session
  });
  const updatedRegistry = JSON.parse(await readFile(
    sessionProcess.options.sessionEnvironmentRegistry,
    "utf8"
  ));
  const temporaryEnvironment = updatedRegistry.sessions.find((entry) => (
    entry.upstreamSessionId === conversation.conversationId
  ));
  assert.deepEqual(temporaryEnvironment, {
    ...updatedRegistry.sessions[0],
    promptContext: {
      conversationKind: "temporary-task",
      scope: "session",
      session: {
        managedDatabaseRefresh: true,
        managedEnvironment: true,
        managedGit: true,
        managedPreview: true
      }
    },
    upstreamSessionId: conversation.conversationId
  });
});

test("OpenCode starts its interactive terminal by attaching to the session's native history", async (t) => {
  const harness = await controllerHarness({ withCommandBoundary: true });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const terminal = await harness.controller.startTerminal("session-1", {}, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });

  assert.equal(terminal.ok, true);
  assert.equal(terminal.id, "opencode-terminal-1");
  assert.equal(harness.terminalStarts.length, 1);
  assert.equal(harness.terminalStarts[0].session, harness.session);
  assert.equal(harness.terminalStarts[0].workdir, path.join(
    harness.root,
    "sessions",
    "active",
    "session-1",
    "source"
  ));
  assert.match(harness.terminalStarts[0].namespace, /vibe64-opencode.*session-1/u);
  assert.match(harness.terminalStarts[0].upstreamSessionId, /^ses_vibe64_/u);
});

test("OpenCode reuses its terminal without creating prompt actor state", async (t) => {
  const harness = await controllerHarness({
    realAttachedTerminal: true,
    withCommandBoundary: true
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };

  const first = await harness.controller.startTerminal("session-1", {}, options);
  const second = await harness.controller.startTerminal("session-1", {}, options);

  assert.equal(first.ok, true);
  assert.equal(second.id, first.id);
  assert.equal(harness.terminalStarts.length, 1);

  await harness.controller.writeTerminal("session-1", first.id, "first", {
    trackGitActor: true
  }, {
    ...options,
    vibe64User: { preferredName: "Ada", username: "ada" }
  });
  await harness.controller.writeTerminal("session-1", first.id, "second", {
    trackGitActor: true
  }, {
    ...options,
    vibe64User: { preferredName: "Grace", username: "grace" }
  });
  await harness.controller.writeTerminal("session-1", first.id, "third", {
    trackGitActor: true
  }, {
    ...options,
    vibe64User: { username: "unnamed" }
  });
  const registryPath = harness.processStarts[0].options.sessionEnvironmentRegistry;
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(Object.hasOwn(registry.sessions[0], "turnContext"), false);

  await harness.controller.sendMessage("session-1", {
    message: "Routed message",
    messageId: "client-message-after-terminal"
  }, {
    ...options,
    vibe64User: { preferredName: "Ada", username: "ada" }
  });
  assert.equal(Object.hasOwn(harness.promptCalls.at(-1).input.prompt, "turnContext"), false);
});
