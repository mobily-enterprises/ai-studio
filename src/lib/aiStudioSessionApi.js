import {
  resolveWebSocketUrl,
  studioApiPath,
  studioHttpClient
} from "@/lib/studioHttp.js";

const AI_STUDIO_ENDPOINT = studioApiPath("ai-studio");
const AI_STUDIO_SESSIONS_ENDPOINT = `${AI_STUDIO_ENDPOINT}/sessions`;

function aiStudioSessionEndpoint(sessionId, suffix = "") {
  return `${AI_STUDIO_SESSIONS_ENDPOINT}/${encodeURIComponent(sessionId)}${suffix}`;
}

function aiStudioCodexTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = aiStudioSessionEndpoint(sessionId, "/codex-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function aiStudioCommandTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = aiStudioSessionEndpoint(sessionId, "/command-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function aiStudioAppReviewTerminalEndpoint(sessionId, terminalSessionId = "") {
  const base = aiStudioSessionEndpoint(sessionId, "/app-review-terminal");
  return terminalSessionId ? `${base}/${encodeURIComponent(terminalSessionId)}` : base;
}

function aiStudioCodexTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${aiStudioCodexTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function aiStudioCommandTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${aiStudioCommandTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

function aiStudioAppReviewTerminalWebSocketUrl(sessionId, terminalSessionId) {
  return resolveWebSocketUrl(`${aiStudioAppReviewTerminalEndpoint(sessionId, terminalSessionId)}/ws`);
}

async function readAiStudioSessionDiff(sessionId) {
  return studioHttpClient.get(aiStudioSessionEndpoint(sessionId, "/diff"));
}

async function startAiStudioCodexTerminal(sessionId) {
  return studioHttpClient.post(aiStudioCodexTerminalEndpoint(sessionId), {});
}

async function closeAiStudioCodexTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(aiStudioCodexTerminalEndpoint(sessionId, terminalSessionId));
}

async function startAiStudioCommandTerminal(sessionId, actionId, input = {}) {
  return studioHttpClient.post(aiStudioCommandTerminalEndpoint(sessionId), {
    actionId,
    input
  });
}

async function startAiStudioAppReviewTerminal(sessionId) {
  return studioHttpClient.post(aiStudioAppReviewTerminalEndpoint(sessionId), {});
}

async function closeAiStudioCommandTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(aiStudioCommandTerminalEndpoint(sessionId, terminalSessionId));
}

async function closeAiStudioAppReviewTerminal(sessionId, terminalSessionId) {
  return studioHttpClient.delete(aiStudioAppReviewTerminalEndpoint(sessionId, terminalSessionId));
}

export {
  aiStudioAppReviewTerminalEndpoint,
  aiStudioAppReviewTerminalWebSocketUrl,
  aiStudioCodexTerminalEndpoint,
  aiStudioCodexTerminalWebSocketUrl,
  aiStudioCommandTerminalEndpoint,
  aiStudioCommandTerminalWebSocketUrl,
  closeAiStudioAppReviewTerminal,
  closeAiStudioCodexTerminal,
  closeAiStudioCommandTerminal,
  readAiStudioSessionDiff,
  startAiStudioAppReviewTerminal,
  startAiStudioCodexTerminal,
  startAiStudioCommandTerminal
};
