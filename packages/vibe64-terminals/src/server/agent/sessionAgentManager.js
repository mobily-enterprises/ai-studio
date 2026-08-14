import {
  VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE
} from "@local/vibe64-runtime/shared";
import {
  normalizeText
} from "@local/vibe64-core/server/core";

const SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE = "vibe64_agent_provider_binding_conflict";

function sessionAgentProviderId(options = {}, fallbackProviderId = "") {
  return normalizeText(
    options?.providerId ||
    options?.agentSettings?.providerId ||
    options?.session?.agentSession?.providerId ||
    options?.session?.metadata?.agent_identity_provider ||
    fallbackProviderId
  );
}

function providerNotImplementedError(providerId = "") {
  const id = normalizeText(providerId);
  const error = new Error(`Assistant provider is not implemented: ${id || "(missing)"}.`);
  error.code = VIBE64_AGENT_PROVIDER_NOT_IMPLEMENTED_CODE;
  error.providerId = id;
  return error;
}

function providerBindingConflictError(sessionId = "", currentProviderId = "", requestedProviderId = "") {
  const error = new Error(
    `Assistant session ${normalizeText(sessionId)} is bound to ${normalizeText(currentProviderId)}, not ${normalizeText(requestedProviderId)}.`
  );
  error.code = SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE;
  error.currentProviderId = normalizeText(currentProviderId);
  error.requestedProviderId = normalizeText(requestedProviderId);
  error.sessionId = normalizeText(sessionId);
  return error;
}

function normalizeProvider(provider = {}) {
  const id = normalizeText(provider?.id);
  const transportId = normalizeText(provider?.transportId);
  if (!id || !transportId) {
    throw new TypeError("Session agent providers require product provider and transport ids.");
  }
  return Object.freeze({
    ...provider,
    id,
    transportId
  });
}

function agentOperationResult(provider = {}, sessionId = "", result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : { value: result };
  return {
    ...source,
    providerId: provider.id,
    sessionId: normalizeText(sessionId),
    transportId: provider.transportId
  };
}

function createSessionAgentManager({
  defaultProviderId = "codex",
  providers = []
} = {}) {
  const providerById = new Map();
  const bindings = new Map();
  const operations = new Map();

  for (const candidate of providers) {
    const provider = normalizeProvider(candidate);
    if (providerById.has(provider.id)) {
      throw new TypeError(`Duplicate session agent provider: ${provider.id}.`);
    }
    providerById.set(provider.id, provider);
  }

  function providerFor(options = {}) {
    const providerId = sessionAgentProviderId(options, defaultProviderId);
    const provider = providerById.get(providerId);
    if (!provider) {
      throw providerNotImplementedError(providerId);
    }
    return provider;
  }

  function bindSession(sessionId = "", options = {}) {
    const id = normalizeText(sessionId);
    if (!id) {
      throw new TypeError("Session agent operations require a session id.");
    }
    const currentProviderId = bindings.get(id);
    const requestedProviderId = sessionAgentProviderId(options);
    if (currentProviderId && requestedProviderId && currentProviderId !== requestedProviderId) {
      throw providerBindingConflictError(id, currentProviderId, requestedProviderId);
    }
    const provider = providerFor({
      ...options,
      providerId: requestedProviderId || currentProviderId || defaultProviderId
    });
    bindings.set(id, provider.id);
    return provider;
  }

  function operationKey(sessionId = "", providerId = "", operation = "", identity = "") {
    return [sessionId, providerId, operation, identity].map(normalizeText).join(":");
  }

  async function coalescedOperation(key = "", operation) {
    const existing = operations.get(key);
    if (existing) {
      return existing;
    }
    const pending = Promise.resolve().then(operation);
    operations.set(key, pending);
    try {
      return await pending;
    } finally {
      if (operations.get(key) === pending) {
        operations.delete(key);
      }
    }
  }

  async function callSessionProvider(method = "", sessionId = "", input = {}, options = {}, {
    coalesceIdentity = ""
  } = {}) {
    const operationOptions = {
      ...options,
      agentSettings: options?.agentSettings || input?.agentSettings || null
    };
    const provider = bindSession(sessionId, operationOptions);
    if (typeof provider[method] !== "function") {
      throw new TypeError(`Assistant provider ${provider.id} does not implement ${method}().`);
    }
    const context = {
      agentSettings: operationOptions.agentSettings,
      onEvent: typeof operationOptions.onEvent === "function" ? operationOptions.onEvent : null,
      providerId: provider.id,
      runtime: operationOptions.runtime || null,
      session: operationOptions.session || null,
      sessionId: normalizeText(sessionId),
      transportId: provider.transportId,
      turnOwnership: operationOptions.turnOwnership || null,
      vibe64User: operationOptions.vibe64User || null
    };
    const run = async () => agentOperationResult(
      provider,
      sessionId,
      await provider[method](context, input)
    );
    const identity = normalizeText(coalesceIdentity);
    return identity
      ? coalescedOperation(operationKey(sessionId, provider.id, method, identity), run)
      : run();
  }

  async function callProvider(method = "", input = {}, options = {}) {
    const provider = providerFor(options);
    if (typeof provider[method] !== "function") {
      throw new TypeError(`Assistant provider ${provider.id} does not implement ${method}().`);
    }
    return agentOperationResult(provider, "", await provider[method]({
      providerId: provider.id,
      transportId: provider.transportId
    }, input, options));
  }

  function sessionMethod(method) {
    return (sessionId = "", input = {}, options = {}) => (
      callSessionProvider(method, sessionId, input, options)
    );
  }

  async function closeSession(sessionId = "", options = {}) {
    const id = normalizeText(sessionId);
    const provider = bindSession(id, options);
    const result = typeof provider.closeSession !== "function"
      ? agentOperationResult(provider, id, { closed: false, ok: true })
      : agentOperationResult(provider, id, await provider.closeSession({
          providerId: provider.id,
          sessionId: id,
          transportId: provider.transportId
        }));
    if (result.ok !== false) {
      bindings.delete(id);
    }
    return result;
  }

  return Object.freeze({
    binding(sessionId = "") {
      return bindings.get(normalizeText(sessionId)) || "";
    },
    closeProject(input = {}, options = {}) {
      return callProvider("closeProject", input, options);
    },
    closeSession,
    closeTerminal: sessionMethod("closeTerminal"),
    createConversation: sessionMethod("createConversation"),
    deleteConversation: sessionMethod("deleteConversation"),
    deleteDetachedChatThread: sessionMethod("deleteDetachedChatThread"),
    describeProvider(options = {}) {
      const provider = providerFor(options);
      return Object.freeze({
        providerId: provider.id,
        transportId: provider.transportId
      });
    },
    ensureSession(sessionId = "", options = {}) {
      return callSessionProvider("ensureSession", sessionId, {}, options, {
        coalesceIdentity: "session"
      });
    },
    interruptDetachedChatTurn: sessionMethod("interruptDetachedChatTurn"),
    interruptTurn: sessionMethod("interruptTurn"),
    invalidateRuntimes(input = {}, options = {}) {
      return callProvider("invalidateRuntimes", input, options);
    },
    async reconcileSessions(sessions = [], options = {}) {
      const provider = providerFor(options);
      if (typeof provider.reconcileSessions !== "function") {
        throw new TypeError(`Assistant provider ${provider.id} does not implement reconcileSessions().`);
      }
      return agentOperationResult(provider, "", await provider.reconcileSessions({
        providerId: provider.id,
        transportId: provider.transportId
      }, sessions, options));
    },
    readConversation: sessionMethod("readConversation"),
    readTerminal(sessionId = "", terminalSessionId = "", options = {}) {
      return callSessionProvider("readTerminal", sessionId, { terminalSessionId }, options);
    },
    resizeTerminal(sessionId = "", terminalSessionId = "", size = {}, options = {}) {
      return callSessionProvider("resizeTerminal", sessionId, { size, terminalSessionId }, options);
    },
    runDetachedChatTurn: sessionMethod("runDetachedChatTurn"),
    sendMessage: sessionMethod("sendMessage"),
    sessionState(sessionId = "", options = {}) {
      return callSessionProvider("sessionState", sessionId, {}, options);
    },
    startConversationTurn: sessionMethod("startConversationTurn"),
    startTerminal: sessionMethod("startTerminal"),
    stopConversation: sessionMethod("stopConversation"),
    streamDetachedChatTurn: sessionMethod("streamDetachedChatTurn"),
    subscribeTerminal(sessionId = "", terminalSessionId = "", subscriber = null, options = {}) {
      return callSessionProvider("subscribeTerminal", sessionId, { subscriber, terminalSessionId }, options);
    },
    unsubscribeSessions(sessions = [], options = {}) {
      return callProvider("unsubscribeSessions", sessions, options);
    },
    uploadAttachment: sessionMethod("uploadAttachment"),
    waitForConversationTurn: sessionMethod("waitForConversationTurn"),
    writeTerminal(sessionId = "", terminalSessionId = "", data = "", input = {}, options = {}) {
      return callSessionProvider("writeTerminal", sessionId, { data, input, terminalSessionId }, options);
    }
  });
}

export {
  SESSION_AGENT_PROVIDER_BINDING_CONFLICT_CODE,
  createSessionAgentManager,
  sessionAgentProviderId
};
