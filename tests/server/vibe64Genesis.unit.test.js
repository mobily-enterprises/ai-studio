import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { runVibe64Command } from "@local/vibe64-execution/server";
import { codexRuntimeContext } from "@local/studio-terminal-core/server/codexRuntimeContext";
import {
  addGenesisStack,
  assertGenesisPromptTask,
  genesisPackageBinDirectory,
  genesisPromptRequest,
  genesisPromptTask,
  initializeGenesisProject,
  inspectGenesisLaunch,
  inspectGenesisWorkspaceSetup,
  renderGenesisPrompt,
  withVibe64ConversationContract,
  withGenesisCommandShim
} from "../../packages/vibe64-genesis/src/server/index.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);

async function initializeGit(projectRoot) {
  await execFileAsync("git", ["init", "--initial-branch=main"], {
    cwd: projectRoot
  });
}

test("the Genesis integration maps Vibe actions to explicit Genesis tasks and requests", () => {
  assert.equal(genesisPromptTask({ genesisTask: "program" }), "program");
  assert.equal(genesisPromptTask({ genesisTask: "deslop", promptId: "anything" }), "deslop");
  assert.equal(genesisPromptTask({ promptId: "obsolete-prompt-id" }), "work");
  assert.equal(genesisPromptTask({ promptId: "unknown" }), "work");
  assert.equal(assertGenesisPromptTask("review", { required: true }), "review");
  assert.throws(
    () => genesisPromptTask({ genesisTask: "deslopp" }),
    /Unknown Genesis prompt task: deslopp/u
  );
  assert.throws(
    () => assertGenesisPromptTask("", { required: true }),
    /require an explicit task/u
  );
  assert.equal(genesisPromptRequest({ conversationRequest: "  Build it.  " }), "Build it.");
  assert.equal(genesisPromptRequest({}, { label: "Inspect this" }), "Inspect this");
});

test("Vibe64 keeps structured questions as a direct-chat presentation contract", () => {
  const prompt = withVibe64ConversationContract("Build the requested feature.");

  assert.match(prompt, /Build the requested feature\./u);
  assert.match(prompt, /no more than three concise/u);
  assert.match(prompt, /`\[1\] Question`/u);
  assert.match(prompt, /`Possible answers:`/u);
});

test("Genesis initialization creates its complete technology-neutral project", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);

    const result = await initializeGenesisProject({ projectRoot });

    assert.equal(result.status, "updated");
    assert.match(await readFile(path.join(projectRoot, "genesis", "blueprint.md"), "utf8"), /# Blueprint/u);
    assert.match(await readFile(path.join(projectRoot, "genesis", "stack.md"), "utf8"), /# Stack/u);
    assert.ok(JSON.parse(await readFile(path.join(projectRoot, ".codex", "hooks.json"), "utf8")));
    assert.ok(JSON.parse(await readFile(path.join(projectRoot, ".genesis", "machine-city.json"), "utf8")));
    assert.ok(JSON.parse(await readFile(path.join(projectRoot, ".genesis", "program-city.json"), "utf8")));
  });
});

test("the integration reads launch targets from the pinned Genesis package", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await addGenesisStack({
      pieces: ["jskit"],
      projectRoot
    });

    const waitingSetup = await inspectGenesisWorkspaceSetup({
      environment: {},
      projectRoot
    });
    assert.equal(waitingSetup.status, "unconfigured");
    assert.equal(waitingSetup.diagnostics[0].code, "STACK_WORKSPACE_SETUP_WAITING");

    await writeFile(path.join(projectRoot, "package.json"), "{}\n", "utf8");
    const setup = await inspectGenesisWorkspaceSetup({
      environment: {},
      projectRoot
    });
    const launch = await inspectGenesisLaunch({
      environment: {},
      projectRoot
    });

    assert.equal(setup.status, "ready");
    assert.deepEqual(setup.steps.map((step) => step.argv), [["npm", "install"]]);
    assert.equal(launch.status, "ready");
    assert.equal(launch.targets[0].id, "app");
    assert.deepEqual(launch.targets[0].runtimeRequirements, ["nodejs"]);
    assert.deepEqual(launch.targets[0].steps.map((step) => step.argv), [
      ["npm", "run", "build"],
      ["npm", "start"]
    ]);
  });
});

test("a blank initialized project stays in Genesis onboarding before ordinary work", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });

    const rendered = await renderGenesisPrompt({
      action: {
        promptId: "conversation"
      },
      input: {
        conversationRequest: "Build a book catalogue."
      },
      projectRoot
    });

    assert.equal(rendered.context.genesis, true);
    assert.equal(rendered.context.requestedTask, "work");
    assert.equal(rendered.context.task, "start");
    assert.match(rendered.prompt, /Build a book catalogue\./u);
    assert.match(rendered.prompt, /"projectKind": "new"/u);
    assert.match(rendered.prompt, /"availableStackPieces": \[/u);
  });
});

test("Genesis owns the opening conversation for an existing uninitialized project", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await writeFile(path.join(projectRoot, "app.js"), "export const answer = 42;\n", "utf8");

    const rendered = await renderGenesisPrompt({
      input: {
        conversationRequest: "Change the answer."
      },
      projectRoot
    });

    assert.equal(rendered.context.genesis, true);
    assert.equal(rendered.context.requestedTask, "work");
    assert.equal(rendered.context.task, "start");
    assert.match(rendered.prompt, /"projectKind": "existing-uninitialized"/u);
    assert.match(rendered.prompt, /strongly recommend `genesis adopt`/u);
    await assert.rejects(
      () => readFile(path.join(projectRoot, "genesis", "blueprint.md"), "utf8"),
      { code: "ENOENT" }
    );
  });
});

test("Codex execution shims receive the installed Genesis executable exactly once", () => {
  const bin = genesisPackageBinDirectory();
  const first = withGenesisCommandShim(["/managed/git", bin]);
  const second = withGenesisCommandShim(first);

  assert.deepEqual(first, ["/managed/git", bin]);
  assert.equal(second.filter((entry) => entry === bin).length, 1);
});

test("Codex discovers Genesis through execution shims without caller-owned PATH", async () => {
  const codexRuntime = codexRuntimeContext({
    terminalEnv: {
      GENESIS_RESOURCE: "available"
    }
  });

  assert.equal(codexRuntime.ok, true);
  assert.equal(Object.hasOwn(codexRuntime.terminalEnv, "PATH"), false);
  const result = await runVibe64Command({
    actor: "app",
    args: ["-lc", "command -v genesis"],
    baseEnv: codexRuntime.env,
    command: "bash",
    env: codexRuntime.terminalEnv,
    envPolicy: "auth",
    mode: "capture",
    purpose: "codex",
    runtimes: codexRuntime.runtimes,
    shimDirs: withGenesisCommandShim()
  });

  assert.equal(result.ok, true, result.output);
  assert.equal(result.stdout.trim(), path.join(genesisPackageBinDirectory(), "genesis"));
});
