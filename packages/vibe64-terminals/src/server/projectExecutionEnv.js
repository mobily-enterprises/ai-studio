import { stableHash } from "@local/vibe64-execution/server";

function normalizeExecutionEnvRecord(env = {}) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [
    String(key || "").trim(),
    String(value ?? "")
  ]).filter(([key]) => Boolean(key)));
}

function executionEnvFingerprint(env = {}) {
  return stableHash(JSON.stringify(Object.entries(normalizeExecutionEnvRecord(env))
    .sort(([left], [right]) => left.localeCompare(right))));
}

async function loadProjectExecutionEnvRecords({
  projectService = {},
  session = {},
  target = ""
} = {}) {
  if (typeof projectService.projectExecutionEnvironment !== "function") {
    return {
      runtimeConfigEnv: {}
    };
  }
  const sessionId = String(session?.sessionId || session?.id || "").trim();
  const env = await projectService.projectExecutionEnvironment({
    ...(sessionId ? { sessionId } : {}),
    target: String(target || "").trim()
  });
  return {
    runtimeConfigEnv: normalizeExecutionEnvRecord(env)
  };
}

function projectExecutionEnvFromRecords({
  runtimeConfigEnv = {}
} = {}) {
  return normalizeExecutionEnvRecord(runtimeConfigEnv);
}

async function loadProjectExecutionEnv(input = {}) {
  return projectExecutionEnvFromRecords(await loadProjectExecutionEnvRecords(input));
}

export {
  executionEnvFingerprint,
  loadProjectExecutionEnv,
  loadProjectExecutionEnvRecords,
  normalizeExecutionEnvRecord,
  projectExecutionEnvFromRecords
};
