import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createService } from "../../packages/vibe64-project/src/server/service.js";
import { createStudioProjectContext } from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import { addGenesisStack, applyGenesisTemplate, initializeGenesisProject } from "../../packages/vibe64-genesis/src/server/index.js";
import { sourceMetadata, sourcePath, withTemporaryRoot } from "./vibe64TestHelpers.js";

const exec = promisify(execFile);
const sessionId = "2026-09-06_10-00-00";

async function fixture(targetRoot) {
  const templateRoot = path.join(path.dirname(targetRoot), "template");
  const root = sourcePath(targetRoot, sessionId);
  for (const cwd of [templateRoot, root]) {
    await mkdir(cwd, { recursive: true });
    await exec("git", ["init", "--quiet", "--initial-branch=public"], { cwd });
    await initializeGenesisProject({ projectRoot: cwd });
  }
  await addGenesisStack({ projectRoot: templateRoot, pieces: ["nodejs"] });
  await writeFile(path.join(templateRoot, "genesis/blueprint.md"), "# Blueprint\n\nA command line starter.\n");
  await writeFile(path.join(templateRoot, "app.js"), "console.log('ready');\n");
  await exec("git", ["add", "-A"], { cwd: templateRoot });
  await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--quiet", "-m", "Starter"], { cwd: templateRoot });
  const catalog = { schemaVersion: 1, templates: [{ id: "nodejs/public", technology: "nodejs", name: "Test", repository: templateRoot, branch: "public" }] };
  const service = createService({
    env: {},
    projectContext: createStudioProjectContext({
      explicitManagedSourceRoot: path.join(path.dirname(targetRoot), "managed-source"),
      explicitSystemRoot: path.join(path.dirname(targetRoot), "system"),
      explicitTargetRoot: targetRoot,
      home: path.dirname(targetRoot)
    }),
    applyTemplate: (input) => applyGenesisTemplate({ ...input, templateSources: [{ namespace: "test", catalog }] })
  });
  const store = await service.createSessionStore();
  await store.createSession({ sessionId, metadata: sourceMetadata(targetRoot, sessionId) });
  return { root, service, store };
}

test("an empty session offers starters and applies only the configured selection into that session", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service } = await fixture(targetRoot);
    const before = await service.readOnboarding({ sessionId });
    assert.equal(before.ok, true);
    assert.equal(before.inspection.state, "new");
    assert.deepEqual(before.templates.map(({ id }) => id), ["official:jskit/public", "official:jskit/accounts"]);
    const result = await service.applyTemplate({ sessionId, templateId: "test:nodejs/public", repository: "/untrusted-browser-input", branch: "wrong" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.inspection.state, "ready");
    assert.equal(await readFile(path.join(root, "app.js"), "utf8"), "console.log('ready');\n");
    await assert.rejects(readFile(path.join(targetRoot, "app.js")), { code: "ENOENT" });
    assert.equal((await service.applyTemplate({ sessionId, templateId: "test:nodejs/public" })).ok, false);
  });
});

test("existing source is adoption and a stale template request preserves it", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service } = await fixture(targetRoot);
    await writeFile(path.join(root, "application.unknown"), "mature implementation");
    const opening = await service.readOnboarding({ sessionId });
    assert.equal(opening.inspection.state, "adoption");
    assert.deepEqual(opening.templates, []);
    const result = await service.applyTemplate({ sessionId, templateId: "test:nodejs/public" });
    assert.equal(result.ok, false);
    assert.equal(await readFile(path.join(root, "application.unknown"), "utf8"), "mature implementation");
    await assert.rejects(readFile(path.join(root, "app.js")), { code: "ENOENT" });
  });
});

test("template application requires an explicit open session and shares the agent write lock", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const { root, service, store } = await fixture(targetRoot);
    assert.equal((await service.applyTemplate({ templateId: "test:nodejs/public" })).ok, false);
    let release;
    let entered;
    const gate = new Promise((resolve) => { release = resolve; });
    const ready = new Promise((resolve) => { entered = resolve; });
    const holding = store.runSessionExclusive(sessionId, "agent-write-mode", async () => {
      entered();
      await gate;
    });
    await ready;
    try {
      const result = await service.applyTemplate({ sessionId, templateId: "test:nodejs/public" });
      assert.equal(result.ok, false);
      assert.equal(result.code, "vibe64_agent_write_mode_busy");
      await assert.rejects(readFile(path.join(root, "app.js")), { code: "ENOENT" });
    } finally {
      release();
      await holding;
    }
  });
});
