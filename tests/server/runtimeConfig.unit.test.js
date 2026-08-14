import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  RUNTIME_CONFIG_OWNERS,
  RUNTIME_CONFIG_PHASES,
  RUNTIME_CONFIG_SCOPES,
  RUNTIME_CONFIG_TARGETS,
  mergeRuntimeConfigRecords,
  normalizeRuntimeConfigKey,
  normalizeRuntimeConfigOwner,
  normalizeRuntimeConfigRecord,
  resolveRuntimeConfig,
  runtimeConfigEnv,
  runtimeConfigEnvViewModel,
  runtimeConfigKeyIsVibe64Reserved,
  runtimeConfigKeyLooksSecret
} from "@local/vibe64-core/server/runtimeConfig";
import {
  readEnvUserValues,
  saveEnvUserValues
} from "@local/vibe64-core/server/envUserValues";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

test("runtime config records normalize technology-neutral metadata", () => {
  const record = normalizeRuntimeConfigRecord({
    key: "SERVICE_API_TOKEN",
    owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
    requiredFor: [RUNTIME_CONFIG_PHASES.SERVER, RUNTIME_CONFIG_PHASES.PREVIEW, RUNTIME_CONFIG_PHASES.SERVER],
    scope: RUNTIME_CONFIG_SCOPES.PROD,
    source: "genesis-stack",
    targets: [RUNTIME_CONFIG_TARGETS.SERVER, RUNTIME_CONFIG_TARGETS.COMMAND],
    value: 42
  });

  assert.deepEqual(record, {
    editable: false,
    key: "SERVICE_API_TOKEN",
    owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
    requiredFor: [RUNTIME_CONFIG_PHASES.PREVIEW, RUNTIME_CONFIG_PHASES.SERVER],
    scope: RUNTIME_CONFIG_SCOPES.PROD,
    secret: true,
    source: "genesis-stack",
    targets: [RUNTIME_CONFIG_TARGETS.COMMAND, RUNTIME_CONFIG_TARGETS.SERVER],
    value: "42",
    valuePresent: true
  });
  assert.equal(Object.hasOwn(record, "materialize"), false);
});

test("runtime config validates keys, owners, and reserved keys", () => {
  assert.equal(normalizeRuntimeConfigKey("VALID_NAME_2"), "VALID_NAME_2");
  assert.equal(normalizeRuntimeConfigOwner(), RUNTIME_CONFIG_OWNERS.USER);
  assert.equal(runtimeConfigKeyIsVibe64Reserved("VIBE64_INTERNAL"), true);
  assert.equal(runtimeConfigKeyIsVibe64Reserved("APP_VIBE64_VALUE"), false);
  assert.throws(
    () => normalizeRuntimeConfigKey("INVALID-NAME"),
    { code: "vibe64_runtime_config_key_invalid" }
  );
  assert.throws(
    () => normalizeRuntimeConfigOwner("adapter"),
    { code: "vibe64_runtime_config_owner_invalid" }
  );
});

test("runtime config secret detection treats key names as segments", () => {
  assert.equal(runtimeConfigKeyLooksSecret("AUTH_DEV_BYPASS_ENABLED"), false);
  assert.equal(runtimeConfigKeyLooksSecret("VIBE64_BYPASS_LOCALHOST_CHECK"), false);
  assert.equal(runtimeConfigKeyLooksSecret("AUTH_DEV_BYPASS_SECRET"), true);
  assert.equal(runtimeConfigKeyLooksSecret("DB_PASSWORD"), true);
  assert.equal(runtimeConfigKeyLooksSecret("DATABASE_URL"), true);
  assert.equal(runtimeConfigKeyLooksSecret("OPENAI_API_KEY"), true);
});

test("runtime config resolver accepts records directly and rejects removed profiles", () => {
  const config = resolveRuntimeConfig([
    {
      key: "MANAGED_VALUE",
      owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "system",
      value: "managed"
    },
    {
      key: "OPENAI_API_KEY",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      requiredFor: [RUNTIME_CONFIG_PHASES.PREVIEW],
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "user",
      value: ""
    }
  ], {
    phase: RUNTIME_CONFIG_PHASES.PREVIEW
  });

  const userRecord = config.view.records.find((record) => record.key === "OPENAI_API_KEY");
  assert.equal(userRecord.owner, RUNTIME_CONFIG_OWNERS.USER);
  assert.equal(userRecord.editable, true);
  assert.equal(userRecord.missing, true);
  assert.equal(userRecord.value, "********");
  assert.deepEqual(config.missing.map((record) => record.key), ["OPENAI_API_KEY"]);
  assert.throws(
    () => resolveRuntimeConfig({
      definitions: []
    }),
    { code: "vibe64_runtime_config_records_invalid" }
  );
});

test("runtime config scopes and targets filter values and missing records", () => {
  const records = [
    {
      key: "ALL_TARGETS",
      owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
      requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "system",
      value: "all"
    },
    {
      key: "SERVER_ONLY",
      owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
      requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "system",
      targets: [RUNTIME_CONFIG_TARGETS.SERVER],
      value: "server"
    },
    {
      key: "CHECK_SECRET",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "user",
      targets: [RUNTIME_CONFIG_TARGETS.CHECKS],
      value: ""
    },
    {
      key: "PROD_ONLY",
      owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
      scope: RUNTIME_CONFIG_SCOPES.PROD,
      source: "system",
      value: "prod"
    }
  ];
  const serverConfig = resolveRuntimeConfig(records, {
    phase: RUNTIME_CONFIG_PHASES.SERVER,
    target: RUNTIME_CONFIG_TARGETS.SERVER
  });
  const checksConfig = resolveRuntimeConfig(records, {
    phase: RUNTIME_CONFIG_PHASES.SERVER,
    target: RUNTIME_CONFIG_TARGETS.CHECKS
  });

  assert.deepEqual(Object.keys(serverConfig.values).sort(), ["ALL_TARGETS", "SERVER_ONLY"]);
  assert.deepEqual(serverConfig.missing, []);
  assert.deepEqual(Object.keys(checksConfig.values).sort(), ["ALL_TARGETS", "CHECK_SECRET"]);
  assert.deepEqual(checksConfig.missing.map((record) => record.key), ["CHECK_SECRET"]);
  assert.deepEqual(runtimeConfigEnv(records, {
    scope: RUNTIME_CONFIG_SCOPES.PROD
  }), {
    PROD_ONLY: "prod"
  });
});

test("runtime config does not require values when no phase is requested", () => {
  const config = resolveRuntimeConfig([
    {
      key: "OPENAI_API_KEY",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      requiredFor: [RUNTIME_CONFIG_PHASES.PREVIEW],
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "user",
      value: ""
    }
  ]);

  assert.equal(config.ok, true);
  assert.deepEqual(config.missing, []);
  assert.equal(config.view.records[0].missing, false);
});

test("runtime config treats withheld known secrets as present", () => {
  const config = resolveRuntimeConfig([
    {
      key: "PAYMENT_API_TOKEN",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      requiredFor: [RUNTIME_CONFIG_PHASES.SERVER],
      scope: RUNTIME_CONFIG_SCOPES.PROD,
      secret: true,
      source: "user",
      value: "",
      valuePresent: true
    }
  ], {
    phase: RUNTIME_CONFIG_PHASES.SERVER,
    scope: RUNTIME_CONFIG_SCOPES.PROD
  });

  const tokenRecord = config.view.records.find((record) => record.key === "PAYMENT_API_TOKEN");
  assert.equal(config.ok, true);
  assert.deepEqual(config.missing, []);
  assert.equal(tokenRecord.value, "********");
  assert.equal(tokenRecord.valuePresent, true);
  assert.equal(config.values.PAYMENT_API_TOKEN, "");
});

test("runtime config user records cannot shadow system records", () => {
  const records = mergeRuntimeConfigRecords([
    {
      key: "DB_PASSWORD",
      owner: RUNTIME_CONFIG_OWNERS.SYSTEM,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "managed-database",
      value: "managed-password"
    },
    {
      key: "DB_PASSWORD",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "user",
      value: "user-password"
    }
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].owner, RUNTIME_CONFIG_OWNERS.SYSTEM);
  assert.equal(records[0].source, "managed-database");
  assert.equal(records[0].value, "managed-password");
});

test("runtime config user records cannot shadow read-only user records", () => {
  const config = resolveRuntimeConfig([
    {
      editable: false,
      key: "AUTH_SUPABASE_URL",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "project-config",
      value: "https://configured.supabase.co"
    },
    {
      key: "AUTH_SUPABASE_URL",
      owner: RUNTIME_CONFIG_OWNERS.USER,
      scope: RUNTIME_CONFIG_SCOPES.DEV,
      source: "user",
      value: "https://stale-user-value.supabase.co"
    }
  ]);

  assert.equal(config.values.AUTH_SUPABASE_URL, "https://configured.supabase.co");
  assert.equal(config.records[0].editable, false);
  assert.equal(config.records[0].source, "project-config");
});

test("runtime config Env view exposes only current record concepts", () => {
  const view = runtimeConfigEnvViewModel({
    records: [
      {
        editable: false,
        key: "AUTH_SUPABASE_URL",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "project-config",
        value: "https://example.supabase.co"
      },
      {
        key: "OPENAI_API_KEY",
        owner: RUNTIME_CONFIG_OWNERS.USER,
        scope: RUNTIME_CONFIG_SCOPES.DEV,
        source: "user",
        value: "secret"
      }
    ],
    scope: RUNTIME_CONFIG_SCOPES.DEV
  });

  const supabaseRecord = view.records.find((record) => record.key === "AUTH_SUPABASE_URL");
  const apiKeyRecord = view.records.find((record) => record.key === "OPENAI_API_KEY");
  assert.equal(supabaseRecord.editable, false);
  assert.equal(apiKeyRecord.editable, true);
  assert.equal(apiKeyRecord.value, "********");
  assert.equal(Object.hasOwn(view, "publicEnvPrefixes"), false);
  assert.equal(Object.hasOwn(view, "adapterId"), false);
  assert.equal(Object.hasOwn(view, "generatedTargets"), false);
  assert.equal(Object.hasOwn(apiKeyRecord, "materialize"), false);
});

test("Env user value store writes 0600 state and preserves empty records", async () => {
  await withTemporaryRoot(async (projectLocalRoot) => {
    const saved = await saveEnvUserValues({
      environment: RUNTIME_CONFIG_SCOPES.DEV,
      projectLocalRoot,
      values: {
        OPENAI_API_KEY: {
          secret: true,
          value: ""
        },
        PUBLIC_FLAG: {
          secret: false,
          value: "enabled"
        }
      }
    });

    const apiKeyRecord = saved.records.find((record) => record.key === "OPENAI_API_KEY");
    const publicRecord = saved.records.find((record) => record.key === "PUBLIC_FLAG");
    assert.equal(apiKeyRecord.value, "");
    assert.equal(apiKeyRecord.owner, RUNTIME_CONFIG_OWNERS.USER);
    assert.equal(apiKeyRecord.source, "user");
    assert.deepEqual(apiKeyRecord.requiredFor, []);
    assert.equal(Object.hasOwn(apiKeyRecord, "materialize"), false);
    assert.equal(publicRecord.secret, false);
    assert.equal((await stat(saved.filePath)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(saved.filePath, "utf8")), {
      environments: {
        dev: {
          OPENAI_API_KEY: {
            secret: true,
            value: ""
          },
          PUBLIC_FLAG: {
            secret: false,
            value: "enabled"
          }
        }
      },
      version: 1
    });

    await saveEnvUserValues({
      projectLocalRoot,
      values: {
        PUBLIC_FLAG: {
          remove: true
        }
      }
    });

    const current = await readEnvUserValues({
      projectLocalRoot
    });
    assert.equal(current.records.some((record) => record.key === "PUBLIC_FLAG"), false);
    assert.equal(current.records.some((record) => record.key === "OPENAI_API_KEY"), true);
  });
});
