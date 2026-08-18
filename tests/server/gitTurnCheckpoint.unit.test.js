import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  checkpointRefs,
  createGitTurnCheckpoint
} from "../../packages/vibe64-execution/src/server/gitTurnCheckpoint.js";

const execFileAsync = promisify(execFile);

test("turn checkpoints capture the complete saveable tree without changing the branch, index, or worktree", async () => {
  const root = await createRepository();
  try {
    const headBefore = await git(root, ["rev-parse", "HEAD"]);
    await writeFile(path.join(root, "tracked.txt"), "changed\n", "utf8");
    await writeFile(path.join(root, "untracked.txt"), "new\n", "utf8");
    const statusBefore = await git(root, ["status", "--porcelain=v1"]);
    const result = await createGitTurnCheckpoint({
      outerTurnId: "client-message-1",
      outcome: "completed",
      sessionId: "session-1",
      timestamp: "2026-08-18T09:00:00.000Z",
      worktreePath: root
    });

    assert.equal(result.ok, true);
    assert.equal(result.created, true);
    assert.equal(await git(root, ["rev-parse", "HEAD"]), headBefore);
    assert.equal(await git(root, ["status", "--porcelain=v1"]), statusBefore);
    assert.equal(await git(root, ["show", `${result.commit}:tracked.txt`]), "changed");
    assert.equal(await git(root, ["show", `${result.commit}:untracked.txt`]), "new");
    assert.equal(await git(root, ["rev-parse", result.latestRef]), result.commit);
    assert.equal((await readFile(path.join(root, "tracked.txt"), "utf8")), "changed\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("turn checkpoint retries are object-identical and a later turn advances latest", async () => {
  const root = await createRepository();
  try {
    await writeFile(path.join(root, "tracked.txt"), "turn one\n", "utf8");
    const input = {
      outerTurnId: "client-message-1",
      outcome: "completed",
      sessionId: "session-1",
      timestamp: "2026-08-18T09:00:00.000Z",
      worktreePath: root
    };
    const first = await createGitTurnCheckpoint(input);
    const retry = await createGitTurnCheckpoint(input);
    assert.equal(retry.created, false);
    assert.equal(retry.commit, first.commit);

    await writeFile(path.join(root, "tracked.txt"), "turn two\n", "utf8");
    const second = await createGitTurnCheckpoint({
      ...input,
      outerTurnId: "provider-successor-independent-outer-turn",
      timestamp: "2026-08-18T09:05:00.000Z"
    });
    assert.notEqual(second.commit, first.commit);
    assert.equal(second.baseCommit, first.commit);
    assert.equal(await git(root, ["rev-parse", second.latestRef]), second.commit);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("turn checkpoint refs use safe digests and invalid identities fail closed", async () => {
  const refs = checkpointRefs({
    outerTurnId: "message/with spaces",
    sessionId: "session:with:punctuation"
  });
  assert.match(refs.turnRef, /^refs\/vibe64\/checkpoints\/[a-f0-9]{32}\/[a-f0-9]{32}$/u);
  await assert.rejects(createGitTurnCheckpoint({
    outerTurnId: "bad\nturn",
    outcome: "completed",
    sessionId: "session-1",
    timestamp: "2026-08-18T09:00:00.000Z",
    worktreePath: "/tmp"
  }), { code: "vibe64_checkpoint_outerturnid_invalid" });
});

async function createRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-turn-checkpoint-"));
  await git(root, ["init", "--initial-branch=main"]);
  await git(root, ["config", "user.name", "Vibe64 Test"]);
  await git(root, ["config", "user.email", "vibe64@example.test"]);
  await writeFile(path.join(root, "tracked.txt"), "base\n", "utf8");
  await git(root, ["add", "tracked.txt"]);
  await git(root, ["commit", "-m", "base"]);
  return root;
}

async function git(cwd, args) {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8"
  });
  return String(result.stdout || "").trim();
}
