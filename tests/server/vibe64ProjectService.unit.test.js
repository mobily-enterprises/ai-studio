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

test("the project service exposes the selected session source without leaking its storage layout", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const service = projectService(targetRoot);
    const store = await service.createSessionStore();
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "selected-session"
    });

    assert.equal(await service.readSelectedSessionSource(), null);
    await store.updateCurrentSession("selected-session");
    await assert.rejects(
      service.readSelectedSessionSource(),
      { code: "vibe64_selected_session_source_unavailable" }
    );
    await store.writeMetadataValue("selected-session", "source_kind", "session_clone");
    await store.writeMetadataValue("selected-session", "source_path_authority", "managed_session_source");
    await store.writeMetadataValue(
      "selected-session",
      "source_path",
      path.join(targetRoot, "sessions", "active", "selected-session", "source")
    );

    assert.deepEqual(await service.readSelectedSessionSource(), {
      sessionId: "selected-session",
      sourceRoot: path.join(targetRoot, "sessions", "active", "selected-session", "source")
    });
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
    const projectRuntimeRoot = service.currentProjectRuntimeRoot();
    assert.notEqual(projectRuntimeRoot, targetRoot);
    assert.equal((await stat(path.join(projectRuntimeRoot, "env", "user-values.json"))).mode & 0o777, 0o600);
    await assert.rejects(
      stat(path.join(targetRoot, "env", "user-values.json")),
      { code: "ENOENT" }
    );
    assert.deepEqual(await service.projectExecutionEnvironment({
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
      inspectEnvironment() {
        return {
          components: ["example-stack"],
          environmentDefaults: [],
          files: [],
          resources: [{
            component: "example-stack",
            resource: {
              environmentAlternatives: [{
                allowEmpty: [],
                required: ["EXAMPLE_ORIGIN", "VIBE64_EXAMPLE_TOKEN"]
              }],
              id: "example-service",
              kind: "example-service"
            }
          }],
          status: "missing-inputs"
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

test("a host resource provider satisfies Genesis resources and projects the resolved Env", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(path.join(targetRoot, ".git", "info"), {
      recursive: true
    });
    const providerCalls = [];
    const service = projectService(targetRoot, {
      inspectEnvironment() {
        return {
          components: ["example-stack"],
          environmentDefaults: [{
            name: "DB_CLIENT",
            sources: ["component:example-stack"],
            value: "mysql2"
          }],
          files: [{ format: "dotenv", path: ".env" }],
          resources: [{
            component: "example-stack",
            resource: {
              environmentAlternatives: [{
                allowEmpty: [],
                required: ["DB_HOST", "DB_PASSWORD"]
              }],
              id: "database",
              kind: "mysql"
            }
          }],
          status: "missing-inputs"
        };
      }
    });
    const released = [];
    service.setResourceEnvironmentProvider({
      async environmentForResources(input) {
        providerCalls.push(input);
        return {
          environment: {
            DB_HOST: "127.0.0.1",
            DB_PASSWORD: "managed-secret"
          }
        };
      },
      async removeSessionResources(input) {
        released.push(input);
        return { ok: true };
      }
    });

    const read = await service.readEnv();
    assert.deepEqual(read.env.records.map((record) => record.key), ["DB_CLIENT", "DB_HOST", "DB_PASSWORD"]);
    assert.deepEqual(read.env.records.map((record) => ({
      editable: record.editable,
      key: record.key,
      owner: record.owner,
      source: record.source,
      value: record.value,
      valuePresent: record.valuePresent
    })), [{
      editable: false,
      key: "DB_CLIENT",
      owner: "system",
      source: "genesis-stack:default",
      value: "mysql2",
      valuePresent: true
    }, {
      editable: true,
      key: "DB_HOST",
      owner: "user",
      source: "genesis-stack:example-stack:database",
      value: "",
      valuePresent: false
    }, {
      editable: true,
      key: "DB_PASSWORD",
      owner: "user",
      source: "genesis-stack:example-stack:database",
      value: "********",
      valuePresent: false
    }]);
    assert.equal(JSON.stringify(read).includes("managed-secret"), false);

    assert.deepEqual(await service.projectExecutionEnvironment(), {
      DB_CLIENT: "mysql2"
    });
    assert.equal(providerCalls.length, 0);

    const store = await service.createSessionStore();
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "session-1"
    });
    await store.writeMetadataValue("session-1", "source_path", targetRoot);

    const sessionRead = await service.readEnv({ sessionId: "session-1" });
    assert.deepEqual(sessionRead.env.records.map((record) => ({
      editable: record.editable,
      key: record.key,
      owner: record.owner,
      source: record.source,
      value: record.value,
      valuePresent: record.valuePresent
    })), [{
      editable: false,
      key: "DB_CLIENT",
      owner: "system",
      source: "genesis-stack:default",
      value: "mysql2",
      valuePresent: true
    }, {
      editable: false,
      key: "DB_HOST",
      owner: "system",
      source: "vibe64-host:managed-resource",
      value: "127.0.0.1",
      valuePresent: true
    }, {
      editable: false,
      key: "DB_PASSWORD",
      owner: "system",
      source: "vibe64-host:managed-resource",
      value: "********",
      valuePresent: true
    }]);
    assert.equal(JSON.stringify(sessionRead).includes("managed-secret"), false);

    assert.deepEqual(await service.projectExecutionEnvironment({ sessionId: "session-1" }), {
      DB_CLIENT: "mysql2",
      DB_HOST: "127.0.0.1",
      DB_PASSWORD: "managed-secret"
    });
    assert.match(await readFile(path.join(targetRoot, ".env"), "utf8"), /DB_CLIENT=mysql2/u);
    assert.match(await readFile(path.join(targetRoot, ".env"), "utf8"), /DB_PASSWORD=managed-secret/u);
    assert.match(await readFile(path.join(targetRoot, ".git", "info", "exclude"), "utf8"), /^\/\.env$/mu);
    assert.equal(providerCalls.length, 2);
    assert.equal(providerCalls[0].sessionId, "session-1");
    assert.deepEqual(providerCalls[0].resources.map(({ resource }) => resource.id), ["database"]);
    assert.deepEqual(providerCalls[0].resources.map(({ resource }) => resource.kind), ["mysql"]);
    assert.equal(Object.hasOwn(providerCalls[0], "environment"), false);

    assert.deepEqual(await service.releaseSessionResources({ sessionId: "session-1" }), { ok: true });
    assert.equal(released.length, 1);
    assert.equal(released[0].sessionId, "session-1");
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
