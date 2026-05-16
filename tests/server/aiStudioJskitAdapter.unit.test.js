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
    writeProjectFile(root, ".jskit/lock.json", "{}\n"),
    writeProjectFile(root, ".jskit/APP_BLUEPRINT.md", "# App blueprint\n")
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
    assert.equal(facts.promptContext.blueprint_exists, "true");
    assert.equal(facts.promptContext.blueprint_relative_path, ".jskit/APP_BLUEPRINT.md");
    assert.equal(facts.promptContext.blueprint_path, path.join(targetRoot, ".jskit/APP_BLUEPRINT.md"));
    assert.deepEqual(facts.capabilities, {
      accept_changes: true,
      commit_changes: true,
      create_issue_file: true,
      create_issue_on_gh: true,
      create_worktree: true,
      edit_issue: true,
      install_dependencies: true,
      run_automated_checks: true,
      run_deep_ui_check: true,
      update_project_knowledge: true,
      send_issue_prompt: true
    });
    assert.deepEqual(facts.commands.map((command) => command.id), [
      "create_worktree",
      "install_dependencies",
      "create_issue_on_gh",
      "run_automated_checks",
      "accept_changes",
      "commit_changes"
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

test("jskit adapter exposes middle-workflow prompt actions through JSKIT capabilities", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "deep_ui_check_run",
      sessionId: "jskit_middle_prompt"
    });

    const deepUiStep = await runtime.getSession("jskit_middle_prompt");
    assert.deepEqual(deepUiStep.actions, [
      {
        adapterCapability: "run_deep_ui_check",
        disabledReason: "",
        enabled: true,
        id: "run_deep_ui_check",
        label: "Run deep UI check",
        promptId: "run_deep_ui_check",
        type: "prompt",
        visible: true
      }
    ]);

    const afterDeepUiPrompt = await runtime.runAction("jskit_middle_prompt", "run_deep_ui_check");
    assert.equal(afterDeepUiPrompt.actionResult.status, "prompt_ready");
    assert.equal(afterDeepUiPrompt.actionResult.promptId, "run_deep_ui_check");
    assert.match(afterDeepUiPrompt.actionResult.prompt, /Run a focused deep UI check/u);

    await runtime.createSession({
      initialStep: "project_knowledge_updated",
      sessionId: "jskit_blueprint_prompt"
    });
    const projectKnowledgeStep = await runtime.getSession("jskit_blueprint_prompt");
    assert.equal(projectKnowledgeStep.actions[0].enabled, true);

    const afterProjectKnowledgePrompt = await runtime.runAction("jskit_blueprint_prompt", "update_project_knowledge");
    assert.equal(afterProjectKnowledgePrompt.actionResult.promptId, "update_project_knowledge");
    assert.match(afterProjectKnowledgePrompt.actionResult.prompt, /Update the JSKIT project knowledge/u);
    assert.match(afterProjectKnowledgePrompt.actionResult.prompt, /\.jskit\/APP_BLUEPRINT\.md/u);
  });
});

test("jskit adapter disables blueprint updates when the blueprint file is missing", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    await rm(path.join(targetRoot, ".jskit/APP_BLUEPRINT.md"));
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter(),
      targetRoot
    });
    await runtime.createSession({
      initialStep: "project_knowledge_updated",
      sessionId: "jskit_no_blueprint"
    });

    const session = await runtime.getSession("jskit_no_blueprint");
    assert.deepEqual(session.actions, [
      {
        adapterCapability: "update_project_knowledge",
        disabledReason: "JSKIT target adapter does not support capability: update_project_knowledge.",
        enabled: false,
        id: "update_project_knowledge",
        label: "Update project knowledge",
        promptId: "update_project_knowledge",
        type: "prompt",
        visible: true
      }
    ]);
  });
});

test("jskit adapter runs middle-workflow commands and stores accepted commit metadata", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await createJskitProject(targetRoot);
    const calls = [];
    const commandResponses = {
      accept_changes: {
        message: "Accepted changes.",
        metadata: {
          changes_accepted: "yes"
        },
        status: "completed"
      },
      commit_changes: {
        message: "Committed accepted changes.",
        metadata: {
          accepted_commit: "abc1234"
        },
        status: "completed"
      },
      run_automated_checks: {
        message: "Automated checks passed.",
        metadata: {
          automated_checks_status: "passed"
        },
        status: "completed"
      }
    };
    const runtime = new AiStudioSessionRuntime({
      adapter: new JskitTargetAdapter({
        commandRunner: async ({ commandId }) => {
          calls.push(commandId);
          return commandResponses[commandId] || {
            message: `Unexpected command ${commandId}.`,
            status: "blocked"
          };
        }
      }),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot
    });

    await runtime.createSession({
      initialStep: "automated_checks_run",
      sessionId: "jskit_checks"
    });
    const afterChecks = await runtime.runAction("jskit_checks", "run_automated_checks");
    assert.equal(afterChecks.metadata.automated_checks_status, "passed");

    await runtime.createSession({
      initialStep: "changes_accepted",
      sessionId: "jskit_accept"
    });
    const beforeAccept = await runtime.getSession("jskit_accept");
    assert.equal(beforeAccept.next.enabled, false);
    assert.equal(beforeAccept.next.disabledReason, "Accept changes before continuing.");

    const afterAccept = await runtime.runAction("jskit_accept", "accept_changes");
    assert.equal(afterAccept.metadata.changes_accepted, "yes");
    assert.equal(afterAccept.next.enabled, true);

    await runtime.createSession({
      initialStep: "changes_committed",
      sessionId: "jskit_commit"
    });
    const beforeCommit = await runtime.getSession("jskit_commit");
    assert.equal(beforeCommit.next.enabled, false);
    assert.equal(beforeCommit.next.disabledReason, "Commit changes before continuing.");

    const afterCommit = await runtime.runAction("jskit_commit", "commit_changes");
    assert.equal(afterCommit.metadata.accepted_commit, "abc1234");
    assert.equal(afterCommit.next.enabled, true);
    assert.equal(await runtime.store.readMetadataValue("jskit_commit", "accepted_commit"), "abc1234");
    assert.deepEqual(calls, [
      "run_automated_checks",
      "accept_changes",
      "commit_changes"
    ]);
  });
});
