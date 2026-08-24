import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCodexAppServerEconomyOutputWithinLimit,
  codexAppServerEconomyThreadSettings,
  codexAppServerEconomyTurnSettings,
  codexAppServerIdentityMetadata,
  codexAppServerPromptWithContextRefresh,
  codexAppServerThreadStartSettings,
  codexAppServerThreadSettings,
  codexAppServerTurnPrompt,
  codexAppServerTurnSettings,
  ensureCodexAppServerThreadForSession,
  prepareCodexAppServerEconomyThreadStartSettings,
  resumeCodexAppServerEconomyThread,
  sendCodexAppServerEconomyTurn,
  sendCodexAppServerPromptForSession,
  startCodexAppServerEconomyThread
} from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_SPARK_MODEL,
  defineVibe64AgentExecutionProfileResolution
} from "@local/vibe64-runtime/shared";
import {
  STUDIO_MANAGED_CODEX_COMMAND,
  STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
function fakeRuntime({
  conversationLog = []
} = {}) {
  const writes = [];
  return {
    store: {
      async mutateSession(sessionId, callback) {
        await callback();
        writes.push({
          kind: "mutate",
          sessionId
        });
      },
      async writeMetadataValue(sessionId, name, value) {
        writes.push({
          kind: "metadata",
          name,
          sessionId,
          value
        });
      },
      async readConversationLog() {
        return conversationLog;
      }
    },
    writes
  };
}

function metadataValue(runtime, name) {
  return runtime.writes.find((write) => write.kind === "metadata" && write.name === name)?.value;
}

function appServerRuntime() {
  return {
    endpoint: "unix:///tmp/vibe64/agent-providers/codex-app-server/app-server.sock",
    runtimeDir: "/tmp/vibe64/agent-providers/codex-app-server",
    socketPath: "/tmp/vibe64/agent-providers/codex-app-server/app-server.sock",
    transport: "unix"
  };
}

function sourceExplanationEconomyProfile(overrides = {}) {
  return defineVibe64AgentExecutionProfileResolution({
    limits: {
      maxInputCharacters: 100_000,
      maxOutputCharacters: 16_000,
      timeoutMs: 180_000
    },
    model: "gpt-5.6-luna",
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: "none"
    },
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
    providerId: "codex",
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false
    },
    revision: "codex-economy-luna-low-v1",
    thinking: "low",
    workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.SOURCE_EXPLANATION,
    ...overrides
  });
}

function sourceExplanationOutputSchema(maxLength = 2_000) {
  return {
    additionalProperties: false,
    properties: {
      answer: {
        maxLength,
        minLength: 1,
        type: "string"
      }
    },
    required: ["answer"],
    type: "object"
  };
}

const ECONOMY_EXECUTION_CWD = "/runtime/vibe64/codex-economy/workspace";
const ECONOMY_ACCOUNT_IDENTITY_SIGNATURE = `sha256:${"a".repeat(64)}`;

function economyExecutionProviderParts() {
  return {
    async currentEconomyExecutionContext() {
      return {
        accountIdentitySignature: ECONOMY_ACCOUNT_IDENTITY_SIGNATURE,
        cwd: ECONOMY_EXECUTION_CWD,
        executionMode: "economy"
      };
    }
  };
}

function economyInventoryProvider({
  generation = 1,
  hooks = [],
  mcpServers = {},
  records = null,
  userAgent = "vibe64/0.149.0 (unit test)"
} = {}) {
  const calls = [];
  return {
    ...economyExecutionProviderParts(),
    calls,
    currentConnectionGeneration() {
      return generation;
    },
    currentServerInfo() {
      return { userAgent };
    },
    async listHooks(cwds) {
      calls.push(["listHooks", cwds]);
      return {
        data: records || [{
          cwd: cwds[0],
          errors: [],
          hooks,
          warnings: []
        }]
      };
    },
    async readConfig(params) {
      calls.push(["readConfig", params]);
      return {
        config: {
          mcp_servers: mcpServers
        }
      };
    }
  };
}

function contextTurnProviderParts(providerCalls) {
  const subscribers = [];
  return {
    async sendTurn(threadId, input, params) {
      providerCalls.push({
        input,
        method: "sendTurn",
        params,
        threadId
      });
      queueMicrotask(() => {
        for (const callback of subscribers) {
          callback({
            method: "turn/completed",
            params: {
              threadId,
              turn: {
                id: "context-turn",
                status: "completed"
              },
              turnId: "context-turn"
            }
          });
        }
      });
      return {
        id: "context-turn",
        status: "inProgress"
      };
    },
    subscribe(callback) {
      subscribers.push(callback);
      return () => null;
    }
  };
}

test("codex app-server bridge uses the current Vibe64 Codex execution settings", () => {
  assert.deepEqual(codexAppServerThreadSettings({
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    developerInstructions: "Vibe64 briefing"
  }), {
    approvalPolicy: "never",
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    developerInstructions: "Vibe64 briefing",
    model: VIBE64_CODEX_DEFAULT_MODEL,
    sandbox: "danger-full-access"
  });
  assert.deepEqual(codexAppServerTurnSettings({
    cwd: "/runtime/projects/repo-test/sessions/active/session/source"
  }), {
    approvalPolicy: "never",
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    effort: "xhigh",
    model: VIBE64_CODEX_DEFAULT_MODEL,
    sandboxPolicy: {
      networkAccess: "enabled",
      type: "externalSandbox"
    },
    summary: "concise"
  });
  assert.deepEqual(codexAppServerTurnSettings({
    agentSettings: {
      thinking: "high"
    },
    cwd: "/runtime/projects/repo-test/sessions/active/session/source"
  }), {
    approvalPolicy: "never",
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    effort: "high",
    model: VIBE64_CODEX_DEFAULT_MODEL,
    sandboxPolicy: {
      networkAccess: "enabled",
      type: "externalSandbox"
    },
    summary: "concise"
  });
  assert.deepEqual(codexAppServerTurnSettings({
    agentSettings: {
      model: VIBE64_CODEX_SPARK_MODEL,
      thinking: "high"
    },
    cwd: "/runtime/projects/repo-test/sessions/active/session/source"
  }), {
    approvalPolicy: "never",
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    effort: "high",
    model: VIBE64_CODEX_SPARK_MODEL,
    sandboxPolicy: {
      networkAccess: "enabled",
      type: "externalSandbox"
    }
  });
});

test("Codex economy settings are Luna-low, bounded, tool-free, and never fall back", async () => {
  const provider = economyInventoryProvider({
    hooks: [{
      currentHash: "sha256:malicious-hook",
      enabled: true,
      handlerType: "command",
      isManaged: false,
      key: "/repo/worktree/.codex/hooks.json:stop:0:0",
      sourcePath: "/repo/worktree/.codex/hooks.json"
    }, {
      currentHash: "sha256:disabled-managed-hook",
      enabled: false,
      handlerType: "command",
      isManaged: true,
      key: "managed:disabled:0",
      sourcePath: "/etc/codex/hooks.json"
    }],
    mcpServers: {
      "danger.server": {
        command: "write-anywhere"
      },
      "quoted\"server": {
        command: "exfiltrate"
      }
    }
  });
  const executionProfile = sourceExplanationEconomyProfile();
  const prepared = await prepareCodexAppServerEconomyThreadStartSettings({
    developerInstructions: "Explain only the bounded excerpt in the prompt.",
    executionProfile,
    provider
  });

  assert.deepEqual(prepared.executionProfile, executionProfile);
  assert.equal(prepared.enforcement.connectionGeneration, 1);
  assert.deepEqual(prepared.enforcement.mcpServerNames, [
    "danger.server",
    "quoted\"server"
  ]);
  assert.deepEqual(prepared.settings, {
    allowProviderModelFallback: false,
    approvalPolicy: "never",
    baseInstructions: "Complete only the bounded structured task in the user input. Return one response matching the supplied JSON schema. Do not use tools, environments, network access, or repository writes.",
    config: prepared.enforcement.config,
    cwd: ECONOMY_EXECUTION_CWD,
    developerInstructions: "Explain only the bounded excerpt in the prompt.",
    dynamicTools: [],
    environments: [],
    model: "gpt-5.6-luna",
    runtimeWorkspaceRoots: [],
    sandbox: "read-only",
    selectedCapabilityRoots: [],
    sessionStartSource: "startup",
    threadSource: "vibe64-economy"
  });
  assert.deepEqual(prepared.settings.config.mcp_servers, {
    "danger.server": {
      enabled: false
    },
    "quoted\"server": {
      enabled: false
    }
  });
  assert.deepEqual(prepared.settings.config.hooks, {
    state: {
      "/repo/worktree/.codex/hooks.json:stop:0:0": {
        enabled: false
      }
    }
  });
  assert.equal(prepared.settings.config.features.shell_tool, false);
  assert.equal(prepared.settings.config.features.plugins, false);
  assert.equal(prepared.settings.config.features.apps, false);
  assert.equal(prepared.settings.config.features.browser_use, false);
  assert.equal(prepared.settings.config.features.computer_use, false);
  assert.equal(prepared.settings.config.features.hooks, false);
  assert.equal(prepared.settings.config.features.multi_agent, false);
  assert.equal(prepared.settings.config.features.tool_suggest, false);
  assert.equal(prepared.settings.config.features.view_image, false);
  assert.deepEqual(prepared.settings.config.notify, []);
  assert.equal(prepared.settings.config.orchestrator.mcp.enabled, false);
  assert.equal(prepared.settings.config.orchestrator.skills.enabled, false);
  assert.equal(prepared.settings.config.skills.include_instructions, false);
  assert.equal(prepared.settings.config.include_apps_instructions, false);
  assert.equal(prepared.settings.config.include_permissions_instructions, false);
  assert.equal(prepared.settings.config.include_environment_context, false);
  assert.equal(prepared.settings.config.project_doc_max_bytes, 0);
  assert.equal(Object.isFrozen(prepared.settings.config), true);
  assert.equal(Object.isFrozen(prepared.settings.config.mcp_servers["danger.server"]), true);

  assert.deepEqual(codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile,
    outputSchema: sourceExplanationOutputSchema()
  }), {
    approvalPolicy: "never",
    cwd: "/repo/worktree",
    effort: "low",
    environments: [],
    model: "gpt-5.6-luna",
    outputSchema: sourceExplanationOutputSchema(),
    runtimeWorkspaceRoots: [],
    sandboxPolicy: {
      networkAccess: false,
      type: "readOnly"
    },
    summary: "none"
  });
  assert.deepEqual(provider.calls, [[
    "readConfig",
    {
      cwd: ECONOMY_EXECUTION_CWD,
      includeLayers: false
    }
  ], [
    "listHooks",
    [ECONOMY_EXECUTION_CWD]
  ]]);
});

test("Codex economy fails closed before inventory when app-server cannot enforce the policy", async () => {
  for (const [label, provider] of [
    ["missing version API", {
      ...economyInventoryProvider(),
      currentServerInfo: undefined
    }],
    ["malformed version", economyInventoryProvider({
      userAgent: "vibe64/development"
    })],
    ["spoofed product", economyInventoryProvider({
      userAgent: "attacker/999.0.0 vibe64/0.149.0"
    })],
    ["leading zero", economyInventoryProvider({
      userAgent: "vibe64/00.149.0"
    })],
    ["control character", economyInventoryProvider({
      userAgent: "vibe64/0.149.0\nattacker/999.0.0"
    })],
    ["oversized user agent", economyInventoryProvider({
      userAgent: `vibe64/0.149.0 ${"x".repeat(600)}`
    })],
    ["old version", economyInventoryProvider({
      userAgent: "vibe64/0.147.0 (unit test)"
    })],
    ["unaudited patch version", economyInventoryProvider({
      userAgent: "vibe64/0.149.1 (unit test)"
    })],
    ["unaudited future version", economyInventoryProvider({
      userAgent: "vibe64/0.150.0 (unit test)"
    })]
  ]) {
    await assert.rejects(prepareCodexAppServerEconomyThreadStartSettings({
      executionProfile: sourceExplanationEconomyProfile(),
      provider
    }), (error) => {
      assert.equal(
        error.code,
        VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE,
        label
      );
      assert.match(error.message, /Update managed Codex and retry/u, label);
      return true;
    });
    assert.deepEqual(provider.calls, [], label);
  }

  const supported = economyInventoryProvider();
  await prepareCodexAppServerEconomyThreadStartSettings({
    executionProfile: sourceExplanationEconomyProfile(),
    provider: supported
  });
  assert.equal(supported.calls.length, 2);
});

test("Codex economy rejects unsafe profiles and non-strict or unbounded output schemas", () => {
  assert.throws(() => codexAppServerEconomyThreadSettings({
    config: {},
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile()
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /verified tool-isolation configuration/u);
    return true;
  });

  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile({
      providerId: "claude"
    }),
    outputSchema: sourceExplanationOutputSchema()
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    return true;
  });

  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile(),
    outputSchema: {
      properties: {
        answer: {
          maxLength: 100,
          type: "string"
        }
      },
      required: ["answer"],
      type: "object"
    }
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /reject additional properties/u);
    return true;
  });

  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile(),
    outputSchema: sourceExplanationOutputSchema(16_001)
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /exceed the resolved output limit/u);
    return true;
  });

  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile(),
    outputSchema: {
      additionalProperties: false,
      properties: {
        answer: {
          maxLength: 100,
          pattern: ".*",
          type: "string"
        }
      },
      required: ["answer"],
      type: "object"
    }
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /unsupported keyword/u);
    return true;
  });

  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile(),
    outputSchema: {
      maximum: 1,
      minimum: 2,
      type: "number"
    }
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /unsupported type/u);
    return true;
  });

  const escapedStringProfile = sourceExplanationEconomyProfile({
    limits: {
      maxInputCharacters: 100,
      maxOutputCharacters: 18,
      timeoutMs: 1000
    }
  });
  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: escapedStringProfile,
    outputSchema: sourceExplanationOutputSchema(1)
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.equal(error.maximumCharacters, JSON.stringify({ answer: "\u0000" }).length);
    assert.match(error.message, /exceed the resolved output limit/u);
    return true;
  });
  assert.doesNotThrow(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile({
      limits: {
        maxInputCharacters: 100,
        maxOutputCharacters: JSON.stringify({ answer: "\u0000" }).length,
        timeoutMs: 1000
      }
    }),
    outputSchema: sourceExplanationOutputSchema(1)
  }));

  const cyclicSchema = {
    additionalProperties: false,
    properties: {},
    required: [],
    type: "object"
  };
  cyclicSchema.properties.answer = cyclicSchema;
  cyclicSchema.required.push("answer");
  assert.throws(() => codexAppServerEconomyTurnSettings({
    cwd: "/repo/worktree",
    executionProfile: sourceExplanationEconomyProfile(),
    outputSchema: cyclicSchema
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /not serializable/u);
    return true;
  });
});

test("Codex economy fails closed for managed hooks and incomplete hook discovery", async () => {
  await assert.rejects(prepareCodexAppServerEconomyThreadStartSettings({
    executionProfile: sourceExplanationEconomyProfile(),
    provider: economyInventoryProvider({
      hooks: [{
        currentHash: "sha256:managed-hook",
        enabled: true,
        handlerType: "command",
        isManaged: true,
        key: "managed:stop:0",
        sourcePath: "/etc/codex/hooks.json"
      }]
    })
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /cannot disable a managed hook/u);
    return true;
  });

  await assert.rejects(prepareCodexAppServerEconomyThreadStartSettings({
    executionProfile: sourceExplanationEconomyProfile(),
    provider: economyInventoryProvider({
      records: [{
        cwd: ECONOMY_EXECUTION_CWD,
        errors: [{ message: "malformed hook configuration" }],
        hooks: [],
        warnings: []
      }]
    })
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /hook discovery has errors/u);
    assert.doesNotMatch(JSON.stringify(error), /malformed hook configuration/u);
    return true;
  });
});

test("Codex economy bounds config, hook, and instruction inventories without exposing their payloads", async () => {
  const cases = [{
    label: "too many MCP servers",
    provider: economyInventoryProvider({
      mcpServers: Object.fromEntries(Array.from({ length: 129 }, (_, index) => [
        `server-${index}`,
        { command: "unsafe" }
      ]))
    })
  }, {
    label: "oversized MCP configuration",
    provider: economyInventoryProvider({
      mcpServers: {
        malicious: {
          secret: `config-secret-${"x".repeat(300 * 1024)}`
        }
      }
    })
  }, {
    label: "oversized hook inventory",
    provider: economyInventoryProvider({
      hooks: [{
        currentHash: "hash",
        enabled: false,
        handlerType: "command",
        isManaged: false,
        key: "hook-key",
        sourcePath: `hook-secret-${"x".repeat(520 * 1024)}`
      }]
    })
  }];

  for (const { label, provider } of cases) {
    await assert.rejects(prepareCodexAppServerEconomyThreadStartSettings({
      executionProfile: sourceExplanationEconomyProfile(),
      provider
    }), (error) => {
      assert.equal(
        error.code,
        VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE,
        label
      );
      assert.doesNotMatch(JSON.stringify(error), /config-secret|hook-secret/u, label);
      return true;
    });
  }

  await assert.rejects(prepareCodexAppServerEconomyThreadStartSettings({
    developerInstructions: "x".repeat(8193),
    executionProfile: sourceExplanationEconomyProfile(),
    provider: economyInventoryProvider()
  }), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED);
    assert.match(error.message, /developer instructions exceed/u);
    return true;
  });
});

test("Codex economy deletes a new thread when execution surfaces change during startup", async () => {
  const calls = [];
  let inventory = 0;
  const provider = {
    ...economyExecutionProviderParts(),
    currentConnectionGeneration() {
      return 4;
    },
    currentServerInfo() {
      return { userAgent: "vibe64/0.149.0 (unit test)" };
    },
    async deleteThread(threadId) {
      calls.push(["deleteThread", threadId]);
    },
    async listHooks(cwds) {
      calls.push(["listHooks", cwds]);
      return {
        data: [{
          cwd: cwds[0],
          errors: [],
          hooks: [],
          warnings: []
        }]
      };
    },
    async readConfig(params) {
      inventory += 1;
      calls.push(["readConfig", params]);
      return {
        config: {
          mcp_servers: inventory === 1 ? {} : {
            "late-write-tool": {
              command: "write-anywhere"
            }
          }
        }
      };
    },
    async startThread(params) {
      calls.push(["startThread", params]);
      return {
        id: "economy-thread"
      };
    }
  };

  await assert.rejects(startCodexAppServerEconomyThread({
    executionProfile: sourceExplanationEconomyProfile(),
    provider
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.match(error.message, /execution surfaces changed/u);
    return true;
  });
  assert.deepEqual(calls.at(-1), ["deleteThread", "economy-thread"]);
});

test("Codex economy reports retryable ownership when post-start deletion fails", async () => {
  let inventory = 0;
  const provider = economyInventoryProvider();
  provider.readConfig = async () => {
    inventory += 1;
    return {
      config: {
        mcp_servers: inventory === 1 ? {} : {
          "late-write-tool": {
            command: "write-anywhere"
          }
        }
      }
    };
  };
  provider.startThread = async () => ({ id: "unclean-economy-thread" });
  provider.deleteThread = async () => {
    throw new Error("delete transport failed");
  };

  await assert.rejects(startCodexAppServerEconomyThread({
    executionProfile: sourceExplanationEconomyProfile(),
    provider
  }), (error) => {
    assert.equal(
      error.code,
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE
    );
    assert.equal(error.codexAppServerEconomyThreadCleanupRequired, true);
    assert.equal(error.codexAppServerEconomyThreadId, "unclean-economy-thread");
    assert.equal(error.cleanupFailed, true);
    assert.match(error.message, /could not retire an economy thread/u);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("Codex economy turn enforces the input bound before contacting the provider", async () => {
  const calls = [];
  const executionProfile = sourceExplanationEconomyProfile({
    limits: {
      maxInputCharacters: 8,
      maxOutputCharacters: 16_000,
      timeoutMs: 180_000
    }
  });
  const provider = {
    ...economyExecutionProviderParts(),
    async sendTurn(...args) {
      calls.push(args);
      return {
        id: "turn-1"
      };
    }
  };

  await assert.rejects(sendCodexAppServerEconomyTurn({
    executionProfile,
    outputSchema: sourceExplanationOutputSchema(),
    prompt: "123456789",
    provider,
    threadId: "economy-thread"
  }), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED);
    return true;
  });
  assert.equal(calls.length, 0);

  const result = await sendCodexAppServerEconomyTurn({
    executionProfile,
    outputSchema: sourceExplanationOutputSchema(),
    prompt: "bounded",
    provider,
    threadId: "economy-thread"
  });
  assert.deepEqual(result.executionProfile, executionProfile);
  assert.equal(result.turn.id, "turn-1");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ["economy-thread", "bounded"]);
  assert.deepEqual(calls[0][2].environments, []);
  assert.equal(calls[0][2].sandboxPolicy.type, "readOnly");
  assert.equal(calls[0][2].sandboxPolicy.networkAccess, false);
});

test("Codex economy rejects raw structured output beyond the resolved bound", () => {
  const executionProfile = sourceExplanationEconomyProfile({
    limits: {
      maxInputCharacters: 100_000,
      maxOutputCharacters: 20,
      timeoutMs: 180_000
    }
  });

  assert.equal(assertCodexAppServerEconomyOutputWithinLimit({
    executionProfile,
    rawOutput: "{\"answer\":\"short\"}"
  }), "{\"answer\":\"short\"}");
  assert.throws(() => assertCodexAppServerEconomyOutputWithinLimit({
    executionProfile,
    rawOutput: "{\"answer\":\"too long\"}"
  }), (error) => {
    assert.equal(error.code, VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.UNBOUNDED);
    assert.equal(error.maxOutputCharacters, 20);
    assert.equal(error.outputCharacters, 21);
    return true;
  });
});

test("Codex economy safely reapplies isolation when resuming a controller-owned thread", async () => {
  const calls = [];
  const provider = {
    ...economyExecutionProviderParts(),
    currentConnectionGeneration() {
      return 7;
    },
    currentServerInfo() {
      return { userAgent: "vibe64/0.149.0 (unit test)" };
    },
    async deleteThread(threadId) {
      calls.push(["deleteThread", threadId]);
    },
    async listHooks(cwds) {
      calls.push(["listHooks", cwds]);
      return {
        data: [{
          cwd: cwds[0],
          errors: [],
          hooks: [],
          warnings: []
        }]
      };
    },
    async readConfig(params) {
      calls.push(["readConfig", params]);
      return {
        config: {
          mcp_servers: {
            filesystem: {
              command: "unsafe-fixture"
            }
          }
        }
      };
    },
    async resumeThread(threadId, params) {
      calls.push(["resumeThread", threadId, params]);
      return {
        id: threadId
      };
    }
  };

  const result = await resumeCodexAppServerEconomyThread({
    developerInstructions: "Continue only this source explanation.",
    executionProfile: sourceExplanationEconomyProfile(),
    provider,
    threadId: "registered-economy-thread"
  });

  assert.equal(result.threadId, "registered-economy-thread");
  assert.equal(calls.filter(([method]) => method === "readConfig").length, 2);
  assert.equal(calls.filter(([method]) => method === "listHooks").length, 2);
  const resumeCall = calls.find(([method]) => method === "resumeThread");
  assert.equal(resumeCall[1], "registered-economy-thread");
  assert.deepEqual(resumeCall[2].runtimeWorkspaceRoots, []);
  assert.equal(resumeCall[2].sandbox, "read-only");
  assert.equal(resumeCall[2].config.mcp_servers.filesystem.enabled, false);
  assert.equal(Object.hasOwn(resumeCall[2], "dynamicTools"), false);
  assert.equal(Object.hasOwn(resumeCall[2], "environments"), false);
  assert.equal(Object.hasOwn(resumeCall[2], "selectedCapabilityRoots"), false);
  assert.equal(calls.some(([method]) => method === "deleteThread"), false);
});

test("codex app-server bridge preserves an explicit Spark interactive turn", () => {
  assert.deepEqual(codexAppServerTurnSettings({
    agentSettings: {
      model: VIBE64_CODEX_SPARK_MODEL,
      thinking: "medium"
    },
    cwd: "/runtime/projects/repo-test/sessions/active/session/source"
  }), {
    approvalPolicy: "never",
    cwd: "/runtime/projects/repo-test/sessions/active/session/source",
    effort: "medium",
    model: VIBE64_CODEX_SPARK_MODEL,
    sandboxPolicy: {
      networkAccess: "enabled",
      type: "externalSandbox"
    }
  });
});

test("codex app-server bridge sends the user prompt unchanged", () => {
  assert.equal(
    codexAppServerTurnPrompt({
      prompt: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Hello"
    }),
    "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Hello"
  );
});

test("codex app-server bridge keeps the user input before a hidden context refresh", () => {
  const prompt = codexAppServerPromptWithContextRefresh({
    contextRefresh: "Vibe64 session briefing\nJSKIT: use generators.",
    prompt: "Vibe64 interactive conversation turn:\nUser/request input:\n- conversationRequest: Continue.",
    promptLabel: "Real Vibe64 routed turn"
  });

  assert.match(prompt, /^Vibe64 interactive conversation turn:/u);
  assert.match(prompt, /This section is developer\/session context, not a user request\./u);
  assert.match(prompt, /--- BEGIN FRESH VIBE64 SESSION BRIEFING ---\nVibe64 session briefing\nJSKIT: use generators\./u);
  assert.match(prompt, /Real Vibe64 routed turn context refresh:\nVIBE64_CONTEXT_REFRESH:/u);
  assert.match(prompt, /conversationRequest: Continue\./u);
  assert.ok(prompt.indexOf("conversationRequest: Continue.") < prompt.indexOf("VIBE64_CONTEXT_REFRESH:"));
});

test("codex app-server bridge records the host CLI resume command for the same thread", () => {
  const metadata = codexAppServerIdentityMetadata({
    appServerRuntime: appServerRuntime(),
    threadId: "019e865d-8108-7740-912b-42ece83a5c73",
    workdir: "/runtime/projects/repo-test/sessions/active/session/source"
  });

  assert.equal(metadata.agent_identity_conversation_id, "019e865d-8108-7740-912b-42ece83a5c73");
  assert.equal(Object.hasOwn(metadata, "agent_workflow_result_transport"), false);
  assert.equal(
    metadata.agent_resume_command,
    `${STUDIO_MANAGED_CODEX_COMMAND} -c ${STUDIO_MANAGED_CODEX_NO_UPDATE_CONFIG} --remote unix:///tmp/vibe64/agent-providers/codex-app-server/app-server.sock resume 019e865d-8108-7740-912b-42ece83a5c73`
  );
  assert.equal(metadata.agent_transport_kind, "unix");
  assert.equal(metadata.agent_transport_socket_path, "/tmp/vibe64/agent-providers/codex-app-server/app-server.sock");
});

test("codex app-server bridge starts a missing session thread and stores identity metadata", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...contextTurnProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async startThread(params) {
      providerCalls.push({
        method: "startThread",
        params
      });
      return {
        id: "thread-started"
      };
    }
  };

  const result = await ensureCodexAppServerThreadForSession({
    developerInstructions: "Vibe64 briefing",
    provider,
    runtime,
    session: {
      metadata: {},
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "thread-started");
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].method, "startThread");
  assert.equal(providerCalls[0].params.cwd, "/repo/worktree");
  assert.equal(Object.hasOwn(providerCalls[0].params, "dynamicTools"), false);
  assert.equal(metadataValue(runtime, "agent_identity_provider"), "codex");
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "thread-started");
  assert.equal(metadataValue(runtime, "agent_transport_kind"), "unix");
  assert.equal(metadataValue(runtime, "agent_transport_socket_path"), "/tmp/vibe64/agent-providers/codex-app-server/app-server.sock");
  assert.equal(metadataValue(runtime, "agent_workflow_result_transport"), undefined);
});

test("codex app-server bridge activates exact project hooks for each new thread", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    async ensureRuntime() {
      return appServerRuntime();
    },
    async listHooks(cwds) {
      providerCalls.push({
        cwds,
        method: "listHooks"
      });
      return {
        data: [{
          cwd: "/repo/worktree",
          hooks: [{
            currentHash: "sha256:genesis-begin",
            enabled: true,
            key: "/repo/worktree/.codex/hooks.json:user_prompt_submit:0:0",
            source: "project"
          }, {
            currentHash: "sha256:ignored-plugin",
            enabled: true,
            key: "plugin:other",
            source: "plugin"
          }, {
            currentHash: "sha256:ignored-disabled",
            enabled: false,
            key: "/repo/worktree/.codex/hooks.json:stop:0:0",
            source: "project"
          }]
        }]
      };
    },
    async startThread(params) {
      providerCalls.push({
        method: "startThread",
        params
      });
      return {
        id: "thread-started"
      };
    }
  };

  await ensureCodexAppServerThreadForSession({
    provider,
    runtime,
    session: {
      metadata: {},
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.deepEqual(providerCalls, [{
    cwds: ["/repo/worktree"],
    method: "listHooks"
  }, {
    method: "startThread",
    params: {
      approvalPolicy: "never",
      config: {
        hooks: {
          state: {
            "/repo/worktree/.codex/hooks.json:user_prompt_submit:0:0": {
              trusted_hash: "sha256:genesis-begin"
            }
          }
        }
      },
      cwd: "/repo/worktree",
      developerInstructions: null,
      model: VIBE64_CODEX_DEFAULT_MODEL,
      sandbox: "danger-full-access",
      sessionStartSource: "startup",
      threadSource: "vibe64"
    }
  }]);
});

test("codex app-server bridge resumes an existing session thread", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...contextTurnProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async resumeThread(threadId, params) {
      providerCalls.push({
        method: "resumeThread",
        params,
        threadId
      });
      return {
        id: threadId
      };
    }
  };

  const result = await ensureCodexAppServerThreadForSession({
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "thread-existing",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
        agent_transport_id: "codex_app_server"
      },
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "thread-existing");
  assert.deepEqual(providerCalls, [
    {
      method: "resumeThread",
      params: {
        approvalPolicy: "never",
        cwd: "/repo/worktree",
        developerInstructions: null,
        model: VIBE64_CODEX_DEFAULT_MODEL,
        sandbox: "danger-full-access"
      },
      threadId: "thread-existing"
    }
  ]);
});

test("codex app-server bridge refreshes project hook trust when resuming a thread", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    async ensureRuntime() {
      return appServerRuntime();
    },
    async listHooks(cwds) {
      providerCalls.push({
        cwds,
        method: "listHooks"
      });
      return {
        data: [{
          cwd: "/repo/worktree",
          hooks: [{
            currentHash: "sha256:current-stop-hook",
            enabled: true,
            key: "/repo/worktree/.codex/hooks.json:stop:0:0",
            source: "project"
          }]
        }]
      };
    },
    async resumeThread(threadId, params) {
      providerCalls.push({
        method: "resumeThread",
        params,
        threadId
      });
      return {
        id: threadId
      };
    }
  };

  await ensureCodexAppServerThreadForSession({
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "thread-existing",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
        agent_transport_id: "codex_app_server"
      },
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(providerCalls[1].method, "resumeThread");
  assert.equal(providerCalls[1].threadId, "thread-existing");
  assert.deepEqual(providerCalls[1].params.config, {
    hooks: {
      state: {
        "/repo/worktree/.codex/hooks.json:stop:0:0": {
          trusted_hash: "sha256:current-stop-hook"
        }
      }
    }
  });
});

test("codex app-server bridge replaces unreadable session threads after an invalid resume request", async () => {
  const runtime = fakeRuntime({
    conversationLog: [
      {
        assistant: {
          at: "2026-06-15T01:02:05.000Z",
          role: "assistant",
          text: "Use the archive branch."
        },
        commentary: [
          {
            at: "2026-06-15T01:02:04.500Z",
            role: "commentary",
            text: "I found the archive branch and I’m checking its scope."
          }
        ],
        thinking: [
          {
            at: "2026-06-15T01:02:04.000Z",
            role: "thinking",
            text: "Checked the issue draft."
          }
        ],
        user: {
          at: "2026-06-15T01:02:03.000Z",
          role: "user",
          text: "Can we talk about archive scope?"
        }
      }
    ]
  });
  const providerCalls = [];
  const provider = {
    ...contextTurnProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async resumeThread(threadId, params) {
      providerCalls.push({
        method: "resumeThread",
        params,
        threadId
      });
      throw Object.assign(new Error("invalid request"), {
        code: -32600,
        method: "thread/resume"
      });
    },
    async readThread(threadId) {
      providerCalls.push({
        method: "readThread",
        threadId
      });
      throw Object.assign(new Error("invalid request"), {
        code: -32600,
        method: "thread/read"
      });
    },
    async startThread(params) {
      providerCalls.push({
        method: "startThread",
        params
      });
      return {
        id: "thread-replacement"
      };
    }
  };

  const result = await ensureCodexAppServerThreadForSession({
    developerInstructions: "Vibe64 briefing",
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "thread-stale",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
        agent_transport_id: "codex_app_server"
      },
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "thread-replacement");
  assert.equal(result.replacedThreadId, "thread-stale");
  assert.equal(result.replacedThreadError?.code, -32600);
  assert.deepEqual(providerCalls.map((call) => call.method), [
    "resumeThread",
    "readThread",
    "startThread",
    "sendTurn"
  ]);
  assert.equal(providerCalls[0].threadId, "thread-stale");
  assert.equal(providerCalls[0].params.developerInstructions, "Vibe64 briefing");
  assert.equal(providerCalls[2].params.cwd, "/repo/worktree");
  assert.equal(providerCalls[3].threadId, "thread-replacement");
  assert.match(providerCalls[3].input, /VIBE64_CONTEXT_RECOVERY/u);
  assert.match(providerCalls[3].input, /Previous provider thread:\nthread-stale/u);
  assert.match(providerCalls[3].input, /Fresh provider thread:\nthread-replacement/u);
  assert.match(providerCalls[3].input, /Can we talk about archive scope\?/u);
  assert.match(providerCalls[3].input, /Checked the issue draft/u);
  assert.match(providerCalls[3].input, /Assistant Commentary 1/u);
  assert.match(providerCalls[3].input, /I found the archive branch and I’m checking its scope/u);
  assert.match(providerCalls[3].input, /Use the archive branch/u);
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "thread-replacement");
  assert.equal(metadataValue(runtime, "codex_app_server_replaced_thread_id"), "thread-stale");
  assert.equal(metadataValue(runtime, "codex_app_server_replaced_thread_error"), "invalid request");
});

test("codex app-server bridge preserves a readable thread after an invalid resume request", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...contextTurnProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async resumeThread(threadId) {
      providerCalls.push({
        method: "resumeThread",
        threadId
      });
      throw Object.assign(new Error("invalid request"), {
        code: -32600,
        method: "thread/resume"
      });
    },
    async readThread(threadId) {
      providerCalls.push({
        method: "readThread",
        threadId
      });
      return {
        id: threadId,
        raw: {
          id: threadId,
          turns: []
        }
      };
    },
    async startThread() {
      providerCalls.push({
        method: "startThread"
      });
      return {
        id: "thread-replacement"
      };
    }
  };

  await assert.rejects(
    () => ensureCodexAppServerThreadForSession({
      provider,
      runtime,
      session: {
        metadata: {
          agent_identity_conversation_id: "thread-readable",
          agent_identity_provider: "codex",
          agent_identity_status: "ready",
          agent_identity_workdir: "/repo/worktree",
          agent_transport_id: "codex_app_server"
        },
        sessionId: "session-1"
      },
      workdir: "/repo/worktree"
    }),
    (error) => error?.code === -32600 && error?.method === "thread/resume"
  );
  assert.deepEqual(providerCalls, [
    {
      method: "resumeThread",
      threadId: "thread-readable"
    },
    {
      method: "readThread",
      threadId: "thread-readable"
    }
  ]);
});

test("codex app-server bridge does not replace transport resume failures", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...contextTurnProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async resumeThread(threadId) {
      providerCalls.push({
        method: "resumeThread",
        threadId
      });
      throw new Error("failed to connect to remote app server");
    },
    async startThread() {
      providerCalls.push({
        method: "startThread"
      });
      return {
        id: "thread-replacement"
      };
    }
  };

  await assert.rejects(
    () => ensureCodexAppServerThreadForSession({
      provider,
      runtime,
      session: {
        metadata: {
          agent_identity_conversation_id: "thread-existing",
          agent_identity_provider: "codex",
          agent_identity_status: "ready",
          agent_identity_workdir: "/repo/worktree",
          agent_transport_id: "codex_app_server"
        },
        sessionId: "session-1"
      },
      workdir: "/repo/worktree"
    }),
    /failed to connect to remote app server/u
  );
  assert.deepEqual(providerCalls, [
    {
      method: "resumeThread",
      threadId: "thread-existing"
    }
  ]);
});

test("codex app-server bridge resumes an existing provider thread without workflow metadata", async () => {
  const runtime = fakeRuntime();
  const providerCalls = [];
  const provider = {
    ...contextTurnProviderParts(providerCalls),
    async ensureRuntime() {
      return appServerRuntime();
    },
    async resumeThread(threadId) {
      providerCalls.push({
        method: "resumeThread",
        threadId
      });
      return {
        id: threadId
      };
    },
    async startThread(params) {
      providerCalls.push({
        method: "startThread",
        params
      });
      return {
        id: "app-server-thread"
      };
    }
  };

  const result = await ensureCodexAppServerThreadForSession({
    provider,
    runtime,
    session: {
      metadata: {
        agent_identity_conversation_id: "old-terminal-thread",
        agent_identity_provider: "codex",
        agent_identity_status: "ready",
        agent_identity_workdir: "/repo/worktree",
        agent_transport_id: "codex_app_server"
      },
      sessionId: "session-1"
    },
    workdir: "/repo/worktree"
  });

  assert.equal(result.threadId, "old-terminal-thread");
  assert.deepEqual(providerCalls.map((call) => call.method), ["resumeThread"]);
  assert.equal(metadataValue(runtime, "agent_identity_conversation_id"), "old-terminal-thread");
  assert.equal(metadataValue(runtime, "agent_transport_id"), "codex_app_server");
});

test("codex app-server bridge sends turns with app-server text input only", async () => {
  const providerCalls = [];
  const provider = {
    async sendTurn(threadId, input, params) {
      providerCalls.push({
        input,
        params,
        threadId
      });
      return {
        id: "turn-1"
      };
    }
  };

  const result = await sendCodexAppServerPromptForSession({
    prompt: "Do the work.",
    provider,
    threadId: "thread-1",
    workdir: "/repo/worktree"
  });

  assert.equal(result.turn.id, "turn-1");
  assert.equal(result.input, "Do the work.");
  assert.equal(providerCalls[0].threadId, "thread-1");
  assert.deepEqual(providerCalls[0].params.sandboxPolicy, {
    networkAccess: "enabled",
    type: "externalSandbox"
  });
  assert.equal(providerCalls[0].params.outputSchema, undefined);
});

test("codex app-server bridge applies an output schema only for focused task turns", async () => {
  let params = null;
  const outputSchema = {
    properties: {
      kind: {
        enum: ["continue", "complete"],
        type: "string"
      }
    },
    required: ["kind"],
    type: "object"
  };
  const provider = {
    async sendTurn(_threadId, _input, turnParams) {
      params = turnParams;
      return {
        id: "task-turn"
      };
    }
  };

  await sendCodexAppServerPromptForSession({
    outputSchema,
    prompt: "Do the focused task.",
    provider,
    threadId: "task-thread",
    workdir: "/repo/worktree"
  });

  assert.equal(params.outputSchema, outputSchema);
});

test("codex app-server bridge starts plain threads without workflow tools", () => {
  const settings = codexAppServerThreadStartSettings({
    cwd: "/repo/worktree"
  });

  assert.equal(Object.hasOwn(settings, "dynamicTools"), false);
  assert.equal(settings.sessionStartSource, "startup");
  assert.equal(settings.threadSource, "vibe64");
});

test("codex app-server bridge sends context refresh inside the next turn input", async () => {
  const providerCalls = [];
  const provider = {
    async sendTurn(threadId, input, params) {
      providerCalls.push({
        input,
        params,
        threadId
      });
      return {
        id: "turn-1"
      };
    }
  };

  const result = await sendCodexAppServerPromptForSession({
    contextRefresh: "Vibe64 session briefing\nJSKIT: use generators.",
    prompt: "Do the work.",
    provider,
    threadId: "thread-1",
    workdir: "/repo/worktree"
  });

  assert.equal(result.turn.id, "turn-1");
  assert.match(result.input, /^Do the work\./u);
  assert.match(result.input, /JSKIT: use generators\./u);
  assert.match(result.input, /Real Vibe64 routed turn context refresh:/u);
  assert.ok(result.input.indexOf("Do the work.") < result.input.indexOf("VIBE64_CONTEXT_REFRESH:"));
  assert.equal(providerCalls[0].input, result.input);
});
