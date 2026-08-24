import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MAX_OPEN_SESSIONS,
  developmentDatabasePolicy
} from "../../packages/vibe64-project/src/server/developmentDatabasePolicy.js";

function sessions(count = 0) {
  return Array.from({ length: count }, (_unused, index) => ({
    sessionId: `session-${index + 1}`,
    sessionName: `Task ${index + 1}`
  }));
}

test("external and per-session databases use the authoritative ordinary session limit", () => {
  for (const managed of [false, true]) {
    const available = developmentDatabasePolicy({
      managed,
      openSessions: sessions(2),
      scope: "session"
    });
    assert.equal(available.creation.canCreate, true);
    assert.equal(available.creation.showCreateAction, true);
    assert.deepEqual(available.limits, {
      maxOpenSessions: DEFAULT_MAX_OPEN_SESSIONS,
      openSessionCount: 2
    });

    const full = developmentDatabasePolicy({
      managed,
      openSessions: sessions(DEFAULT_MAX_OPEN_SESSIONS),
      scope: "session"
    });
    assert.equal(full.creation.canCreate, false);
    assert.equal(full.creation.showCreateAction, true);
    assert.match(full.creation.disabledReason, /up to 3 open sessions/u);
  }

  assert.deepEqual(developmentDatabasePolicy({
    managed: false,
    openSessions: []
  }).developmentDatabase, {
    managed: false,
    scope: "external"
  });
});

test("a shared managed database permits exactly one open session", () => {
  const empty = developmentDatabasePolicy({
    managed: true,
    openSessions: [],
    scope: "project"
  });
  assert.deepEqual(empty.creation, {
    canCreate: true,
    mode: "direct",
    showCreateAction: true
  });
  assert.deepEqual(empty.limits, {
    maxOpenSessions: 1,
    openSessionCount: 0
  });

  const occupied = developmentDatabasePolicy({
    managed: true,
    openSessions: sessions(1),
    scope: "project"
  });
  assert.equal(occupied.creation.canCreate, false);
  assert.equal(occupied.creation.showCreateAction, false);
  assert.match(occupied.creation.disabledReason, /Close its open session/u);
  assert.deepEqual(occupied.limits, {
    maxOpenSessions: 1,
    openSessionCount: 1
  });
});

test("settings distinguish option eligibility from live scope mutability", () => {
  const empty = developmentDatabasePolicy({
    managed: true,
    openSessions: [],
    scope: "session"
  }).developmentDatabase;
  assert.equal(empty.canChange, true);
  assert.equal(empty.options.project.available, true);
  assert.equal(empty.options.session.available, true);

  const one = developmentDatabasePolicy({
    managed: true,
    openSessions: sessions(1),
    scope: "session"
  }).developmentDatabase;
  assert.equal(one.canChange, false);
  assert.equal(one.options.project.available, true);
  assert.equal(one.options.session.available, true);
  assert.match(one.disabledReason, /Task 1/u);

  const two = developmentDatabasePolicy({
    managed: true,
    openSessions: sessions(2),
    scope: "session"
  }).developmentDatabase;
  assert.equal(two.canChange, false);
  assert.equal(two.options.project.available, false);
  assert.match(two.options.project.disabledReason, /Task 1, Task 2/u);
  assert.equal(two.options.session.available, true);

  const invalidLegacyState = developmentDatabasePolicy({
    managed: true,
    openSessions: sessions(2),
    scope: "project"
  }).developmentDatabase;
  assert.equal(invalidLegacyState.scope, "project");
  assert.equal(invalidLegacyState.options.project.available, false);
  assert.match(invalidLegacyState.options.project.disabledReason, /has 2/u);
});
