import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  serializeVibe64AssistantSelection
} from "../../packages/vibe64-runtime/src/shared/index.js";
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
  providerEvents = [],
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
  let runStartedAt = "";
  const runtime = {
    projectContextRoot: root,
    stateRoot: path.join(root, "runtime"),
    async getSession() {
      return session;
    },
    store: {
      async conversationMessageIdExists() {
        return false;
      },
      async mutateSession(_sessionId, operation) {
        return operation();
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
  const commandEnvironmentCalls = [];
  const catalogReadCalls = [];
  const createdSessions = [];
  const promptCalls = [];
  const publishedSessionChanges = [];
  const switchedAgents = [];
  const switchedModels = [];
  const upstreamSessions = new Map();
  const outputs = new Map();
  const queuedAssistantResponses = [...assistantResponses];
  let failNextPrompt = false;
  let nextSession = 1;

  function client() {
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
        upstreamSessions.set(id, created);
        return created;
      },
      async deleteSession(id) {
        upstreamSessions.delete(id);
        return true;
      },
      async health() {
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
        if (failNextPrompt) {
          failNextPrompt = false;
          throw Object.assign(new Error("admission failed"), { statusCode: 503 });
        }
        outputs.set(id, id.startsWith("ses_detached_")
          ? '{"subject":"Add durable OpenCode sessions"}'
          : queuedAssistantResponses.shift() || "Main turn complete");
        return { admittedSeq: promptCalls.length, id: input.id };
      },
      async providers() {
        return catalogProviders;
      },
      async readSession(id) {
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
        async stop() {
          processStops.push(options);
          return { exited: true, signal: "SIGTERM" };
        }
      };
      processStarts.push(started);
      return started;
    },
    async listConnections() {
      return [{
        fingerprint: connection.fingerprint,
        modelProviderId: connection.modelProviderId,
        providerRevision: connection.providerRevision
      }];
    },
    projectService: {
      async createRuntime() {
        return runtime;
      },
      async readProjectAiPolicy() {
        return { aiPolicy: {}, ok: true };
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
    createdSessions,
    failPrompt() {
      failNextPrompt = true;
    },
    metadataWrites,
    processStarts,
    processStops,
    promptCalls,
    publishedSessionChanges,
    root,
    runtime,
    selection,
    session,
    switchedAgents,
    switchedModels,
    systemMessages,
    thinkingMessages,
    upstreamSessions,
    userMessages
  };
}

test("OpenCode cold catalog reads include every configured provider route", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.capabilities({ engineId: "opencode" });

  assert.equal(harness.processStarts.length, 0);
  assert.deepEqual(harness.catalogReadCalls[0].providerConnections, [{
    apiKey: "deepseek-key-one",
    canonicalUrl: "https://api.deepseek.com",
    economyModelId: "deepseek-chat",
    endpointCode: "deepseek_api",
    fingerprint: `sha256:${"1".repeat(64)}`,
    modelProviderId: "deepseek"
  }]);
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

test("OpenCode persists a user message only after upstream admission", async (t) => {
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
    message: "Second attempt",
    messageId: "client-message-2"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  assert.equal(delivered.ok, true);
  assert.equal(harness.userMessages.length, 1);
  assert.equal(harness.userMessages[0].messageId, "client-message-2");
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
  const mainPrompt = harness.promptCalls.find((entry) => entry.id === delivered.thread.id).input;
  assert.equal(mainPrompt.agent, "build");
  assert.deepEqual(mainPrompt.model, {
    id: "deepseek-chat",
    providerID: "deepseek",
    variant: "high"
  });
  assert.match(mainPrompt.prompt.text, /Issue the ordinary shell command you intend to run exactly once/u);
  assert.match(mainPrompt.prompt.text, /Never encode, copy, reconstruct, or invoke Vibe64's session-command wrapper/u);
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
  assert.deepEqual(harness.systemMessages, []);
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
  assert.deepEqual(harness.systemMessages, []);
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
  const result = await harness.controller.runDetachedChatTurn("session-1", {
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
  assert.equal(result.text, '{"subject":"Add durable OpenCode sessions"}');
  const helperPrompt = harness.promptCalls.find((entry) => entry.id === result.threadId).input;
  assert.equal(helperPrompt.agent, OPENCODE_ECONOMY_AGENT_ID);
  assert.deepEqual(helperPrompt.model, {
    id: "deepseek-chat",
    providerID: "deepseek"
  });
  assert.match(helperPrompt.prompt.text, /Return only one JSON value matching this JSON Schema/u);
  assert.match(helperPrompt.prompt.text, /"required":\["subject"\]/u);
  assert.equal(events.some((event) => event.type === "session.next.reasoning.started"), true);
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-server-progress"
  )), false);

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
});
