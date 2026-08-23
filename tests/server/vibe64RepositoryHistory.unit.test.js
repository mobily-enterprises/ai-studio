import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  inspectRepositoryHistory,
  repositoryReadContext,
  repositoryVersionFileDiff,
  repositoryVersionFiles
} from "../../packages/vibe64-terminals/src/server/repositoryHistory.js";

const execFileAsync = promisify(execFile);
const identity = {
  GIT_AUTHOR_EMAIL: "history@example.test",
  GIT_AUTHOR_NAME: "History Test",
  GIT_COMMITTER_EMAIL: "history@example.test",
  GIT_COMMITTER_NAME: "History Test"
};

async function git(cwd, args) {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...identity }
  });
  return String(result.stdout || "").trim();
}

async function commandRunner(request = {}) {
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args || [], {
      cwd: request.cwd,
      env: { ...process.env, ...identity, ...(request.env || {}) }
    });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", (error) => resolve({ error: error.message, ok: false, stderr, stdout }));
    child.once("close", (code) => resolve({ ok: code === 0, exitCode: code, stderr, stdout }));
    child.stdin.end(request.input ?? undefined);
  });
}

function localProject(root) {
  return {
    repository: { defaultBranch: "main", mode: "local_source" },
    repositoryMode: "local_source",
    sourceRoot: root
  };
}

test("a session without a source never falls through to a project repository cache", () => {
  assert.throws(() => repositoryReadContext({
    githubMirrorPath: "/missing/github-mirror/repository.git",
    path: "/project",
    repository: { defaultBranch: "main", mode: "github" },
    repositoryMode: "github"
  }, {
    metadata: { base_branch: "main" },
    sessionId: "session-1"
  }), (error) => error.code === "vibe64_repository_history_session_source_missing");
});

test("hosted history uses repository storage and never the hosted namespace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-hosted-history-"));
  const hostedNamespace = path.join(root, "namespace");
  const repositoryStorageRoot = path.join(root, "runtime", "github-mirror");
  const repositoryPath = path.join(repositoryStorageRoot, "repository.git");
  try {
    await mkdir(path.join(hostedNamespace, ".git"), { recursive: true });
    await writeFile(path.join(hostedNamespace, ".git", "HOSTILE"), "untouched\n", "utf8");
    await mkdir(repositoryStorageRoot, { recursive: true });
    await git(repositoryStorageRoot, ["init", "--bare", repositoryPath]);

    const requests = [];
    const context = repositoryReadContext({
      githubMirrorPath: repositoryPath,
      path: hostedNamespace,
      projectRoot: hostedNamespace,
      repository: { defaultBranch: "main", mode: "github" },
      repositoryMode: "github"
    });
    assert.equal(context.cwd, repositoryStorageRoot);
    assert.equal(context.executionRoot, repositoryStorageRoot);

    await assert.rejects(inspectRepositoryHistory({
      project: {
        githubMirrorPath: repositoryPath,
        path: hostedNamespace,
        projectRoot: hostedNamespace,
        repository: { defaultBranch: "main", mode: "github" },
        repositoryMode: "github"
      },
      runCommand: async (request) => {
        requests.push(request);
        return { ok: false, stderr: "missing branch" };
      }
    }));
    assert.ok(requests.length > 0);
    assert.ok(requests.every((request) => request.cwd !== hostedNamespace));
    assert.ok(requests.every((request) => !request.allowedRoots.includes(hostedNamespace)));
    assert.equal(await readFile(path.join(hostedNamespace, ".git", "HOSTILE"), "utf8"), "untouched\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("version history pins pagination and exposes bounded per-version files and diffs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-history-"));
  const managedSourceRoot = `${root}-managed-sources`;
  try {
    await git(root, ["init", "--initial-branch=main"]);
    await writeFile(path.join(root, "first.txt"), "first\n", "utf8");
    await git(root, ["add", "first.txt"]);
    await git(root, ["commit", "-m", "first version"]);
    const rootCommit = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(path.join(root, "second.txt"), "second\n", "utf8");
    await git(root, ["add", "second.txt"]);
    await git(root, ["commit", "-m", "<script>not markup</script>"]);
    const secondCommit = await git(root, ["rev-parse", "HEAD"]);
    const sessionSourceRoot = path.join(managedSourceRoot, "sessions", "active", "session-1", "source");
    await mkdir(path.dirname(sessionSourceRoot), { recursive: true });
    await git(path.dirname(sessionSourceRoot), ["clone", root, sessionSourceRoot]);

    const firstPage = await inspectRepositoryHistory({
      limit: 1,
      project: localProject(root),
      runCommand: commandRunner
    });
    assert.equal(firstPage.versions.length, 1);
    assert.equal(firstPage.versions[0].commit, secondCommit);
    assert.equal(firstPage.versions[0].message, "<script>not markup</script>");
    assert.equal(firstPage.hasMore, true);

    await writeFile(path.join(root, "later.txt"), "later\n", "utf8");
    await git(root, ["add", "later.txt"]);
    await git(root, ["commit", "-m", "later version"]);

    const sessionHistory = await inspectRepositoryHistory({
      project: localProject(root),
      runCommand: commandRunner,
      session: {
        metadata: {
          base_branch: "main",
          base_commit: rootCommit,
          canonical_commit: secondCommit,
          repository_mode: "local_source",
          source_kind: "session_clone",
          source_path: sessionSourceRoot,
          source_path_authority: "managed_session_source"
        },
        projectContextRoot: root,
        sessionId: "session-1",
        sessionRoot: path.join(path.dirname(root), "runtime", "session-1"),
        sourcePath: sessionSourceRoot
      }
    });
    assert.equal(sessionHistory.historySnapshotCommit, secondCommit);
    assert.equal(sessionHistory.versions[0].commit, secondCommit);

    const secondPage = await inspectRepositoryHistory({
      cursor: firstPage.nextCursor,
      limit: 1,
      project: localProject(root),
      runCommand: commandRunner
    });
    assert.equal(secondPage.historySnapshotCommit, secondCommit);
    assert.equal(secondPage.versions[0].commit, rootCommit);

    const files = await repositoryVersionFiles({
      commit: rootCommit,
      historySnapshotCommit: firstPage.historySnapshotCommit,
      project: localProject(root),
      runCommand: commandRunner
    });
    assert.deepEqual(files.files, [{
      added: 1,
      deleted: 0,
      path: "first.txt",
      status: "A"
    }]);

    const diff = await repositoryVersionFileDiff({
      commit: rootCommit,
      historySnapshotCommit: firstPage.historySnapshotCommit,
      path: "first.txt",
      project: localProject(root),
      runCommand: commandRunner
    });
    assert.match(diff.diff, /\+first/u);

    const unrelated = await git(root, ["commit-tree", `${rootCommit}^{tree}`, "-m", "unrelated"]);
    await assert.rejects(repositoryVersionFiles({
      commit: unrelated,
      historySnapshotCommit: firstPage.historySnapshotCommit,
      project: localProject(root),
      runCommand: commandRunner
    }), (error) => error.code === "vibe64_repository_history_commit_unreachable");
    await assert.rejects(repositoryVersionFiles({
      commit: "HEAD",
      historySnapshotCommit: firstPage.historySnapshotCommit,
      project: localProject(root),
      runCommand: commandRunner
    }), (error) => error.code === "vibe64_repository_history_commit_invalid");
    await assert.rejects(repositoryVersionFiles({
      commit: rootCommit,
      historySnapshotCommit: "refs/heads/main",
      project: localProject(root),
      runCommand: commandRunner
    }), (error) => error.code === "vibe64_repository_history_snapshot_invalid");
  } finally {
    await Promise.all([
      rm(root, { force: true, recursive: true }),
      rm(managedSourceRoot, { force: true, recursive: true })
    ]);
  }
});
