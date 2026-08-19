import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  checkSessionUpdates,
  inspectSessionChangeDiff,
  inspectSessionChanges,
  inspectSessionWork,
  recoverSessionWorkUpdate,
  recoverSessionWorkSave,
  saveSessionWork as saveSessionWorkImplementation,
  updateSessionWork
} from "../../packages/vibe64-terminals/src/server/sessionWorkSave.js";
import {
  canonicalRepositoryBackupPath,
  canonicalRepositoryInitializeScript,
  canonicalRepositoryInstallRefScript
} from "../../packages/vibe64-execution/src/server/repositoryStorage.js";

const execFileAsync = promisify(execFile);

async function git(cwd, args, input = undefined) {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "vibe64@example.test",
      GIT_AUTHOR_NAME: "Vibe64 Test",
      GIT_COMMITTER_EMAIL: "vibe64@example.test",
      GIT_COMMITTER_NAME: "Vibe64 Test"
    },
    input
  });
  return String(result.stdout || "").trim();
}

async function commandRunner(request = {}) {
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args || [], {
      cwd: request.cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_EMAIL: "vibe64@example.test",
        GIT_AUTHOR_NAME: "Vibe64 Test",
        GIT_COMMITTER_EMAIL: "vibe64@example.test",
        GIT_COMMITTER_NAME: "Vibe64 Test",
        ...(request.env || {})
      }
    });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", (error) => resolve({
      code: "git_failed",
      error: error.message,
      ok: false,
      output: `${stdout}${stderr}`,
      stderr,
      stdout
    }));
    child.once("close", (code) => resolve({
      ...(code === 0 ? {} : { code: "git_failed" }),
      ok: code === 0,
      output: stdout,
      stderr,
      stdout
    }));
    if (request.input !== undefined && request.input !== null) {
      child.stdin.end(request.input);
    } else {
      child.stdin.end();
    }
  });
}

function saveSessionWork(input = {}) {
  return saveSessionWorkImplementation({
    message: "Improve tested project behavior",
    ...input
  });
}

async function createRemoteFixture(root) {
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  await git(root, ["init", "--bare", "--initial-branch=main", remote]);
  await git(root, ["clone", remote, seed]);
  await writeFile(path.join(seed, "shared.txt"), "initial\n", "utf8");
  await git(seed, ["add", "shared.txt"]);
  await git(seed, ["commit", "-m", "initial"]);
  await git(seed, ["push", "origin", "main"]);
  return {
    baseCommit: await git(seed, ["rev-parse", "HEAD"]),
    remote,
    seed
  };
}

async function sessionForRemote(root, fixture, id = "session-1") {
  const source = path.join(root, id);
  await git(root, ["clone", "--branch", "main", fixture.remote, source]);
  await git(source, ["checkout", "-b", `vibe64/${id}`]);
  return {
    metadata: {
      base_branch: "main",
      base_commit: fixture.baseCommit,
      branch: `vibe64/${id}`,
      source_path: source,
      source_remote_url: fixture.remote
    },
    sessionId: id,
    sourcePath: source
  };
}

function githubProject(root, remote) {
  return {
    githubRepository: {
      cloneUrl: remote
    },
    path: path.join(root, "project-cache"),
    repository: {
      defaultBranch: "main",
      mode: "github"
    },
    repositoryMode: "github"
  };
}

function runScript(script = "", cwd = "") {
  return execFileAsync("bash", ["-lc", script], {
    cwd,
    encoding: "utf8"
  });
}

function managedGitProject(root, canonicalRepositoryPath) {
  return {
    canonicalRepositoryPath,
    path: path.join(root, "project-cache"),
    repository: {
      defaultBranch: "main",
      mode: "managed_git"
    },
    repositoryMode: "managed_git"
  };
}

test("work inspection compares the complete session tree with its verified canonical base", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "committed-locally.txt"), "session work\n", "utf8");
    await git(session.sourcePath, ["add", "committed-locally.txt"]);
    await git(session.sourcePath, ["commit", "-m", "local session commit"]);

    const result = await inspectSessionWork({
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(result.ok, true);
    assert.equal(result.repositoryMode, "github");
    assert.equal(result.canonicalCommit, fixture.baseCommit);
    assert.equal(result.sessionHead, await git(session.sourcePath, ["rev-parse", "HEAD"]));
    assert.equal(result.dirty, false, "the working tree itself is clean");
    assert.equal(result.unsaved, true, "the complete session tree still differs from canonical");
    assert.equal(result.ahead, 1);
    assert.equal(result.behind, 0);
    assert.equal(result.updateAvailable, false);
    assert.deepEqual(result.changedPaths, ["committed-locally.txt"]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("current changes returns a bounded canonical file list and one selected-file diff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "shared.txt"), "changed\n", "utf8");
    await writeFile(path.join(session.sourcePath, "new file.txt"), "new\n", "utf8");

    const changes = await inspectSessionChanges({
      limit: 1,
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(changes.unsaved, true);
    assert.equal(changes.totalCount, 2);
    assert.equal(changes.files.length, 1);
    assert.equal(changes.truncated, true);
    assert.deepEqual(changes.files[0], {
      added: 1,
      deleted: 0,
      path: "new file.txt",
      status: "A"
    });

    const fileDiff = await inspectSessionChangeDiff({
      path: "shared.txt",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(fileDiff.path, "shared.txt");
    assert.match(fileDiff.diff, /-initial/u);
    assert.match(fileDiff.diff, /\+changed/u);
    assert.equal(fileDiff.truncated, false);

    await assert.rejects(inspectSessionChangeDiff({
      path: "../outside.txt",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    }), (error) => error.code === "vibe64_session_change_path_invalid");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Update preserves unsaved session work while advancing to newer GitHub work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "remote.txt"), "remote\n", "utf8");
    await git(canonicalWriter, ["add", "remote.txt"]);
    await git(canonicalWriter, ["commit", "-m", "remote advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await writeFile(path.join(session.sourcePath, "local.txt"), "local\n", "utf8");

    const check = await checkSessionUpdates({
      operationId: "check-github-update",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(check.behind, 1);
    assert.equal(check.ahead, 0);
    assert.equal(check.relationship, "behind");
    assert.equal(check.updateStrategy, "rebase");
    assert.equal(check.updateAvailable, true);
    assert.equal(check.incomingVersions.length, 1);
    assert.equal(check.incomingVersions[0].commit, canonicalCommit);
    assert.equal(check.incomingVersions[0].message, "remote advance");
    assert.equal(check.incomingVersionsTruncated, false);

    const result = await updateSessionWork({
      operationId: "apply-github-update",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(result.status, "updated");
    assert.equal(result.canonicalCommit, canonicalCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "remote.txt"), "utf8"), "remote\n");
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");
    assert.match(await git(session.sourcePath, ["status", "--porcelain"]), /local\.txt/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Update check distinguishes diverged history from a normal fast-forward", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "session-commit.txt"), "session\n", "utf8");
    await git(session.sourcePath, ["add", "session-commit.txt"]);
    await git(session.sourcePath, ["commit", "-m", "session commit"]);

    const canonicalWriter = path.join(root, "canonical-writer-diverged");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "remote-commit.txt"), "remote\n", "utf8");
    await git(canonicalWriter, ["add", "remote-commit.txt"]);
    await git(canonicalWriter, ["commit", "-m", "remote commit"]);
    await git(canonicalWriter, ["push", "origin", "main"]);

    const check = await checkSessionUpdates({
      operationId: "check-diverged-update",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(check.ahead, 1);
    assert.equal(check.behind, 1);
    assert.equal(check.relationship, "diverged");
    assert.equal(check.updateAvailable, true);
    assert.equal(check.updateStrategy, "rebase");
    assert.equal(check.incomingVersions.length, 1);
    assert.equal(check.incomingVersions[0].message, "remote commit");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Update leaves HEAD, index, and worktree untouched when newer work conflicts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "shared.txt"), "remote\n", "utf8");
    await git(canonicalWriter, ["add", "shared.txt"]);
    await git(canonicalWriter, ["commit", "-m", "remote conflict"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    await writeFile(path.join(session.sourcePath, "shared.txt"), "local\n", "utf8");
    const beforeHead = await git(session.sourcePath, ["rev-parse", "HEAD"]);
    const beforeIndex = await git(session.sourcePath, ["write-tree"]);
    const beforeStatus = await git(session.sourcePath, ["status", "--porcelain=v1", "-z"]);

    await assert.rejects(updateSessionWork({
      operationId: "apply-conflicting-update",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    }), (error) => error.code === "vibe64_session_update_conflict");
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), beforeHead);
    assert.equal(await git(session.sourcePath, ["write-tree"]), beforeIndex);
    assert.equal(await git(session.sourcePath, ["status", "--porcelain=v1", "-z"]), beforeStatus);
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "local\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("interrupted Update recovery applies the prepared result exactly once", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "remote.txt"), "remote\n", "utf8");
    await git(canonicalWriter, ["add", "remote.txt"]);
    await git(canonicalWriter, ["commit", "-m", "remote advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    await writeFile(path.join(session.sourcePath, "local.txt"), "local\n", "utf8");
    let recovery = {};

    await assert.rejects(updateSessionWork({
      onProgress: async (progress) => {
        recovery = { ...recovery, ...progress };
        if (progress.stage === "mutating") {
          throw new Error("simulated restart");
        }
      },
      operationId: "recover-update",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    }), /simulated restart/u);

    const result = await recoverSessionWorkUpdate({
      project: githubProject(root, fixture.remote),
      recovery,
      runCommand: commandRunner,
      session
    });
    assert.equal(result.recovered, true);
    assert.equal(result.status, "updated");
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), recovery.canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");
    assert.equal(await readFile(path.join(session.sourcePath, "remote.txt"), "utf8"), "remote\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local-source Update imports the clean project baseline as canonical authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const baseline = path.join(root, "baseline");
    await git(root, ["init", "--initial-branch=main", baseline]);
    await writeFile(path.join(baseline, "base.txt"), "initial\n", "utf8");
    await git(baseline, ["add", "base.txt"]);
    await git(baseline, ["commit", "-m", "initial"]);
    const baseCommit = await git(baseline, ["rev-parse", "HEAD"]);
    const source = path.join(root, "session-local");
    await git(root, ["clone", "--branch", "main", baseline, source]);
    await git(source, ["checkout", "-b", "vibe64/session-local"]);
    await writeFile(path.join(source, "local.txt"), "local\n", "utf8");
    await writeFile(path.join(baseline, "remote.txt"), "baseline\n", "utf8");
    await git(baseline, ["add", "remote.txt"]);
    await git(baseline, ["commit", "-m", "baseline advance"]);
    const canonicalCommit = await git(baseline, ["rev-parse", "HEAD"]);
    const project = {
      path: baseline,
      repository: { defaultBranch: "main", mode: "local_source" }
    };
    const session = {
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/session-local",
        source_path: source
      },
      sessionId: "session-local",
      sourcePath: source
    };

    const result = await updateSessionWork({
      operationId: "local-update",
      project,
      runCommand: commandRunner,
      session
    });
    assert.equal(result.canonicalCommit, canonicalCommit);
    assert.equal(await git(source, ["rev-parse", "HEAD"]), canonicalCommit);
    assert.equal(await readFile(path.join(source, "remote.txt"), "utf8"), "baseline\n");
    assert.equal(await readFile(path.join(source, "local.txt"), "utf8"), "local\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save refuses canonical advances until explicit Update rebases the session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "remote.txt"), "remote\n", "utf8");
    await git(canonicalWriter, ["add", "remote.txt"]);
    await git(canonicalWriter, ["commit", "-m", "canonical advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await writeFile(path.join(session.sourcePath, "local.txt"), "local\n", "utf8");

    const project = githubProject(root, fixture.remote);
    await assert.rejects(saveSessionWork({
      operationId: "save-before-rebase",
      project,
      runCommand: commandRunner,
      session
    }), (error) => error.code === "vibe64_session_save_update_required");
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");

    const updated = await updateSessionWork({
      operationId: "rebase-before-save",
      project,
      runCommand: commandRunner,
      session
    });
    session.metadata.base_commit = updated.canonicalCommit;
    const result = await saveSessionWork({
      identity: {
        email: "person@example.test",
        name: "Person"
      },
      operationId: "save-1",
      project,
      runCommand: commandRunner,
      session
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "saved");
    assert.equal(result.reconciled, true);
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), result.saveCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), result.saveCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", `${result.saveCommit}^`]), canonicalCommit);
    assert.equal(
      await git(session.sourcePath, ["log", "-1", "--format=%s"]),
      "Improve tested project behavior"
    );
    assert.equal(await readFile(path.join(session.sourcePath, "remote.txt"), "utf8"), "remote\n");
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");
    assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a second Save also requires explicit Update after a later canonical advance", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const project = githubProject(root, fixture.remote);
    await writeFile(path.join(session.sourcePath, "first.txt"), "first\n", "utf8");
    const first = await saveSessionWork({
      operationId: "save-first",
      project,
      runCommand: commandRunner,
      session
    });
    session.metadata.base_commit = first.saveCommit;

    const canonicalWriter = path.join(root, "canonical-writer-second");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "canonical-second.txt"), "canonical\n", "utf8");
    await git(canonicalWriter, ["add", "canonical-second.txt"]);
    await git(canonicalWriter, ["commit", "-m", "later canonical advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalSecond = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await writeFile(path.join(session.sourcePath, "second.txt"), "second\n", "utf8");

    await assert.rejects(saveSessionWork({
      operationId: "save-second-before-rebase",
      project,
      runCommand: commandRunner,
      session
    }), (error) => error.code === "vibe64_session_save_update_required");

    const updated = await updateSessionWork({
      operationId: "rebase-second-save",
      project,
      runCommand: commandRunner,
      session
    });
    session.metadata.base_commit = updated.canonicalCommit;
    const second = await saveSessionWork({
      operationId: "save-second",
      project,
      runCommand: commandRunner,
      session
    });

    assert.equal(second.status, "saved");
    assert.equal(await git(session.sourcePath, ["rev-parse", `${second.saveCommit}^`]), canonicalSecond);
    assert.equal(await readFile(path.join(session.sourcePath, "first.txt"), "utf8"), "first\n");
    assert.equal(await readFile(path.join(session.sourcePath, "second.txt"), "utf8"), "second\n");
    assert.equal(await readFile(path.join(session.sourcePath, "canonical-second.txt"), "utf8"), "canonical\n");
    assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save reports published_needs_reconcile when the worktree changes after its checkpoint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "saved.txt"), "saved\n", "utf8");
    let changedDuringSave = false;

    const result = await saveSessionWork({
      onProgress: async ({ stage }) => {
        if (stage === "prepared" && !changedDuringSave) {
          changedDuringSave = true;
          await writeFile(path.join(session.sourcePath, "late.txt"), "late\n", "utf8");
        }
      },
      operationId: "save-concurrent-worktree",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(result.status, "published_needs_reconcile");
    assert.equal(result.reconciled, false);
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), result.saveCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "late.txt"), "utf8"), "late\n");
    await assert.rejects(readFile(path.join(fixture.seed, "late.txt"), "utf8"));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed-Git Save uses the guarded canonical push and preserves its backup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const canonicalRepositoryPath = path.join(root, "canonical-repository", "repository.git");
    await runScript(canonicalRepositoryInitializeScript({
      defaultBranch: "main",
      repositoryPath: canonicalRepositoryPath
    }), root);
    await runScript(canonicalRepositoryInstallRefScript({
      repositoryPath: canonicalRepositoryPath,
      sourceRef: "refs/heads/main",
      sourceRepository: fixture.seed,
      targetRef: "refs/heads/main"
    }), root);
    const session = await sessionForRemote(root, {
      ...fixture,
      remote: canonicalRepositoryPath
    }, "managed-session");
    await writeFile(path.join(session.sourcePath, "managed.txt"), "managed\n", "utf8");

    const result = await saveSessionWork({
      operationId: "save-managed",
      project: managedGitProject(root, canonicalRepositoryPath),
      runCommand: commandRunner,
      session
    });

    assert.equal(result.mode, "managed_git");
    assert.equal(result.status, "saved");
    assert.equal(
      await git(root, ["--git-dir", canonicalRepositoryPath, "rev-parse", "refs/heads/main"]),
      result.saveCommit
    );
    assert.equal(
      await git(root, [
        "--git-dir",
        canonicalRepositoryBackupPath(canonicalRepositoryPath),
        "for-each-ref",
        "--format=%(objectname)",
        "refs/vibe64/backups/heads/main"
      ]),
      fixture.baseCommit
    );
    assert.equal(await readFile(path.join(session.sourcePath, "managed.txt"), "utf8"), "managed\n");
    assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("managed-Git Update reads the guarded canonical authority without publishing session work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-update-"));
  try {
    const fixture = await createRemoteFixture(root);
    const canonicalRepositoryPath = path.join(root, "canonical-repository", "repository.git");
    await runScript(canonicalRepositoryInitializeScript({
      defaultBranch: "main",
      repositoryPath: canonicalRepositoryPath
    }), root);
    await runScript(canonicalRepositoryInstallRefScript({
      repositoryPath: canonicalRepositoryPath,
      sourceRef: "refs/heads/main",
      sourceRepository: fixture.seed,
      targetRef: "refs/heads/main"
    }), root);
    const session = await sessionForRemote(root, {
      ...fixture,
      remote: canonicalRepositoryPath
    }, "managed-update");
    await writeFile(path.join(session.sourcePath, "local.txt"), "local\n", "utf8");

    await writeFile(path.join(fixture.seed, "canonical.txt"), "canonical\n", "utf8");
    await git(fixture.seed, ["add", "canonical.txt"]);
    await git(fixture.seed, ["commit", "-m", "managed canonical advance"]);
    await git(fixture.seed, ["remote", "add", "canonical", canonicalRepositoryPath]);
    await git(fixture.seed, [
      "push",
      "--push-option=vibe64-atomic",
      "canonical",
      "HEAD:refs/heads/main"
    ]);
    const canonicalCommit = await git(fixture.seed, ["rev-parse", "HEAD"]);

    const result = await updateSessionWork({
      operationId: "managed-update",
      project: managedGitProject(root, canonicalRepositoryPath),
      runCommand: commandRunner,
      session
    });

    assert.equal(result.mode, "managed_git");
    assert.equal(result.canonicalCommit, canonicalCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "canonical.txt"), "utf8"), "canonical\n");
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");
    assert.match(await git(session.sourcePath, ["status", "--porcelain"]), /local\.txt/u);
    assert.equal(
      await git(root, ["--git-dir", canonicalRepositoryPath, "rev-parse", "refs/heads/main"]),
      canonicalCommit,
      "Update must not publish session work"
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("explicit Update reports a real three-way conflict without changing canonical authority", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "shared.txt"), "canonical\n", "utf8");
    await git(canonicalWriter, ["add", "shared.txt"]);
    await git(canonicalWriter, ["commit", "-m", "canonical change"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await writeFile(path.join(session.sourcePath, "shared.txt"), "session\n", "utf8");

    await assert.rejects(
      updateSessionWork({
        operationId: "update-conflict",
        project: githubProject(root, fixture.remote),
        runCommand: commandRunner,
        session
      }),
      (error) => error.code === "vibe64_session_update_conflict"
    );
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "session\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save permits same-file sibling work when Git proves the edits merge cleanly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    await writeFile(path.join(fixture.seed, "mergeable.txt"), "first\nsecond\nthird\nfourth\n", "utf8");
    await git(fixture.seed, ["add", "mergeable.txt"]);
    await git(fixture.seed, ["commit", "-m", "add mergeable file"]);
    await git(fixture.seed, ["push", "origin", "main"]);
    fixture.baseCommit = await git(fixture.seed, ["rev-parse", "HEAD"]);
    const session = await sessionForRemote(root, fixture);
    const sibling = await sessionForRemote(root, fixture, "session-2");
    await writeFile(path.join(session.sourcePath, "mergeable.txt"), "current\nsecond\nthird\nfourth\n", "utf8");
    await writeFile(path.join(sibling.sourcePath, "mergeable.txt"), "first\nsecond\nthird\nsibling\n", "utf8");

    const project = githubProject(root, fixture.remote);
    const result = await saveSessionWork({
      operationId: "save-sibling-clean-overlap",
      project,
      runCommand: commandRunner,
      session,
      siblingWork: async ({ operationId }) => [await inspectSessionWork({
        comparisonOperationId: operationId,
        project,
        runCommand: commandRunner,
        session: sibling
      })]
    });

    assert.equal(result.status, "saved");
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), result.saveCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "mergeable.txt"), "utf8"), "current\nsecond\nthird\nfourth\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save rejects only a genuine same-file sibling merge conflict", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const sibling = await sessionForRemote(root, fixture, "session-2");
    await writeFile(path.join(session.sourcePath, "shared.txt"), "current\n", "utf8");
    await writeFile(path.join(sibling.sourcePath, "shared.txt"), "sibling\n", "utf8");
    const project = githubProject(root, fixture.remote);

    await assert.rejects(saveSessionWork({
      operationId: "save-sibling-conflict",
      project,
      runCommand: commandRunner,
      session,
      siblingWork: async ({ operationId }) => [await inspectSessionWork({
        comparisonOperationId: operationId,
        project,
        runCommand: commandRunner,
        session: sibling
      })]
    }), (error) => {
      assert.equal(error.code, "vibe64_session_save_sibling_conflict");
      assert.deepEqual(error.siblingConflicts, [{
        classification: "conflict",
        paths: ["shared.txt"],
        sessionId: "session-2"
      }]);
      return true;
    });
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), fixture.baseCommit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("work inspection trusts only the platform-verified canonical snapshot, not mutable tracking refs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "published.txt"), "published\n", "utf8");
    await git(session.sourcePath, ["add", "published.txt"]);
    await git(session.sourcePath, ["commit", "-m", "published work"]);
    await git(session.sourcePath, ["push", "origin", "HEAD:main"]);

    const publishedCommit = await git(session.sourcePath, ["rev-parse", "HEAD"]);
    await mkdir(path.join(session.sourcePath, "node_modules", "ignored-package"), { recursive: true });
    await writeFile(path.join(session.sourcePath, ".git", "info", "exclude"), "node_modules/\n", "utf8");
    await writeFile(path.join(session.sourcePath, "node_modules", "ignored-package", "index.js"), "ignored\n", "utf8");

    const beforeCheck = await inspectSessionWork({
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(beforeCheck.canonicalCommit, fixture.baseCommit);
    assert.equal(beforeCheck.unsaved, true);

    const checked = await checkSessionUpdates({
      operationId: "check-pulled-canonical",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(checked.behind, 0);
    assert.equal(checked.reconciled, true);
    assert.equal(checked.sessionCurrent, true);
    assert.equal(checked.updateAvailable, false);

    const inspected = await inspectSessionWork({
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(inspected.unsaved, false);
    assert.deepEqual(inspected.changedPaths, []);
    assert.equal(inspected.canonicalCommit, publishedCommit);
    assert.equal(inspected.changeBaseCommit, publishedCommit);
    assert.equal(inspected.sessionMatchesCanonical, true);

    const updated = await updateSessionWork({
      operationId: "update-pulled-canonical",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    assert.equal(updated.status, "already_current");
    assert.equal(updated.canonicalCommit, publishedCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), publishedCommit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save publishes only session-authored work after the session incorporates canonical updates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer-pulled");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "canonical.txt"), "canonical\n", "utf8");
    await git(canonicalWriter, ["add", "canonical.txt"]);
    await git(canonicalWriter, ["commit", "-m", "canonical update"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);

    await git(session.sourcePath, ["pull", "--ff-only", "origin", "main"]);
    await writeFile(path.join(session.sourcePath, "session-only.txt"), "session\n", "utf8");

    const result = await saveSessionWork({
      operationId: "save-after-pull",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(result.changeBaseCommit, canonicalCommit);
    assert.deepEqual(result.changedPaths, ["session-only.txt"]);
    assert.equal(await git(session.sourcePath, ["rev-parse", `${result.saveCommit}^`]), canonicalCommit);
    assert.equal(
      await git(session.sourcePath, ["diff-tree", "--no-commit-id", "--name-only", "-r", result.saveCommit]),
      "session-only.txt"
    );
    assert.equal(await readFile(path.join(session.sourcePath, "canonical.txt"), "utf8"), "canonical\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("work inspection reports a canonical advance as an update instead of local changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    const canonicalWriter = path.join(root, "canonical-writer-observed");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "remote.txt"), "remote\n", "utf8");
    await git(canonicalWriter, ["add", "remote.txt"]);
    await git(canonicalWriter, ["commit", "-m", "remote advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await git(session.sourcePath, ["fetch", "origin", "main"]);

    await checkSessionUpdates({
      operationId: "check-observed-canonical",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    const inspected = await inspectSessionWork({
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(inspected.unsaved, false);
    assert.deepEqual(inspected.changedPaths, []);
    assert.equal(inspected.canonicalCommit, canonicalCommit);
    assert.equal(inspected.changeBaseCommit, fixture.baseCommit);
    assert.equal(inspected.behind, 1);
    assert.equal(inspected.updateAvailable, true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("work inspection does not resurrect saved work when canonical advances beyond the session head", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "already-saved.txt"), "saved\n", "utf8");
    await git(session.sourcePath, ["add", "already-saved.txt"]);
    await git(session.sourcePath, ["commit", "-m", "already saved"]);
    await git(session.sourcePath, ["push", "origin", "HEAD:main"]);
    const sessionHead = await git(session.sourcePath, ["rev-parse", "HEAD"]);

    const canonicalWriter = path.join(root, "canonical-writer-after-session");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "canonical-only.txt"), "canonical\n", "utf8");
    await git(canonicalWriter, ["add", "canonical-only.txt"]);
    await git(canonicalWriter, ["commit", "-m", "canonical advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    const canonicalCommit = await git(canonicalWriter, ["rev-parse", "HEAD"]);
    await git(session.sourcePath, ["fetch", "origin", "main"]);

    await checkSessionUpdates({
      operationId: "check-canonical-after-session",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    const inspected = await inspectSessionWork({
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(inspected.sessionHead, sessionHead);
    assert.equal(inspected.canonicalCommit, canonicalCommit);
    assert.equal(inspected.changeBaseCommit, sessionHead);
    assert.equal(inspected.unsaved, false);
    assert.deepEqual(inspected.changedPaths, []);
    assert.equal(inspected.behind, 1);
    assert.equal(inspected.updateAvailable, true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("work inspection reports only new session edits when canonical advances beyond the session head", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "already-saved.txt"), "saved\n", "utf8");
    await git(session.sourcePath, ["add", "already-saved.txt"]);
    await git(session.sourcePath, ["commit", "-m", "already saved"]);
    await git(session.sourcePath, ["push", "origin", "HEAD:main"]);
    const sessionHead = await git(session.sourcePath, ["rev-parse", "HEAD"]);

    const canonicalWriter = path.join(root, "canonical-writer-with-session-edit");
    await git(root, ["clone", "--branch", "main", fixture.remote, canonicalWriter]);
    await writeFile(path.join(canonicalWriter, "canonical-only.txt"), "canonical\n", "utf8");
    await git(canonicalWriter, ["add", "canonical-only.txt"]);
    await git(canonicalWriter, ["commit", "-m", "canonical advance"]);
    await git(canonicalWriter, ["push", "origin", "main"]);
    await git(session.sourcePath, ["fetch", "origin", "main"]);

    await checkSessionUpdates({
      operationId: "check-canonical-with-session-edit",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });
    await writeFile(path.join(session.sourcePath, "session-only.txt"), "session\n", "utf8");

    const inspected = await inspectSessionWork({
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(inspected.changeBaseCommit, sessionHead);
    assert.equal(inspected.unsaved, true);
    assert.deepEqual(inspected.changedPaths, ["session-only.txt"]);
    assert.equal(inspected.behind, 1);
    assert.equal(inspected.updateAvailable, true);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local-source Save advances the clean configured baseline", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const baseline = path.join(root, "baseline");
    await git(root, ["init", "--initial-branch=main", baseline]);
    await writeFile(path.join(baseline, "app.txt"), "initial\n", "utf8");
    await git(baseline, ["add", "app.txt"]);
    await git(baseline, ["commit", "-m", "initial"]);
    const baseCommit = await git(baseline, ["rev-parse", "HEAD"]);
    const source = path.join(root, "session-local");
    await git(root, ["clone", "--branch", "main", baseline, source]);
    await git(source, ["checkout", "-b", "vibe64/session-local"]);
    await writeFile(path.join(source, "app.txt"), "saved\n", "utf8");
    const session = {
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/session-local",
        source_path: source
      },
      sessionId: "session-local",
      sourcePath: source
    };
    const result = await saveSessionWork({
      operationId: "save-local",
      project: {
        path: baseline,
        repository: {
          defaultBranch: "main",
          mode: "local_source"
        }
      },
      runCommand: commandRunner,
      session
    });
    assert.equal(result.status, "saved");
    assert.equal(await git(baseline, ["rev-parse", "HEAD"]), result.saveCommit);
    assert.equal(await readFile(path.join(baseline, "app.txt"), "utf8"), "saved\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local-source Save rejects a baseline checked out on the wrong branch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const baseline = path.join(root, "baseline");
    await git(root, ["init", "--initial-branch=main", baseline]);
    await writeFile(path.join(baseline, "app.txt"), "initial\n", "utf8");
    await git(baseline, ["add", "app.txt"]);
    await git(baseline, ["commit", "-m", "initial"]);
    const baseCommit = await git(baseline, ["rev-parse", "HEAD"]);
    await git(baseline, ["checkout", "-b", "other"]);
    const source = path.join(root, "session-local");
    await git(root, ["clone", baseline, source]);
    await git(source, ["checkout", "-b", "vibe64/session-local", baseCommit]);
    await writeFile(path.join(source, "app.txt"), "session\n", "utf8");

    await assert.rejects(saveSessionWork({
      operationId: "save-local-wrong-branch",
      project: {
        path: baseline,
        repository: {
          defaultBranch: "main",
          mode: "local_source"
        }
      },
      runCommand: commandRunner,
      session: {
        metadata: {
          base_branch: "main",
          base_commit: baseCommit,
          source_path: source
        },
        sessionId: "session-local",
        sourcePath: source
      }
    }), (error) => error.code === "vibe64_session_save_local_branch_mismatch");
    assert.equal(await git(baseline, ["rev-parse", "HEAD"]), baseCommit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local-source interrupted Save recovery verifies the clean baseline before reconciling", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const baseline = path.join(root, "baseline");
    await git(root, ["init", "--initial-branch=main", baseline]);
    await writeFile(path.join(baseline, "app.txt"), "initial\n", "utf8");
    await git(baseline, ["add", "app.txt"]);
    await git(baseline, ["commit", "-m", "initial"]);
    const baseCommit = await git(baseline, ["rev-parse", "HEAD"]);
    const source = path.join(root, "session-local");
    await git(root, ["clone", "--branch", "main", baseline, source]);
    await git(source, ["checkout", "-b", "vibe64/session-local"]);
    await writeFile(path.join(source, "app.txt"), "saved\n", "utf8");
    const session = {
      metadata: {
        base_branch: "main",
        base_commit: baseCommit,
        branch: "vibe64/session-local",
        source_path: source
      },
      sessionId: "session-local",
      sourcePath: source
    };
    const project = {
      path: baseline,
      repository: {
        defaultBranch: "main",
        mode: "local_source"
      }
    };
    let recovery = {};
    await assert.rejects(saveSessionWork({
      onProgress: async (progress) => {
        recovery = { ...recovery, ...progress };
        if (progress.stage === "published") {
          throw new Error("simulated service restart");
        }
      },
      operationId: "save-local-recovery",
      project,
      runCommand: commandRunner,
      session
    }), /simulated service restart/u);

    const result = await recoverSessionWorkSave({
      project,
      recovery,
      runCommand: commandRunner,
      session
    });

    assert.equal(result.recovered, true);
    assert.equal(result.reconciled, true);
    assert.equal(await git(baseline, ["status", "--porcelain"]), "");
    assert.equal(await git(baseline, ["rev-parse", "HEAD"]), recovery.proposedCommit);
    assert.equal(await git(source, ["rev-parse", "HEAD"]), recovery.proposedCommit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("interrupted Save recovery verifies published authority and reconciles without republishing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "recovered.txt"), "recovered\n", "utf8");
    let recovery = {};
    await assert.rejects(saveSessionWork({
      operationId: "save-recover-published",
      onProgress: async (progress) => {
        recovery = { ...recovery, ...progress };
        if (progress.stage === "published") {
          throw new Error("simulated service restart");
        }
      },
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    }), /simulated service restart/u);
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), recovery.proposedCommit);
    assert.notEqual(await git(session.sourcePath, ["rev-parse", "HEAD"]), recovery.proposedCommit);

    const result = await recoverSessionWorkSave({
      project: githubProject(root, fixture.remote),
      recovery,
      runCommand: commandRunner,
      session
    });

    assert.equal(result.recovered, true);
    assert.equal(result.reconciled, true);
    assert.equal(result.saveCommit, recovery.proposedCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), recovery.proposedCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "recovered.txt"), "utf8"), "recovered\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("interrupted Save recovery never republishes when authority is still unchanged", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "not-published.txt"), "local\n", "utf8");
    let recovery = {};
    await assert.rejects(saveSessionWork({
      operationId: "save-recover-unpublished",
      onProgress: async (progress) => {
        recovery = { ...recovery, ...progress };
        if (progress.stage === "publishing") {
          throw new Error("simulated service restart");
        }
      },
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    }), /simulated service restart/u);

    await assert.rejects(recoverSessionWorkSave({
      project: githubProject(root, fixture.remote),
      recovery,
      runCommand: commandRunner,
      session
    }), (error) => {
      assert.equal(error.code, "vibe64_session_save_interrupted_retryable");
      assert.equal(error.retryable, true);
      return true;
    });
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), fixture.baseCommit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
