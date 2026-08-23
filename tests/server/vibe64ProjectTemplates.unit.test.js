import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  PROJECT_TEMPLATES,
  applyProjectTemplate,
  projectTemplate,
  projectTemplateEligibility,
  readProjectTemplates
} from "../../packages/vibe64-project/src/server/projectTemplates.js";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT
} from "../../packages/vibe64-core/src/server/projectRepository.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);
async function git(cwd, args = []) {
  const result = await execFileAsync("git", args, {
    cwd
  });
  return String(result.stdout || "").trim();
}

async function runGatewayCommand(request = {}) {
  try {
    const result = await execFileAsync(request.command, request.args || [], {
      cwd: request.cwd
    });
    return {
      ok: true,
      output: `${result.stdout || ""}${result.stderr || ""}`,
      stderr: String(result.stderr || ""),
      stdout: String(result.stdout || "")
    };
  } catch (error) {
    return {
      code: "vibe64_test_command_failed",
      ok: false,
      output: `${error?.stdout || ""}${error?.stderr || error?.message || ""}`,
      stderr: String(error?.stderr || error?.message || ""),
      stdout: String(error?.stdout || "")
    };
  }
}

function githubTemplateProject(remotePath, runtimeRoot) {
  return {
    githubMirrorPath: path.join(runtimeRoot, "github-mirror", "repository.git"),
    projectRuntimeRoot: runtimeRoot,
    repository: {
      defaultBranch: "main",
      github: {
        cloneUrl: remotePath,
        fullName: "local/destination"
      },
      mode: PROJECT_REPOSITORY_MODE_GITHUB
    },
    repositoryMode: PROJECT_REPOSITORY_MODE_GITHUB
  };
}

async function createSeedRepository(root, {
  id = "jskit-test",
  repository = "local/jskit-test"
} = {}) {
  await mkdir(root, {
    recursive: true
  });
  await git(root, ["init", "--initial-branch=main"]);
  await writeFile(path.join(root, "README.md"), "# Test project template\n", "utf8");
  await writeFile(path.join(root, "vibe64.seed.json"), `${JSON.stringify({
    schema: "vibe64.seed",
    schemaVersion: 1,
    id,
    name: "Test",
    kind: "starter",
    repository,
    basedOn: null
  }, null, 2)}\n`, "utf8");
  await git(root, ["add", "-A"]);
  await git(root, [
    "-c",
    "user.name=Vibe64 Test",
    "-c",
    "user.email=vibe64@example.invalid",
    "commit",
    "-m",
    "Create test seed"
  ]);
  return git(root, ["rev-parse", "HEAD"]);
}

function testTemplate(seedRoot, overrides = {}) {
  return projectTemplate({
    accent: "sky",
    capabilities: ["Test capability"],
    cloneUrl: seedRoot,
    description: "A complete test template.",
    icon: "web",
    id: "jskit-test",
    name: "Test",
    order: 1,
    repository: "local/jskit-test",
    repositoryUrl: "https://example.invalid/local/jskit-test",
    stackPieces: ["nodejs"],
    tagline: "A useful test project",
    ...overrides
  });
}

async function assertSingleRootCommit(cwd, {
  gitDir = "",
  ref = "refs/heads/main"
} = {}) {
  const prefix = gitDir ? ["--git-dir", gitDir] : [];
  assert.equal(await git(cwd, [...prefix, "rev-list", "--count", ref]), "1");
  assert.equal(
    (await git(cwd, [...prefix, "rev-list", "--parents", "-n", "1", ref]))
      .split(/\s+/u)
      .filter(Boolean)
      .length,
    1
  );
}

test("project templates expose friendly trusted registry records", async () => {
  const result = await readProjectTemplates({
    project: {
      repositoryMode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
    },
    projectRuntimeRoot: "/tmp/vibe64-template-registry-runtime",
    sourceRoot: "/path/that/does/not/exist"
  });

  assert.equal(result.ok, true);
  assert.equal(result.eligibility.eligible, false);
  assert.deepEqual(result.templates.map((template) => template.id), [
    "genesis-blank",
    "jskit-public",
    "jskit-accounts",
    "jskit-database",
    "jskit-workspaces"
  ]);
  assert.equal(result.templates[0].cloneUrl, undefined);
  assert.match(result.templates[0].description, /only Git and Genesis/u);
});

test("the blank starter creates one Genesis root commit without selecting technology", async () => {
  await withTemporaryRoot(async (root) => {
    const sourceRoot = path.join(root, "project");
    const runtimeRoot = path.join(root, "runtime");
    await mkdir(sourceRoot, {
      recursive: true
    });

    const result = await applyProjectTemplate({
      project: {
        repository: {
          defaultBranch: "main",
          mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
        },
        repositoryMode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      projectRuntimeRoot: runtimeRoot,
      sourceRoot,
      templateId: "genesis-blank",
      templates: [PROJECT_TEMPLATES[0]]
    });

    assert.equal(result.ok, true);
    assert.equal(result.materialization.sourceRevision, "");
    await assertSingleRootCommit(sourceRoot);
    assert.match(await readFile(path.join(sourceRoot, "genesis", "blueprint.md"), "utf8"), /Blueprint/u);
    assert.match(await readFile(path.join(sourceRoot, "genesis", "stack.md"), "utf8"), /Stack/u);
    assert.ok(JSON.parse(await readFile(path.join(sourceRoot, ".codex", "hooks.json"), "utf8")));
  });
});

test("project templates materialize an empty local source as one new root commit", async () => {
  await withTemporaryRoot(async (root) => {
    const seedRoot = path.join(root, "seed");
    const sourceRoot = path.join(root, "project");
    const runtimeRoot = path.join(root, "runtime");
    const sourceRevision = await createSeedRepository(seedRoot);
    await mkdir(sourceRoot, {
      recursive: true
    });

    const result = await applyProjectTemplate({
      project: {
        repository: {
          defaultBranch: "main",
          mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
        },
        repositoryMode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      projectRuntimeRoot: runtimeRoot,
      sourceRoot,
      templateId: "jskit-test",
      templates: [testTemplate(seedRoot)]
    });

    assert.equal(result.ok, true);
    assert.equal(result.materialization.sourceRevision, sourceRevision);
    assert.notEqual(result.materialization.commit, sourceRevision);
    assert.equal(await readFile(path.join(sourceRoot, "README.md"), "utf8"), "# Test project template\n");
    assert.match(await readFile(path.join(sourceRoot, "genesis", "stack.md"), "utf8"), /nodejs/u);
    await assert.rejects(() => readFile(path.join(sourceRoot, "vibe64.seed.json"), "utf8"), {
      code: "ENOENT"
    });
    await assertSingleRootCommit(sourceRoot);
    assert.match(await git(sourceRoot, ["log", "-1", "--format=%B"]), /Vibe64-Starter: jskit-test/u);

    const after = await projectTemplateEligibility({
      project: {
        repositoryMode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      projectRuntimeRoot: runtimeRoot,
      sourceRoot
    });
    assert.equal(after.eligible, false);
    assert.equal(after.code, "vibe64_project_template_destination_not_empty");
  });
});

test("project templates reject source metadata outside the trusted registry", async () => {
  await withTemporaryRoot(async (root) => {
    const seedRoot = path.join(root, "seed");
    const sourceRoot = path.join(root, "project");
    const runtimeRoot = path.join(root, "runtime");
    await createSeedRepository(seedRoot, {
      id: "another-template"
    });
    await mkdir(sourceRoot, {
      recursive: true
    });

    await assert.rejects(
      () => applyProjectTemplate({
        project: {
          repository: {
            defaultBranch: "main",
            mode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
          },
          repositoryMode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
        },
        projectRuntimeRoot: runtimeRoot,
        sourceRoot,
        templateId: "jskit-test",
        templates: [testTemplate(seedRoot)]
      }),
      {
        code: "vibe64_project_template_metadata_mismatch"
      }
    );
  });
});

test("project templates materialize managed canonical Git as one root commit", async () => {
  await withTemporaryRoot(async (root) => {
    const seedRoot = path.join(root, "seed");
    const hostedNamespace = path.join(root, "project");
    const runtimeRoot = path.join(root, "runtime");
    const repositoryPath = path.join(runtimeRoot, "canonical-repository", "repository.git");
    await createSeedRepository(seedRoot);
    await mkdir(path.join(hostedNamespace, ".git"), {
      recursive: true
    });
    await mkdir(runtimeRoot, {
      recursive: true
    });
    await writeFile(path.join(hostedNamespace, ".git", "HOSTILE"), "must remain untouched\n", "utf8");

    const result = await applyProjectTemplate({
      project: {
        canonicalRepositoryPath: repositoryPath,
        repository: {
          defaultBranch: "main",
          mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
        },
        repositoryMode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
      },
      projectRuntimeRoot: runtimeRoot,
      templateId: "jskit-test",
      templates: [testTemplate(seedRoot)]
    });

    assert.equal(result.materialization.repositoryMode, PROJECT_REPOSITORY_MODE_MANAGED_GIT);
    assert.equal(
      await git(runtimeRoot, ["--git-dir", repositoryPath, "show", "main:README.md"]),
      "# Test project template"
    );
    await assert.rejects(
      () => git(runtimeRoot, ["--git-dir", repositoryPath, "show", "main:vibe64.seed.json"]),
      /does not exist in/u
    );
    await assertSingleRootCommit(runtimeRoot, {
      gitDir: repositoryPath
    });
    assert.equal(
      await readFile(path.join(hostedNamespace, ".git", "HOSTILE"), "utf8"),
      "must remain untouched\n"
    );
  });
});

test("project templates push one root commit to an empty GitHub-backed destination", async () => {
  await withTemporaryRoot(async (root) => {
    const seedRoot = path.join(root, "seed");
    const hostedNamespace = path.join(root, "project");
    const runtimeRoot = path.join(root, "runtime");
    const repositoryPath = path.join(runtimeRoot, "github-mirror", "repository.git");
    const remotePath = path.join(root, "destination.git");
    await createSeedRepository(seedRoot);
    await mkdir(path.join(hostedNamespace, ".git"), {
      recursive: true
    });
    await writeFile(path.join(hostedNamespace, ".git", "HOSTILE"), "must remain untouched\n", "utf8");
    await mkdir(runtimeRoot, {
      recursive: true
    });
    await git(root, ["init", "--bare", remotePath]);

    const result = await applyProjectTemplate({
      env: {},
      project: {
        githubMirrorPath: repositoryPath,
        githubRepository: {
          cloneUrl: remotePath,
          fullName: "local/destination"
        },
        repository: {
          defaultBranch: "main",
          github: {
            cloneUrl: remotePath,
            fullName: "local/destination"
          },
          mode: PROJECT_REPOSITORY_MODE_GITHUB
        },
        repositoryMode: PROJECT_REPOSITORY_MODE_GITHUB
      },
      projectRuntimeRoot: runtimeRoot,
      templateId: "jskit-test",
      templates: [testTemplate(seedRoot)]
    });

    assert.equal(result.materialization.repositoryMode, PROJECT_REPOSITORY_MODE_GITHUB);
    assert.equal(
      await git(root, ["--git-dir", remotePath, "rev-parse", "refs/heads/main"]),
      result.materialization.commit
    );
    await assertSingleRootCommit(runtimeRoot, {
      gitDir: repositoryPath
    });
    await assertSingleRootCommit(root, {
      gitDir: remotePath
    });
    assert.equal(
      await readFile(path.join(hostedNamespace, ".git", "HOSTILE"), "utf8"),
      "must remain untouched\n"
    );
  });
});

test("GitHub blank materialization is token-backed, runtime-owned, and journals before publication", async () => {
  await withTemporaryRoot(async (root) => {
    const remotePath = path.join(root, "destination.git");
    const runtimeRoot = path.join(root, "runtime");
    const stages = [];
    const requests = [];
    await git(root, ["init", "--bare", "--initial-branch=main", remotePath]);
    await mkdir(runtimeRoot, {
      recursive: true
    });

    const result = await applyProjectTemplate({
      afterAuthorityVerification: async (materialization) => {
        stages.push("verified");
        assert.equal(
          await git(root, ["--git-dir", remotePath, "rev-parse", "refs/heads/main"]),
          materialization.commit
        );
        await assert.rejects(() => readdir(path.join(runtimeRoot, "github-mirror")), {
          code: "ENOENT"
        });
      },
      beforeAuthorityMutation: async (materialization) => {
        stages.push("prepared");
        assert.match(materialization.commit, /^[0-9a-f]{40}$/u);
        await assert.rejects(
          () => git(root, ["--git-dir", remotePath, "rev-parse", "refs/heads/main"])
        );
      },
      env: {},
      input: {
        gitAuthToken: "test-github-token"
      },
      project: githubTemplateProject(remotePath, runtimeRoot),
      projectRuntimeRoot: runtimeRoot,
      runCommand: async (request) => {
        requests.push(request);
        return runGatewayCommand(request);
      },
      templateId: "genesis-blank",
      templates: [PROJECT_TEMPLATES[0]]
    });

    assert.deepEqual(stages, ["prepared", "verified"]);
    assert.equal(result.materialization.mirrorRefreshed, true);
    assert.equal(
      await git(root, ["--git-dir", remotePath, "rev-parse", "refs/heads/main"]),
      result.materialization.commit
    );
    assert.match(
      await git(root, ["--git-dir", remotePath, "show", "main:genesis/blueprint.md"]),
      /Blueprint/u
    );
    await assertSingleRootCommit(root, {
      gitDir: remotePath
    });
    assert.deepEqual(await readdir(path.join(runtimeRoot, "tmp")), []);

    const githubRequests = requests.filter((request) => request.gitTransport === "github-token");
    assert.ok(githubRequests.length > 0);
    assert.ok(githubRequests.every((request) => request.actor === "daemon"));
    assert.ok(githubRequests.every((request) => request.gitAuthToken === "test-github-token"));
    assert.ok(githubRequests.every((request) => !request.args.some((arg) => String(arg).includes("test-github-token"))));
    await assertSingleRootCommit(runtimeRoot, {
      gitDir: path.join(runtimeRoot, "github-mirror", "repository.git")
    });
    assert.deepEqual(await readdir(path.join(runtimeRoot, "tmp")), []);
  });
});

test("GitHub materialization rejects an unrelated non-empty repository", async () => {
  await withTemporaryRoot(async (root) => {
    const sourceRoot = path.join(root, "existing-source");
    const remotePath = path.join(root, "destination.git");
    const runtimeRoot = path.join(root, "runtime");
    const existingCommit = await createSeedRepository(sourceRoot);
    await git(root, ["clone", "--bare", sourceRoot, remotePath]);
    await mkdir(runtimeRoot, {
      recursive: true
    });

    await assert.rejects(
      () => applyProjectTemplate({
        env: {},
        input: {
          gitAuthToken: "test-github-token"
        },
        project: githubTemplateProject(remotePath, runtimeRoot),
        projectRuntimeRoot: runtimeRoot,
        runCommand: runGatewayCommand,
        templateId: "genesis-blank",
        templates: [PROJECT_TEMPLATES[0]]
      }),
      {
        code: "vibe64_project_template_destination_not_empty",
        statusCode: 409
      }
    );

    assert.equal(
      await git(root, ["--git-dir", remotePath, "rev-parse", "refs/heads/main"]),
      existingCommit
    );
    await assert.rejects(() => readdir(path.join(runtimeRoot, "tmp")), {
      code: "ENOENT"
    });
    await assert.rejects(() => readdir(path.join(runtimeRoot, "github-mirror")), {
      code: "ENOENT"
    });
  });
});

test("GitHub materialization preserves verified publication when mirror refresh fails", async () => {
  await withTemporaryRoot(async (root) => {
    const remotePath = path.join(root, "destination.git");
    const runtimeRoot = path.join(root, "runtime");
    await git(root, ["init", "--bare", "--initial-branch=main", remotePath]);
    await mkdir(runtimeRoot, {
      recursive: true
    });

    const result = await applyProjectTemplate({
      env: {},
      input: {
        gitAuthToken: "test-github-token"
      },
      project: githubTemplateProject(remotePath, runtimeRoot),
      projectRuntimeRoot: runtimeRoot,
      runCommand: async (request) => {
        if (
          request.command === "bash" &&
          request.args?.[0] === "-c" &&
          request.args?.[2] === "vibe64-github-mirror-refresh"
        ) {
          return {
            code: "vibe64_test_mirror_failed",
            ok: false,
            stderr: "simulated disposable mirror failure"
          };
        }
        return runGatewayCommand(request);
      },
      templateId: "genesis-blank",
      templates: [PROJECT_TEMPLATES[0]]
    });

    assert.equal(result.materialization.mirrorRefreshed, false);
    assert.equal(
      await git(root, ["--git-dir", remotePath, "rev-parse", "refs/heads/main"]),
      result.materialization.commit
    );
    await assertSingleRootCommit(root, {
      gitDir: remotePath
    });
    assert.deepEqual(await readdir(path.join(runtimeRoot, "tmp")), []);
  });
});

test("GitHub materialization removes temporary work after every authoritative and journal failure stage", async () => {
  await withTemporaryRoot(async (root) => {
    for (const stage of [
      "genesis",
      "commit",
      "before-authority",
      "push",
      "verification",
      "after-verification"
    ]) {
      const caseRoot = path.join(root, stage);
      const remotePath = path.join(caseRoot, "destination.git");
      const runtimeRoot = path.join(caseRoot, "runtime");
      let remoteReadCount = 0;
      await mkdir(caseRoot, {
        recursive: true
      });
      await git(caseRoot, ["init", "--bare", "--initial-branch=main", remotePath]);
      await mkdir(runtimeRoot, {
        recursive: true
      });

      const runCommand = async (request) => {
        if (
          (stage === "commit" && request.command === "git" && request.args?.includes("commit")) ||
          (stage === "push" && request.command === "git" && request.args?.includes("push"))
        ) {
          return {
            code: `vibe64_test_${stage}_failed`,
            ok: false,
            stderr: `simulated ${stage} failure`
          };
        }
        const result = await runGatewayCommand(request);
        if (request.command === "git" && request.args?.includes("ls-remote")) {
          remoteReadCount += 1;
          if (stage === "verification" && remoteReadCount === 2) {
            const output = `${"0".repeat(40)}\trefs/heads/main\n`;
            return {
              ...result,
              output,
              stdout: output
            };
          }
        }
        return result;
      };

      await assert.rejects(() => applyProjectTemplate({
        ...(stage === "after-verification" ? {
          afterAuthorityVerification: async () => {
            throw new Error("simulated verified-journal failure");
          }
        } : {}),
        ...(stage === "before-authority" ? {
          beforeAuthorityMutation: async () => {
            throw new Error("simulated prepared-journal failure");
          }
        } : {}),
        env: {},
        ...(stage === "genesis" ? {
          initializeProject: async () => {
            const error = new Error("simulated Genesis failure");
            error.code = "vibe64_test_genesis_failed";
            throw error;
          }
        } : {}),
        input: {
          gitAuthToken: "test-github-token"
        },
        project: githubTemplateProject(remotePath, runtimeRoot),
        projectRuntimeRoot: runtimeRoot,
        runCommand,
        templateId: "genesis-blank",
        templates: [PROJECT_TEMPLATES[0]]
      }));

      assert.deepEqual(await readdir(path.join(runtimeRoot, "tmp")), [], stage);
    }
  });
});

test("project template eligibility rejects source, history, and active sessions", async () => {
  await withTemporaryRoot(async (root) => {
    const sourceRoot = path.join(root, "source");
    const runtimeRoot = path.join(root, "runtime");
    await mkdir(sourceRoot, {
      recursive: true
    });
    await writeFile(path.join(sourceRoot, "existing.txt"), "existing\n", "utf8");

    const existingSource = await projectTemplateEligibility({
      project: {
        repositoryMode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      projectRuntimeRoot: runtimeRoot,
      sourceRoot
    });
    assert.equal(existingSource.eligible, false);
    assert.equal(existingSource.code, "vibe64_project_template_destination_not_empty");

    const emptyTarget = path.join(root, "empty-project");
    const activeRuntime = path.join(root, "active-runtime");
    await mkdir(emptyTarget, {
      recursive: true
    });
    await mkdir(path.join(activeRuntime, "sessions", "active", "session-1"), {
      recursive: true
    });
    const activeSession = await projectTemplateEligibility({
      project: {
        repositoryMode: PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      },
      projectRuntimeRoot: activeRuntime,
      sourceRoot: emptyTarget
    });
    assert.equal(activeSession.eligible, false);
    assert.equal(activeSession.code, "vibe64_project_template_active_sessions");

    const importedRoot = path.join(root, "imported");
    await createSeedRepository(importedRoot);
    await mkdir(runtimeRoot, {
      recursive: true
    });
    const importedGithub = await projectTemplateEligibility({
      checkGithubRemote: true,
      project: {
        repository: {
          defaultBranch: "main",
          github: {
            cloneUrl: importedRoot,
            fullName: "local/imported"
          },
          mode: PROJECT_REPOSITORY_MODE_GITHUB
        },
        repositoryMode: PROJECT_REPOSITORY_MODE_GITHUB
      },
      projectRuntimeRoot: runtimeRoot
    });
    assert.equal(importedGithub.eligible, false);
    assert.equal(importedGithub.code, "vibe64_project_template_destination_not_empty");
  });
});

test("concurrent project template requests serialize and only one can commit", async () => {
  await withTemporaryRoot(async (root) => {
    const seedRoot = path.join(root, "seed");
    const runtimeRoot = path.join(root, "runtime");
    const canonicalRepositoryPath = path.join(runtimeRoot, "canonical-repository", "repository.git");
    await createSeedRepository(seedRoot);
    await mkdir(runtimeRoot, {
      recursive: true
    });
    const options = {
      project: {
        canonicalRepositoryPath,
        repository: {
          defaultBranch: "main",
          mode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
        },
        repositoryMode: PROJECT_REPOSITORY_MODE_MANAGED_GIT
      },
      projectRuntimeRoot: runtimeRoot,
      templateId: "jskit-test",
      templates: [testTemplate(seedRoot)]
    };

    const results = await Promise.allSettled([
      applyProjectTemplate(options),
      applyProjectTemplate(options),
      applyProjectTemplate(options)
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 2);
    for (const rejected of results.filter((result) => result.status === "rejected")) {
      assert.equal(rejected.reason.code, "vibe64_project_template_destination_not_empty");
    }
    await assertSingleRootCommit(runtimeRoot, {
      gitDir: canonicalRepositoryPath
    });
  });
});
