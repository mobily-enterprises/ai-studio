import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_PREFERRED_NAME_LENGTH,
  MEMBERSHIP_RECORD_VERSION,
  createVibe64MembershipStore,
  membershipRootFromDaemonStateRoot
} from "../../packages/vibe64-core/src/server/vibe64MembershipStore.js";

test("membership root is derived from daemon state root", () => {
  assert.equal(
    membershipRootFromDaemonStateRoot("/home/owner/.local/state/vibe64"),
    "/home/owner/.local/state/vibe64/users"
  );
});

test("membership files store only Vibe64 metadata keyed by OS username", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-membership-"));
  const resolvedUsers = [];
  const store = createVibe64MembershipStore({
    membershipRoot: root,
    async osUserResolver(username) {
      resolvedUsers.push(username);
      return {
        gid: 1001,
        home: `/home/${username}`,
        shell: "/bin/bash",
        uid: 1001,
        username
      };
    }
  });

  const user = await store.enableUser("ada", {
    role: "owner"
  });

  assert.equal(user.username, "ada");
  assert.equal(user.role, "owner");
  assert.equal(user.status, "active");
  assert.deepEqual(resolvedUsers, ["ada"]);
  assert.equal(Object.hasOwn(user, "uid"), false);
  assert.equal(Object.hasOwn(user, "gid"), false);
  assert.equal(Object.hasOwn(user, "home"), false);
  assert.equal(Object.hasOwn(user, "shell"), false);
});

test("membership requires explicit active enablement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-membership-"));
  const store = createVibe64MembershipStore({
    membershipRoot: root
  });

  await assert.rejects(
    () => store.requireActiveUser("ada"),
    /OS user is not enabled for Vibe64/u
  );

  await store.enableUser("ada");
  assert.equal((await store.requireActiveUser("ada")).username, "ada");
});

test("membership persists sanitized GitHub identity metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-membership-github-"));
  const store = createVibe64MembershipStore({
    membershipRoot: root
  });

  await store.enableUser("ada", {
    role: "owner"
  });
  const updated = await store.updateGithubIdentity("ada", {
    avatar_url: "https://avatars.example/ada.png",
    id: 123,
    login: "ada-lovelace",
    token: "must-not-persist"
  });
  const record = JSON.parse(await readFile(path.join(root, "ada.json"), "utf8"));

  assert.equal(updated.github.login, "ada-lovelace");
  assert.deepEqual(record.github, {
    avatarUrl: "https://avatars.example/ada.png",
    connectedAt: updated.github.connectedAt,
    id: 123,
    login: "ada-lovelace"
  });
  assert.equal(Object.hasOwn(record.github, "token"), false);
  assert.equal((await store.readMembership("ada")).github.login, "ada-lovelace");
});

test("membership reads version 1 records with an empty preferred name and upgrades them on update", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-membership-preferred-name-migration-"));
  const createdAt = "2026-01-02T03:04:05.000Z";
  await writeFile(path.join(root, "ada.json"), `${JSON.stringify({
    createdAt,
    role: "owner",
    status: "active",
    updatedAt: createdAt,
    username: "ada",
    version: 1
  })}\n`);
  const store = createVibe64MembershipStore({
    membershipRoot: root
  });

  const legacy = await store.readMembership("ada");
  assert.equal(legacy.preferredName, "");
  assert.equal(legacy.version, MEMBERSHIP_RECORD_VERSION);

  const updated = await store.updatePreferredName("ada", "  Ada   Lovelace  ");
  const persisted = JSON.parse(await readFile(path.join(root, "ada.json"), "utf8"));
  assert.equal(updated.preferredName, "Ada Lovelace");
  assert.equal(persisted.preferredName, "Ada Lovelace");
  assert.equal(persisted.createdAt, createdAt);
  assert.equal(persisted.version, MEMBERSHIP_RECORD_VERSION);
});

test("membership accepts only the exact stored versions it understands", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-membership-version-"));
  const store = createVibe64MembershipStore({
    membershipRoot: root
  });
  const recordPath = path.join(root, "ada.json");
  const baseRecord = {
    createdAt: "2026-01-02T03:04:05.000Z",
    preferredName: "Ada",
    role: "owner",
    status: "active",
    updatedAt: "2026-01-02T03:04:05.000Z",
    username: "ada"
  };

  await writeFile(recordPath, `${JSON.stringify({
    ...baseRecord,
    version: MEMBERSHIP_RECORD_VERSION
  })}\n`);
  assert.equal((await store.readMembership("ada")).preferredName, "Ada");

  const { version: _ignored, ...missingVersion } = {
    ...baseRecord,
    version: MEMBERSHIP_RECORD_VERSION
  };
  await writeFile(recordPath, `${JSON.stringify(missingVersion)}\n`);
  await assert.rejects(
    store.readMembership("ada"),
    { code: "vibe64_membership_record_version_unsupported" }
  );

  await writeFile(recordPath, `${JSON.stringify({
    ...baseRecord,
    version: 999
  })}\n`);
  await assert.rejects(
    store.readMembership("ada"),
    { code: "vibe64_membership_record_version_unsupported" }
  );
});

test("membership preferred name accepts Unicode, can be cleared, and is bounded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-membership-preferred-name-"));
  const store = createVibe64MembershipStore({
    membershipRoot: root
  });
  await store.enableUser("ada", {
    role: "owner"
  });

  assert.equal((await store.updatePreferredName("ada", "  Ada 👩🏽‍💻  ")).preferredName, "Ada 👩🏽‍💻");
  assert.equal((await store.updatePreferredName("ada", "")).preferredName, "");
  await assert.rejects(
    () => store.updatePreferredName("ada", "a".repeat(MAX_PREFERRED_NAME_LENGTH + 1)),
    {
      code: "vibe64_preferred_name_too_long"
    }
  );
  await assert.rejects(
    () => store.updatePreferredName("ada", "Ada\u0000Lovelace"),
    {
      code: "vibe64_preferred_name_invalid"
    }
  );
});

test("concurrent membership updates preserve every field and leave no temporary files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-membership-concurrent-update-"));
  const firstStore = createVibe64MembershipStore({
    membershipRoot: root
  });
  const secondStore = createVibe64MembershipStore({
    membershipRoot: root
  });
  await firstStore.enableUser("ada", {
    role: "owner"
  });

  const updates = [];
  for (let index = 0; index < 20; index += 1) {
    updates.push(firstStore.updatePreferredName("ada", `Ada ${index}`));
    updates.push(secondStore.updateGithubIdentity("ada", {
      login: `ada-${index}`
    }));
  }
  await Promise.all(updates);

  const record = await firstStore.readMembership("ada");
  assert.equal(record.preferredName, "Ada 19");
  assert.equal(record.github.login, "ada-19");
  assert.deepEqual(
    (await readdir(root)).filter((name) => name.endsWith(".tmp")),
    []
  );
});
