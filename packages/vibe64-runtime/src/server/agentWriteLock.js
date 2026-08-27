const VIBE64_AGENT_WRITE_LOCK = "agent-write-mode";

const VIBE64_AGENT_WRITE_BUSY_RESULT = Object.freeze({
  code: "vibe64_agent_write_mode_busy",
  error: "Another assistant operation is starting. Try again in a moment.",
  ok: false,
  retryable: true
});

async function runVibe64AgentWriteExclusive(runtime, sessionId = "", operation, options = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("Exclusive Vibe64 agent work requires an operation.");
  }
  if (typeof runtime?.store?.runSessionExclusive !== "function") {
    return {
      acquired: true,
      value: await operation()
    };
  }
  const exclusive = await runtime.store.runSessionExclusive(
    sessionId,
    VIBE64_AGENT_WRITE_LOCK,
    operation,
    options
  );
  return exclusive.acquired
    ? exclusive
    : {
        acquired: false,
        value: VIBE64_AGENT_WRITE_BUSY_RESULT
      };
}

async function runVibe64RenewalAgentWriteExclusive(runtime, sessionId = "", operation) {
  if (typeof operation !== "function") {
    throw new TypeError("Exclusive Vibe64 renewal agent work requires an operation.");
  }
  if (typeof runtime?.store?.runSessionExclusiveForRenewal !== "function") {
    throw new TypeError("Exclusive Vibe64 renewal agent work requires the private renewal lock boundary.");
  }
  const exclusive = await runtime.store.runSessionExclusiveForRenewal(
    sessionId,
    VIBE64_AGENT_WRITE_LOCK,
    operation
  );
  return exclusive.acquired
    ? exclusive
    : {
        acquired: false,
        value: VIBE64_AGENT_WRITE_BUSY_RESULT
      };
}

export {
  runVibe64AgentWriteExclusive,
  runVibe64RenewalAgentWriteExclusive
};
