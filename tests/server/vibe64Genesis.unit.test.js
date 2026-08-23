import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { runVibe64Command } from "@local/vibe64-execution/server";
import { codexRuntimeContext } from "@local/studio-terminal-core/server/codexRuntimeContext";
import {
  GENESIS_DERIVED_ARTIFACT_PATHS,
  VIBE64_AUTOMATIC_HOOK_NO_OUTPUT,
  addGenesisStack,
  assertGenesisPromptTask,
  genesisCommandShimDirectory,
  genesisPackageBinDirectory,
  genesisPromptRequest,
  genesisPromptTask,
  initializeGenesisProject,
  inspectGenesisDerivedArtifacts,
  inspectGenesisEnvironment,
  inspectVibe64Launch,
  inspectVibe64WorkspaceSetup,
  inspectVibe64Deployment,
  parseVibe64DeploymentLines,
  parseVibe64LaunchLines,
  parseVibe64WorkspaceSetupLines,
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

test("Genesis inspection never falls back to the server working directory", async () => {
  await assert.rejects(
    () => inspectGenesisEnvironment({}),
    /explicit absolute projectRoot/u
  );
  await assert.rejects(
    () => inspectGenesisEnvironment({ projectRoot: "relative-project" }),
    /explicit absolute projectRoot/u
  );
});

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
  assert.match(prompt, /Do not send commentary, progress announcements/u);
  assert.match(prompt, new RegExp(VIBE64_AUTOMATIC_HOOK_NO_OUTPUT, "u"));
  assert.doesNotMatch(prompt, /VIBE64 NEW-PROJECT OPENING/u);
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

test("Vibe64 interprets its setup and launch contracts from the pinned Stack package", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await addGenesisStack({
      pieces: ["jskit"],
      projectRoot
    });
    assert.match(
      await readFile(path.join(projectRoot, "genesis", "stack.md"), "utf8"),
      /## Stack packages\n- `genesis-stack`/u
    );

    const waitingSetup = await inspectVibe64WorkspaceSetup({
      environment: {},
      projectRoot
    });
    assert.equal(waitingSetup.status, "unconfigured");
    assert.equal(waitingSetup.diagnostics[0].code, "VIBE64_WORKSPACE_SETUP_WAITING");

    await writeFile(path.join(projectRoot, "package.json"), "{}\n", "utf8");
    const setup = await inspectVibe64WorkspaceSetup({
      environment: {},
      projectRoot
    });
    const launch = await inspectVibe64Launch({
      environment: {},
      projectRoot
    });

    assert.equal(setup.status, "ready");
    assert.equal(setup.contract, "vibe64.workspace-setup.v1");
    assert.deepEqual(setup.steps.map((step) => step.argv), [["npm", "install"]]);
    assert.equal(launch.status, "ready");
    assert.equal(launch.contract, "vibe64.launch.v1");
    assert.equal(launch.targets[0].id, "app");
    assert.deepEqual(launch.targets[0].runtimeRequirements, ["nodejs"]);
    assert.deepEqual(launch.targets[0].steps.map((step) => step.argv), [
      ["npm", "run", "develop"]
    ]);
  });
});

test("Vibe64 owns deployment interpretation while Genesis exposes its opaque Stack section", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });

    const environment = await inspectGenesisEnvironment({ projectRoot });
    await writeFile(
      path.join(projectRoot, "genesis", "stack.md"),
      [
        "# Stack",
        "",
        "## Components",
        "",
        "## Deployment",
        "",
        "- Runtimes: `nodejs`",
        "- Ready when: `GET` `/health` returns `204`",
        "- Serve `Start`: `node` `server.js`",
        ""
      ].join("\n"),
      "utf8"
    );
    const deployment = await inspectVibe64Deployment({ projectRoot });

    assert.equal(environment.contract, "genesis.environment.v1");
    assert.equal(deployment.contract, "vibe64.application-deployment.v1");
    assert.equal(deployment.status, "ready");
    assert.equal(deployment.readiness.path, "/health");
    assert.deepEqual(deployment.steps.at(-1).argv, ["node", "server.js"]);
  });
});

test("Vibe64 rejects unsafe Deployment content that Genesis deliberately leaves opaque", () => {
  const invalid = [
    ["- Runtimes: `nodejs`", "- Serve `Start`: `npm` `start`"],
    ["- Workdir: `../escape`", "- Ready when: `GET` `/` returns `200`", "- Serve `Start`: `npm` `start`"],
    ["- Runtimes: `nodejs`", "- Ready when: `GET` `/` returns `200`", "- Serve `Start`: `npm start`"],
    ["- Recreate on restore: `../node_modules`", "- Ready when: `GET` `/` returns `200`", "- Prepare `Install`: `npm` `ci`", "- Serve `Start`: `npm` `start`"],
    ["- Recreate on restore: `node_modules`", "- Ready when: `GET` `/` returns `200`", "- Build `Build`: `npm` `run` `build`", "- Serve `Start`: `npm` `start`"],
    ["- Ready when: `GET` `/` returns `200`", "- Serve `Start`: `npm` `start`", "- Build `After start`: `npm` `run` `build`"],
    ["```json vibe64.application-deployment.v1", "{\"version\":1}", "```"]
  ];
  for (const lines of invalid) {
    assert.throws(
      () => parseVibe64DeploymentLines(lines),
      (error) => error?.code === "VIBE64_DEPLOYMENT_INVALID"
    );
  }
});

test("Vibe64 setup and launch parse only their canonical Markdown grammar", () => {
  assert.deepEqual(parseVibe64WorkspaceSetupLines([
    "- Prepare `Install` with `nodejs`: `npm` `install`"
  ]), [{
    label: "Install",
    argv: ["npm", "install"],
    runtimeRequirements: ["nodejs"],
    workdir: "."
  }]);

  const launch = parseVibe64LaunchLines([
    "### Target `app`: Run app",
    "",
    "- Default.",
    "- Runtimes: `nodejs`",
    "- Ready when: `GET` `/health` returns `200`",
    "- Serve `Develop`: `npm` `run` `develop`",
    "",
    "#### Preview identity",
    "",
    "- Command: `tools/preview-identity`",
    "- Protocol: `vibe64.preview-identity.command.v1`",
    "- Identity types: `email`",
    "- Runtimes: `nodejs`"
  ]);
  assert.equal(launch.targets[0].steps[0].role, "server");
  assert.equal(launch.targets[0].previewIdentity.protocol, "vibe64.preview-identity.command.v1");

  assert.throws(
    () => parseVibe64WorkspaceSetupLines([
      "```json vibe64.workspace-setup.v1",
      "{\"version\":1}",
      "```"
    ]),
    (error) => error?.code === "VIBE64_WORKSPACE_SETUP_INVALID"
  );
  assert.throws(
    () => parseVibe64LaunchLines([
      "```json vibe64.launch.v1",
      "{\"version\":1}",
      "```"
    ]),
    (error) => error?.code === "VIBE64_LAUNCH_INVALID"
  );
});

test("Vibe64 executes the current JSKIT Deployment declaration exactly", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await addGenesisStack({ pieces: ["jskit"], projectRoot });

    const deployment = await inspectVibe64Deployment({ projectRoot });

    assert.equal(deployment.contract, "vibe64.application-deployment.v1");
    assert.equal(deployment.source, "component:jskit");
    assert.deepEqual(deployment.artifact, { disposablePaths: ["node_modules"] });
    assert.deepEqual(deployment.steps.map(({ role, argv }) => ({ role, argv })), [
      { role: "prepare", argv: ["npm", "ci"] },
      { role: "build", argv: ["npm", "run", "build"] },
      { role: "migrate", argv: ["npm", "run", "db:prepare"] },
      { role: "serve", argv: ["npm", "start"] }
    ]);
    assert.deepEqual(deployment.readiness, {
      kind: "http",
      method: "GET",
      path: "/api/health",
      status: 200
    });
  });
});

test("the exact Genesis boundary exposes the portable derived-artifact contract", () => {
  const result = inspectGenesisDerivedArtifacts();

  assert.equal(result.contract, "genesis.derived-artifacts.v1");
  assert.deepEqual(GENESIS_DERIVED_ARTIFACT_PATHS, [
    ".genesis/machine-city.json",
    ".genesis/program-city.json"
  ]);
  assert.deepEqual(
    result.artifacts.map((artifact) => artifact.recreator),
    ["index-codebase", "index-codebase"]
  );
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
    assert.match(rendered.prompt, /"id": "jskit"/u);
    assert.match(rendered.prompt, /"id": "jskit-mysql"/u);
    assert.doesNotMatch(rendered.prompt, /"id": "vue"/u);
    assert.doesNotMatch(rendered.prompt, /"id": "jskit-postgresql"/u);
    assert.doesNotMatch(rendered.prompt, /"id": "postgresql"/u);
    assert.match(rendered.prompt, /interface has already welcomed the person/u);
    assert.match(rendered.prompt, /without repeating that greeting/u);
    assert.match(rendered.prompt, /invite them to write what they would like to make/u);
    assert.match(rendered.prompt, /genesis stack add jskit-mysql/u);
    assert.match(rendered.prompt, /otherwise run `genesis stack add jskit`/u);
    assert.match(rendered.prompt, /Do not ask the person to choose a database/u);
    assert.match(rendered.prompt, /PostgreSQL is temporarily unavailable/u);
    assert.match(rendered.prompt, /explicitly requests PostgreSQL/u);
    assert.match(rendered.prompt, /do not silently substitute MySQL/u);
    assert.match(rendered.prompt, /Do not offer standalone `vue`/u);
    assert.match(rendered.prompt, /Do not mention Genesis, Stack, JSKIT, Vue/u);
    assert.ok(
      rendered.prompt.indexOf("explicit Vibe64 host default") >
        rendered.prompt.indexOf("Never silently select a technology")
    );
  });
});

test("Vibe64 keeps its installed Stack catalog available for a migrated project prompt", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });
    await writeFile(
      path.join(projectRoot, "genesis", "blueprint.md"),
      "# Blueprint\n\nPeople manage an existing application.\n",
      "utf8"
    );
    await writeFile(
      path.join(projectRoot, "genesis", "stack.md"),
      "# Stack\n\n## Components\n- `nodejs`\n- `jskit`\n- `vue`\n",
      "utf8"
    );
    await writeFile(path.join(projectRoot, "app.js"), "export const app = true;\n", "utf8");

    const rendered = await renderGenesisPrompt({
      input: {
        conversationRequest: "Continue the existing work."
      },
      projectRoot
    });

    assert.equal(rendered.context.genesis, true);
    assert.equal(rendered.context.task, "work");
    assert.match(rendered.prompt, /Continue the existing work\./u);
    assert.match(rendered.prompt, /SELECTED STACK GUIDANCE/u);
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
    assert.match(
      rendered.prompt,
      /strongly recommend preparing the existing project for\s+guided editing/u
    );
    assert.match(rendered.prompt, /Do not require the user to know\s+Genesis terminology/u);
    assert.match(rendered.prompt, /If they approve, run `genesis adopt`\s+yourself/u);
    await assert.rejects(
      () => readFile(path.join(projectRoot, "genesis", "blueprint.md"), "utf8"),
      { code: "ENOENT" }
    );
  });
});

test("Codex execution shims receive the installed Genesis executable exactly once", () => {
  const bin = genesisCommandShimDirectory();
  const first = withGenesisCommandShim(["/managed/git", genesisPackageBinDirectory(), bin]);
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
  assert.equal(result.stdout.trim(), path.join(genesisCommandShimDirectory(), "genesis"));
});

test("the managed Genesis command exposes Vibe64's curated Stack catalog", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });

    const result = await execFileAsync(path.join(genesisCommandShimDirectory(), "genesis"), [
      "stack",
      "add",
      "jskit"
    ], {
      cwd: projectRoot
    });

    assert.match(result.stdout, /stack: updated/u);
    const stack = await readFile(path.join(projectRoot, "genesis", "stack.md"), "utf8");
    assert.match(stack, /- `genesis-stack`/u);
    assert.match(stack, /- `jskit`/u);
    assert.match(stack, /- `nodejs`/u);
  });
});

test("the temporary onboarding gate preserves the installed PostgreSQL Stack piece", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await initializeGit(projectRoot);
    await initializeGenesisProject({ projectRoot });

    const result = await execFileAsync(path.join(genesisCommandShimDirectory(), "genesis"), [
      "stack",
      "add",
      "jskit-postgresql"
    ], {
      cwd: projectRoot
    });

    assert.match(result.stdout, /stack: updated/u);
    const stack = await readFile(path.join(projectRoot, "genesis", "stack.md"), "utf8");
    assert.match(stack, /- `jskit-postgresql`/u);
    assert.match(stack, /- `postgresql`/u);
  });
});
