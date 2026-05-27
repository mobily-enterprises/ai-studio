import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createService
} from "../../packages/ai-studio-accounts/src/server/service.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

function connectedToolchain(calls = []) {
  return async function runToolchain(commandArgs) {
    calls.push(commandArgs);
    return connectedToolchainResult(commandArgs);
  };
}

function connectedToolchainResult(commandArgs) {
  if (commandArgs[0] === "codex") {
    return {
      ok: true,
      output: "Codex is logged in.",
      stdout: "Logged in"
    };
  }
  if (commandArgs[0] === "gh" && commandArgs[1] === "auth") {
    return {
      ok: true,
      output: "github.com\nToken scopes: repo, read:org, gist, workflow",
      stdout: "github.com"
    };
  }
  if (commandArgs[0] === "gh" && commandArgs[1] === "api") {
    return {
      ok: true,
      output: "merc",
      stdout: "merc"
    };
  }
  throw new Error(`Unexpected toolchain command: ${commandArgs.join(" ")}`);
}

function disconnectedCodexToolchain(calls = []) {
  return async function runToolchain(commandArgs) {
    calls.push(commandArgs);
    if (commandArgs[0] === "codex") {
      return {
        ok: false,
        output: "Codex is not logged in.",
        stdout: ""
      };
    }
    return connectedToolchainResult(commandArgs);
  };
}

test("Accounts status reuses a persisted ready status for setup readiness", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    const readyStatusCacheRoot = path.join(root, "status-cache");
    const calls = [];
    const service = createService({
      readyStatusCacheRoot,
      runToolchain: connectedToolchain(calls),
      targetRoot
    });

    const first = await service.getStatus();
    assert.equal(first.ok, true);
    assert.equal(first.ready, true);
    assert.equal(calls.length, 3);

    const restored = createService({
      readyStatusCacheRoot,
      runToolchain: async () => {
        throw new Error("Toolchain should not run when ready status is cached.");
      },
      targetRoot
    });
    const second = await restored.getStatus();
    assert.equal(second.ok, true);
    assert.equal(second.ready, true);
  });
});

test("Accounts refresh bypasses and clears a stale ready status", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "target");
    const readyStatusCacheRoot = path.join(root, "status-cache");

    await createService({
      readyStatusCacheRoot,
      runToolchain: connectedToolchain(),
      targetRoot
    }).getStatus();

    const disconnectedCalls = [];
    const refreshed = await createService({
      readyStatusCacheRoot,
      runToolchain: disconnectedCodexToolchain(disconnectedCalls),
      targetRoot
    }).getStatus({
      refresh: true
    });
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.ready, false);
    assert.equal(disconnectedCalls.length, 3);

    const connectedCalls = [];
    const afterClear = await createService({
      readyStatusCacheRoot,
      runToolchain: connectedToolchain(connectedCalls),
      targetRoot
    }).getStatus();
    assert.equal(afterClear.ok, true);
    assert.equal(afterClear.ready, true);
    assert.equal(connectedCalls.length, 3);
  });
});
