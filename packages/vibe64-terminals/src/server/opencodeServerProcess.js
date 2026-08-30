import { randomBytes } from "node:crypto";
import {
  closeSync,
  fstatSync,
  openSync,
  readSync
} from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import stripAnsi from "strip-ansi";

import {
  isolatedProcessEnv,
  runVibe64Command,
  stableHash,
  stopVibe64Execution
} from "@local/vibe64-execution/server";

import { createOpenCodeServerClient } from "./opencodeServerClient.js";

const OPENCODE_EXPECTED_VERSION = "1.18.22";
const OPENCODE_ECONOMY_AGENT_ID = "vibe64-economy";
const OPENCODE_HOST = "127.0.0.1";
const OPENCODE_LOG_LIMIT_BYTES = 64 * 1024;
const OPENCODE_CATALOG_LIMIT_BYTES = 32 * 1024 * 1024;
const OPENCODE_MANAGED_OUTPUT_TOKEN_MAX = 128 * 1024;
const OPENCODE_CATALOG_TIMEOUT_MS = 30_000;
const OPENCODE_READY_TIMEOUT_MS = 30_000;
const OPENCODE_STOP_TIMEOUT_MS = 3_000;
const OPENCODE_SESSION_ENVIRONMENT_PLUGIN_URL = new URL(
  "./opencodeSessionEnvironmentPlugin.js",
  import.meta.url
).href;
const OPENCODE_MANAGED_STARTUP_SCRIPT = [
  "set -eu",
  "log_path=\"$1\"",
  "shift",
  ": > \"$log_path\"",
  "chmod 600 \"$log_path\"",
  "export VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID=$$",
  "exec \"$@\" </dev/null >>\"$log_path\" 2>&1"
].join("\n");
const OPENCODE_INLINE_CONFIG_BASE = Object.freeze({
  agent: {
    [OPENCODE_ECONOMY_AGENT_ID]: {
      description: "Vibe64 bounded helper turns without tools.",
      hidden: true,
      mode: "primary",
      permission: {
        "*": "deny"
      }
    }
  },
  snapshot: false
});

function text(value = "") {
  return String(value ?? "").trim();
}

function openCodeCatalogBlocks(value = "") {
  const lines = stripAnsi(String(value || ""))
    .replace(/\r\n?/gu, "\n")
    .split("\n");
  const blocks = [];
  let header = "";
  let source = [];
  for (const line of lines) {
    const normalized = line.trim();
    if (source.length === 0) {
      if (normalized.startsWith("{") || normalized.startsWith("[")) {
        try {
          blocks.push({
            header,
            value: JSON.parse(line)
          });
          header = "";
        } catch {
          source = [line];
        }
      } else if (normalized) {
        header = normalized;
      }
      continue;
    }
    source.push(line);
    try {
      blocks.push({
        header,
        value: JSON.parse(source.join("\n"))
      });
      header = "";
      source = [];
    } catch {
      // The pretty-printed JSON block is not complete yet.
    }
  }
  return blocks;
}

function parseOpenCodeModelCatalog(value = "") {
  const providers = new Map();
  const defaults = {};
  for (const block of openCodeCatalogBlocks(value)) {
    const model = block.value;
    const providerId = text(model?.providerID || block.header.split("/")[0]);
    const modelId = text(model?.id || block.header.slice(providerId.length + 1));
    if (!providerId || !modelId || !model || typeof model !== "object" || Array.isArray(model)) {
      continue;
    }
    const provider = providers.get(providerId) || {
      id: providerId,
      models: {},
      name: providerId,
      source: "api"
    };
    provider.models[modelId] = { ...model, id: modelId };
    providers.set(providerId, provider);
    defaults[providerId] ||= modelId;
  }
  if (providers.size === 0) {
    throw new Error("OpenCode returned no parseable model catalogue.");
  }
  return {
    all: [...providers.values()],
    default: defaults
  };
}

function parseOpenCodeAgentCatalog(value = "") {
  return openCodeCatalogBlocks(value).map((block) => {
    const match = block.header.match(/^(.*?)\s+\(([^)]+)\)$/u);
    return {
      description: "",
      hidden: false,
      mode: text(match?.[2]) || "primary",
      name: text(match?.[1] || block.header),
      permission: block.value
    };
  }).filter((agent) => agent.name);
}

function canonicalProviderUrl(value = "") {
  const source = text(value);
  if (!source) {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(source);
  } catch {
    throw new TypeError("OpenCode provider routes require a canonical HTTPS URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.toString().replace(/\/$/u, "") !== source.replace(/\/$/u, "")
  ) {
    throw new TypeError("OpenCode provider routes require a canonical HTTPS URL.");
  }
  return source;
}

function openCodeInlineConfig({
  canonicalUrl = "",
  modelProviderId = "",
  providerConnections = [],
  sessionEnvironmentRegistry = ""
} = {}) {
  const routes = new Map();
  if (text(modelProviderId) || text(canonicalUrl)) {
    routes.set(text(modelProviderId), canonicalProviderUrl(canonicalUrl));
  }
  for (const connection of Array.isArray(providerConnections) ? providerConnections : []) {
    routes.set(text(connection?.modelProviderId), canonicalProviderUrl(connection?.canonicalUrl));
  }
  if ([...routes].some(([providerId, baseURL]) => !providerId || !baseURL)) {
    throw new TypeError("OpenCode provider id and canonical URL must be supplied together.");
  }
  return JSON.stringify({
    ...OPENCODE_INLINE_CONFIG_BASE,
    ...(text(sessionEnvironmentRegistry)
      ? { plugin: [OPENCODE_SESSION_ENVIRONMENT_PLUGIN_URL] }
      : {}),
    ...(routes.size > 0
      ? {
          provider: Object.fromEntries([...routes].map(([providerId, baseURL]) => [
            providerId,
            {
              options: { baseURL }
            }
          ]))
        }
      : {})
  });
}

function wait(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeOpenCodeEnvironment(baseEnv = {}, {
  cacheRoot = "",
  canonicalUrl = "",
  dbPath = "",
  managedEnv = {},
  modelProviderId = "",
  password = "",
  privateRoot = "",
  providerConnections = [],
  sessionEnvironmentRegistry = "",
  shimDirs = []
} = {}) {
  const homeRoot = path.join(privateRoot, "home");
  const managed = Object.fromEntries(Object.entries(managedEnv || {})
    .filter(([name, value]) => (
      /^VIBE64_[A-Z0-9_]+$/u.test(name) && value !== undefined && value !== null
    ))
    .map(([name, value]) => [name, String(value)]));
  return isolatedProcessEnv(baseEnv, {
    cacheRoot: cacheRoot || path.join(privateRoot, "cache"),
    configRoot: path.join(privateRoot, "config"),
    dataRoot: path.join(privateRoot, "data"),
    extraEnv: {
      ...managed,
      NO_PROXY: [text(baseEnv.NO_PROXY), OPENCODE_HOST, "localhost", "::1"]
        .filter(Boolean)
        .join(","),
      OPENCODE_DB: dbPath,
      OPENCODE_CONFIG_CONTENT: openCodeInlineConfig({
        canonicalUrl,
        modelProviderId,
        providerConnections,
        sessionEnvironmentRegistry
      }),
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_SHARE: "1",
      OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
      OPENCODE_PRINT_LOGS: "0",
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_SERVER_USERNAME: "opencode",
      ...(text(sessionEnvironmentRegistry)
        ? {
            OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX: String(OPENCODE_MANAGED_OUTPUT_TOKEN_MAX),
            VIBE64_OPENCODE_SESSION_ENV_REGISTRY: path.resolve(sessionEnvironmentRegistry)
          }
        : {})
    },
    homeRoot,
    pathEntries: shimDirs,
    stateRoot: path.join(privateRoot, "state")
  });
}

async function availableLoopbackPort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, OPENCODE_HOST, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

async function waitForOpenCodeReady({
  client,
  expectedVersion = OPENCODE_EXPECTED_VERSION,
  processHandle,
  timeoutMs = OPENCODE_READY_TIMEOUT_MS
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (processHandle.exited) {
      throw new Error("OpenCode exited before its server became ready.");
    }
    try {
      const health = await client.health({
        signal: AbortSignal.timeout(Math.max(100, Math.min(2_000, deadline - Date.now())))
      });
      if (health?.healthy === true) {
        if (expectedVersion && text(health.version) !== expectedVersion) {
          const error = new Error(
            `OpenCode ${text(health.version) || "(unknown)"} is installed; Vibe64 requires ${expectedVersion}.`
          );
          error.code = "vibe64_opencode_version_mismatch";
          throw error;
        }
        return health;
      }
    } catch (error) {
      if (error?.code === "vibe64_opencode_version_mismatch") {
        throw error;
      }
      lastError = error;
    }
    await wait(100);
  }
  const error = new Error("OpenCode did not become ready before the startup deadline.");
  error.cause = lastError;
  error.code = "vibe64_opencode_start_timeout";
  throw error;
}

async function createOpenCodeServerProcess({
  apiKey = "",
  cacheRoot = "",
  canonicalUrl = "",
  command = "opencode",
  commandRunner = runVibe64Command,
  dbPath = "",
  env = process.env,
  execution = {},
  expectedVersion = OPENCODE_EXPECTED_VERSION,
  fetchImpl = globalThis.fetch,
  managedEnv = {},
  modelProviderId = "",
  port = 0,
  privateRoot = "",
  providerConnections = [],
  readinessTimeoutMs = OPENCODE_READY_TIMEOUT_MS,
  sessionEnvironmentRegistry = "",
  shimDirs = [],
  stopExecution = stopVibe64Execution,
  workdir = ""
} = {}) {
  const normalizedDbPath = path.resolve(text(dbPath));
  const normalizedPrivateRoot = path.resolve(text(privateRoot));
  const normalizedWorkdir = path.resolve(text(workdir));
  if (!text(dbPath) || !text(privateRoot) || !text(workdir)) {
    throw new TypeError("OpenCode server processes require database, private, and working roots.");
  }
  await Promise.all([
    mkdir(path.dirname(normalizedDbPath), { mode: 0o700, recursive: true }),
    ...(text(cacheRoot) ? [mkdir(path.resolve(text(cacheRoot)), { mode: 0o700, recursive: true })] : []),
    mkdir(normalizedPrivateRoot, { mode: 0o700, recursive: true }),
    mkdir(normalizedWorkdir, { recursive: true })
  ]);
  const selectedPort = Number(port) || await availableLoopbackPort();
  const password = randomBytes(32).toString("base64url");
  const client = createOpenCodeServerClient({
    baseUrl: `http://${OPENCODE_HOST}:${selectedPort}`,
    fetchImpl,
    password
  });
  let processHandle = null;
  let stopPromise = null;
  let processEnv = null;

  const logPath = path.join(normalizedPrivateRoot, "opencode-server.log");
  const credentialHome = Object.freeze({
    cacheRoot: text(cacheRoot) ? path.resolve(text(cacheRoot)) : path.join(normalizedPrivateRoot, "cache"),
    configRoot: path.join(normalizedPrivateRoot, "config"),
    dataRoot: path.join(normalizedPrivateRoot, "data"),
    home: path.join(normalizedPrivateRoot, "home"),
    stateRoot: path.join(normalizedPrivateRoot, "state")
  });

  function readLogs() {
    let descriptor = null;
    try {
      descriptor = openSync(logPath, "r");
      const size = Number(fstatSync(descriptor).size) || 0;
      const length = Math.min(size, OPENCODE_LOG_LIMIT_BYTES);
      const output = Buffer.alloc(length);
      if (length > 0) {
        readSync(descriptor, output, 0, length, Math.max(0, size - length));
      }
      return {
        stderr: output.toString("utf8").trim(),
        stdout: ""
      };
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { stderr: "", stdout: "" };
      }
      throw error;
    } finally {
      if (descriptor !== null) {
        closeSync(descriptor);
      }
    }
  }

  function stop() {
    if (stopPromise) {
      return stopPromise;
    }
    stopPromise = Promise.resolve().then(async () => {
      const exitProof = processHandle
        ? await processHandle.stop()
        : { code: null, exited: true, signal: "" };
      if (exitProof.exited === true) {
        await rm(normalizedPrivateRoot, { force: true, recursive: true });
      }
      return exitProof;
    });
    return stopPromise;
  }

  try {
    processEnv = safeOpenCodeEnvironment(env, {
      cacheRoot: text(cacheRoot) ? path.resolve(text(cacheRoot)) : "",
      canonicalUrl,
      dbPath: normalizedDbPath,
      managedEnv,
      modelProviderId,
      password,
      privateRoot: normalizedPrivateRoot,
      providerConnections,
      sessionEnvironmentRegistry,
      shimDirs
    });
    const startResult = await commandRunner({
      actor: "app",
      allowedRoots: [normalizedWorkdir],
      args: [
        "-c",
        OPENCODE_MANAGED_STARTUP_SCRIPT,
        "vibe64-opencode-server",
        logPath,
        text(command) || "opencode",
        "serve",
        "--hostname",
        OPENCODE_HOST,
        "--port",
        String(selectedPort),
        "--mdns=false"
      ],
      baseEnv: processEnv,
      command: "/bin/sh",
      credentialHome,
      cwd: normalizedWorkdir,
      envPolicy: "auth",
      execution: {
        kind: "assistant",
        label: text(execution.label) || "OpenCode assistant",
        lifecycle: "service",
        operationId: text(execution.operationId) || "opencode-server",
        ownerId: text(execution.ownerId) || stableHash(`${normalizedDbPath}\0${normalizedWorkdir}`),
        projectSlug: text(execution.projectSlug),
        sessionId: text(execution.sessionId)
      },
      inheritProcessEnv: false,
      mode: "detached",
      purpose: "assistant",
      shimDirs
    });
    if (startResult?.ok !== true || !text(startResult?.execution?.id)) {
      const error = new Error(
        text(startResult?.error || startResult?.output) || "OpenCode failed to start."
      );
      error.code = text(startResult?.code) || "vibe64_opencode_start_failed";
      error.execution = startResult?.execution;
      error.retryable = startResult?.retryable === true;
      throw error;
    }
    let stopped = false;
    processHandle = Object.freeze({
      get exited() {
        return stopped;
      },
      executionId: startResult.execution.id,
      pid: startResult.pid,
      readLogs,
      async stop() {
        const proof = await stopExecution(startResult.execution.id, {
          allowMissingRecordScopeRecovery: true,
          reason: "opencode-server-stop",
          termTimeoutMs: OPENCODE_STOP_TIMEOUT_MS
        });
        stopped = proof?.scopeEmpty === true;
        return {
          ...(proof && typeof proof === "object" ? proof : {}),
          exited: stopped
        };
      }
    });
    const health = await waitForOpenCodeReady({
      client,
      expectedVersion,
      processHandle,
      timeoutMs: readinessTimeoutMs
    });
    const connections = [
      ...(text(modelProviderId) || String(apiKey)
        ? [{ apiKey, canonicalUrl, modelProviderId }]
        : []),
      ...(Array.isArray(providerConnections) ? providerConnections : [])
    ];
    const authenticated = new Set();
    for (const connection of connections) {
      const providerId = text(connection?.modelProviderId);
      const key = String(connection?.apiKey || "");
      if (!providerId || !key || authenticated.has(providerId)) {
        continue;
      }
      await client.authenticateApiKey(providerId, key);
      authenticated.add(providerId);
    }
    return Object.freeze({
      canonicalUrl: canonicalProviderUrl(canonicalUrl),
      client,
      dbPath: normalizedDbPath,
      health: Object.freeze({ ...health }),
      modelProviderId: text(modelProviderId),
      modelProviderIds: Object.freeze([...authenticated]),
      executionId: processHandle.executionId,
      pid: processHandle.pid,
      port: selectedPort,
      privateRoot: normalizedPrivateRoot,
      readLogs() {
        return readLogs();
      },
      async startAttachedTerminal({
        metadata = {},
        namespace = "",
        session = {},
        upstreamSessionId = "",
        workdir: terminalWorkdir = ""
      } = {}) {
        const directory = path.resolve(text(terminalWorkdir));
        const attachedSessionId = text(upstreamSessionId);
        if (!text(terminalWorkdir) || !attachedSessionId || !text(namespace)) {
          throw new TypeError("OpenCode attached terminals require a directory, session, and namespace.");
        }
        return commandRunner({
          actor: "app",
          allowedRoots: [directory, normalizedWorkdir],
          args: [
            "attach",
            `http://${OPENCODE_HOST}:${selectedPort}`,
            "--dir",
            directory,
            "--session",
            attachedSessionId,
            "--pure"
          ],
          baseEnv: processEnv,
          command: text(command) || "opencode",
          credentialHome,
          cwd: directory,
          envPolicy: "auth",
          execution: {
            kind: "terminal",
            label: "OpenCode terminal",
            lifecycle: "interactive",
            operationId: "opencode-terminal",
            ownerId: text(session?.sessionId || session?.id),
            sessionId: text(session?.sessionId || session?.id)
          },
          inheritProcessEnv: false,
          mode: "pty",
          project: {
            sourceRoot: directory
          },
          purpose: "assistant",
          session,
          terminal: {
            commandPreview: "opencode attach",
            maxRunning: 1,
            metadata: {
              ...metadata,
              upstreamSessionId: attachedSessionId
            },
            namespace,
            reuseRunning: true
          }
        });
      },
      stop,
      workdir: normalizedWorkdir
    });
  } catch (error) {
    const logs = processHandle?.readLogs?.() || { stderr: "", stdout: "" };
    await stop().catch(() => null);
    error.code ||= "vibe64_opencode_start_failed";
    error.details = logs;
    throw error;
  }
}

async function readOpenCodeCatalog({
  cacheRoot = "",
  command = "opencode",
  commandRunner = runVibe64Command,
  env = process.env,
  privateRoot = "",
  providerConnections = [],
  workdir = ""
} = {}) {
  const normalizedPrivateRoot = path.resolve(text(privateRoot));
  const normalizedWorkdir = path.resolve(text(workdir));
  if (!text(privateRoot) || !text(workdir)) {
    throw new TypeError("OpenCode catalogue reads require private and working roots.");
  }
  await Promise.all([
    mkdir(normalizedPrivateRoot, { mode: 0o700, recursive: true }),
    mkdir(normalizedWorkdir, { recursive: true })
  ]);
  const providerAuth = Object.fromEntries((Array.isArray(providerConnections) ? providerConnections : [])
    .map((connection) => [
      text(connection?.modelProviderId),
      String(connection?.apiKey || "")
    ])
    .filter(([providerId, apiKey]) => providerId && apiKey)
    .map(([providerId, apiKey]) => [providerId, { key: apiKey, type: "api" }]));
  if (Object.keys(providerAuth).length > 0) {
    const authRoot = path.join(normalizedPrivateRoot, "data", "opencode");
    await mkdir(authRoot, { mode: 0o700, recursive: true });
    await writeFile(path.join(authRoot, "auth.json"), `${JSON.stringify(providerAuth)}\n`, {
      mode: 0o600
    });
  }
  const processEnv = safeOpenCodeEnvironment(env, {
    cacheRoot,
    dbPath: path.join(normalizedPrivateRoot, "opencode.db"),
    privateRoot: normalizedPrivateRoot,
    providerConnections
  });
  const run = async (args, label) => {
    const result = await commandRunner({
      actor: "app",
      allowedRoots: [normalizedWorkdir],
      args,
      baseEnv: processEnv,
      command: text(command) || "opencode",
      credentialHome: {
        cacheRoot: text(cacheRoot) ? path.resolve(cacheRoot) : path.join(normalizedPrivateRoot, "cache"),
        configRoot: path.join(normalizedPrivateRoot, "config"),
        dataRoot: path.join(normalizedPrivateRoot, "data"),
        home: path.join(normalizedPrivateRoot, "home"),
        stateRoot: path.join(normalizedPrivateRoot, "state")
      },
      cwd: normalizedWorkdir,
      envPolicy: "auth",
      execution: {
        kind: "assistant",
        label,
        lifecycle: "finite",
        operationId: "opencode-catalog",
        ownerId: "opencode-catalog"
      },
      inheritProcessEnv: false,
      maxBuffer: OPENCODE_CATALOG_LIMIT_BYTES,
      mode: "capture",
      purpose: "assistant",
      timeout: OPENCODE_CATALOG_TIMEOUT_MS
    });
    if (result?.ok !== true) {
      const error = new Error(text(result?.error || result?.stderr || result?.stdout) || `${label} failed.`);
      error.code = text(result?.code) || "vibe64_opencode_catalog_failed";
      throw error;
    }
    return String(result.stdout || "");
  };
  try {
    const models = await run(["models", "--pure", "--verbose"], "Reading OpenCode models");
    const agents = await run(["agent", "list", "--pure"], "Reading OpenCode agents");
    return {
      agents: parseOpenCodeAgentCatalog(agents),
      providers: parseOpenCodeModelCatalog(models)
    };
  } finally {
    await rm(normalizedPrivateRoot, { force: true, recursive: true });
  }
}

export {
  OPENCODE_ECONOMY_AGENT_ID,
  OPENCODE_EXPECTED_VERSION,
  OPENCODE_HOST,
  OPENCODE_READY_TIMEOUT_MS,
  OPENCODE_STOP_TIMEOUT_MS,
  availableLoopbackPort,
  canonicalProviderUrl,
  createOpenCodeServerProcess,
  openCodeInlineConfig,
  parseOpenCodeAgentCatalog,
  parseOpenCodeModelCatalog,
  readOpenCodeCatalog,
  safeOpenCodeEnvironment
};
