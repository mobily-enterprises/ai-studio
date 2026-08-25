import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm
} from "node:fs/promises";
import getPort from "get-port";
import os from "node:os";
import path from "node:path";

import {
  initializeManagedJskitProject
} from "@local/vibe64-project/server/managedProject";

const START_TIMEOUT_MS = 30_000;

function run(command, args, { cwd, env = process.env, stdio = "inherit" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} failed (code=${code}, signal=${signal || "none"}).`));
    });
  });
}

async function waitForHealth(url) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok && (await response.json()).ok === true) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The created application did not become healthy: ${lastError?.message || "timeout"}`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, 5_000);
    timeout.unref();
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-created-project-proof-"));
  const namespaceRoot = path.join(root, "namespace");
  const projectRuntimeRoot = path.join(root, "runtime");
  const checkoutRoot = path.join(root, "checkout");
  let server = null;
  try {
    await Promise.all([
      mkdir(namespaceRoot),
      mkdir(projectRuntimeRoot)
    ]);
    const initialized = await initializeManagedJskitProject({
      projectContextRoot: namespaceRoot,
      projectName: "created-project-proof",
      projectRuntimeRoot
    });
    assert.deepEqual(await readdir(namespaceRoot), []);
    await run("git", ["clone", initialized.repositoryPath, checkoutRoot]);

    const packageJson = JSON.parse(await readFile(path.join(checkoutRoot, "package.json"), "utf8"));
    const mainPackage = JSON.parse(await readFile(
      path.join(checkoutRoot, "packages", "main", "package.json"),
      "utf8"
    ));
    assert.equal(packageJson.name, "created-project-proof");
    assert.deepEqual(packageJson.workspaces, ["packages/*"]);
    assert.equal(packageJson.devDependencies["@jskit-ai/jskit-catalog"], "0.1.198");
    assert.equal(packageJson.devDependencies["@jskit-ai/jskit-cli"], undefined);
    assert.equal(packageJson.scripts["jskit:update"], "npx --yes @jskit-ai/jskit-catalog@latest update");
    assert.equal(packageJson.scripts["jskit:check"], "jskit check");
    assert.equal(mainPackage.name, "@local/main");
    assert.equal(mainPackage.version, "0.1.0");
    JSON.parse(await readFile(path.join(checkoutRoot, "package-lock.json"), "utf8"));

    await run("npm", ["ci"], { cwd: checkoutRoot });
    assert.equal(execFileSync("git", ["status", "--porcelain"], {
      cwd: checkoutRoot,
      encoding: "utf8"
    }), "");
    await run("npm", ["run", "jskit:check"], { cwd: checkoutRoot });
    await run("npm", ["ls"], { cwd: checkoutRoot });
    await run("npm", ["run", "verify"], { cwd: checkoutRoot });

    const port = await getPort();
    server = spawn("npm", ["start"], {
      cwd: checkoutRoot,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port)
      },
      stdio: "inherit"
    });
    await waitForHealth(`http://127.0.0.1:${port}/api/health`);
    process.stdout.write("Fresh Vibe64 JSKIT project installed, verified, built, and started successfully.\n");
  } finally {
    if (server) {
      await stop(server);
    }
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

await main();
