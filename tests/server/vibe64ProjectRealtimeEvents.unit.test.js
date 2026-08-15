import assert from "node:assert/strict";
import test from "node:test";
import {
  VIBE64_PROJECT_CHANGED_EVENT,
  vibe64ProjectChangedServiceEvent,
  vibe64ProjectRuntimeChangedServiceEvent
} from "@local/vibe64-core/server/projectRealtimeEvents";

test("Vibe64 project service event describes a realtime project change", () => {
  const event = vibe64ProjectChangedServiceEvent({
    operation: "selected"
  });
  const entityId = event.entityId({
    args: [{
      slug: "from-input"
    }],
    result: {
      currentProject: {
        projectRoot: "/tmp/beepollen",
        slug: "beepollen"
      },
      hasSelection: true,
      targetRoot: "/tmp/beepollen"
    }
  });
  const payload = event.realtime.payload({
    result: {
      currentProject: {
        projectRoot: "/tmp/beepollen",
        slug: "beepollen"
      },
      hasSelection: true,
      targetRoot: "/tmp/beepollen"
    }
  });

  assert.equal(event.type, "entity.changed");
  assert.equal(event.source, "vibe64");
  assert.equal(event.entity, "project");
  assert.equal(event.operation, "selected");
  assert.equal(event.realtime.event, VIBE64_PROJECT_CHANGED_EVENT);
  assert.equal(event.realtime.audience, "all_clients");
  assert.equal(entityId, "beepollen");
  assert.deepEqual(payload, {
    hasSelection: true,
    projectRoot: "/tmp/beepollen",
    projectSlug: "beepollen",
    targetRoot: "/tmp/beepollen"
  });
});

test("Vibe64 project service event falls back to request input for entity ids", () => {
  const event = vibe64ProjectChangedServiceEvent();

  assert.equal(event.entityId({
    args: [{
      name: "new-app"
    }],
    result: {}
  }), "new-app");
});

test("Vibe64 runtime service events expose close metadata from the real method result", () => {
  const event = vibe64ProjectRuntimeChangedServiceEvent({
    action: "runtime-closed"
  });
  const state = {
    args: [{
      reason: "user-close-project"
    }],
    result: {
      ok: true,
      projectSlug: "alpha",
      targetRoot: "/tmp/alpha",
      runtime: {
        open: false
      }
    }
  };

  assert.equal(event.entityId(state), "alpha");
  assert.equal(event.action, "runtime-closed");
  assert.equal(event.reason(state), "user-close-project");
  assert.deepEqual(event.realtime.payload(state), {
    message: "Project is closed.",
    projectRoot: "/tmp/alpha",
    projectSlug: "alpha",
    runtime: {
      open: false
    },
    targetRoot: "/tmp/alpha"
  });
  assert.equal(event.entityId({ result: { ok: false } }), null);
});
