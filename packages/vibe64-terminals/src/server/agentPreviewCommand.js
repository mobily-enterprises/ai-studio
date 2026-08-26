import crypto from "node:crypto";
import http from "node:http";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  logOperationalEvent,
  sanitizeLogText
} from "@local/vibe64-core/server/logging";
import {
  PREVIEW_IDENTITY_CONTROL_PATH
} from "@local/vibe64-core/server/previewAuth";
import {
  vibe64ErrorResponse,
  vibe64StatusCode
} from "@local/vibe64-core/server/serverResponses";
import {
  readSessionUiSyncStateForSession
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  agentPlaywrightCommandSource,
  agentPreviewBrowserWorkerSource,
  agentPreviewWrapperSource,
  runVibe64Command,
  runtimePackBinPaths,
  runtimePackRoot,
  stopVibe64Execution
} from "@local/vibe64-execution/server";
import {
  writeExecutableFileIfChanged
} from "./writeExecutableFileIfChanged.js";
import {
  readJsonCommandRequest,
  requestUnixJsonCommand,
  sendJsonCommandResponse,
  shortCommandHash,
  unixCommandSocketIsPresent
} from "./unixJsonCommand.js";

const AGENT_PREVIEW_COMMAND_NAME = "vibe64-preview";
const AGENT_PLAYWRIGHT_COMMAND_NAME = "vibe64-playwright";
const AGENT_PREVIEW_BROWSER_WORKER_NAME = "vibe64-preview-browser-worker";
const AGENT_PREVIEW_BROWSER_SOCKET_NAME = "preview-browser.sock";
const AGENT_PREVIEW_BROWSER_METADATA_NAME = "preview-browser.json";
const AGENT_PREVIEW_COMMAND_SOCKET_NAME = "preview-command.sock";
const AGENT_PREVIEW_COMMAND_CONTRACT_VERSION = "8";
const AGENT_PREVIEW_COMMAND_REQUEST_MAX_BYTES = 1024 * 1024;
const AGENT_PREVIEW_COMMAND_ROUTES = new Set([
  "/agent-preview-command/browser-start",
  "/agent-preview-command/browser-stop",
  "/agent-preview-command/health",
  "/agent-preview-command/identity",
  "/agent-preview-command/run"
]);
const DEFAULT_PREVIEW_BROWSER_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PREVIEW_LOG_LINES = 200;
const DEFAULT_PREVIEW_WAIT_TIMEOUT_MS = 90_000;
const MAX_PREVIEW_LOG_LINES = 5000;
const PREVIEW_WAIT_POLL_INTERVAL_MS = 500;
const VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID";
const VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_SOCKET";
const VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_TOKEN";
const VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION";
const VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV = "VIBE64_AGENT_PREVIEW_COMMAND_GENERATION";
const VIBE64_PREVIEW_BROWSER_WORKER_TOKEN_ENV = "VIBE64_PREVIEW_BROWSER_WORKER_TOKEN";

const commandServers = new Map();
const commandServerPrepares = new Map();

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function wrapperHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_COMMAND_NAME);
}

function agentPlaywrightHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PLAYWRIGHT_COMMAND_NAME);
}

function browserWorkerHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_BROWSER_WORKER_NAME);
}

function browserSocketHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_BROWSER_SOCKET_NAME);
}

function browserMetadataHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_BROWSER_METADATA_NAME);
}

function commandSocketHostPath(wrapperHostDir = "") {
  return path.join(wrapperHostDir, AGENT_PREVIEW_COMMAND_SOCKET_NAME);
}

async function readRequestJson(request) {
  return readJsonCommandRequest(request, {
    invalidJsonError: {
      code: "vibe64_agent_preview_command_invalid_json",
      message: "Vibe64 preview command input must be valid JSON."
    },
    maxBytes: AGENT_PREVIEW_COMMAND_REQUEST_MAX_BYTES,
    tooLargeError: {
      code: "vibe64_agent_preview_command_input_too_large",
      message: "Vibe64 preview command input is too large."
    }
  });
}

async function writeWrapper({
  agentPlaywrightSource = "",
  browserWorkerSource = "",
  previewWrapperSource = "",
  wrapperHostDir = ""
} = {}) {
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!normalizedWrapperHostDir) {
    return false;
  }
  await mkdir(normalizedWrapperHostDir, {
    recursive: true
  });
  await Promise.all([
    writeExecutableFileIfChanged(
      wrapperHostPath(normalizedWrapperHostDir),
      previewWrapperSource
    ),
    writeExecutableFileIfChanged(
      browserWorkerHostPath(normalizedWrapperHostDir),
      browserWorkerSource
    ),
    writeExecutableFileIfChanged(
      agentPlaywrightHostPath(normalizedWrapperHostDir),
      agentPlaywrightSource
    )
  ]);
  return true;
}

function responseError(message = "", code = "vibe64_agent_preview_command_failed", extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    ok: false
  };
}

function usageText() {
  return [
    "Usage:",
    "  vibe64-preview ensure [--wait] [--json] [--timeout-ms <ms>]",
    "  vibe64-preview status [--json]",
    "  vibe64-preview inspect-url",
    "  vibe64-preview screenshot [--output <path>]",
    "  vibe64-preview browser ensure",
    "  vibe64-preview browser eval < playwright-code.js",
    "  vibe64-preview browser identity <default|guest|configured-name>",
    "  vibe64-preview browser screenshot [--output <path>]",
    "  vibe64-preview browser status",
    "  vibe64-preview browser reset",
    "  vibe64-preview browser close",
    "  vibe64-preview logs [--lines <count>] [--json]",
    "  vibe64-preview restart [--wait] [--json] [--timeout-ms <ms>]",
    "  vibe64-playwright [--identity <default|guest|configured-name>] test [playwright test arguments]",
    "  vibe64-playwright [--identity <default|guest|configured-name>] npm-run <package-script> [-- script arguments]",
    "",
    "Screenshot commands emit JSON metadata for a uniquely named, immutable PNG.",
    "This is the canonical preview server for the configured primary application.",
    "Do not start a duplicate copy of that application on another port.",
    "A distinct secondary application explicitly requested by the user, such as a reference app, may run separately without replacing this preview."
  ].join("\n") + "\n";
}

function hasFlag(args = [], flag = "") {
  return args.includes(flag);
}

function optionValue(args = [], name = "") {
  const index = args.indexOf(name);
  if (index >= 0) {
    return normalizeText(args[index + 1]);
  }
  const prefix = `${name}=`;
  const entry = args.find((arg) => String(arg || "").startsWith(prefix));
  return entry ? normalizeText(entry.slice(prefix.length)) : "";
}

function parsePreviewCommandArgs(args = []) {
  const values = Array.isArray(args) ? args.map((arg) => String(arg || "").trim()).filter(Boolean) : [];
  const command = values.find((arg) => !arg.startsWith("-")) || "";
  return {
    command,
    json: hasFlag(values, "--json"),
    lines: normalizeLogLines(optionValue(values, "--lines")),
    timeoutMs: normalizeTimeoutMs(optionValue(values, "--timeout-ms")),
    wait: hasFlag(values, "--wait")
  };
}

function normalizeLogLines(value = "") {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0
    ? Math.min(number, MAX_PREVIEW_LOG_LINES)
    : DEFAULT_PREVIEW_LOG_LINES;
}

function normalizeTimeoutMs(value = "") {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : DEFAULT_PREVIEW_WAIT_TIMEOUT_MS;
}

function previewReady(status = {}) {
  return status?.previewTarget?.available !== false && Boolean(normalizeText(status?.previewTarget?.href));
}

function activeTerminalExited(status = {}, terminalSessionId = "") {
  const terminal = status?.activeTerminal || {};
  if (terminalSessionId && normalizeText(terminal.id) && normalizeText(terminal.id) !== normalizeText(terminalSessionId)) {
    return false;
  }
  return normalizeText(terminal.status) === "exited";
}

function previewEndpoint(value = "") {
  const url = normalizeText(value);
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    const defaultPort = parsed.protocol === "https:" ? 443 : 80;
    return {
      hostname: parsed.hostname,
      port: Number(parsed.port) || defaultPort,
      url: parsed.toString()
    };
  } catch {
    return null;
  }
}

function previewPageUrl(baseUrl = "", route = "", {
  inheritBaseSearch = false
} = {}) {
  const normalizedBaseUrl = normalizeText(baseUrl);
  const normalizedRoute = normalizeText(route);
  if (!normalizedBaseUrl || !normalizedRoute.startsWith("/")) {
    return "";
  }
  try {
    const base = new URL(normalizedBaseUrl);
    const page = new URL(normalizedRoute, base);
    if (inheritBaseSearch) {
      for (const [name, value] of base.searchParams) {
        if (!page.searchParams.has(name)) {
          page.searchParams.append(name, value);
        }
      }
    }
    return page.toString();
  } catch {
    return "";
  }
}

function previewInspectionUrl(status = {}, {
  previewState = null
} = {}) {
  const previewTarget = isRecord(status.previewTarget) ? status.previewTarget : {};
  const proxyUrl = normalizeText(previewTarget.href);
  const route = normalizeText(previewState?.route);
  if (proxyUrl) {
    return route
      ? previewPageUrl(proxyUrl, route, {
          inheritBaseSearch: true
        }) || proxyUrl
      : proxyUrl;
  }
  const summary = previewStatusSummary(status, {
    previewState
  });
  return normalizeText(summary.currentPage?.agentUrl || summary.endpoints?.agent?.url);
}

function previewCurrentPage(previewState = {}, {
  agentUrl = ""
} = {}) {
  const route = normalizeText(previewState?.route);
  if (!route) {
    return null;
  }
  return {
    agentUrl: previewPageUrl(agentUrl, route),
    observedAt: normalizeText(previewState?.updatedAt),
    route,
    title: normalizeText(previewState?.title)
  };
}

function previewTerminal(status = {}) {
  const terminal = isRecord(status?.activeTerminal) ? status.activeTerminal : null;
  if (!terminal) {
    return null;
  }
  return {
    command: normalizeText(terminal.commandPreview),
    createdAt: normalizeText(terminal.createdAt),
    exitCode: terminal.exitCode ?? null,
    id: normalizeText(terminal.id),
    running: terminal.running === true,
    status: normalizeText(terminal.status)
  };
}

function previewDiagnostics(status = {}) {
  const metadata = isRecord(status?.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  const sessionRoot = normalizeText(metadata.sessionRoot);
  return sessionRoot ? {
    latest: path.join(sessionRoot, "preview-last.json"),
    log: path.join(sessionRoot, "preview-log.jsonl")
  } : null;
}

function previewStatusSummary(status = {}, {
  previewState = null
} = {}) {
  const lastOutputTarget = isRecord(status.lastOutputTarget) ? status.lastOutputTarget : {};
  const activeMetadata = isRecord(status.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  const openTarget = isRecord(status.openTarget) ? status.openTarget : {};
  const previewTarget = isRecord(status.previewTarget) ? status.previewTarget : {};
  const agentUrl = normalizeText(lastOutputTarget.agentHref || activeMetadata.previewProxyTargetHref || activeMetadata.targetUrl || openTarget.href);
  const browserUrl = normalizeText(openTarget.href || previewTarget.targetHref);
  const agentEndpoint = previewEndpoint(agentUrl);
  const browserEndpoint = previewEndpoint(browserUrl);
  const identityTypes = (Array.isArray(status.previewIdentity?.identityTypes)
    ? status.previewIdentity.identityTypes
    : [])
    .map(normalizeText)
    .filter(Boolean);
  const identities = (Array.isArray(status.previewIdentity?.identities)
    ? status.previewIdentity.identities
    : [])
    .map((identity) => ({
      name: normalizeText(identity?.name),
      type: normalizeText(identity?.type)
    }))
    .filter((identity) => identity.name && identity.type);
  return {
    currentPage: previewCurrentPage(previewState, {
      agentUrl: agentEndpoint?.url
    }),
    diagnostics: previewDiagnostics(status),
    endpoints: {
      agent: agentEndpoint,
      browser: browserEndpoint
    },
    defaultIdentity: normalizeText(status.previewIdentity?.defaultIdentityName),
    identities,
    identityTypes,
    outputTargetId: normalizeText(lastOutputTarget.id || activeMetadata.outputTargetId),
    ready: previewReady(status),
    stale: previewTarget.stale === true || normalizeText(previewTarget.recovery?.reason) === "server_source_changed",
    terminal: previewTerminal(status)
  };
}

function previewSummaryLines(summary = {}) {
  return [
    `Preview ready: ${summary.ready ? "yes" : "no"}`,
    `Preview running: ${summary.terminal?.running ? "yes" : "no"}`,
    summary.outputTargetId ? `Output target: ${summary.outputTargetId}` : "",
    summary.endpoints?.agent?.url ? `Agent URL: ${summary.endpoints.agent.url}` : "",
    summary.endpoints?.agent?.hostname ? `Agent host: ${summary.endpoints.agent.hostname}` : "",
    summary.endpoints?.agent?.port ? `Agent port: ${summary.endpoints.agent.port}` : "",
    summary.endpoints?.browser?.url ? `Browser URL: ${summary.endpoints.browser.url}` : "",
    summary.currentPage?.route ? `Current page: ${summary.currentPage.route}` : "Current page: not observed",
    summary.currentPage?.agentUrl ? `Current page agent URL: ${summary.currentPage.agentUrl}` : "",
    summary.terminal?.id ? `Terminal: ${summary.terminal.id} (${summary.terminal.status || "unknown"})` : "",
    summary.identities?.length
      ? `Managed app identities: ${summary.identities.map((identity) => identity.name).join(", ")}`
      : "Managed app identities: none configured",
    `Stale: ${summary.stale ? "yes" : "no"}`
  ].filter(Boolean);
}

function statusStdout(summary = {}, {
  json = false
} = {}) {
  return json
    ? JSON.stringify(summary, null, 2) + "\n"
    : previewSummaryLines(summary).join("\n") + "\n";
}

function previewLogTail(output = "", lines = DEFAULT_PREVIEW_LOG_LINES) {
  const normalizedOutput = String(output || "").replace(/\r\n/gu, "\n");
  const trailingNewline = normalizedOutput.endsWith("\n");
  const entries = normalizedOutput.split("\n");
  if (trailingNewline) {
    entries.pop();
  }
  const tail = entries.slice(-normalizeLogLines(lines)).join("\n");
  return tail && trailingNewline ? `${tail}\n` : tail;
}

function logsStdout(status = {}, {
  json = false,
  lines = DEFAULT_PREVIEW_LOG_LINES
} = {}) {
  const output = previewLogTail(status?.activeTerminal?.output, lines);
  const payload = {
    diagnostics: previewDiagnostics(status),
    outputTargetId: outputTargetIdFromStatus(status),
    lineLimit: normalizeLogLines(lines),
    output,
    terminal: previewTerminal(status)
  };
  if (json) {
    return JSON.stringify(payload, null, 2) + "\n";
  }
  const header = [
    payload.terminal?.id
      ? `Managed preview logs: ${payload.terminal.id} (${payload.terminal.status || "unknown"})`
      : "Managed preview logs: no terminal",
    `Showing up to ${payload.lineLimit} lines.`,
    payload.diagnostics?.log ? `Preview diagnostic log: ${payload.diagnostics.log}` : ""
  ].filter(Boolean).join("\n");
  return `${header}\n\n${output || "No managed preview server output is available."}${output.endsWith("\n") ? "" : "\n"}`;
}

function previewStartStdout(summary = {}, {
  command = "ensure",
  json = false
} = {}) {
  const payload = command === "restart"
    ? {
        ...summary,
        restarted: true
      }
    : {
        ...summary,
        ensured: true
      };
  if (json) {
    return JSON.stringify(payload, null, 2) + "\n";
  }
  return [
    command === "restart" ? "Restarted preview." : "Preview is ready.",
    ...previewSummaryLines(payload)
  ].join("\n") + "\n";
}

function outputTargetIdFromStatus(status = {}) {
  const lastOutputTarget = isRecord(status.lastOutputTarget) ? status.lastOutputTarget : {};
  const activeMetadata = isRecord(status.activeTerminal?.metadata) ? status.activeTerminal.metadata : {};
  return normalizeText(lastOutputTarget.id || activeMetadata.outputTargetId);
}

async function waitForPreviewReady(launchTarget, sessionId = "", {
  terminalSessionId = "",
  timeoutMs = DEFAULT_PREVIEW_WAIT_TIMEOUT_MS
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let latestStatus = null;
  while (Date.now() <= deadline) {
    latestStatus = await launchTarget.launchStatus(sessionId);
    if (latestStatus?.ok === false) {
      return {
        ok: false,
        status: latestStatus
      };
    }
    if (previewReady(latestStatus)) {
      return {
        ok: true,
        status: latestStatus
      };
    }
    if (activeTerminalExited(latestStatus, terminalSessionId)) {
      return {
        ok: false,
        status: latestStatus
      };
    }
    await delay(PREVIEW_WAIT_POLL_INTERVAL_MS);
  }
  return {
    ok: false,
    status: latestStatus,
    timeout: true
  };
}

function logPreviewCommandResult(logger, result = {}, fields = {}) {
  const ok = result?.ok !== false && Number(result?.exitCode || 0) === 0;
  return logOperationalEvent(logger, ok ? "info" : "warn", {
    code: result?.code || "",
    command: normalizeText(fields.command),
    component: "vibe64.agent_preview_command",
    cwd: normalizeText(fields.cwd),
    durationMs: Number(fields.durationMs || 0),
    event: "vibe64.agent_preview_command.finished",
    exitCode: Number(result?.exitCode ?? (ok ? 0 : 1)),
    ok,
    outputTail: ok ? "" : sanitizeLogText(result.stderr || result.error || "").slice(-1000),
    sessionId: normalizeText(fields.sessionId)
  }, "Vibe64 agent preview command finished.");
}

function createAgentPreviewCommandService({
  launchTarget = null,
  logger = null,
  readSessionUiState = readSessionUiSyncStateForSession,
  runManagedCommand = runVibe64Command,
  stopManagedExecution = stopVibe64Execution
} = {}) {
  const browserWorkers = new Map();

  async function authorizeBrowserIdentity(sessionId = "", identity = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const requested = normalizeText(identity).toLowerCase();
    const reservedIdentity = requested.toLowerCase();
    if (!normalizedSessionId) {
      return responseError(
        "Vibe64 preview command session id is required.",
        "vibe64_agent_preview_command_session_required"
      );
    }
    if (!requested) {
      return responseError(
        "Choose default, guest, or a configured managed app identity name.",
        "vibe64_agent_preview_identity_required"
      );
    }
    if (!launchTarget || typeof launchTarget.selectPreviewIdentity !== "function") {
      return responseError(
        "Vibe64 preview identity control is not available.",
        "vibe64_agent_preview_identity_unavailable"
      );
    }
    if (reservedIdentity === "guest") {
      return launchTarget.selectPreviewIdentity(normalizedSessionId, {
        mode: "guest"
      });
    }
    return launchTarget.selectPreviewIdentity(normalizedSessionId, {
      identityName: requested,
      mode: "identity"
    });
  }

  function registerBrowserWorker(sessionId = "", descriptor = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const socketPath = normalizeText(descriptor.socketPath);
    if (!normalizedSessionId || !socketPath) {
      return false;
    }
    const sessionWorkers = browserWorkers.get(normalizedSessionId) || new Map();
    const existing = sessionWorkers.get(socketPath);
    const sameGeneration = normalizeText(existing?.token) === normalizeText(descriptor.token);
    sessionWorkers.set(socketPath, {
      ...descriptor,
      executionId: sameGeneration ? normalizeText(existing?.executionId) : "",
      retiredDescriptors: sameGeneration
        ? (existing?.retiredDescriptors || [])
        : [
            ...(existing?.retiredDescriptors || []),
            ...(existing ? [existing] : [])
          ],
      sessionId: normalizedSessionId,
      socketPath
    });
    browserWorkers.set(normalizedSessionId, sessionWorkers);
    return true;
  }

  async function closeAllForSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const sessionWorkers = browserWorkers.get(normalizedSessionId) || new Map();
    browserWorkers.delete(normalizedSessionId);
    let closed = 0;
    for (const descriptor of sessionWorkers.values()) {
      await stopRegisteredBrowserWorker(descriptor, {
        reason: "session-close",
        stopExecution: stopManagedExecution
      });
      closed += 1;
    }
    await closeAgentPreviewCommandServersForSession(normalizedSessionId);
    return {
      closed,
      ok: true
    };
  }

  async function releaseControlForSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const sessionWorkers = browserWorkers.get(normalizedSessionId) || new Map();
    for (const descriptor of sessionWorkers.values()) {
      await stopRegisteredBrowserWorker(descriptor, {
        reason: "control-release",
        stopExecution: stopManagedExecution
      });
    }
    await closeAgentPreviewCommandServersForSession(sessionId);
    return {
      ok: true
    };
  }

  function statusSummary(status = {}, sessionId = "") {
    const uiState = typeof readSessionUiState === "function"
      ? readSessionUiState(sessionId)
      : null;
    return previewStatusSummary(status, {
      previewState: uiState?.preview || null
    });
  }

  function inspectionUrl(status = {}, sessionId = "") {
    const uiState = typeof readSessionUiState === "function"
      ? readSessionUiState(sessionId)
      : null;
    return previewInspectionUrl(status, {
      previewState: uiState?.preview || null
    });
  }

  async function run(input = {}) {
    const startedAtMs = Date.now();
    const parsed = parsePreviewCommandArgs(input.args);
    const sessionId = normalizeText(input.sessionId);
    const baseFields = {
      command: parsed.command,
      cwd: normalizeText(input.cwd),
      sessionId
    };
    const finish = (result = {}) => {
      logPreviewCommandResult(logger, result, {
        ...baseFields,
        durationMs: Date.now() - startedAtMs
      });
      return result;
    };

    if (!sessionId) {
      return finish(responseError("Vibe64 preview command session id is required.", "vibe64_agent_preview_command_session_required"));
    }
    if (!launchTarget || typeof launchTarget.launchStatus !== "function") {
      return finish(responseError("Vibe64 preview control is not available.", "vibe64_agent_preview_command_unavailable"));
    }
    if (!parsed.command || parsed.command === "help" || parsed.command === "--help" || parsed.command === "-h") {
      return finish({
        exitCode: 0,
        ok: true,
        stdout: usageText()
      });
    }
    if (parsed.command === "status") {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) {
        return finish({
          ...status,
          exitCode: 1,
          stderr: `${status.error || "Vibe64 preview status failed."}\n`
        });
      }
      return finish({
        exitCode: 0,
        ok: true,
        stdout: statusStdout(statusSummary(status, sessionId), {
          json: parsed.json
        })
      });
    }
    if (parsed.command === "inspect-url") {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) {
        return finish({
          ...status,
          exitCode: 1,
          stderr: `${status.error || "Vibe64 preview status failed."}\n`
        });
      }
      const url = inspectionUrl(status, sessionId);
      if (!url) {
        return finish(responseError(
          "Managed preview inspection URL is unavailable. Run vibe64-preview ensure --wait --json first.",
          "vibe64_agent_preview_command_inspection_url_unavailable",
          {
            exitCode: 1
          }
        ));
      }
      return finish({
        exitCode: 0,
        ok: true,
        stdout: `${url}\n`
      });
    }
    if (parsed.command === "logs") {
      const status = await launchTarget.launchStatus(sessionId);
      if (status?.ok === false) {
        return finish({
          ...status,
          exitCode: 1,
          stderr: `${status.error || "Vibe64 preview logs failed."}\n`
        });
      }
      return finish({
        exitCode: 0,
        ok: true,
        stdout: logsStdout(status, {
          json: parsed.json,
          lines: parsed.lines
        })
      });
    }
    if (!["ensure", "restart"].includes(parsed.command)) {
      return finish(responseError(`Unknown Vibe64 preview command: ${parsed.command}`, "vibe64_agent_preview_command_unknown", {
        exitCode: 2,
        stderr: usageText()
      }));
    }
    const ensuring = parsed.command === "ensure";
    if (ensuring && typeof launchTarget.ensurePreview !== "function") {
      return finish(responseError("Vibe64 managed preview startup is not available.", "vibe64_agent_preview_command_ensure_unavailable"));
    }
    if (!ensuring && typeof launchTarget.restartPreview !== "function") {
      return finish(responseError("Vibe64 preview restart is not available.", "vibe64_agent_preview_command_restart_unavailable"));
    }

    let started;
    if (ensuring) {
      started = await launchTarget.ensurePreview(sessionId);
    } else {
      started = await launchTarget.restartPreview(sessionId);
    }
    if (started?.ok === false) {
      return finish({
        ...started,
        exitCode: 1,
        stderr: `${started.error || (ensuring ? "Vibe64 managed preview could not start." : "Vibe64 preview restart failed.")}\n`
      });
    }
    let status = await launchTarget.launchStatus(sessionId);
    if (parsed.wait) {
      const waited = await waitForPreviewReady(launchTarget, sessionId, {
        terminalSessionId: started.id,
        timeoutMs: parsed.timeoutMs
      });
      status = waited.status || status;
      if (!waited.ok) {
        const timedOut = waited.timeout === true;
        const summary = statusSummary(status || {}, sessionId);
        return finish(responseError(
          timedOut
            ? "Timed out waiting for Vibe64 preview to become ready."
            : "Vibe64 preview did not become ready.",
          timedOut ? "vibe64_agent_preview_command_wait_timeout" : "vibe64_agent_preview_command_not_ready",
          {
            exitCode: 1,
            stdout: previewStartStdout({
              ...summary,
              timedOut
            }, {
              command: parsed.command,
              json: parsed.json
            })
          }
        ));
      }
    }
    return finish({
      exitCode: 0,
      ok: true,
      stdout: previewStartStdout(statusSummary(status || {}, sessionId), {
        command: parsed.command,
        json: parsed.json
      })
    });
  }

  return Object.freeze({
    authorizeBrowserIdentity,
    browserStart: (sessionId, input) => startRegisteredBrowserWorker(sessionId, input, {
      browserWorkers,
      runCommand: runManagedCommand,
      stopExecution: stopManagedExecution
    }),
    browserStop: (sessionId, input) => stopRegisteredBrowserWorkerForInput(sessionId, input, {
      browserWorkers,
      stopExecution: stopManagedExecution
    }),
    closeAllForSession,
    registerBrowserWorker,
    releaseControlForSession,
    run
  });
}

function verifyRequestToken(input = {}, expectedToken = "") {
  return normalizeText(input.token) && normalizeText(input.token) === normalizeText(expectedToken);
}

function commandServerToken({
  sessionId = "",
  socketPath = "",
  wrapperHostDir = ""
} = {}) {
  return shortCommandHash([
    "agent-preview-command-token",
    normalizeText(sessionId),
    normalizeText(socketPath),
    normalizeText(wrapperHostDir)
  ].join("\n"));
}

function browserWorkerToken({
  commandToken = "",
  generationId = "",
  sessionId = ""
} = {}) {
  return crypto
    .createHash("sha256")
    .update([
      "vibe64-preview-browser",
      normalizeText(sessionId),
      normalizeText(generationId),
      normalizeText(commandToken)
    ].join("\n"))
    .digest("hex");
}

function normalizedBrowserProcessGroups(value = []) {
  const groups = new Map();
  for (const entry of Array.isArray(value) ? value : []) {
    const groupId = Number(entry?.groupId);
    const startTimeTicks = normalizeText(entry?.startTimeTicks);
    if (Number.isSafeInteger(groupId) && groupId > 1 && startTimeTicks) {
      groups.set(groupId, {
        groupId,
        startTimeTicks
      });
    }
  }
  return [...groups.values()].sort((left, right) => left.groupId - right.groupId);
}

function browserWorkerMetadataSignature(metadata = {}, token = "") {
  return crypto
    .createHash("sha256")
    .update([
      normalizeText(token),
      normalizeText(metadata.contractVersion),
      normalizeText(metadata.executionId),
      String(metadata.pid || ""),
      normalizeText(metadata.socketPath),
      normalizeText(metadata.startTimeTicks),
      normalizeText(metadata.startedAt),
      normalizeText(metadata.workerScriptPath),
      JSON.stringify(normalizedBrowserProcessGroups(metadata.browserProcessGroups))
    ].join("\n"))
    .digest("hex");
}

async function browserWorkerRequest({
  input = {},
  socketPath = "",
  token = "",
  timeoutMs = 2000
} = {}) {
  const response = await requestUnixJsonCommand({
    body: {
      ...input,
      token
    },
    path: "/command",
    socketPath,
    timeoutMs
  });
  return response.payload || responseError(
    "Managed browser returned an invalid response.",
    "vibe64_managed_browser_response_invalid"
  );
}

async function registeredProcessIdentity(pid) {
  try {
    const statText = await readFile(`/proc/${pid}/stat`, "utf8");
    const closeIndex = statText.lastIndexOf(") ");
    const fields = statText.slice(closeIndex + 2).trim().split(/\s+/u);
    return {
      groupId: Number(fields[2]),
      startTimeTicks: String(fields[19] || ""),
      state: String(fields[0] || "")
    };
  } catch {
    return null;
  }
}

async function registeredProcessGroupIsAlive(entry = {}) {
  const groupId = Number(entry?.groupId);
  const leader = await registeredProcessIdentity(groupId);
  if (
    !leader ||
    leader.groupId !== groupId ||
    leader.startTimeTicks !== normalizeText(entry?.startTimeTicks)
  ) {
    return false;
  }
  for (const processEntry of await readdir("/proc", { withFileTypes: true }).catch(() => [])) {
    if (!processEntry.isDirectory() || !/^\d+$/u.test(processEntry.name)) {
      continue;
    }
    const identity = await registeredProcessIdentity(Number(processEntry.name));
    if (identity?.groupId === groupId && identity.state !== "Z") {
      return true;
    }
  }
  return false;
}

async function drainRegisteredProcessGroup(entry = {}) {
  if (!await registeredProcessGroupIsAlive(entry)) {
    return true;
  }
  try {
    process.kill(-Number(entry.groupId), "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
  for (let attempt = 0; attempt < 60 && await registeredProcessGroupIsAlive(entry); attempt += 1) {
    await delay(50);
  }
  if (await registeredProcessGroupIsAlive(entry)) {
    try {
      process.kill(-Number(entry.groupId), "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw error;
      }
    }
  }
  for (let attempt = 0; attempt < 20 && await registeredProcessGroupIsAlive(entry); attempt += 1) {
    await delay(50);
  }
  return !await registeredProcessGroupIsAlive(entry);
}

async function registeredWorkerMetadata(descriptor = {}) {
  try {
    const metadata = JSON.parse(await readFile(descriptor.metadataPath, "utf8"));
    const executionId = normalizeText(metadata?.executionId);
    if (
      !/^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,254}[A-Za-z0-9])?$/u.test(executionId) ||
      (normalizeText(descriptor.executionId) && executionId !== normalizeText(descriptor.executionId)) ||
      metadata?.socketPath !== descriptor.socketPath ||
      metadata?.workerScriptPath !== descriptor.workerScriptPath ||
      metadata?.contractVersion !== descriptor.contractVersion ||
      metadata?.signature !== browserWorkerMetadataSignature(metadata, descriptor.token)
    ) {
      return null;
    }
    return metadata;
  } catch {
    return null;
  }
}

async function registeredWorkerStatus(descriptor = {}) {
  try {
    const payload = await browserWorkerRequest({
      input: { command: "status" },
      socketPath: descriptor.socketPath,
      token: descriptor.token
    });
    return payload?.ok === true &&
      payload.value?.contractVersion === descriptor.contractVersion
      ? payload.value
      : null;
  } catch {
    return null;
  }
}

async function fileExists(filePath = "") {
  try {
    await readFile(filePath);
    return true;
  } catch {
    return false;
  }
}

function browserCleanupFault(message = "The managed browser execution could not be proven empty.") {
  return responseError(message, "vibe64_execution_cleanup_required", {
    retryable: false
  });
}

async function stopRegisteredBrowserWorker(descriptor = {}, {
  reason = "browser-stop",
  skipStartWait = false,
  stopExecution = stopVibe64Execution
} = {}) {
  if (!skipStartWait && descriptor.startPromise) {
    await descriptor.startPromise.catch(() => null);
  }
  const retiredDescriptors = descriptor.retiredDescriptors || [];
  descriptor.retiredDescriptors = [];
  for (const retired of retiredDescriptors) {
    const retiredResult = await stopRegisteredBrowserWorker(retired, {
      reason: "browser-generation-replaced",
      stopExecution
    });
    if (retiredResult.ok !== true) {
      descriptor.retiredDescriptors.unshift(retired);
      return retiredResult;
    }
  }
  const metadata = await registeredWorkerMetadata(descriptor);
  await browserWorkerRequest({
    input: {
      command: "close"
    },
    socketPath: descriptor.socketPath,
    token: descriptor.token
  }).catch(() => null);
  const executionIds = [...new Set([
    normalizeText(descriptor.executionId),
    normalizeText(metadata?.executionId)
  ].filter(Boolean))];
  if (executionIds.length === 0 && (
    await unixCommandSocketIsPresent(descriptor.socketPath) ||
    await fileExists(descriptor.metadataPath)
  )) {
    return browserCleanupFault(
      "The managed browser has no valid execution ownership record; no replacement was started."
    );
  }
  for (const executionId of executionIds) {
    const stopped = await stopExecution(executionId, { reason });
    if (stopped?.scopeEmpty !== true) {
      return browserCleanupFault(stopped?.error);
    }
  }
  for (const group of normalizedBrowserProcessGroups(metadata?.browserProcessGroups)) {
    if (!await drainRegisteredProcessGroup(group)) {
      return browserCleanupFault(
        `Managed browser process group ${group.groupId} did not become empty.`
      );
    }
  }
  await Promise.all([
    rm(descriptor.socketPath, {
      force: true
    }),
    rm(descriptor.metadataPath, {
      force: true
    })
  ]).catch(() => null);
  descriptor.executionId = "";
  return {
    ok: true,
    scopeEmpty: true,
    stopped: executionIds.length > 0
  };
}

function registeredBrowserWorkerForInput(sessionId = "", input = {}, browserWorkers = new Map()) {
  const normalizedSessionId = normalizeText(sessionId);
  const socketPath = normalizeText(input.browserSocketPath);
  const descriptor = browserWorkers.get(normalizedSessionId)?.get(socketPath);
  if (!descriptor) {
    return {
      error: responseError(
        "The managed browser is not registered for this assistant session.",
        "vibe64_managed_browser_not_registered"
      )
    };
  }
  if (
    normalizeText(input.managedNodePath) !== descriptor.managedNodePath ||
    normalizeText(input.workerScriptPath) !== descriptor.workerScriptPath
  ) {
    return {
      error: responseError(
        "The managed browser command does not match the registered runtime.",
        "vibe64_managed_browser_runtime_invalid"
      )
    };
  }
  const worktreePath = path.resolve(descriptor.worktreePath);
  const cwd = path.resolve(normalizeText(input.cwd) || worktreePath);
  const relativeCwd = path.relative(worktreePath, cwd);
  if (relativeCwd === ".." || relativeCwd.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCwd)) {
    return {
      error: responseError(
        "The managed browser working directory is outside this session source.",
        "vibe64_managed_browser_cwd_invalid"
      )
    };
  }
  return { cwd, descriptor };
}

async function startRegisteredBrowserWorker(sessionId = "", input = {}, {
  browserWorkers = new Map(),
  runCommand = runVibe64Command,
  stopExecution = stopVibe64Execution
} = {}) {
  const registered = registeredBrowserWorkerForInput(sessionId, input, browserWorkers);
  if (registered.error) {
    return registered.error;
  }
  const { cwd, descriptor } = registered;
  if (descriptor.startPromise) {
    return descriptor.startPromise;
  }
  const startPromise = (async () => {
    for (const retired of descriptor.retiredDescriptors || []) {
      const retiredResult = await stopRegisteredBrowserWorker(retired, {
        reason: "browser-generation-replaced",
        stopExecution
      });
      if (retiredResult.ok !== true) {
        return retiredResult;
      }
    }
    descriptor.retiredDescriptors = [];

    const existingStatus = await registeredWorkerStatus(descriptor);
    const existingMetadata = await registeredWorkerMetadata(descriptor);
    if (existingStatus) {
      if (!existingMetadata) {
        return browserCleanupFault(
          "The running managed browser has no valid execution ownership record."
        );
      }
      descriptor.executionId = existingMetadata.executionId;
      return {
        executionId: descriptor.executionId,
        ok: true,
        value: existingStatus
      };
    }
    if (existingMetadata || normalizeText(descriptor.executionId)) {
      const drained = await stopRegisteredBrowserWorker(descriptor, {
        reason: "browser-restart",
        skipStartWait: true,
        stopExecution
      });
      if (drained.ok !== true) {
        return drained;
      }
    } else if (
      await unixCommandSocketIsPresent(descriptor.socketPath) ||
      await fileExists(descriptor.metadataPath)
    ) {
      return browserCleanupFault(
        "Stale managed browser state has no valid execution owner; no replacement was started."
      );
    }

    const result = await runCommand({
      actor: "daemon",
      allowedRoots: [descriptor.worktreePath],
      args: [
        descriptor.workerScriptPath,
        descriptor.socketPath,
        descriptor.metadataPath,
        descriptor.controlSocketPath
      ],
      command: descriptor.managedNodePath,
      cwd,
      env: descriptor.env,
      envPolicy: "preview",
      execution: {
        controlGenerationId: descriptor.controlGenerationId,
        kind: "browser",
        label: "Managed browser",
        lifecycle: "service",
        ownerId: descriptor.sessionId,
        parentExecutionId: normalizeText(input.parentExecutionId),
        projectSlug: descriptor.project?.slug,
        sessionId: descriptor.sessionId
      },
      mode: "detached",
      project: descriptor.project,
      purpose: "preview",
      runtimes: ["node26", "playwright"],
      session: {
        sessionId: descriptor.sessionId
      }
    });
    if (result?.ok !== true) {
      return result;
    }
    descriptor.executionId = normalizeText(result.execution?.id);
    if (!descriptor.executionId) {
      return browserCleanupFault(
        "The managed browser started without an execution ownership record."
      );
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const [status, metadata] = await Promise.all([
        registeredWorkerStatus(descriptor),
        registeredWorkerMetadata(descriptor)
      ]);
      if (status && metadata?.executionId === descriptor.executionId) {
        return {
          executionId: descriptor.executionId,
          ok: true,
          value: status
        };
      }
      await delay(100);
    }
    const drained = await stopRegisteredBrowserWorker(descriptor, {
      reason: "browser-readiness-timeout",
      skipStartWait: true,
      stopExecution
    });
    if (drained.ok !== true) {
      return drained;
    }
    return responseError(
      "The managed browser worker did not become ready.",
      "vibe64_managed_browser_readiness_timeout"
    );
  })();
  descriptor.startPromise = startPromise;
  try {
    return await startPromise;
  } finally {
    if (descriptor.startPromise === startPromise) {
      descriptor.startPromise = null;
    }
  }
}

async function stopRegisteredBrowserWorkerForInput(sessionId = "", input = {}, {
  browserWorkers = new Map(),
  stopExecution = stopVibe64Execution
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const descriptor = browserWorkers
    .get(normalizedSessionId)
    ?.get(normalizeText(input.browserSocketPath));
  if (!descriptor) {
    return responseError(
      "The managed browser is not registered for this assistant session.",
      "vibe64_managed_browser_not_registered"
    );
  }
  return stopRegisteredBrowserWorker(descriptor, {
    reason: "browser-close",
    stopExecution
  });
}

async function closeAgentPreviewCommandServersForSession(sessionId = "") {
  const normalizedSessionId = normalizeText(sessionId);
  await Promise.all([...commandServerPrepares.values()].map((preparation) => (
    preparation.catch(() => null)
  )));
  for (const [socketPath, entryValue] of [...commandServers.entries()]) {
    const entry = entryValue?.promise
      ? await entryValue.promise.catch(() => null)
      : entryValue;
    if (normalizeText(entry?.sessionId) !== normalizedSessionId) {
      continue;
    }
    if (entry?.server) {
      await new Promise((resolve) => entry.server.close(() => resolve())).catch(() => null);
    }
    commandServers.delete(socketPath);
    await rm(socketPath, {
      force: true
    }).catch(() => null);
  }
}

async function agentPreviewCommandServerIsHealthy(entry = {}, {
  sessionId = "",
  socketPath = ""
} = {}) {
  if (!entry.server || !await unixCommandSocketIsPresent(socketPath)) {
    return false;
  }
  try {
    const response = await requestUnixJsonCommand({
      body: {
        generationId: entry.generationId,
        sessionId,
        token: entry.token
      },
      path: "/agent-preview-command/health",
      socketPath,
      timeoutMs: 2000
    });
    return response.statusCode === 200 &&
      response.payload?.ok === true &&
      normalizeText(response.payload?.generationId) === normalizeText(entry.generationId) &&
      normalizeText(response.payload?.sessionId) === normalizeText(sessionId);
  } catch {
    return false;
  }
}

async function closeAgentPreviewCommandServer(socketPath = "", entry = null) {
  if (entry?.server) {
    await new Promise((resolve) => entry.server.close(() => resolve())).catch(() => null);
  }
  if (commandServers.get(socketPath) === entry) {
    commandServers.delete(socketPath);
  }
}

async function removeDeadAgentPreviewCommandSocket(socketPath = "") {
  if (!await unixCommandSocketIsPresent(socketPath)) {
    return;
  }
  try {
    await requestUnixJsonCommand({
      body: {},
      path: "/agent-preview-command/health",
      socketPath,
      timeoutMs: 2000
    });
  } catch (error) {
    if (["ECONNREFUSED", "ENOENT", "ENOTSOCK"].includes(String(error?.code || ""))) {
      await rm(socketPath, {
        force: true
      });
      return;
    }
    throw error;
  }
  const error = new Error("The managed preview socket is owned by an unverified listener.");
  error.code = "vibe64_agent_control_owner_unverified";
  throw error;
}

async function ensureAgentPreviewCommandServer({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
} = {}) {
  const socketPath = commandSocketHostPath(wrapperHostDir);
  const pending = commandServerPrepares.get(socketPath);
  if (pending) {
    await pending.catch(() => null);
    return ensureAgentPreviewCommandServer({
      commandService,
      sessionId,
      wrapperHostDir
    });
  }
  const preparation = ensureAgentPreviewCommandServerUnlocked({
    commandService,
    sessionId,
    wrapperHostDir
  });
  commandServerPrepares.set(socketPath, preparation);
  try {
    return await preparation;
  } finally {
    if (commandServerPrepares.get(socketPath) === preparation) {
      commandServerPrepares.delete(socketPath);
    }
  }
}

async function ensureAgentPreviewCommandServerUnlocked({
  commandService,
  sessionId = "",
  wrapperHostDir = ""
} = {}) {
  const socketPath = commandSocketHostPath(wrapperHostDir);
  let existing = commandServers.get(socketPath);
  if (existing?.promise) {
    await existing.promise.catch(() => null);
    existing = commandServers.get(socketPath);
  }
  if (
    existing?.commandService === commandService &&
    await agentPreviewCommandServerIsHealthy(existing, {
      sessionId,
      socketPath
    })
  ) {
    return existing;
  }
  await closeAgentPreviewCommandServer(socketPath, existing);
  const promise = (async () => {
    await mkdir(path.dirname(socketPath), {
      recursive: true
    });
    await removeDeadAgentPreviewCommandSocket(socketPath);
    const token = commandServerToken({
      sessionId,
      socketPath,
      wrapperHostDir
    });
    const generationId = crypto.randomUUID();
    const server = http.createServer(async (request, response) => {
      try {
        if (request.method !== "POST" || !AGENT_PREVIEW_COMMAND_ROUTES.has(request.url)) {
          sendJsonCommandResponse(response, 404, responseError("Unknown Vibe64 preview command route.", "vibe64_agent_preview_command_route_not_found"));
          return;
        }
        const input = await readRequestJson(request);
        if (
          !verifyRequestToken(input, token) ||
          normalizeText(input.sessionId) !== normalizeText(sessionId) ||
          normalizeText(input.generationId) !== generationId
        ) {
          sendJsonCommandResponse(response, 409, responseError(
            "Managed preview control generation is no longer current. Reconnect the assistant.",
            "vibe64_agent_control_unavailable"
          ));
          return;
        }
        if (request.url === "/agent-preview-command/health") {
          sendJsonCommandResponse(response, 200, {
            generationId,
            ok: true,
            sessionId: normalizeText(sessionId)
          });
          return;
        }
        if (request.url === "/agent-preview-command/identity") {
          const payload = await commandService.authorizeBrowserIdentity(
            sessionId,
            input.identity
          );
          sendJsonCommandResponse(response, vibe64StatusCode(payload), payload);
          return;
        }
        if (request.url === "/agent-preview-command/browser-start") {
          const payload = await commandService.browserStart(sessionId, input);
          sendJsonCommandResponse(response, vibe64StatusCode(payload), payload);
          return;
        }
        if (request.url === "/agent-preview-command/browser-stop") {
          const payload = await commandService.browserStop(sessionId, input);
          sendJsonCommandResponse(response, vibe64StatusCode(payload), payload);
          return;
        }
        if (request.url === "/agent-preview-command/run") {
          sendJsonCommandResponse(response, 200, await commandService.run(input));
          return;
        }
      } catch (error) {
        const payload = vibe64ErrorResponse(error, {
          fallbackCode: "vibe64_agent_preview_command_request_failed",
          fallbackMessage: "Vibe64 preview command request failed."
        });
        sendJsonCommandResponse(response, vibe64StatusCode(payload), payload);
      }
    });
    await new Promise((resolve, reject) => {
      const handleError = (error) => reject(error);
      server.once("error", handleError);
      server.listen(socketPath, () => {
        server.off("error", handleError);
        resolve();
      });
    });
    server.unref?.();
    const stored = {
      commandService,
      generationId,
      server,
      sessionId: normalizeText(sessionId),
      socketPath,
      token
    };
    commandServers.set(socketPath, stored);
    if (!await agentPreviewCommandServerIsHealthy(stored, {
      sessionId,
      socketPath
    })) {
      await closeAgentPreviewCommandServer(socketPath, stored);
      await rm(socketPath, {
        force: true
      }).catch(() => null);
      const error = new Error("Managed preview control did not pass its ownership health check.");
      error.code = "vibe64_agent_control_unavailable";
      throw error;
    }
    return stored;
  })();
  commandServers.set(socketPath, {
    commandService,
    promise
  });
  try {
    return await promise;
  } catch (error) {
    if (commandServers.get(socketPath)?.promise === promise) {
      commandServers.delete(socketPath);
    }
    throw error;
  }
}

async function prepareAgentPreviewCommand({
  browserIdleTimeoutMs = DEFAULT_PREVIEW_BROWSER_IDLE_TIMEOUT_MS,
  browserControlHealthFailureLimit = 4,
  browserControlHealthIntervalMs = 15_000,
  commandService,
  env = process.env,
  project = {},
  sessionId = "",
  worktreePath = "",
  wrapperHostDir = ""
} = {}) {
  const normalizedSessionId = normalizeText(sessionId);
  const normalizedWrapperHostDir = normalizeText(wrapperHostDir);
  if (!commandService || !normalizedSessionId || !normalizedWrapperHostDir) {
    return {
      env: {},
      ok: false
    };
  }
  const packRoot = runtimePackRoot({
    env
  });
  const [nodeBinDir] = runtimePackBinPaths("node26", {
    env
  });
  const managedNodePath = path.join(nodeBinDir, "node");
  const managedNpmPath = path.join(nodeBinDir, "npm");
  const normalizedWorktreePath = path.resolve(normalizeText(worktreePath) || process.cwd());
  const workerScriptPath = browserWorkerHostPath(normalizedWrapperHostDir);
  const playwrightModulePath = path.join(
    packRoot,
    "playwright",
    "runtime",
    "lib",
    "node_modules",
    "playwright"
  );
  await writeWrapper({
    agentPlaywrightSource: agentPlaywrightCommandSource({
      managedNodePath,
      managedNpmPath,
      managedPreviewPath: wrapperHostPath(normalizedWrapperHostDir),
      runtimeRoot: packRoot
    }),
    browserWorkerSource: agentPreviewBrowserWorkerSource({
      contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      controlHealthFailureLimit: browserControlHealthFailureLimit,
      controlHealthIntervalMs: browserControlHealthIntervalMs,
      identityControlPath: PREVIEW_IDENTITY_CONTROL_PATH,
      idleTimeoutMs: browserIdleTimeoutMs,
      playwrightModulePath
    }),
    previewWrapperSource: agentPreviewWrapperSource({
      contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      managedNodePath,
      workerScriptPath
    }),
    wrapperHostDir: normalizedWrapperHostDir
  });
  const server = await ensureAgentPreviewCommandServer({
    commandService,
    sessionId: normalizedSessionId,
    wrapperHostDir: normalizedWrapperHostDir
  });
  const token = browserWorkerToken({
    commandToken: server.token,
    generationId: server.generationId,
    sessionId: normalizedSessionId
  });
  const workerDescriptor = {
    contractVersion: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
    controlGenerationId: server.generationId,
    controlSocketPath: commandSocketHostPath(normalizedWrapperHostDir),
    env: {
      [VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV]: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV]: server.generationId,
      [VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV]: commandSocketHostPath(normalizedWrapperHostDir),
      [VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV]: server.token,
      [VIBE64_PREVIEW_BROWSER_WORKER_TOKEN_ENV]: token
    },
    managedNodePath,
    metadataPath: browserMetadataHostPath(normalizedWrapperHostDir),
    project: isRecord(project) ? project : {},
    socketPath: browserSocketHostPath(normalizedWrapperHostDir),
    token,
    workerScriptPath,
    worktreePath: normalizedWorktreePath
  };
  commandService.registerBrowserWorker?.(normalizedSessionId, workerDescriptor);
  return {
    controlGenerationId: server.generationId,
    env: {
      [VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV]: AGENT_PREVIEW_COMMAND_CONTRACT_VERSION,
      [VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV]: normalizedSessionId,
      [VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV]: server.generationId,
      [VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV]: commandSocketHostPath(normalizedWrapperHostDir),
      [VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV]: server.token
    },
    hostBrowserMetadataPath: workerDescriptor.metadataPath,
    hostBrowserSocketPath: workerDescriptor.socketPath,
    hostBrowserWorkerPath: workerScriptPath,
    hostPlaywrightWrapperPath: agentPlaywrightHostPath(normalizedWrapperHostDir),
    hostSocketPath: commandSocketHostPath(normalizedWrapperHostDir),
    hostWrapperPath: wrapperHostPath(normalizedWrapperHostDir),
    ok: true
  };
}

export {
  AGENT_PLAYWRIGHT_COMMAND_NAME,
  AGENT_PREVIEW_COMMAND_NAME,
  VIBE64_AGENT_PREVIEW_COMMAND_CONTRACT_VERSION_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_GENERATION_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SESSION_ID_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_SOCKET_ENV,
  VIBE64_AGENT_PREVIEW_COMMAND_TOKEN_ENV,
  createAgentPreviewCommandService,
  prepareAgentPreviewCommand
};
