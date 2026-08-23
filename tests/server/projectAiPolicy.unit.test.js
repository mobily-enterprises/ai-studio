import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  PROJECT_AI_POLICY_CUSTOM_NOTE_MAX_LENGTH,
  defaultProjectAiPolicy,
  normalizeProjectAiPolicy,
  projectAiPolicyPath,
  readProjectAiPolicy,
  saveProjectAiPolicy
} from "@local/vibe64-core/server/projectAiPolicy";
import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const playfulPolicy = {
  customNote: "Celebrate useful milestones.",
  expertise: "expert",
  promptHints: false,
  rationale: "conclusions",
  responseLength: "very_short",
  tone: "playful"
};

test("project AI policy has stable defaults without creating state", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectRuntimeRoot = path.join(temporaryRoot, "state", "projects", "catalogue");
    const result = await readProjectAiPolicy({ projectRuntimeRoot });

    assert.deepEqual(result.policy, defaultProjectAiPolicy());
    assert.equal(result.filePath, projectAiPolicyPath(projectRuntimeRoot));
    await assert.rejects(stat(result.filePath), { code: "ENOENT" });
  });
});

test("project AI policy normalizes bounded text and rejects invalid fields", () => {
  assert.deepEqual(normalizeProjectAiPolicy({
    customNote: "  First line\r\nSecond line  "
  }), {
    customNote: "First line\nSecond line",
    expertise: "comfortable",
    promptHints: true,
    rationale: "concise",
    responseLength: "concise",
    tone: "encouraging"
  });

  assert.throws(
    () => normalizeProjectAiPolicy({ tone: "sarcastic" }),
    { code: "vibe64_project_ai_policy_invalid" }
  );
  assert.throws(
    () => normalizeProjectAiPolicy({ promptHints: "yes" }),
    { code: "vibe64_project_ai_policy_invalid" }
  );
  assert.throws(
    () => normalizeProjectAiPolicy({ unexpected: true }),
    { code: "vibe64_project_ai_policy_invalid" }
  );
  assert.throws(
    () => normalizeProjectAiPolicy({
      customNote: "x".repeat(PROJECT_AI_POLICY_CUSTOM_NOTE_MAX_LENGTH + 1)
    }),
    { code: "vibe64_project_ai_policy_invalid" }
  );
});

test("project AI policy saves atomically with a durable revision", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
    const saved = await saveProjectAiPolicy({
      now: () => new Date("2026-08-24T01:02:03.000Z"),
      policy: playfulPolicy,
      projectRuntimeRoot
    });

    assert.deepEqual(saved.policy, {
      ...playfulPolicy,
      revision: 1,
      updatedAt: "2026-08-24T01:02:03.000Z",
      version: 1
    });
    assert.deepEqual((await readProjectAiPolicy({ projectRuntimeRoot })).policy, saved.policy);
    assert.equal((await stat(saved.filePath)).mode & 0o777, 0o660);
    assert.deepEqual(JSON.parse(await readFile(saved.filePath, "utf8")), saved.policy);
  });
});

test("project AI policy serializes concurrent saves without losing revisions", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
    const saved = await Promise.all([
      saveProjectAiPolicy({
        policy: playfulPolicy,
        projectRuntimeRoot
      }),
      saveProjectAiPolicy({
        policy: {
          ...playfulPolicy,
          tone: "direct"
        },
        projectRuntimeRoot
      })
    ]);

    assert.deepEqual(saved.map((entry) => entry.policy.revision).sort(), [1, 2]);
    assert.equal((await readProjectAiPolicy({ projectRuntimeRoot })).policy.revision, 2);
  });
});

test("project AI policy rejects malformed or incompatible stored state", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
    const filePath = projectAiPolicyPath(projectRuntimeRoot);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "not-json\n", "utf8");
    await assert.rejects(
      readProjectAiPolicy({ projectRuntimeRoot }),
      { code: "vibe64_project_ai_policy_invalid" }
    );

    await writeFile(filePath, `${JSON.stringify({
      ...playfulPolicy,
      revision: 1,
      updatedAt: "2026-08-24T01:02:03.000Z",
      version: 2
    })}\n`, "utf8");
    await assert.rejects(
      readProjectAiPolicy({ projectRuntimeRoot }),
      { code: "vibe64_project_ai_policy_version_unsupported" }
    );

    const { customNote: _missing, ...incompletePolicy } = playfulPolicy;
    await writeFile(filePath, `${JSON.stringify({
      ...incompletePolicy,
      revision: 1,
      updatedAt: "2026-08-24T01:02:03.000Z",
      version: 1
    })}\n`, "utf8");
    await assert.rejects(
      readProjectAiPolicy({ projectRuntimeRoot }),
      { code: "vibe64_project_ai_policy_invalid" }
    );
  });
});
