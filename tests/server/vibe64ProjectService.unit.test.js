import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  createService
} from "../../packages/vibe64-project/src/server/service.js";
import {
  createStudioProjectContext
} from "../../packages/vibe64-core/src/server/studioProjectContext.js";
import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

function projectService(targetRoot, options = {}) {
  return createService({
    env: {},
    projectContext: createStudioProjectContext({
      explicitManagedSourceRoot: path.join(path.dirname(targetRoot), "managed-source"),
      explicitSystemRoot: path.join(path.dirname(targetRoot), "system"),
      explicitTargetRoot: targetRoot,
      home: path.dirname(targetRoot)
    }),
    ...options
  });
}

test("an explicit project exposes one plain Genesis project", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);
    const response = await service.listProjects();

    assert.equal(response.ok, true);
    assert.equal(response.hasSelection, true);
    assert.equal(response.projects.length, 1);
    assert.equal(response.currentProject.path, targetRoot);
    assert.equal(response.currentProject.selected, true);
    assert.equal("workflowRepositoryProfile" in response.currentProject, false);
    assert.equal("adapter" in response.currentProject, false);
  });
});

test("a catalog project can be created and selected without project-type setup", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectsRoot = path.join(temporaryRoot, "projects");
    const projectContext = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(temporaryRoot, "managed-source"),
      explicitProjectsRoot: projectsRoot,
      explicitSystemRoot: path.join(temporaryRoot, "system"),
      home: temporaryRoot
    });
    const service = createService({
      env: {},
      projectContext
    });

    const created = await service.createProject({
      name: "Book catalogue"
    });

    assert.equal(created.ok, true);
    assert.equal(created.currentProject.slug, "book-catalogue");
    assert.equal((await service.listProjects()).projects.length, 1);
    assert.equal(service.currentTargetRoot(), path.join(projectsRoot, "book-catalogue"));
  });
});

test("foundation state recommends Genesis adoption but never blocks ordinary chat", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);

    assert.deepEqual(await service.requireProjectFoundation(), {
      genesisReady: false,
      ok: true,
      ready: true,
      status: "adoption-recommended"
    });

    await mkdir(path.join(targetRoot, "genesis"), {
      recursive: true
    });
    await Promise.all([
      writeFile(path.join(targetRoot, "genesis", "blueprint.md"), "# Blueprint\n", "utf8"),
      writeFile(path.join(targetRoot, "genesis", "stack.md"), "# Stack\n", "utf8")
    ]);

    const response = await service.readProjectFoundation();
    assert.equal(response.ok, true);
    assert.equal(response.genesisReady, true);
    assert.equal(response.status, "genesis-ready");
  });
});

test("Env is user-owned and reaches Genesis sessions without an adapter", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot, {
      env: {
        PLATFORM_VALUE: "platform"
      }
    });

    const saved = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        BOOKS_API_KEY: {
          secret: true,
          value: "secret-value"
        },
        BOOKS_ORIGIN: {
          secret: false,
          value: "http://books.test"
        }
      }
    });

    assert.equal(saved.ok, true);
    assert.equal(saved.env.records.find((record) => record.key === "BOOKS_API_KEY").value, "********");
    assert.deepEqual(await service.projectUserEnvironment({
      scope: "dev"
    }), {
      BOOKS_API_KEY: "secret-value",
      BOOKS_ORIGIN: "http://books.test"
    });

    const runtime = await service.createRuntime();
    assert.equal(runtime.promptEnvironment.PLATFORM_VALUE, "platform");
    assert.equal(runtime.promptEnvironment.BOOKS_API_KEY, "secret-value");
    assert.equal(runtime.adapter, undefined);
  });
});

test("reserved Vibe64 Env names require an explicit Genesis Stack declaration", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);
    const response = await service.saveEnvUserValues({
      values: {
        VIBE64_INTERNAL_OVERRIDE: "unsafe"
      }
    });

    assert.equal(response.ok, false);
    assert.equal(response.errors[0].code, "vibe64_env_reserved_key");
  });
});

test("Genesis Stack resources define expected Env names without technology checks in Vibe64", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot, {
      inspectLaunch() {
        return {
          resources: [{
            component: "example-stack",
            resource: {
              environmentAlternatives: [{
                allowEmpty: [],
                required: ["EXAMPLE_ORIGIN", "VIBE64_EXAMPLE_TOKEN"]
              }],
              id: "example-service"
            }
          }]
        };
      }
    });

    const read = await service.readEnv();
    assert.deepEqual(read.env.records.map((record) => record.key), [
      "EXAMPLE_ORIGIN",
      "VIBE64_EXAMPLE_TOKEN"
    ]);
    assert.equal(read.env.records.every((record) => record.valuePresent === false), true);
    assert.equal(read.env.records.every((record) => record.requiredFor.includes("server")), true);

    const saved = await service.saveEnvUserValues({
      values: {
        VIBE64_EXAMPLE_TOKEN: {
          secret: true,
          value: "allowed-by-stack"
        }
      }
    });
    assert.equal(saved.ok, true);
  });
});

test("managed app identities live only in dedicated project-local state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);

    assert.deepEqual(await service.readPreviewApplicationIdentities(), {
      identities: [],
      ok: true
    });

    const saved = await service.savePreviewApplicationIdentities({
      identities: [
        {
          name: "Admin",
          type: "email",
          value: "admin@example.test"
        },
        {
          name: "user",
          type: "user-id",
          value: "42"
        }
      ]
    });

    assert.deepEqual(saved, {
      identities: [
        {
          name: "admin",
          type: "email",
          value: "admin@example.test"
        },
        {
          name: "user",
          type: "user-id",
          value: "42"
        }
      ],
      ok: true
    });
    assert.deepEqual(await service.readPreviewApplicationIdentities(), saved);

    const projectLocalRoot = service.currentProjectLocalRoot();
    assert.notEqual(projectLocalRoot, targetRoot);
    const storedPath = path.join(
      projectLocalRoot,
      "preview",
      "application-identities.json"
    );
    const stored = JSON.parse(await readFile(storedPath, "utf8"));
    assert.deepEqual(stored, {
      identities: saved.identities,
      version: 1
    });
    assert.equal((await stat(storedPath)).mode & 0o777, 0o600);
  });
});

test("managed app identity validation rejects ambiguous names", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);
    const response = await service.savePreviewApplicationIdentities({
      identities: [
        {
          name: "admin",
          type: "email",
          value: "first@example.test"
        },
        {
          name: "ADMIN",
          type: "email",
          value: "second@example.test"
        }
      ]
    });

    assert.equal(response.ok, false);
    assert.equal(response.errors[0].code, "vibe64_invalid_application_identities_config");
    assert.match(response.errors[0].message, /duplicated/u);
  });
});

test("managed app identities migrate once from the exact legacy local record", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);
    const projectLocalRoot = service.currentProjectLocalRoot();
    const legacyPath = path.join(
      projectLocalRoot,
      "runtime-config",
      "preview_application_identities"
    );
    const newPath = path.join(
      projectLocalRoot,
      "preview",
      "application-identities.json"
    );
    const identities = [
      {
        name: "admin",
        type: "email",
        value: "admin@example.test"
      },
      {
        name: "user",
        type: "login",
        value: "catalogue-user"
      }
    ];
    await mkdir(path.dirname(legacyPath), {
      recursive: true
    });
    await writeFile(legacyPath, `${JSON.stringify(identities)}\n`, "utf8");

    const migrated = await service.readPreviewApplicationIdentities();
    assert.deepEqual(migrated, {
      identities,
      ok: true
    });
    assert.equal("filePath" in migrated, false);
    assert.equal("source" in migrated, false);
    assert.deepEqual(JSON.parse(await readFile(newPath, "utf8")), {
      identities,
      version: 1
    });
    await assert.rejects(() => readFile(legacyPath, "utf8"), {
      code: "ENOENT"
    });

    await writeFile(legacyPath, `${JSON.stringify([{
      name: "ignored",
      type: "user-id",
      value: "999"
    }])}\n`, "utf8");
    assert.deepEqual(await service.readPreviewApplicationIdentities(), migrated);
  });
});
