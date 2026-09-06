import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";

const VIBE64_ACCOUNTS_CHANGED_EVENT = "vibe64.accounts.changed";
const VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT = "vibe64.accounts.auth-session.changed";
const VIBE64_CONNECTIONS_CHANGED_EVENT = "vibe64.connections.changed";
const VIBE64_ACCOUNT_EVENT_ENTITY = "account";
const VIBE64_ACCOUNT_EVENT_SOURCE = "vibe64";
const VIBE64_ACCOUNT_REALTIME_AUDIENCE = "all_clients";

function normalizeAccountValue(value = "") {
  return String(value || "").trim();
}

function accountIdFromResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  const account = source.account && typeof source.account === "object" && !Array.isArray(source.account)
    ? source.account
    : null;
  return normalizeAccountValue(
    source.accountId ||
    account?.id ||
    (typeof source.account === "string" ? source.account : "") ||
    ""
  );
}

function accountIdFromInput(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  return normalizeAccountValue(source.accountId || "");
}

function authSessionIdFromResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  return normalizeAccountValue(source.id || source.sessionId || "");
}

function accountIdFromExecution({ input = {}, result = {} } = {}) {
  return accountIdFromResult(result) || accountIdFromInput(input) || "accounts";
}

function vibe64AccountsRealtimePayload({ input = {}, result = {} } = {}) {
  const accountId = accountIdFromResult(result) || accountIdFromInput(input);
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  return {
    ...(accountId ? { accountId } : {}),
    ...(typeof source.account?.connected === "boolean" ? { connected: source.account.connected } : {}),
    ...(authSessionIdFromResult(result) ? { authSessionId: authSessionIdFromResult(result) } : {}),
    ...(source.status ? { status: normalizeAccountValue(source.status) } : {})
  };
}

function vibe64ConnectionsRealtimePayload(execution = {}) {
  const payload = vibe64AccountsRealtimePayload(execution);
  return {
    ...payload,
    ...(payload.accountId ? { connectionId: payload.accountId } : {})
  };
}

function vibe64AccountAuthSessionRealtimePayload(session = {}) {
  const source = session && typeof session === "object" && !Array.isArray(session)
    ? session
    : {};
  const accountId = normalizeAccountValue(source.account?.id || source.account || "");
  const sessionId = normalizeAccountValue(source.id || source.sessionId || "");
  return {
    ...(accountId ? { accountId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(source.outputVersion ? { outputVersion: source.outputVersion } : {}),
    ...(source.status ? { status: normalizeAccountValue(source.status) } : {}),
    ...(source.terminalStatus ? { terminalStatus: normalizeAccountValue(source.terminalStatus) } : {})
  };
}

function authSessionRealtimeAudience({ context = {} } = {}) {
  return normalizeAccountValue(context?.actor?.id)
    ? "actor_user"
    : VIBE64_ACCOUNT_REALTIME_AUDIENCE;
}

function vibe64AccountsChangedActionEvent({ operation = "updated" } = {}) {
  return createEntityChangedActionEvent({
    source: VIBE64_ACCOUNT_EVENT_SOURCE,
    entity: VIBE64_ACCOUNT_EVENT_ENTITY,
    operation,
    entityId: accountIdFromExecution,
    realtime: {
      event: VIBE64_ACCOUNTS_CHANGED_EVENT,
      audience: VIBE64_ACCOUNT_REALTIME_AUDIENCE,
      payload: vibe64AccountsRealtimePayload
    }
  });
}

function vibe64AccountAuthSessionChangedActionEvent({ operation = "updated" } = {}) {
  return createEntityChangedActionEvent({
    source: VIBE64_ACCOUNT_EVENT_SOURCE,
    entity: "account-auth-session",
    operation,
    entityId: ({ result = {} } = {}) => authSessionIdFromResult(result),
    realtime: {
      event: VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT,
      audience: authSessionRealtimeAudience,
      payload: ({ result = {} } = {}) => vibe64AccountAuthSessionRealtimePayload(result)
    }
  });
}

function vibe64ConnectionsChangedActionEvent({ operation = "updated" } = {}) {
  return createEntityChangedActionEvent({
    source: VIBE64_ACCOUNT_EVENT_SOURCE,
    entity: "connection",
    operation,
    entityId: accountIdFromExecution,
    realtime: {
      event: VIBE64_CONNECTIONS_CHANGED_EVENT,
      audience: VIBE64_ACCOUNT_REALTIME_AUDIENCE,
      payload: vibe64ConnectionsRealtimePayload
    }
  });
}

function createVibe64AccountsChangedPublisher({ events = null } = {}) {
  if (!events || typeof events.publish !== "function") {
    return async function publishNoop() {
      return null;
    };
  }

  return async function publishVibe64AccountsChanged(accountId = "", {
    actorId = null,
    account = null,
    authSessionId = "",
    operation = "updated",
    reason = "",
    status = ""
  } = {}) {
    const normalizedAccountId = normalizeAccountValue(accountId) || accountIdFromResult({ account });
    if (!normalizedAccountId) {
      return null;
    }
    const result = {
      account: account && typeof account === "object" && !Array.isArray(account)
        ? account
        : {
            id: normalizedAccountId
          },
      ...(authSessionId ? { id: authSessionId } : {}),
      ...(status || resultStatusFromAccount(account) ? { status: status || resultStatusFromAccount(account) } : {})
    };
    const realtimePayload = {
      ...vibe64AccountsRealtimePayload({
        input: {
          accountId: normalizedAccountId
        },
        result
      }),
      ...(reason ? { reason } : {})
    };

    const accountEvent = await events.publish({
      actorId,
      source: VIBE64_ACCOUNT_EVENT_SOURCE,
      entity: VIBE64_ACCOUNT_EVENT_ENTITY,
      operation: normalizeAccountValue(operation) || "updated",
      entityId: normalizedAccountId,
      scope: {
        kind: "global",
        id: null
      },
      occurredAt: new Date().toISOString(),
      realtime: {
        event: VIBE64_ACCOUNTS_CHANGED_EVENT,
        audience: VIBE64_ACCOUNT_REALTIME_AUDIENCE,
        payload: realtimePayload
      },
      type: "entity.changed"
    });
    await events.publish({
      actorId,
      source: VIBE64_ACCOUNT_EVENT_SOURCE,
      entity: "connection",
      operation: normalizeAccountValue(operation) || "updated",
      entityId: normalizedAccountId,
      scope: {
        kind: "global",
        id: null
      },
      occurredAt: new Date().toISOString(),
      realtime: {
        event: VIBE64_CONNECTIONS_CHANGED_EVENT,
        audience: VIBE64_ACCOUNT_REALTIME_AUDIENCE,
        payload: {
          ...realtimePayload,
          connectionId: normalizedAccountId
        }
      },
      type: "entity.changed"
    });
    return accountEvent;
  };
}

function createVibe64ConnectionsChangedPublisher({ events = null } = {}) {
  if (!events || typeof events.publish !== "function") {
    return async function publishNoop() {
      return null;
    };
  }

  return async function publishVibe64ConnectionsChanged(connectionId = "", {
    connected,
    operation = "updated",
    reason = "",
    status = ""
  } = {}) {
    const normalizedConnectionId = normalizeAccountValue(connectionId);
    if (!normalizedConnectionId) {
      return null;
    }
    return events.publish({
      source: VIBE64_ACCOUNT_EVENT_SOURCE,
      entity: "connection",
      operation: normalizeAccountValue(operation) || "updated",
      entityId: normalizedConnectionId,
      scope: {
        kind: "global",
        id: null
      },
      occurredAt: new Date().toISOString(),
      realtime: {
        event: VIBE64_CONNECTIONS_CHANGED_EVENT,
        audience: VIBE64_ACCOUNT_REALTIME_AUDIENCE,
        payload: {
          connectionId: normalizedConnectionId,
          ...(typeof connected === "boolean" ? { connected } : {}),
          ...(reason ? { reason: normalizeAccountValue(reason) } : {}),
          ...(status ? { status: normalizeAccountValue(status) } : {})
        }
      },
      type: "entity.changed"
    });
  };
}

function createVibe64AccountAuthSessionChangedPublisher({ events = null } = {}) {
  if (!events || typeof events.publish !== "function") {
    return async function publishNoop() {
      return null;
    };
  }

  return async function publishVibe64AccountAuthSessionChanged(session = {}, {
    actorId = "",
    operation = "updated",
    reason = ""
  } = {}) {
    const payload = vibe64AccountAuthSessionRealtimePayload(session);
    const normalizedActorId = normalizeAccountValue(actorId);
    if (!payload.sessionId) {
      return null;
    }
    return events.publish({
      source: VIBE64_ACCOUNT_EVENT_SOURCE,
      entity: "account-auth-session",
      operation: normalizeAccountValue(operation) || "updated",
      entityId: payload.sessionId,
      actorId: normalizedActorId || null,
      scope: {
        kind: "global",
        id: null
      },
      occurredAt: new Date().toISOString(),
      realtime: {
        event: VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT,
        audience: normalizedActorId ? "actor_user" : VIBE64_ACCOUNT_REALTIME_AUDIENCE,
        payload: {
          ...payload,
          ...(reason ? { reason } : {})
        }
      },
      type: "entity.changed"
    });
  };
}

function resultStatusFromAccount(account = null) {
  return account && typeof account === "object" && !Array.isArray(account)
    ? normalizeAccountValue(account.status)
    : "";
}

export {
  VIBE64_ACCOUNTS_CHANGED_EVENT,
  VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT,
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  vibe64AccountAuthSessionChangedActionEvent,
  vibe64AccountsChangedActionEvent,
  vibe64ConnectionsChangedActionEvent,
  createVibe64AccountAuthSessionChangedPublisher,
  createVibe64AccountsChangedPublisher,
  createVibe64ConnectionsChangedPublisher
};
