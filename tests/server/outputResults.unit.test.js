import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listOutputResults,
  outputResultsRoot,
  readOutputResult,
  removeOutputResults,
  snapshotDeclaredOutputResults
} from "../../packages/vibe64-terminals/src/server/outputResults.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";

async function outputResultFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-output-results-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const sessionId = "session-output-results";
  const sourceRoot = path.join(root, "sessions", "active", sessionId, "source");
  const sessionRoot = path.join(root, "state", sessionId);
  await mkdir(path.join(sourceRoot, "dist"), { recursive: true });
  await mkdir(sessionRoot, { recursive: true });
  return {
    root,
    session: {
      metadata: {
        source_kind: "session_clone",
        source_path: sourceRoot,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      sessionId,
      sessionRoot
    },
    sourceRoot
  };
}

function download(overrides = {}) {
  return {
    id: "binary",
    mediaType: "application/octet-stream",
    name: "hello",
    path: "dist/hello",
    ...overrides
  };
}

test("output results are immutable snapshots addressed only by generated ids", async (t) => {
  const fixture = await outputResultFixture(t);
  const sourcePath = path.join(fixture.sourceRoot, "dist", "hello");
  await writeFile(sourcePath, "first build\n");

  const captured = await snapshotDeclaredOutputResults({
    downloads: [download()],
    outputTargetId: "build",
    session: fixture.session,
    terminalSessionId: "terminal-1"
  });
  await writeFile(sourcePath, "changed after capture\n");

  assert.equal(captured.captured, true);
  assert.equal(captured.run.outputTargetId, "build");
  assert.equal(captured.results.length, 1);
  assert.doesNotMatch(JSON.stringify(captured), /dist\/hello/u);
  assert.match(captured.results[0].id, /^[0-9a-f-]{36}$/u);

  const opened = await readOutputResult(fixture.session, captured.results[0].id);
  try {
    assert.equal(await opened.fileHandle.readFile("utf8"), "first build\n");
    assert.equal(opened.result.sha256, captured.results[0].sha256);
  } finally {
    await opened.fileHandle.close();
  }

  const storeRoot = outputResultsRoot(fixture.session);
  assert.equal((await stat(storeRoot)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(storeRoot, "index.json"))).mode & 0o777, 0o600);
  const storedRun = JSON.parse(await readFile(path.join(storeRoot, "index.json"), "utf8")).runs[0];
  assert.equal(
    (await stat(path.join(storeRoot, `run-${storedRun.id}`, storedRun.results[0].storageName))).mode & 0o777,
    0o400
  );
});

test("output-result capture is idempotent per terminal and serializes concurrent runs", async (t) => {
  const fixture = await outputResultFixture(t);
  await Promise.all([
    writeFile(path.join(fixture.sourceRoot, "dist", "one"), "one\n"),
    writeFile(path.join(fixture.sourceRoot, "dist", "two"), "two\n")
  ]);

  const [one, two] = await Promise.all([
    snapshotDeclaredOutputResults({
      downloads: [download({ id: "one", name: "one", path: "dist/one" })],
      outputTargetId: "build-one",
      session: fixture.session,
      terminalSessionId: "terminal-one"
    }),
    snapshotDeclaredOutputResults({
      downloads: [download({ id: "two", name: "two", path: "dist/two" })],
      outputTargetId: "build-two",
      session: fixture.session,
      terminalSessionId: "terminal-two"
    })
  ]);
  const duplicate = await snapshotDeclaredOutputResults({
    downloads: [download({ id: "one", name: "one", path: "dist/one" })],
    outputTargetId: "build-one",
    session: fixture.session,
    terminalSessionId: "terminal-one"
  });

  assert.equal(one.captured, true);
  assert.equal(two.captured, true);
  assert.equal(duplicate.captured, false);
  assert.equal(duplicate.run.id, one.run.id);
  assert.deepEqual(
    (await listOutputResults(fixture.session)).map(({ terminalSessionId }) => terminalSessionId).sort(),
    ["terminal-one", "terminal-two"]
  );
});

test("output-result capture rejects traversal, symlinks, and hard links", async (t) => {
  const fixture = await outputResultFixture(t);
  const ordinaryPath = path.join(fixture.sourceRoot, "dist", "ordinary");
  await writeFile(ordinaryPath, "ordinary\n");
  await symlink(ordinaryPath, path.join(fixture.sourceRoot, "dist", "symbolic"));
  await link(ordinaryPath, path.join(fixture.sourceRoot, "dist", "hard-linked"));

  await assert.rejects(
    snapshotDeclaredOutputResults({
      downloads: [download({ path: "../outside" })],
      outputTargetId: "build",
      session: fixture.session,
      terminalSessionId: "terminal-traversal"
    }),
    (error) => error?.code === "vibe64_output_result_path_invalid"
  );
  await assert.rejects(
    snapshotDeclaredOutputResults({
      downloads: [download({ path: "dist/symbolic" })],
      outputTargetId: "build",
      session: fixture.session,
      terminalSessionId: "terminal-symlink"
    }),
    (error) => error?.code === "vibe64_output_result_missing"
  );
  await assert.rejects(
    snapshotDeclaredOutputResults({
      downloads: [download({ path: "dist/hard-linked" })],
      outputTargetId: "build",
      session: fixture.session,
      terminalSessionId: "terminal-hard-link"
    }),
    (error) => error?.code === "vibe64_output_result_not_regular_file"
  );
  assert.deepEqual(await listOutputResults(fixture.session), []);
});

test("output-result removal deletes only the session-owned result store", async (t) => {
  const fixture = await outputResultFixture(t);
  const sourcePath = path.join(fixture.sourceRoot, "dist", "hello");
  await writeFile(sourcePath, "keep source\n");
  await snapshotDeclaredOutputResults({
    downloads: [download()],
    outputTargetId: "build",
    session: fixture.session,
    terminalSessionId: "terminal-cleanup"
  });

  await removeOutputResults(fixture.session);

  await assert.rejects(stat(outputResultsRoot(fixture.session)), { code: "ENOENT" });
  assert.equal(await readFile(sourcePath, "utf8"), "keep source\n");
});
