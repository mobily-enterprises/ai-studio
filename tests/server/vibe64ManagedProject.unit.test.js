import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
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

test("managed blank projects begin as one canonical Genesis commit without a namespace checkout", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-managed-project-"));
  t.after(() => rm(root, {
    force: true,
    recursive: true
  }));
  const namespaceRoot = path.join(root, "namespace");
  const projectRuntimeRoot = path.join(root, "runtime");
  await Promise.all([
    mkdir(namespaceRoot),
    mkdir(projectRuntimeRoot)
  ]);

  const initialized = await initializeManagedGenesisProject({
    projectContextRoot: namespaceRoot,
    projectRuntimeRoot,
    runCommand: directCommand
  });
  const canonicalCommit = (await execFileAsync("git", [
    "--git-dir", initialized.repositoryPath, "rev-parse", "refs/heads/main"
  ])).stdout.trim();

  assert.equal(canonicalCommit, initialized.commit);
  assert.equal((await execFileAsync("git", [
    "--git-dir", initialized.repositoryPath, "rev-list", "--count", "main"
  ])).stdout.trim(), "1");
  assert.match((await execFileAsync("git", [
    "--git-dir", initialized.repositoryPath, "show", "main:genesis/blueprint.md"
  ])).stdout, /# Blueprint/u);
  assert.equal((await execFileAsync("git", [
    "--git-dir", initialized.repositoryPath, "show", "main:genesis/stack.md"
  ])).stdout, "# Stack\n\n## Components\n");
  assert.deepEqual(await readdir(namespaceRoot), []);
  assert.deepEqual(await readdir(path.join(projectRuntimeRoot, "tmp")), []);
  assert.equal(initialized.sourceRoot, undefined);
});

test("managed Genesis initialization removes its temporary checkout after every failure stage", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-managed-project-failures-"));
  t.after(() => rm(root, {
    force: true,
    recursive: true
  }));

  for (const stage of ["genesis", "commit", "canonical-init", "canonical-install", "verification"]) {
    const caseRoot = path.join(root, stage);
    const namespaceRoot = path.join(caseRoot, "namespace");
    const projectRuntimeRoot = path.join(caseRoot, "runtime");
    await Promise.all([
      mkdir(namespaceRoot, { recursive: true }),
      mkdir(projectRuntimeRoot, { recursive: true })
    ]);
    const runCommand = async (request) => {
      const script = String(request.args?.at(-1) || "");
      const shouldFail = (
        stage === "commit" &&
        request.command === "git" &&
        request.args?.includes("commit")
      ) || (
        stage === "canonical-init" &&
        request.command === "bash" &&
        script.includes("Canonical repository is ready at")
      ) || (
        stage === "canonical-install" &&
        request.command === "bash" &&
        script.includes("CANONICAL_INCOMING_REF")
      ) || (
        stage === "verification" &&
        request.command === "git" &&
        request.args?.includes("refs/heads/main^{commit}")
      );
      return shouldFail
        ? {
            code: `vibe64_test_${stage}_failed`,
            ok: false,
            stderr: `simulated ${stage} failure`
          }
        : directCommand(request);
    };

    await assert.rejects(
      () => initializeManagedGenesisProject({
        ...(stage === "genesis" ? {
          initializeProject: async () => {
            throw new Error("simulated Genesis failure");
          }
        } : {}),
        projectContextRoot: namespaceRoot,
        projectRuntimeRoot,
        runCommand,
      }),
      undefined,
      stage
    );

    assert.deepEqual(await readdir(namespaceRoot), [], stage);
    assert.deepEqual(await readdir(path.join(projectRuntimeRoot, "tmp")), [], stage);
  }
});
