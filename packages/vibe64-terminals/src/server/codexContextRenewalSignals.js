import {
  normalizeText
} from "@local/vibe64-core/server/core";

const CONTEXT_COMPACTION_REASON = "context_compacted";
const CODEX_TOKEN_USAGE_METHOD = "thread/tokenUsage/updated";

function nonNegativeInteger(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function contextCompactionKey({
  eventId = "",
  reason = "",
  threadId = "",
  turnId = ""
} = {}) {
  const fields = [reason, threadId, turnId, eventId].map(normalizeText);
  return fields.slice(1).some(Boolean) ? fields.join(":") : "";
}

function codexContextUsageFromNotification(notification = {}) {
  if (normalizeText(notification?.method) !== CODEX_TOKEN_USAGE_METHOD) {
    return null;
  }
  const params = notification?.params && typeof notification.params === "object"
    ? notification.params
    : {};
  const tokenUsage = params.tokenUsage && typeof params.tokenUsage === "object"
    ? params.tokenUsage
    : {};
  const last = tokenUsage.last && typeof tokenUsage.last === "object"
    ? tokenUsage.last
    : {};
  const total = tokenUsage.total && typeof tokenUsage.total === "object"
    ? tokenUsage.total
    : {};
  const usedTokens = nonNegativeInteger(last.totalTokens);
  const inputTokens = nonNegativeInteger(last.inputTokens);
  const cumulativeTokens = nonNegativeInteger(total.totalTokens);
  const windowTokens = nonNegativeInteger(tokenUsage.modelContextWindow);
  const threadId = normalizeText(params.threadId);
  const turnId = normalizeText(params.turnId);
  if (
    !threadId ||
    !turnId ||
    usedTokens === null ||
    inputTokens === null ||
    cumulativeTokens === null ||
    !windowTokens ||
    usedTokens > windowTokens ||
    inputTokens > usedTokens ||
    cumulativeTokens < usedTokens
  ) {
    return null;
  }
  return Object.freeze({
    cumulativeTokens,
    inputTokens,
    threadId,
    turnId,
    usedTokens,
    windowTokens
  });
}

async function recordCodexContextUsageSignal(store, sessionId = "", notification = {}, {
  at = new Date().toISOString(),
  expectedThreadId = ""
} = {}) {
  const id = normalizeText(sessionId);
  const usage = codexContextUsageFromNotification(notification);
  const threadId = normalizeText(expectedThreadId);
  if (
    !id ||
    !usage ||
    !threadId ||
    usage.threadId !== threadId ||
    typeof store?.mutateSession !== "function"
  ) {
    return null;
  }
  const recordedAt = normalizeText(at) || new Date().toISOString();
  return store.mutateSession(id, async () => {
    const currentThreadId = normalizeText(
      await store.readMetadataValue(id, "agent_identity_conversation_id")
    );
    const previousThreadId = normalizeText(
      await store.readMetadataValue(id, "agent_context_usage_thread_id")
    );
    const previousCumulativeTokens = nonNegativeInteger(
      await store.readMetadataValue(id, "agent_context_usage_cumulative_tokens")
    );
    if (currentThreadId !== usage.threadId) {
      return null;
    }
    if (
      previousThreadId === usage.threadId &&
      previousCumulativeTokens !== null &&
      usage.cumulativeTokens <= previousCumulativeTokens
    ) {
      return null;
    }
    await Promise.all([
      store.writeMetadataValue(
        id,
        "agent_context_usage_cumulative_tokens",
        String(usage.cumulativeTokens)
      ),
      store.writeMetadataValue(id, "agent_context_input_tokens", String(usage.inputTokens)),
      store.writeMetadataValue(id, "agent_context_usage_provider", "codex"),
      store.writeMetadataValue(id, "agent_context_usage_thread_id", usage.threadId),
      store.writeMetadataValue(id, "agent_context_usage_turn_id", usage.turnId),
      store.writeMetadataValue(id, "agent_context_usage_updated_at", recordedAt),
      store.writeMetadataValue(id, "agent_context_used_tokens", String(usage.usedTokens)),
      store.writeMetadataValue(id, "agent_context_window_tokens", String(usage.windowTokens))
    ]);
    return {
      ...usage,
      at: recordedAt,
      exact: true,
      providerId: "codex"
    };
  });
}

async function recordCodexContextRenewalSignal(store, sessionId = "", {
  at = new Date().toISOString(),
  eventId = "",
  reason = "",
  threadId = "",
  turnId = ""
} = {}) {
  const id = normalizeText(sessionId);
  const normalizedReason = normalizeText(reason);
  if (
    !id ||
    normalizedReason !== CONTEXT_COMPACTION_REASON ||
    typeof store?.mutateSession !== "function"
  ) {
    return null;
  }
  const key = contextCompactionKey({
    eventId,
    reason: normalizedReason,
    threadId,
    turnId
  });
  if (!key) {
    return null;
  }
  return store.mutateSession(id, async () => {
    const previousKey = normalizeText(
      await store.readMetadataValue(id, "agent_context_compaction_last_key")
    );
    const previousCount = nonNegativeInteger(
      await store.readMetadataValue(id, "agent_context_compaction_count")
    );
    if (previousKey === key) {
      return {
        at: normalizeText(await store.readMetadataValue(id, "agent_context_compaction_last_at")),
        count: previousCount,
        duplicate: true,
        key
      };
    }
    const count = Math.min(Number.MAX_SAFE_INTEGER, previousCount + 1);
    const recordedAt = normalizeText(at) || new Date().toISOString();
    await Promise.all([
      store.writeMetadataValue(id, "agent_context_compaction_count", String(count)),
      store.writeMetadataValue(id, "agent_context_compaction_last_at", recordedAt),
      store.writeMetadataValue(id, "agent_context_compaction_last_key", key)
    ]);
    return {
      at: recordedAt,
      count,
      duplicate: false,
      key
    };
  });
}

export {
  CONTEXT_COMPACTION_REASON,
  codexContextUsageFromNotification,
  contextCompactionKey,
  recordCodexContextRenewalSignal,
  recordCodexContextUsageSignal
};
