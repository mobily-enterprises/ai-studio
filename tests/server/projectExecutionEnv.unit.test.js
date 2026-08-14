import assert from "node:assert/strict";
import test from "node:test";

import {
  executionEnvFingerprint,
  loadProjectExecutionEnv,
  loadProjectExecutionEnvRecords,
  normalizeExecutionEnvRecord,
  projectExecutionEnvFromRecords
} from "../../packages/vibe64-terminals/src/server/projectExecutionEnv.js";

test("project execution environment comes from the project service", async () => {
  let request = null;
  const env = await loadProjectExecutionEnv({
    projectService: {
      async projectUserEnvironment(input) {
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
    sourcePath: "/tmp/session-source",
    target: "codex",
    targetRoot: "/tmp/project"
  });

  assert.deepEqual(request, {
    sessionId: "session-1",
    sourcePath: "/tmp/session-source",
    target: "codex",
    targetRoot: "/tmp/project"
  });
  assert.deepEqual(env, {
    DB_PORT: "3306",
    EMPTY: "",
    NAME: "catalog"
  });
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
