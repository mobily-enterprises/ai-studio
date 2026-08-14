import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  createSessionSource
} from "../../packages/vibe64-terminals/src/server/sessionSource.js";
import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args = []) {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8"
  });
  return result.stdout.trim();
}

async function createProject(targetRoot) {
  await mkdir(targetRoot, { recursive: true });
  await git(targetRoot, ["init", "--initial-branch=main"]);
  await git(targetRoot, ["config", "user.name", "Vibe64 Test"]);
  await git(targetRoot, ["config", "user.email", "vibe64@example.test"]);
  await writeFile(path.join(targetRoot, "app.txt"), "initial\n", "utf8");
  await git(targetRoot, ["add", "app.txt"]);
  await git(targetRoot, ["commit", "-m", "initial"]);
}

function sourceContext(root, sessionId = "session-1") {
  const metadata = {};
  return {
    metadata,
    runtime: {
      projectSessionSourceRoot: path.join(root, "managed-source"),
      targetRoot: path.join(root, "project")
    },
    session: {
      sessionId
    },
    store: {
      async writeMetadataValue(id, name, value) {
        assert.equal(id, sessionId);
        metadata[name] = value;
      }
    }
  };
}

test("Vibe64 creates an isolated Git source for a session", async () => {
  await withTemporaryRoot(async (root) => {
    const context = sourceContext(root);
    await createProject(context.runtime.targetRoot);
    const baseline = await git(context.runtime.targetRoot, ["rev-parse", "HEAD"]);

    const result = await createSessionSource(context);

    assert.equal(result.ok, true);
    assert.equal(result.commit, baseline);
    assert.equal(await git(result.sourcePath, ["branch", "--show-current"]), "vibe64/session-1");
    assert.equal(await git(result.sourcePath, ["rev-parse", "HEAD"]), baseline);
    assert.equal(context.metadata.base_branch, "main");
    assert.equal(context.metadata.base_commit, baseline);
    assert.equal(context.metadata.branch, "vibe64/session-1");
    assert.equal(context.metadata.main_checkout_root, context.runtime.targetRoot);
    assert.equal(context.metadata.source_kind, "session_clone");
    assert.equal(context.metadata.source_path, result.sourcePath);
    assert.equal(context.metadata.source_path_authority, SESSION_SOURCE_PATH_AUTHORITY_MANAGED);
  });
});

test("Vibe64 creates a Git baseline for a new unversioned project", async () => {
  await withTemporaryRoot(async (root) => {
    const context = sourceContext(root, "new-project-session");
    await mkdir(context.runtime.targetRoot, { recursive: true });
    await writeFile(path.join(context.runtime.targetRoot, "README.md"), "New project\n", "utf8");

    const result = await createSessionSource(context);

    assert.equal(result.ok, true);
    assert.match(result.commit, /^[0-9a-f]{40}$/u);
    assert.equal(await git(context.runtime.targetRoot, ["status", "--porcelain"]), "");
    assert.equal(await git(result.sourcePath, ["show", "HEAD:README.md"]), "New project");
  });
});

test("Vibe64 refuses to hide uncommitted project changes in a new session", async () => {
  await withTemporaryRoot(async (root) => {
    const context = sourceContext(root, "dirty-project-session");
    await createProject(context.runtime.targetRoot);
    await writeFile(path.join(context.runtime.targetRoot, "app.txt"), "changed\n", "utf8");

    await assert.rejects(
      createSessionSource(context),
      (error) => error?.code === "vibe64_session_source_project_dirty"
    );
  });
});
