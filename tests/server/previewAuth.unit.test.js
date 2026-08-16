import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_COMMAND_PREVIEW_AUTH_KIND,
  PREVIEW_IDENTITY_LOGIN_OPERATION,
  PREVIEW_IDENTITY_LOGOUT_OPERATION,
  PREVIEW_IDENTITY_SELECTOR_EMAIL,
  PREVIEW_IDENTITY_SELECTOR_LOGIN,
  PREVIEW_IDENTITY_SELECTOR_USER_ID,
  PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  createPreviewAuthSecret,
  createPreviewIdentityGrant,
  normalizePreviewApplicationIdentities,
  normalizePreviewIdentityCommandCapability,
  normalizePreviewIdentitySelection,
  previewAuthEnvironment,
  previewAuthIdentityAvailable,
  previewAuthIdentityTypes,
  verifyPreviewIdentityGrant
} from "../../packages/vibe64-core/src/server/previewAuth.js";

function previewAuthFixture(overrides = {}) {
  return {
    identityTypes: [PREVIEW_IDENTITY_SELECTOR_EMAIL, PREVIEW_IDENTITY_SELECTOR_USER_ID],
    kind: APPLICATION_COMMAND_PREVIEW_AUTH_KIND,
    projectScope: "project:preview-auth-test",
    secret: "b".repeat(64),
    sessionId: "session-preview-auth-test",
    targetHref: "http://127.0.0.1:4102/home",
    targetRoot: "/tmp/preview-auth-test",
    terminalSessionId: "terminal-preview-auth-test",
    ...overrides
  };
}

test("preview identity selections normalize login and logout operations", () => {
  assert.deepEqual(normalizePreviewIdentitySelection({
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: " ADA@EXAMPLE.COM "
    }
  }), {
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com"
    }
  });
  assert.deepEqual(normalizePreviewIdentitySelection({
    operation: PREVIEW_IDENTITY_LOGOUT_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ignored@example.com"
    }
  }), {
    operation: PREVIEW_IDENTITY_LOGOUT_OPERATION
  });
  assert.throws(
    () => normalizePreviewIdentitySelection({ operation: "arbitrary" }),
    /operation is invalid/u
  );
});

test("application command preview identity validates one direct app-owned invocation", () => {
  const secret = createPreviewAuthSecret();
  const previewIdentity = normalizePreviewIdentityCommandCapability({
    command: ["tools/preview-identity"],
    environment: {
      enabled: "APP_PREVIEW_IDENTITY_ENABLED",
      secret: "APP_PREVIEW_IDENTITY_SECRET"
    },
    identityTypes: [PREVIEW_IDENTITY_SELECTOR_EMAIL, PREVIEW_IDENTITY_SELECTOR_USER_ID],
    protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL,
    runtimes: ["node26"]
  });

  assert.deepEqual(previewIdentity.command, ["tools/preview-identity"]);
  assert.deepEqual(previewAuthEnvironment({
    kind: APPLICATION_COMMAND_PREVIEW_AUTH_KIND,
    previewIdentity,
    secret
  }), {
    APP_PREVIEW_IDENTITY_ENABLED: "true",
    APP_PREVIEW_IDENTITY_SECRET: secret
  });
  assert.equal(previewAuthIdentityAvailable({
    kind: APPLICATION_COMMAND_PREVIEW_AUTH_KIND
  }), true);
  assert.deepEqual(previewAuthIdentityTypes({
    identityTypes: previewIdentity.identityTypes,
    kind: APPLICATION_COMMAND_PREVIEW_AUTH_KIND
  }), [PREVIEW_IDENTITY_SELECTOR_EMAIL, PREVIEW_IDENTITY_SELECTOR_USER_ID]);
});

test("application command preview identity rejects Vibe64 viewer mappings", () => {
  assert.throws(() => normalizePreviewIdentityCommandCapability({
    command: ["tools/preview-identity"],
    identityTypes: [PREVIEW_IDENTITY_SELECTOR_EMAIL],
    protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL,
    viewerIdentityTypes: [PREVIEW_IDENTITY_SELECTOR_EMAIL]
  }), /cannot derive application identities from the Vibe64 viewer/u);
});

test("application command preview identity rejects colliding environment aliases", () => {
  assert.throws(() => normalizePreviewIdentityCommandCapability({
    command: ["tools/preview-identity"],
    environment: {
      enabled: "APP_PREVIEW_IDENTITY",
      secret: "APP_PREVIEW_IDENTITY"
    },
    identityTypes: [PREVIEW_IDENTITY_SELECTOR_EMAIL],
    protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL
  }), /must be different/u);
});

test("application command preview identity requires an app-owned project-relative executable", () => {
  assert.throws(() => normalizePreviewIdentityCommandCapability({
    command: ["node", "./scripts/preview-identity.mjs"],
    identityTypes: [PREVIEW_IDENTITY_SELECTOR_EMAIL],
    protocol: PREVIEW_IDENTITY_COMMAND_PROTOCOL
  }), /committed app-owned project-relative file/u);
});

test("application command grants reject viewer subjects", () => {
  assert.throws(() => createPreviewIdentityGrant(previewAuthFixture(), {
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    subject: {
      kind: "viewer"
    }
  }), /requires an explicit application selector/u);
});

test("managed app identities normalize named app-owned selectors without a Vibe64 viewer", () => {
  assert.deepEqual(normalizePreviewApplicationIdentities([
    {
      name: " Admin ",
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: " ADA@EXAMPLE.COM "
    },
    {
      name: "worker",
      type: PREVIEW_IDENTITY_SELECTOR_LOGIN,
      value: "luca"
    },
    {
      name: "auditor",
      type: PREVIEW_IDENTITY_SELECTOR_USER_ID,
      value: "42"
    }
  ]), [
    {
      name: "admin",
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com"
    },
    {
      name: "worker",
      type: PREVIEW_IDENTITY_SELECTOR_LOGIN,
      value: "luca"
    },
    {
      name: "auditor",
      type: PREVIEW_IDENTITY_SELECTOR_USER_ID,
      value: "42"
    }
  ]);
  assert.throws(() => normalizePreviewApplicationIdentities([
    {
      name: "you",
      type: PREVIEW_IDENTITY_SELECTOR_LOGIN,
      value: "merc"
    }
  ]), /invalid name/u);
  assert.throws(() => normalizePreviewApplicationIdentities([
    {
      name: "admin",
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com",
      vibe64User: "merc"
    }
  ]), /contain only name, type, and value/u);
  assert.throws(() => normalizePreviewApplicationIdentities([
    {
      name: "admin",
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com"
    },
    {
      name: "admin",
      type: PREVIEW_IDENTITY_SELECTOR_USER_ID,
      value: "42"
    }
  ]), /duplicated/u);
});

test("preview identity grants verify once scoped data remains unchanged", () => {
  const previewAuth = previewAuthFixture();
  const grant = createPreviewIdentityGrant(previewAuth, {
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com"
    }
  }, {
    nowSeconds: 100,
    ttlSeconds: 30
  });

  const verified = verifyPreviewIdentityGrant(grant, previewAuth, {
    nowSeconds: 110
  });
  assert.equal(verified.expiresAt, 130);
  assert.match(verified.nonce, /^[A-Za-z0-9_-]+$/u);
  assert.deepEqual(verified.selection, {
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com"
    }
  });
});

test("preview identity grants reject tampering, expiry, and scope mismatch", () => {
  const previewAuth = previewAuthFixture();
  const grant = createPreviewIdentityGrant(previewAuth, {
    operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
    selector: {
      type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
      value: "ada@example.com"
    }
  }, {
    nowSeconds: 100,
    ttlSeconds: 10
  });
  const tampered = `${grant.slice(0, -1)}${grant.endsWith("a") ? "b" : "a"}`;

  assert.throws(
    () => verifyPreviewIdentityGrant(tampered, previewAuth, { nowSeconds: 105 }),
    /grant is invalid/u
  );
  assert.throws(
    () => verifyPreviewIdentityGrant(grant, previewAuth, { nowSeconds: 110 }),
    /grant has expired/u
  );
  assert.throws(
    () => verifyPreviewIdentityGrant(grant, previewAuthFixture({
      terminalSessionId: "another-terminal"
    }), { nowSeconds: 105 }),
    /does not belong to this preview/u
  );
});

test("preview identity grants require every project, session, target, and terminal scope field", () => {
  for (const field of [
    "projectScope",
    "sessionId",
    "targetHref",
    "targetRoot",
    "terminalSessionId"
  ]) {
    assert.throws(
      () => createPreviewIdentityGrant(previewAuthFixture({ [field]: "" }), {
        operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
        selector: {
          type: PREVIEW_IDENTITY_SELECTOR_EMAIL,
          value: "ada@example.com"
        }
      }),
      /scope is incomplete/u
    );
  }
});

test("preview auth providers advertise only the identifier types they support", () => {
  assert.deepEqual(previewAuthIdentityTypes({
    identityTypes: [PREVIEW_IDENTITY_SELECTOR_EMAIL, PREVIEW_IDENTITY_SELECTOR_USER_ID],
    kind: APPLICATION_COMMAND_PREVIEW_AUTH_KIND
  }), [
    PREVIEW_IDENTITY_SELECTOR_EMAIL,
    PREVIEW_IDENTITY_SELECTOR_USER_ID
  ]);
});
