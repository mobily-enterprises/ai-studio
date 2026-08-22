import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createService
} from "../../packages/current-app/src/server/service.js";
import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

function projectService(root, {
  sessionRoot = "",
  userEnvironment = {}
} = {}) {
  return {
    async createRuntime() {
      return {
        async getSession(sessionId) {
          return {
            sessionId,
            sourcePath: sessionRoot,
            targetRoot: sessionRoot
          };
        }
      };
    },
    currentProjectSourceRoot() {
      return root;
    },
    currentTargetRoot() {
      return root;
    },
    async projectExecutionEnvironment() {
      return userEnvironment;
    }
  };
}

test("current app returns the explicit Vibe64 launch contract", async () => {
  await withTemporaryRoot(async (root) => {
    const calls = [];
    const service = createService({
      env: {
        PLATFORM_VALUE: "platform"
      },
      inspectLaunch(input) {
        calls.push(input);
        return {
          components: ["nodejs"],
          diagnostics: [],
          resources: [],
          runtimeRequirements: ["node"],
          stackHash: "stack-hash",
          status: "ready",
          targets: [{
            id: "web",
            label: "Web"
          }]
        };
      },
      projectService: projectService(root, {
        userEnvironment: {
          BOOKS_ORIGIN: "http://books.test"
        }
      })
    });

    const response = await service.inspectCurrentApp();

    assert.equal(response.ok, true);
    assert.equal(response.ready, true);
    assert.equal(response.status, "ready");
    assert.equal(response.root, root);
    assert.deepEqual(response.components, ["nodejs"]);
    assert.deepEqual(response.targets, [{ id: "web", label: "Web" }]);
    assert.equal(calls[0].environment.PLATFORM_VALUE, "platform");
    assert.equal(calls[0].environment.BOOKS_ORIGIN, "http://books.test");
  });
});

test("missing Vibe64 launch declarations are unconfigured, not guessed", async () => {
  await withTemporaryRoot(async (root) => {
    const service = createService({
      inspectLaunch() {
        const error = new Error("Genesis requires genesis/stack.md. Run genesis init first.");
        error.code = "STACK_REQUIRED";
        throw error;
      },
      projectService: projectService(root)
    });

    const response = await service.inspectCurrentApp();

    assert.equal(response.ok, true);
    assert.equal(response.ready, false);
    assert.equal(response.status, "unconfigured");
    assert.deepEqual(response.targets, []);
    assert.match(response.message, /stack\.md/u);
  });
});

test("a project without a baseline source is unconfigured until a session exists", async () => {
  let inspected = false;
  const service = createService({
    inspectLaunch() {
      inspected = true;
      return {};
    },
    projectService: projectService("")
  });

  const response = await service.inspectCurrentApp();

  assert.equal(response.ok, true);
  assert.equal(response.status, "unconfigured");
  assert.equal(inspected, false);
  assert.match(response.message, /Choose a project/u);
});

test("session inspection uses that session's source directory", async () => {
  await withTemporaryRoot(async (root) => {
    const sessionRoot = path.join(root, "session-source");
    let inspectedRoot = "";
    const service = createService({
      inspectLaunch({ projectRoot }) {
        inspectedRoot = projectRoot;
        return {
          status: "unconfigured",
          targets: []
        };
      },
      projectService: projectService(root, {
        sessionRoot
      })
    });

    const response = await service.inspectCurrentApp({
      sessionId: "session-1"
    });

    assert.equal(response.ok, true);
    assert.equal(inspectedRoot, sessionRoot);
    assert.equal(response.root, sessionRoot);
  });
});

test("unexpected Genesis inspection errors remain visible", async () => {
  await withTemporaryRoot(async (root) => {
    const service = createService({
      inspectLaunch() {
        const error = new Error("Cannot read Stack file.");
        error.code = "EACCES";
        throw error;
      },
      projectService: projectService(root)
    });

    const response = await service.inspectCurrentApp();

    assert.equal(response.ok, false);
    assert.equal(response.code, "EACCES");
    assert.match(response.error, /Cannot read Stack/u);
  });
});
