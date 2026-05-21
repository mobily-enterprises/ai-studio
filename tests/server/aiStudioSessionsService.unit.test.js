import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_STUDIO_SESSION_STATUS
} from "../../server/lib/aiStudio/index.js";
import {
  createService
} from "../../packages/ai-studio-sessions/src/server/service.js";

function readySetupServices() {
  const readyService = {
    async getStatus() {
      return {
        ready: true
      };
    }
  };
  return {
    accountSetupService: readyService,
    adapterSetupService: readyService,
    projectSetupService: readyService,
    studioSetupService: readyService
  };
}

test("session action closes terminals when the action archives the session", async () => {
  const closedSessionIds = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction(sessionId) {
            return {
              sessionId,
              status: AI_STUDIO_SESSION_STATUS.FINISHED
            };
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async closeSessionTerminals(sessionId) {
        closedSessionIds.push(sessionId);
      }
    }
  });

  const session = await service.runSessionAction("session-1", "finish_session");

  assert.equal(session.status, AI_STUDIO_SESSION_STATUS.FINISHED);
  assert.deepEqual(closedSessionIds, ["session-1"]);
});

test("session action keeps terminals when the session remains active", async () => {
  const closedSessionIds = [];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async runAction(sessionId) {
            return {
              sessionId,
              status: AI_STUDIO_SESSION_STATUS.ACTIVE
            };
          }
        };
      }
    },
    setupServices: readySetupServices(),
    terminalService: {
      async closeSessionTerminals(sessionId) {
        closedSessionIds.push(sessionId);
      }
    }
  });

  const session = await service.runSessionAction("session-1", "record_action");

  assert.equal(session.status, AI_STUDIO_SESSION_STATUS.ACTIVE);
  assert.deepEqual(closedSessionIds, []);
});

test("session creation waits for an unsynced merged session", async () => {
  let createSessionCalled = false;
  const existingSessions = [
    {
      metadata: {
        pr_merged: "yes"
      },
      sessionId: "session-merged",
      status: AI_STUDIO_SESSION_STATUS.ACTIVE
    }
  ];
  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          async createSession() {
            createSessionCalled = true;
            return {
              sessionId: "new-session"
            };
          },
          async listSessions() {
            return existingSessions;
          }
        };
      },
      async requireProjectType() {
        return {
          adapter: {
            id: "jskit"
          },
          projectType: "jskit"
        };
      }
    },
    setupServices: readySetupServices()
  });

  const result = await service.createSession();

  assert.equal(result.ok, false);
  assert.equal(result.status, "blocked");
  assert.equal(result.errors[0].code, "main_checkout_sync_required");
  assert.equal(createSessionCalled, false);
});
