import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AiStudioSessionRuntime,
  JskitTargetAdapter
} from "../../server/lib/aiStudio/index.js";

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(tmpdir(), "ai-studio-jskit-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

async function writeProjectFile(root, relativePath, text = "") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, text, "utf8");
}

async function createJskitProject(root) {
  await Promise.all([
    writeProjectFile(root, "package.json", JSON.stringify({
      name: "example-jskit-app",
      scripts: {
        build: "vite build",
        test: "node --test"
      }
    }, null, 2)),
    writeProjectFile(root, "config/public.js", "export default {};\n"),
    writeProjectFile(root, "src/main.js", "console.log('app');\n"),
    writeProjectFile(root, "packages/main/package.descriptor.mjs", "export default {};\n"),
    writeProjectFile(root, ".jskit/lock.json", "{}\n")
  ]);
}

test("jskit adapter detects a JSKIT target and exposes setup facts", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const adapter = new JskitTargetAdapter();

    const detection = await adapter.detect({
      targetRoot
    });
    const facts = await adapter.inspect({
      targetRoot
    });

    assert.deepEqual(detection, {
      detected: true,
      reason: ""
    });
    assert.equal(facts.summary, "JSKIT project detected.");
    assert.equal(facts.promptContext.package_name, "example-jskit-app");
    assert.equal(facts.promptContext.scripts, "build, test");
    assert.deepEqual(facts.capabilities, {
      create_issue_file: true,
      create_issue_on_gh: true,
      create_worktree: true,
      edit_issue: true,
      install_dependencies: true,
      send_issue_prompt: true
    });
    assert.deepEqual(facts.commands.map((command) => command.id), [
      "create_worktree",
      "install_dependencies",
      "create_issue_on_gh"
    ]);
  });
});

test("jskit adapter leaves capabilities empty when target markers are missing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await writeProjectFile(targetRoot, "package.json", "{}\n");
    const adapter = new JskitTargetAdapter();

    const detection = await adapter.detect({
      targetRoot
    });
    const facts = await adapter.inspect({
      targetRoot
    });

    assert.equal(detection.detected, false);
    assert.match(detection.reason, /Missing JSKIT markers/u);
    assert.deepEqual(facts.capabilities, {});
    assert.deepEqual(facts.commands, []);
  });
});

test("jskit adapter command results persist issue metadata and keep Next gated until issue submission", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const calls = [];
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter({
        commandRunner: async ({ commandId, targetRoot: commandTargetRoot }) => {
          calls.push({
            commandId,
            targetRoot: commandTargetRoot
          });
          return {
            message: "Created GitHub issue.",
            metadata: {
              issue_url: "https://github.com/example/repo/issues/42"
            },
            status: "completed"
          };
        }
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_submitted",
      sessionId: "jskit_issue"
    });

    const beforeSubmit = await runtime.getSession("jskit_issue");
    assert.equal(beforeSubmit.next.enabled, false);
    assert.equal(beforeSubmit.next.disabledReason, "Waiting for metadata: issue_url.");

    const afterSubmit = await runtime.runAction("jskit_issue", "create_issue_on_gh");

    assert.deepEqual(calls, [
      {
        commandId: "create_issue_on_gh",
        targetRoot
      }
    ]);
    assert.equal(afterSubmit.metadata.issue_url, "https://github.com/example/repo/issues/42");
    assert.equal(afterSubmit.next.enabled, true);
    assert.equal(afterSubmit.next.stepId, "plan_made");
    assert.deepEqual(afterSubmit.actionResult.metadata, {
      issue_url: "https://github.com/example/repo/issues/42"
    });
    assert.equal(await runtime.store.readMetadataValue("jskit_issue", "issue_url"), "https://github.com/example/repo/issues/42");
  });
});

test("jskit adapter prompt actions include JSKIT prompt context", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "issue_file_created",
      sessionId: "jskit_prompt"
    });

    const afterPrompt = await runtime.runAction("jskit_prompt", "create_issue_file");

    assert.equal(afterPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.id, "jskit");
    assert.equal(afterPrompt.actionResult.promptContext.adapter.promptContext.package_name, "example-jskit-app");
    assert.match(afterPrompt.actionResult.prompt, /example-jskit-app/u);
  });
});
