import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  recoverSessionWorkSave,
  saveSessionWork
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

test("Save preserves disjoint canonical work and publishes one ordinary commit", async () => {
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

    const result = await saveSessionWork({
      identity: {
        email: "person@example.test",
        name: "Person"
      },
      operationId: "save-1",
      project: githubProject(root, fixture.remote),
      runCommand: commandRunner,
      session
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "saved");
    assert.equal(result.reconciled, true);
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), result.saveCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", "HEAD"]), result.saveCommit);
    assert.equal(await git(session.sourcePath, ["rev-parse", `${result.saveCommit}^`]), canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "remote.txt"), "utf8"), "remote\n");
    assert.equal(await readFile(path.join(session.sourcePath, "local.txt"), "utf8"), "local\n");
    assert.equal(await git(session.sourcePath, ["status", "--porcelain"]), "");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a second Save reconciles from the verified base and preserves a later canonical advance", async () => {
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

test("Save reports a real three-way conflict without changing canonical authority", async () => {
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
      saveSessionWork({
        operationId: "save-conflict",
        project: githubProject(root, fixture.remote),
        runCommand: commandRunner,
        session
      }),
      (error) => error.code === "vibe64_session_save_conflict"
    );
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), canonicalCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "session\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Save rejects overlapping unsaved work in another open session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-save-"));
  try {
    const fixture = await createRemoteFixture(root);
    const session = await sessionForRemote(root, fixture);
    await writeFile(path.join(session.sourcePath, "shared.txt"), "session\n", "utf8");

    await assert.rejects(
      saveSessionWork({
        operationId: "save-sibling-conflict",
        project: githubProject(root, fixture.remote),
        runCommand: commandRunner,
        session,
        siblingWork: async () => [{
          changedPaths: ["shared.txt", "sibling-only.txt"],
          sessionId: "session-2"
        }]
      }),
      (error) => {
        assert.equal(error.code, "vibe64_session_save_sibling_conflict");
        assert.deepEqual(error.siblingConflicts, [{
          paths: ["shared.txt"],
          sessionId: "session-2"
        }]);
        return true;
      }
    );
    assert.equal(await git(fixture.remote, ["rev-parse", "refs/heads/main"]), fixture.baseCommit);
    assert.equal(await readFile(path.join(session.sourcePath, "shared.txt"), "utf8"), "session\n");
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
