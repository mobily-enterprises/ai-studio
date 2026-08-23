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
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  sourceMetadata,
  sourcePath,
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

test("a catalog project without a baseline checkout does not inspect its metadata directory", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectsRoot = path.join(temporaryRoot, "projects");
    const projectContext = createStudioProjectContext({
      explicitManagedSourceRoot: path.join(temporaryRoot, "managed-source"),
      explicitProjectsRoot: projectsRoot,
      explicitSystemRoot: path.join(temporaryRoot, "system"),
      home: temporaryRoot
    });
    let inspections = 0;
    const service = createService({
      env: {},
      inspectEnvironment() {
        inspections += 1;
        throw new Error("the project metadata directory is not source");
      },
      projectContext
    });
    await service.createProject({ name: "Remote catalogue" });
    const hostedNamespace = path.join(projectsRoot, "remote-catalogue");
    await mkdir(path.join(hostedNamespace, ".git"), {
      recursive: true
    });
    await writeFile(path.join(hostedNamespace, ".git", "config"), "must-not-be-inspected\n", "utf8");

    const response = await service.readEnv();

    assert.equal(response.ok, true);
    assert.equal(response.env.configSource.sourceRoot, "");
    assert.equal(response.env.stackWarning, undefined);
    assert.equal(inspections, 0);
  });
});

test("managed development database scope is project state and changes only without open sessions", async () => {
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
    await service.createProject({ name: "Shared catalogue" });
    let nameRequests = 0;
    service.setResourceEnvironmentProvider({
      developmentDatabaseNameForProject({ slug }) {
        nameRequests += 1;
        assert.equal(slug, "shared-catalogue");
        return "merc_shared_catalogue";
      },
      async environmentForResources() {
        return { environment: {} };
      },
      managedDevelopmentDatabase: true
    });

    const initial = await service.readSettings();
    assert.deepEqual(initial.developmentDatabase, {
      canChange: true,
      managed: true,
      scope: "session"
    });
    const saved = await service.saveDevelopmentDatabaseScope({
      scope: "project"
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.scope, "project");
    assert.equal(nameRequests, 1);
    assert.equal(
      (await service.listProjects()).currentProject.developmentDatabaseName,
      "merc_shared_catalogue"
    );

    const store = await service.createSessionStore();
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "ghost-session"
    });
    assert.deepEqual((await service.readSettings()).developmentDatabase, {
      canChange: true,
      managed: true,
      scope: "project"
    });

    const sessionSource = path.join(temporaryRoot, "managed-source", "sessions", "active", "open-session", "source");
    await mkdir(sessionSource, { recursive: true });
    await store.createSession({
      metadata: {
        source_kind: "session_clone",
        source_path: sessionSource,
        source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
      },
      runtimeKind: "genesis",
      sessionId: "open-session"
    });
    const blocked = await service.saveDevelopmentDatabaseScope({
      scope: "session"
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.errors[0].code, "vibe64_development_database_scope_busy");

    await store.writeStatus("open-session", "abandoned");
    await store.compactClosedSession("open-session");
    assert.deepEqual((await service.readSettings()).developmentDatabase, {
      canChange: true,
      managed: true,
      scope: "project"
    });
    const savedAgain = await service.saveDevelopmentDatabaseScope({
      scope: "project"
    });
    assert.equal(savedAgain.ok, true);
    assert.equal(nameRequests, 1);
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
    assert.deepEqual(await service.revealEnvSecret({
      environment: "dev",
      key: "BOOKS_API_KEY"
    }), {
      key: "BOOKS_API_KEY",
      ok: true,
      value: "secret-value"
    });
    const publicValueReveal = await service.revealEnvSecret({
      environment: "dev",
      key: "BOOKS_ORIGIN"
    });
    assert.equal(publicValueReveal.code, "vibe64_env_variable_not_secret");
    assert.equal(publicValueReveal.ok, false);
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

test("saving or removing Env values immediately refreshes declared environment files", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    await mkdir(path.join(targetRoot, ".git", "info"), {
      recursive: true
    });
    const service = projectService(targetRoot, {
      inspectEnvironment() {
        return {
          components: ["example-stack"],
          environmentDefaults: [],
          files: [{ format: "dotenv", path: ".env" }],
          resources: [],
          status: "ready"
        };
      }
    });

    const saved = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        PREVIEW_AUTH_SECRET: {
          secret: true,
          value: "temporary-secret"
        }
      }
    });
    assert.equal(saved.ok, true);
    assert.match(await readFile(path.join(targetRoot, ".env"), "utf8"), /PREVIEW_AUTH_SECRET=temporary-secret/u);

    const removed = await service.saveEnvUserValues({
      environment: "dev",
      values: {
        PREVIEW_AUTH_SECRET: {
          remove: true
        }
      }
    });
    assert.equal(removed.ok, true);
    assert.doesNotMatch(await readFile(path.join(targetRoot, ".env"), "utf8"), /PREVIEW_AUTH_SECRET/u);
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
    const sessionId = "session-1";
    const sessionSource = sourcePath(targetRoot, sessionId);
    await Promise.all([
      mkdir(path.join(targetRoot, ".git", "info"), {
        recursive: true
      }),
      mkdir(path.join(sessionSource, ".git", "info"), {
        recursive: true
      })
    ]);
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
      managedDevelopmentDatabase: true,
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
      metadata: sourceMetadata(targetRoot, sessionId),
      runtimeKind: "genesis",
      sessionId
    });

    const sessionRead = await service.readEnv({ sessionId });
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
    assert.deepEqual(await service.revealEnvSecret({
      key: "DB_PASSWORD",
      sessionId
    }), {
      key: "DB_PASSWORD",
      ok: true,
      value: "managed-secret"
    });

    assert.deepEqual(await service.projectExecutionEnvironment({ sessionId }), {
      DB_CLIENT: "mysql2",
      DB_HOST: "127.0.0.1",
      DB_PASSWORD: "managed-secret"
    });
    assert.match(await readFile(path.join(sessionSource, ".env"), "utf8"), /DB_CLIENT=mysql2/u);
    assert.match(await readFile(path.join(sessionSource, ".env"), "utf8"), /DB_PASSWORD=managed-secret/u);
    assert.match(await readFile(path.join(sessionSource, ".git", "info", "exclude"), "utf8"), /^\/\.env$/mu);
    assert.equal(providerCalls.length, 3);
    assert.equal(providerCalls.every((call) => call.sessionId === sessionId), true);
    assert.equal(providerCalls.every((call) => call.developmentDatabaseScope === "session"), true);
    assert.deepEqual(providerCalls[0].resources.map(({ resource }) => resource.id), ["database"]);
    assert.deepEqual(providerCalls[0].resources.map(({ resource }) => resource.kind), ["mysql"]);
    assert.equal(Object.hasOwn(providerCalls[0], "environment"), false);

    assert.deepEqual(await service.releaseSessionResources({ sessionId }), { ok: true });
    assert.equal(released.length, 1);
    assert.equal(released[0].sessionId, sessionId);
    assert.equal(released[0].developmentDatabaseScope, "session");
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

    const projectLocalRoot = service.currentProjectRuntimeRoot();
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
    const projectLocalRoot = service.currentProjectRuntimeRoot();
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
