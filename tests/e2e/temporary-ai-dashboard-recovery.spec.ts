import { expect, test, type Page, type Request } from "@playwright/test";

import {
  BASE_URL,
  DASHBOARD_PATH,
  directChatSessionId,
  directChatSessionPayload
} from "./support/base-shell-data";
import {
  mockProjectGateReady
} from "./support/base-shell-mocks";
import {
  fulfillJson,
  routeApiEndpoint
} from "./support/base-shell/http";

const RECOVERY_CODES = [
  "vibe64_session_update_conflict",
  "vibe64_session_update_history_diverged"
] as const;
const REPOSITORY_RECOVERY_GIT_BOUNDARY = [
  "Vibe64—not Temporary AI—owns every repository operation. The failed operation has already been rolled back.",
  "You may inspect Git read-only and edit ordinary working-tree files in this session. Do not change HEAD, branches, refs, the index, stashes, remotes, commits, checkpoints, or repository configuration.",
  "Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase, cherry-pick, revert, pull, push, fetch, or update-ref. Do not create a recovery ref or stash; Vibe64 already owns durable recovery.",
  "Record the initial HEAD and index with read-only commands, leave both byte-for-byte unchanged, and do not publish. Resolve only by editing the conflicting working-tree files so the user can retry the Vibe64 operation.",
  "For an overlapping edit, keep the latest saved version's overlapping lines byte-for-byte and preserve this session's additional intent in adjacent non-overlapping content. Do not report success while Git has unmerged index entries or while HEAD/index differ from their initial values."
].join("\n");
const REPOSITORY_RECOVERY_PROMPT_LEAD = "Help resolve this Vibe64 repository problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:";

test.describe("Dashboard repository Temporary AI recovery", () => {
  test.use({
    hasTouch: true,
    viewport: { height: 844, width: 390 }
  });

  for (const code of RECOVERY_CODES) {
    test(`${code} reveals chat and sends exactly one Temporary AI turn`, async ({ page }) => {
      const diagnostic = `Repository update failed with ${code}.`;
      const expectedPrompt = [
        REPOSITORY_RECOVERY_PROMPT_LEAD,
        REPOSITORY_RECOVERY_GIT_BOUNDARY,
        diagnostic
      ].join("\n\n");
      const captured = await mockRepositoryRecovery(page, { code, diagnostic });

      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/repository`);

      await expect(page.getByRole("button", { name: "Show chat", exact: true })).toBeVisible();
      await expectTouchTarget(page.getByRole("button", {
        name: "Fix with temporary AI",
        exact: true
      }));
      await page.getByRole("button", { name: "Fix with temporary AI", exact: true }).click();

      const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
      await expect(workspace).toBeVisible();
      await expect(page.getByRole("button", { name: "Show project", exact: true })).toBeVisible();
      await expectTouchTarget(workspace.getByRole("button", {
        name: "Resolve repository update",
        exact: true
      }));
      await expectTouchTarget(workspace.getByRole("button", {
        name: "Read/write: temporary AI may edit this session",
        exact: true
      }));
      await expect.poll(() => captured.temporaryCreates).toHaveLength(1);
      await expect.poll(() => captured.temporaryTurns).toHaveLength(1);
      expect(captured.temporaryCreates[0]).toEqual(expect.objectContaining({
        policy: "workspace_write"
      }));
      expect(captured.temporaryTurns[0]).toEqual(expect.objectContaining({
        message: expectedPrompt,
        policy: "workspace_write",
        promptLabel: "Resolve repository update"
      }));
      await expect(workspace.getByText("Temporary recovery complete.", { exact: true })).toBeVisible();
      await expect(workspace.getByRole("button", {
        name: "Resolve repository update",
        exact: true
      })).toBeVisible();
      await expect(workspace.getByRole("button", {
        name: "Read/write: temporary AI may edit this session",
        exact: true
      })).toBeVisible();
      expect(captured.temporaryCreates).toHaveLength(1);
      expect(captured.temporaryTurns).toHaveLength(1);
      expect(captured.mainChatMessages).toHaveLength(0);
    });
  }
});

async function mockRepositoryRecovery(page: Page, {
  code,
  diagnostic
}: {
  code: typeof RECOVERY_CODES[number];
  diagnostic: string;
}) {
  const mainChatMessages: Record<string, unknown>[] = [];
  const temporaryCreates: Record<string, unknown>[] = [];
  const temporaryTurns: Record<string, unknown>[] = [];
  await mockProjectGateReady(page);

  await routeApiEndpoint(page, "/vibe64/repository", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname.endsWith("/history")) {
      await fulfillJson(route, {
        historySnapshotCommit: "canonical-commit",
        nextCursor: "",
        ok: true,
        updateCheck: {
          ahead: 0,
          behind: 1,
          canonicalCommit: "canonical-commit",
          checkedAt: "2026-08-23T12:00:00.000Z",
          sessionCommit: "session-commit",
          updateAvailable: true
        },
        versions: []
      });
      return;
    }
    await fulfillJson(route, { ok: true });
  }, { prefix: true });

  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === "PUT" && url.pathname.endsWith("/current")) {
      await fulfillJson(route, {
        ok: true,
        sessionId: directChatSessionId
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/agent-message")) {
      mainChatMessages.push(requestBodyWithoutOrigin(request));
      await fulfillJson(route, { delivered: true, ok: true });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/temporary-conversations")) {
      temporaryCreates.push(requestBodyWithoutOrigin(request));
      await fulfillJson(route, {
        conversationId: "temporary-conversation-1",
        ok: true
      });
      return;
    }
    if (
      method === "POST" &&
      url.pathname.endsWith("/temporary-conversations/temporary-conversation-1/turns")
    ) {
      temporaryTurns.push(requestBodyWithoutOrigin(request));
      await fulfillJson(route, {
        ok: true,
        runId: "temporary-run-1",
        status: "inProgress"
      });
      return;
    }
    if (
      method === "GET" &&
      url.pathname.endsWith("/temporary-conversations/temporary-conversation-1")
    ) {
      await fulfillJson(route, {
        message: "Temporary recovery complete.",
        ok: true,
        runId: "temporary-run-1",
        status: "completed"
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/updates/check")) {
      await fulfillJson(route, {
        code,
        error: diagnostic,
        ok: false
      });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/work")) {
      await fulfillJson(route, {
        ahead: 0,
        behind: 1,
        ok: true,
        operation: null,
        unsaved: true,
        updateAvailable: true,
        updateOperation: null
      });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/conversation-log")) {
      await fulfillJson(route, {
        conversationLog: [],
        ok: true,
        pagination: {
          count: 0,
          hasMoreBefore: false,
          limit: 20,
          totalTurnCount: 0
        },
        sessionId: directChatSessionId
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      await fulfillJson(route, directChatSessionPayload);
      return;
    }
    await fulfillJson(route, {
      creation: {
        canCreate: true,
        mode: "direct"
      },
      limits: {
        openSessionCount: 1
      },
      ok: true,
      sessions: [directChatSessionPayload]
    });
  }, { prefix: true });

  return {
    mainChatMessages,
    temporaryCreates,
    temporaryTurns
  };
}

function requestBodyWithoutOrigin(request: Request) {
  const {
    originId: _originId,
    ...body
  } = (request.postDataJSON() || {}) as Record<string, unknown>;
  return body;
}

async function expectTouchTarget(locator: ReturnType<Page["getByRole"]>) {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    return box && {
      height: Math.round(box.height),
      width: Math.round(box.width)
    };
  }).toMatchObject({
    height: 48
  });
}
