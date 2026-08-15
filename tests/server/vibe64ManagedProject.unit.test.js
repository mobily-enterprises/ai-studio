import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  initializeManagedGenesisProject
} from "@local/vibe64-project/server/managedProject";

const execFileAsync = promisify(execFile);

async function directCommand({ args = [], command = "", cwd = "" } = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      env: process.env,
      maxBuffer: 4 * 1024 * 1024
    });
    return {
      exitCode: 0,
      ok: true,
      stderr: String(result.stderr || ""),
      stdout: String(result.stdout || "")
    };
  } catch (error) {
    return {
      code: error.code,
      exitCode: Number(error.code) || 1,
      ok: false,
      stderr: String(error.stderr || error.message || ""),
      stdout: String(error.stdout || "")
    };
  }
}

test("managed blank projects begin as one Genesis commit with private Git state outside source", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-managed-project-"));
  t.after(() => rm(root, {
    force: true,
    recursive: true
  }));
  const sourceRoot = path.join(root, "source");
  const projectRuntimeRoot = path.join(root, "runtime");
  await Promise.all([
    mkdir(sourceRoot),
    mkdir(projectRuntimeRoot)
  ]);

  const initialized = await initializeManagedGenesisProject({
    projectRuntimeRoot,
    runCommand: directCommand,
    targetRoot: sourceRoot
  });
  const sourceCommit = (await execFileAsync("git", ["-C", sourceRoot, "rev-parse", "HEAD"])).stdout.trim();
  const canonicalCommit = (await execFileAsync("git", [
    "--git-dir", initialized.repositoryPath, "rev-parse", "refs/heads/main"
  ])).stdout.trim();

  assert.equal(sourceCommit, initialized.commit);
  assert.equal(canonicalCommit, initialized.commit);
  assert.equal((await execFileAsync("git", ["-C", sourceRoot, "rev-list", "--count", "HEAD"])).stdout.trim(), "1");
  assert.equal((await readdir(sourceRoot)).includes("canonical-repository"), false);
  assert.match(await readFile(path.join(sourceRoot, "genesis", "blueprint.md"), "utf8"), /# Blueprint/u);
  assert.equal(await readFile(path.join(sourceRoot, "genesis", "stack.md"), "utf8"), "# Stack\n\n## Components\n");
});
