import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_CREATE_PROJECT,
  ACTION_READ_ENV,
  ACTION_SAVE_ENV_USER_VALUES,
  createProjectActions
} from "../../packages/vibe64-project/src/server/actions.js";

function featureAction(project, actionId = "") {
  const action = createProjectActions({ project }).find((candidate) => candidate.id === actionId);
  assert.ok(action, `Expected feature action ${actionId} to be registered.`);
  return action;
}

test("Env read action forwards its input", async () => {
  const calls = [];
  const project = {
    async readEnv(...args) {
      calls.push(args);
      return {
        ok: true
      };
    }
  };
  const action = featureAction(project, ACTION_READ_ENV);
  const input = {
    scope: "development"
  };

  await action.execute(input, {});

  assert.deepEqual(calls, [[input]]);
});

test("project mutations publish first-class action events", async () => {
  const action = featureAction({
    async createProject() {
      return {
        ok: true,
        project: {
          projectRoot: "/srv/projects/catalogue",
          slug: "catalogue"
        }
      };
    }
  }, ACTION_CREATE_PROJECT);
  const result = await action.execute({ slug: "catalogue" }, {});
  const event = await action.events[0]({
    context: {},
    input: { slug: "catalogue" },
    result
  });

  assert.equal(event.type, "entity.changed");
  assert.equal(event.source, "vibe64");
  assert.equal(event.entity, "project");
  assert.equal(event.operation, "created");
  assert.equal(event.entityId, "catalogue");
  assert.equal(event.realtime.event, "vibe64.project.changed");
  assert.equal(event.realtime.audience, "all_clients");
  assert.deepEqual(event.realtime.payload, {
    projectRoot: "/srv/projects/catalogue",
    projectSlug: "catalogue"
  });
});

test("Env save action forwards user-owned values", async () => {
  const calls = [];
  const project = {
    async saveEnvUserValues(...args) {
      calls.push(args);
      return {
        ok: true
      };
    }
  };
  const action = featureAction(project, ACTION_SAVE_ENV_USER_VALUES);
  const input = {
    records: [{
      key: "API_URL",
      value: "https://example.test"
    }],
    scope: "development"
  };

  await action.execute(input, {});

  assert.deepEqual(calls, [[input]]);
});
