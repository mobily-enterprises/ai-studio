import assert from "node:assert/strict";
import test from "node:test";

import {
  executionEnvFingerprint,
  loadProjectExecutionEnv,
  loadProjectExecutionEnvRecords,
  normalizeExecutionEnvRecord,
  projectExecutionEnvFromRecords
} from "../../packages/vibe64-terminals/src/server/projectExecutionEnv.js";

test("environment reads use inspection without preparing project resources", async () => {
  let request = null;
  const env = await loadProjectExecutionEnv({
    projectService: {
      async projectExecutionEnvironment() {
        assert.fail("Reading environment must not provision resources or write files.");
      },
      async projectInspectionEnvironment(input) {
        request = input;
        return {
          DB_PORT: 3306,
          EMPTY: null,
          NAME: "catalog"
        };
      }
    },
    session: {
      sessionId: "session-1"
    },
    target: "codex"
  });

  assert.deepEqual(request, {
    sessionId: "session-1",
    session: {
      sessionId: "session-1"
    },
    target: "codex"
  });
  assert.deepEqual(env, {
    DB_PORT: "3306",
    EMPTY: "",
    NAME: "catalog"
  });
});

test("execution startup explicitly prepares the project environment", async () => {
  const env = await loadProjectExecutionEnv({
    prepare: true,
    projectService: {
      async projectInspectionEnvironment() {
        assert.fail("Startup must prepare its environment.");
      },
      async projectExecutionEnvironment(input) {
        assert.equal(input.sessionId, "session-1");
        return { READY: "yes" };
      }
    },
    session: { sessionId: "session-1" }
  });
  assert.deepEqual(env, { READY: "yes" });
});

test("project execution environment is empty when the project declares none", async () => {
  assert.deepEqual(await loadProjectExecutionEnv({}), {});
  assert.deepEqual(await loadProjectExecutionEnvRecords({}), {
    runtimeConfigEnv: {}
  });
});

test("execution environment normalization keeps only named scalar entries", () => {
  assert.deepEqual(normalizeExecutionEnvRecord({
    "": "ignored",
    COUNT: 2,
    NULL: null,
    VALUE: "yes"
  }), {
    COUNT: "2",
    NULL: "",
    VALUE: "yes"
  });
  assert.deepEqual(normalizeExecutionEnvRecord(null), {});
  assert.deepEqual(projectExecutionEnvFromRecords({
    runtimeConfigEnv: {
      VALUE: "yes"
    }
  }), {
    VALUE: "yes"
  });
});

test("execution environment fingerprints are order-independent", () => {
  const first = executionEnvFingerprint({
    A: "1",
    B: "2"
  });
  assert.equal(first, executionEnvFingerprint({
    B: "2",
    A: "1"
  }));
  assert.notEqual(first, executionEnvFingerprint({
    A: "1",
    B: "3"
  }));
});
