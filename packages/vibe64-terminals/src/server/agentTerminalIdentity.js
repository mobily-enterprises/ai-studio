import path from "node:path";

const MAX_AGENT_IDENTITY_VALUE_LENGTH = 512;

export const AGENT_TERMINAL_IDENTITY_STATUS = Object.freeze({
  ATTENTION_REQUIRED: "attention_required",
  FAILED: "failed",
  PENDING: "pending",
  READY: "ready"
});

export const AGENT_TERMINAL_RESUME_STRATEGY = Object.freeze({
  NOT_RESUMABLE: "not-resumable",
  PROVIDER_NATIVE: "provider-native",
  TERMINAL_REUSE: "terminal-reuse"
});

function normalizeIdentityText(value) {
  const normalized = String(value || "").trim();
  if (
    !normalized ||
    normalized.length > MAX_AGENT_IDENTITY_VALUE_LENGTH ||
    normalized.includes("\n") ||
    normalized.includes("\r")
  ) {
    return "";
  }
  return normalized;
}

export function normalizeAgentProvider(value) {
  const provider = normalizeIdentityText(value).toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(provider)) {
    return "";
  }
  return provider;
}

export function normalizeAgentConversationId(value) {
  return normalizeIdentityText(value);
}

export function normalizeAgentResumeStrategy(value) {
  const strategy = normalizeIdentityText(value);
  return Object.values(AGENT_TERMINAL_RESUME_STRATEGY).includes(strategy)
    ? strategy
    : "";
}

export function normalizeAgentIdentityStatus(value) {
  const status = normalizeIdentityText(value);
  return Object.values(AGENT_TERMINAL_IDENTITY_STATUS).includes(status)
    ? status
    : "";
}

export function normalizeAgentWorkdir(value) {
  const workdir = String(value || "").trim();
  if (!workdir) {
    return "";
  }
  return path.resolve(workdir);
}

export function agentTerminalIdentityForWorkdir(session = {}, {
  provider = "",
  validateConversationId = normalizeAgentConversationId,
  workdir = ""
} = {}) {
  const metadata = session.metadata || {};
  const normalizedProvider = normalizeAgentProvider(provider);
  const recordedProvider = normalizeAgentProvider(metadata.agent_identity_provider);
  if (!normalizedProvider || recordedProvider !== normalizedProvider) {
    return null;
  }

  const status = normalizeAgentIdentityStatus(metadata.agent_identity_status);
  if (status !== AGENT_TERMINAL_IDENTITY_STATUS.READY) {
    return null;
  }

  const conversationId = validateConversationId(metadata.agent_identity_conversation_id);
  if (!conversationId) {
    return null;
  }

  const normalizedWorkdir = normalizeAgentWorkdir(workdir);
  const recordedWorkdir = normalizeAgentWorkdir(metadata.agent_identity_workdir);
  if (!normalizedWorkdir || !recordedWorkdir || recordedWorkdir !== normalizedWorkdir) {
    return null;
  }

  return {
    capturedAt: normalizeIdentityText(metadata.agent_identity_captured_at),
    conversationId,
    provider: normalizedProvider,
    resumeStrategy: normalizeAgentResumeStrategy(metadata.agent_identity_resume_strategy),
    source: "agent_identity",
    status,
    terminalSessionId: normalizeIdentityText(metadata.agent_identity_terminal_session_id),
    workdir: recordedWorkdir
  };
}

export function agentTerminalIdentityState(session = {}, {
  provider = "",
  validateConversationId = normalizeAgentConversationId,
  workdir = ""
} = {}) {
  const identity = agentTerminalIdentityForWorkdir(session, {
    provider,
    validateConversationId,
    workdir
  });
  if (identity) {
    return identity;
  }
  const metadata = session.metadata || {};
  const normalizedProvider = normalizeAgentProvider(provider);
  const recordedProvider = normalizeAgentProvider(metadata.agent_identity_provider);
  if (!normalizedProvider || recordedProvider !== normalizedProvider) {
    return null;
  }
  return {
    capturedAt: normalizeIdentityText(metadata.agent_identity_captured_at),
    conversationId: "",
    error: String(metadata.agent_identity_error || "").trim(),
    provider: normalizedProvider,
    resumeStrategy: normalizeAgentResumeStrategy(metadata.agent_identity_resume_strategy),
    source: "agent_identity",
    status: normalizeAgentIdentityStatus(metadata.agent_identity_status),
    terminalSessionId: normalizeIdentityText(metadata.agent_identity_terminal_session_id),
    workdir: normalizeAgentWorkdir(metadata.agent_identity_workdir)
  };
}

async function writeSessionMetadata(runtime, sessionId, values = {}) {
  await runtime.store.mutateSession(sessionId, async () => {
    await Promise.all(Object.entries(values).map(([name, value]) => (
      runtime.store.writeMetadataValue(sessionId, name, String(value || "").trim())
    )));
  });
}

export async function writeAgentTerminalIdentityPending({
  runtime,
  sessionId,
  provider,
  resumeStrategy,
  terminalSessionId,
  workdir
} = {}) {
  await writeSessionMetadata(runtime, sessionId, {
    agent_identity_conversation_id: "",
    agent_identity_error: "",
    agent_identity_provider: normalizeAgentProvider(provider),
    agent_identity_resume_strategy: normalizeAgentResumeStrategy(resumeStrategy),
    agent_identity_status: AGENT_TERMINAL_IDENTITY_STATUS.PENDING,
    agent_identity_terminal_session_id: terminalSessionId,
    agent_identity_updated_at: new Date().toISOString(),
    agent_identity_workdir: normalizeAgentWorkdir(workdir)
  });
}

export async function writeAgentTerminalIdentityReady({
  identity = {},
  legacyMetadata = {},
  runtime,
  sessionId
} = {}) {
  const capturedAt = identity.capturedAt || new Date().toISOString();
  await writeSessionMetadata(runtime, sessionId, {
    ...legacyMetadata,
    agent_identity_captured_at: capturedAt,
    agent_identity_conversation_id: identity.conversationId,
    agent_identity_error: "",
    agent_identity_provider: normalizeAgentProvider(identity.provider),
    agent_identity_resume_strategy: normalizeAgentResumeStrategy(identity.resumeStrategy),
    agent_identity_status: AGENT_TERMINAL_IDENTITY_STATUS.READY,
    agent_identity_terminal_session_id: identity.terminalSessionId,
    agent_identity_updated_at: capturedAt,
    agent_identity_workdir: normalizeAgentWorkdir(identity.workdir)
  });
}

export async function writeAgentTerminalIdentityFailed({
  attentionRequired = false,
  error = "",
  provider,
  resumeStrategy,
  runtime,
  sessionId,
  terminalSessionId,
  workdir
} = {}) {
  await writeSessionMetadata(runtime, sessionId, {
    agent_identity_conversation_id: "",
    agent_identity_error: String(error || "").trim(),
    agent_identity_provider: normalizeAgentProvider(provider),
    agent_identity_resume_strategy: normalizeAgentResumeStrategy(resumeStrategy),
    agent_identity_status: attentionRequired
      ? AGENT_TERMINAL_IDENTITY_STATUS.ATTENTION_REQUIRED
      : AGENT_TERMINAL_IDENTITY_STATUS.FAILED,
    agent_identity_terminal_session_id: terminalSessionId,
    agent_identity_updated_at: new Date().toISOString(),
    agent_identity_workdir: normalizeAgentWorkdir(workdir)
  });
}

function normalizeCapturedIdentity(captured, {
  adapter,
  terminalSessionId,
  workdir
} = {}) {
  const source = typeof captured === "string"
    ? {
        conversationId: captured
      }
    : {
        ...(captured?.identity || captured || {})
      };
  const validateConversationId = typeof adapter.validateConversationId === "function"
    ? adapter.validateConversationId
    : normalizeAgentConversationId;
  const conversationId = validateConversationId(source.conversationId);
  if (!conversationId) {
    return null;
  }
  return {
    capturedAt: source.capturedAt || new Date().toISOString(),
    conversationId,
    provider: normalizeAgentProvider(adapter.provider),
    resumeStrategy: normalizeAgentResumeStrategy(source.resumeStrategy || adapter.resumeStrategy),
    source: "agent_identity",
    status: AGENT_TERMINAL_IDENTITY_STATUS.READY,
    terminalSessionId: normalizeIdentityText(source.terminalSessionId || terminalSessionId),
    workdir: normalizeAgentWorkdir(source.workdir || workdir)
  };
}

export async function ensureAgentTerminalIdentity({
  adapter = {},
  runtime,
  session,
  terminalSessionId
} = {}) {
  const sessionId = normalizeIdentityText(session?.sessionId);
  const provider = normalizeAgentProvider(adapter.provider);
  const workdir = normalizeAgentWorkdir(
    typeof adapter.workdir === "function" ? adapter.workdir(session) : session?.workdir
  );
  const resumeStrategy = normalizeAgentResumeStrategy(adapter.resumeStrategy);
  if (!sessionId || !provider || !workdir || !terminalSessionId) {
    return {
      ok: false,
      error: "Agent identity capture is missing a session, provider, workdir, or terminal.",
      retryable: true
    };
  }

  const readIdentity = typeof adapter.readIdentity === "function"
    ? adapter.readIdentity
    : (currentSession, currentWorkdir) => agentTerminalIdentityForWorkdir(currentSession, {
        provider,
        validateConversationId: adapter.validateConversationId,
        workdir: currentWorkdir
      });
  const existingIdentity = readIdentity(session, workdir);
  const existingConversationId = adapter.validateConversationId
    ? adapter.validateConversationId(existingIdentity?.conversationId)
    : normalizeAgentConversationId(existingIdentity?.conversationId);
  if (existingIdentity && existingConversationId) {
    const identity = {
      ...existingIdentity,
      conversationId: existingConversationId,
      provider,
      resumeStrategy: existingIdentity.resumeStrategy || resumeStrategy,
      terminalSessionId: existingIdentity.terminalSessionId || terminalSessionId,
      workdir
    };
    if (identity.source !== "agent_identity") {
      await writeAgentTerminalIdentityReady({
        identity,
        legacyMetadata: typeof adapter.legacyMetadataForIdentity === "function"
          ? adapter.legacyMetadataForIdentity(identity)
          : {},
        runtime,
        sessionId
      });
      return {
        identity,
        ok: true,
        session: await runtime.getSession(sessionId)
      };
    }
    return {
      identity,
      ok: true,
      session
    };
  }

  await writeAgentTerminalIdentityPending({
    provider,
    resumeStrategy,
    runtime,
    sessionId,
    terminalSessionId,
    workdir
  });

  const ready = typeof adapter.waitUntilReady === "function"
    ? await adapter.waitUntilReady({
        runtime,
        session,
        sessionId,
        terminalSessionId,
        workdir
      })
    : {
        ok: true
      };
  if (ready?.ok === false) {
    const attentionRequired = ready.attentionRequired === true ||
      ready.requiresUserInput === true ||
      ready.retryable === true;
    await writeAgentTerminalIdentityFailed({
      attentionRequired,
      error: ready.error,
      provider,
      resumeStrategy,
      runtime,
      sessionId,
      terminalSessionId,
      workdir
    });
    return {
      ...ready,
      attentionRequired
    };
  }

  let captured = null;
  try {
    captured = await adapter.captureIdentity({
      runtime,
      session,
      sessionId,
      terminalSessionId,
      workdir
    });
  } catch (error) {
    const message = String(error?.message || error || `${adapter.displayName || provider} session identity could not be saved.`);
    await writeAgentTerminalIdentityFailed({
      error: message,
      provider,
      resumeStrategy,
      runtime,
      sessionId,
      terminalSessionId,
      workdir
    });
    return {
      ok: false,
      error: message,
      retryable: true
    };
  }
  const identity = normalizeCapturedIdentity(captured, {
    adapter: {
      ...adapter,
      provider,
      resumeStrategy
    },
    terminalSessionId,
    workdir
  });
  if (!identity) {
    const error = `${adapter.displayName || provider} session identity could not be saved.`;
    await writeAgentTerminalIdentityFailed({
      error,
      provider,
      resumeStrategy,
      runtime,
      sessionId,
      terminalSessionId,
      workdir
    });
    return {
      ok: false,
      error,
      retryable: true
    };
  }

  await writeAgentTerminalIdentityReady({
    identity,
    legacyMetadata: typeof adapter.legacyMetadataForIdentity === "function"
      ? adapter.legacyMetadataForIdentity(identity)
      : {},
    runtime,
    sessionId
  });

  return {
    identity,
    ok: true,
    session: await runtime.getSession(sessionId)
  };
}
