import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

async function controllerHarness({ assistantError = null, withCommandBoundary = false } = {}) {
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
    sessionId: "session-1",
    sessionRoot
  };
  const userMessages = [];
  const metadataWrites = [];
  const runtime = {
    projectContextRoot: root,
    stateRoot: path.join(root, "runtime"),
    store: {
      async conversationMessageIdExists() {
        return false;
      },
      async mutateSession(_sessionId, operation) {
        return operation();
      },
      async writeAgentRunEvent() {
        return null;
      },
      async writeConversationAssistantMessage(_sessionId, input) {
        return { id: input.messageId, text: input.text, type: "assistant" };
      },
      async writeConversationCommentaryMessage(_sessionId, input) {
        return { id: input.messageId, text: input.text, type: "commentary" };
      },
      async writeConversationThinkingMessage(_sessionId, input) {
        return { id: input.messageId, text: input.text, type: "thinking" };
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
  const createdSessions = [];
  const promptCalls = [];
  const switchedAgents = [];
  const switchedModels = [];
  const upstreamSessions = new Map();
  const outputs = new Map();
  let failNextPrompt = false;
  let nextSession = 1;

  function client() {
    return {
      async *events() {},
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
              ...(assistantError ? { error: assistantError } : { text: output }),
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
          : "Main turn complete");
        return { admittedSeq: promptCalls.length, id: input.id };
      },
      async providers() {
        return providerResult;
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
    ...(withCommandBoundary ? {
      agentDatabaseCommand: { id: "database" },
      agentEnvCommand: { id: "environment" },
      agentPreviewCommand: { id: "preview" },
      codexGitCommand: { id: "git" },
      async prepareCommandEnvironment(input) {
        commandEnvironmentCalls.push(input);
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
    async publishSessionChanged() {},
    async recordGitActor(input) {
      return { ok: true, session: input.session };
    },
    async resolveConnection() {
      return { ...connection };
    }
  });

  return {
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
    root,
    runtime,
    selection,
    session,
    switchedAgents,
    switchedModels,
    upstreamSessions,
    userMessages
  };
}

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
  assert.equal(harness.processStarts.filter((entry) => entry.options.apiKey).length, 1);
  assert.equal(
    harness.processStarts.find((entry) => entry.options.apiKey).options.apiKey,
    "deepseek-key-one"
  );
  const sessionProcess = harness.processStarts.find((entry) => entry.options.apiKey);
  assert.deepEqual(sessionProcess.options.execution, {
    label: "OpenCode assistant",
    operationId: "opencode-server",
    ownerId: "session-1",
    projectSlug: path.basename(harness.root),
    sessionId: "session-1"
  });
  const catalogProcess = harness.processStarts.find((entry) => !entry.options.apiKey);
  assert.equal(catalogProcess.options.execution.label, "OpenCode model catalogue");
  assert.equal(catalogProcess.options.execution.operationId, "opencode-catalog");
  assert.equal(catalogProcess.options.execution.projectSlug, path.basename(harness.root));
  assert.match(catalogProcess.options.execution.ownerId, /^opencode-catalog-[a-f0-9]{40}$/u);
  const mainPrompt = harness.promptCalls.find((entry) => entry.id === delivered.thread.id).input;
  assert.equal(mainPrompt.agent, "build");
  assert.deepEqual(mainPrompt.model, {
    id: "deepseek-chat",
    providerID: "deepseek",
    variant: "high"
  });
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
  const sessionStarts = harness.processStarts.filter((entry) => entry.options.apiKey);

  assert.equal(first.thread.id, second.thread.id);
  assert.equal(sessionStarts.length, 2);
  assert.equal(sessionStarts[0].options.dbPath, sessionStarts[1].options.dbPath);
  assert.equal(sessionStarts[0].options.workdir, sessionStarts[1].options.workdir);
  assert.equal(sessionStarts[0].options.apiKey, "deepseek-key-one");
  assert.equal(sessionStarts[1].options.apiKey, "deepseek-key-two");
  assert.equal(harness.processStops.includes(sessionStarts[0].options), true);
  assert.equal(harness.createdSessions.filter((entry) => entry.id === first.thread.id).length, 1);
});

test("OpenCode helper turns use the hidden deny-all agent and bounded structured output", async (t) => {
  const harness = await controllerHarness();
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
  const sessionProcess = harness.processStarts.find((entry) => entry.options.apiKey);
  assert.deepEqual(sessionProcess.options.managedEnv, {
    VIBE64_AGENT_DATABASE_COMMAND_SOCKET: "/managed/database.sock",
    VIBE64_AGENT_ENV_COMMAND_SOCKET: "/managed/environment.sock",
    VIBE64_AGENT_PREVIEW_COMMAND_SOCKET: "/managed/preview.sock",
    VIBE64_CODEX_GIT_COMMAND_SOCKET: "/managed/git.sock"
  });
  assert.deepEqual(sessionProcess.options.shimDirs, ["/managed/wrappers"]);
});
