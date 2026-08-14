import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_READ_ENV,
  ACTION_SAVE_ENV_USER_VALUES,
  featureActions
} from "../../packages/vibe64-project/src/server/actions.js";

function featureAction(actionId = "") {
  const action = featureActions.find((candidate) => candidate.id === actionId);
  assert.ok(action, `Expected feature action ${actionId} to be registered.`);
  return action;
}

test("Env read action forwards its input", async () => {
  const action = featureAction(ACTION_READ_ENV);
  const calls = [];
  const input = {
    scope: "development"
  };

  await action.execute(input, {}, {
    featureService: {
      async readEnv(...args) {
        calls.push(args);
        return {
          ok: true
        };
      }
    }
  });

  assert.deepEqual(calls, [[input]]);
});

test("Env save action forwards user-owned values", async () => {
  const action = featureAction(ACTION_SAVE_ENV_USER_VALUES);
  const calls = [];
  const input = {
    records: [{
      key: "API_URL",
      value: "https://example.test"
    }],
    scope: "development"
  };

  await action.execute(input, {}, {
    featureService: {
      async saveEnvUserValues(...args) {
        calls.push(args);
        return {
          ok: true
        };
      }
    }
  });

  assert.deepEqual(calls, [[input]]);
});
