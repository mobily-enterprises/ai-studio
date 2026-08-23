import { expect, test, type Page, type Request, type Route } from "@playwright/test";

import {
  BASE_URL,
  DASHBOARD_PATH,
  sessionRuntimeRoot
} from "./support/base-shell-data";
import {
  mockProjectGateReady
} from "./support/base-shell-mocks";
import {
  routeApiEndpoint
} from "./support/base-shell/http";

const SESSION_ID = "direct-chat-session";
const REPOSITORY_RECOVERY_GIT_BOUNDARY = [
  "Vibe64—not Temporary AI—owns every repository operation. The failed operation has already been rolled back.",
  "You may inspect Git read-only and edit ordinary working-tree files in this session. Do not change HEAD, branches, refs, the index, stashes, remotes, commits, checkpoints, or repository configuration.",
  "Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase, cherry-pick, revert, pull, push, fetch, or update-ref. Do not create a recovery ref or stash; Vibe64 already owns durable recovery.",
  "Record the initial HEAD and index with read-only commands, leave both byte-for-byte unchanged, and do not publish. Resolve only by editing the conflicting working-tree files so the user can retry the Vibe64 operation.",
  "For an overlapping edit, keep the latest saved version's overlapping lines byte-for-byte and preserve this session's additional intent in adjacent non-overlapping content. Do not report success while Git has unmerged index entries or while HEAD/index differ from their initial values."
].join("\n");
test.describe("direct chat", () => {
  test("sends an ordinary chat message without orchestration metadata or a prompts section", async ({ page }) => {
    const messages: Record<string, unknown>[] = [];
    await mockDirectChat(page, {
      onMessage(body) {
        messages.push(body);
      }
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    await expect(page.getByText("Prompts", { exact: true })).toHaveCount(0);

    const composer = page.getByLabel("Message Codex");
    await composer.fill("Make the smallest safe change.");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect.poll(() => messages).toHaveLength(1);
    expect(messages[0]).toEqual(expect.objectContaining({
      displayMessage: "Make the smallest safe change.",
      message: "Make the smallest safe change."
    }));
    expect(messages[0].messageId).toMatch(/^message_tab_/u);
    expect(messages[0]).not.toHaveProperty("actionId");
    expect(messages[0]).not.toHaveProperty("intentId");
    await expect(page.getByText("Make the smallest safe change.", { exact: true })).toBeVisible();
    await expect(composer).toHaveValue("");
  });

  test("saves through the native project operation without sending a chat message", async ({ page }) => {
    const messages: Record<string, unknown>[] = [];
    const saves: Record<string, unknown>[] = [];
    await mockDirectChat(page, {
      onMessage(body) {
        messages.push(body);
      },
      onSave(body) {
        saves.push(body);
      }
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    await page.getByRole("button", { name: "Save work", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Save current work?", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/canonical repository/iu)).toBeVisible();
    await expect(dialog.getByText(/concurrent canonical changes/iu)).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(messages).toHaveLength(0);

    await page.getByRole("button", { name: "Save work", exact: true }).click();
    const confirmButton = dialog.getByRole("button", { name: "Save", exact: true });
    await confirmButton.click();

    await expect.poll(() => saves).toHaveLength(1);
    expect(saves[0]).toEqual({});
    expect(messages).toHaveLength(0);
    await expect(dialog).not.toBeVisible();
  });

  test("disables Save work while the agent is active", async ({ page }) => {
    await mockDirectChat(page, {
      agentActive: true
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    await expect(page.getByRole("button", { name: "Save work", exact: true })).toBeDisabled();
  });

  test.describe("temporary AI mobile navigation", () => {
    test.use({
      hasTouch: true,
      viewport: { height: 844, width: 390 }
    });

    test("switches between Main chat and temporary AI without stopping hidden work", async ({ page }) => {
      const messages: Record<string, unknown>[] = [];
      const temporaryDeletes: string[] = [];
      const temporaryStarts: Record<string, unknown>[] = [];
      const temporaryTurns: Record<string, unknown>[] = [];
      let mainChatVisible = false;
      let pollsWhileMainChatVisible = 0;
      await mockDirectChat(page, {
        onMessage(body) {
          messages.push(body);
        },
        onTemporaryConversation(body) {
          temporaryStarts.push(body);
        },
        onTemporaryDelete(conversationId) {
          temporaryDeletes.push(conversationId);
        },
        onTemporaryPoll() {
          if (mainChatVisible) {
            pollsWhileMainChatVisible += 1;
            return {
              message: "Finished while Main chat was visible.",
              ok: true,
              progressUpdates: [{
                id: "progress:hidden",
                text: "Continued while Main chat was visible."
              }],
              runId: "temporary-run-1",
              status: "completed"
            };
          }
          return {
            message: "",
            ok: true,
            progressUpdates: [{ id: "progress:initial", text: "Inspecting the project." }],
            runId: "temporary-run-1",
            status: "inProgress"
          };
        },
        onTemporaryTurn(body) {
          temporaryTurns.push(body);
        }
      });

      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
      await page.getByRole("button", { name: "Open temporary AI" }).click();

      const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
      const navigation = workspace.getByRole("navigation", {
        name: "Main and temporary conversations"
      });
      await expect(workspace).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Main chat", exact: true })).toBeVisible();
      await workspace.getByLabel("Message temporary AI").fill("Inspect this without changing it.");
      await workspace.getByRole("button", { name: "Send to temporary AI" }).click();
      await expect(workspace.getByLabel("Temporary AI progress").getByText(
        "Inspecting the project.",
        { exact: true }
      )).toBeVisible();

      await navigation.getByRole("button", { name: "New temporary AI task", exact: true }).click();
      await expect(navigation.getByRole("button", { name: "Temporary 2", exact: true })).toHaveAttribute(
        "aria-current",
        "page"
      );

      const coarseControls = [
        navigation.getByRole("button", { name: "Main chat", exact: true }),
        navigation.locator('[data-temporary-ai-task-id]').filter({ hasText: "Temporary 1" }),
        navigation.locator('[data-temporary-ai-task-id]').filter({ hasText: "Temporary 2" }),
        navigation.getByRole("button", { name: "Close Temporary 1", exact: true }),
        navigation.getByRole("button", { name: "Close Temporary 2", exact: true }),
        navigation.getByRole("button", { name: "New temporary AI task", exact: true }),
        navigation.getByRole("button", { name: /Read-only: temporary AI cannot edit/iu })
      ];
      for (const control of coarseControls) {
        const bounds = await control.boundingBox();
        expect(bounds?.height).toBeGreaterThanOrEqual(48);
        expect(bounds?.width).toBeGreaterThanOrEqual(48);
      }

      await navigation.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
      });
      const navigationBounds = await navigation.boundingBox();
      const mainChatBounds = await navigation.getByRole("button", {
        name: "Main chat",
        exact: true
      }).boundingBox();
      expect(mainChatBounds?.x).toBeGreaterThanOrEqual(navigationBounds?.x || 0);
      expect((mainChatBounds?.x || 0) - (navigationBounds?.x || 0)).toBeLessThan(12);

      await navigation.getByRole("button", { name: "Main chat", exact: true }).click();
      mainChatVisible = true;
      await expect(workspace).not.toBeVisible();
      await expect(page.getByRole("region", { name: "Session chat" })).toBeFocused();
      await page.getByLabel("Message Codex").fill("Continue in the main conversation.");
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect.poll(() => messages).toHaveLength(1);
      await expect.poll(() => pollsWhileMainChatVisible).toBeGreaterThan(0);

      await page.getByRole("button", { name: "Open temporary AI" }).click();
      await expect(workspace).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Temporary 1", exact: true })).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Temporary 2", exact: true })).toHaveAttribute(
        "aria-current",
        "page"
      );
      await navigation.getByRole("button", { name: "Temporary 1", exact: true }).click();
      await expect(workspace.getByText("Continued while Main chat was visible.", { exact: true })).toBeVisible();
      await expect(workspace.getByText("Finished while Main chat was visible.", { exact: true })).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Temporary 1", exact: true })).toHaveAttribute(
        "aria-current",
        "page"
      );

      await navigation.getByRole("button", { name: "Close Temporary 1", exact: true }).click();
      await expect.poll(() => temporaryDeletes).toEqual(["temporary-conversation-1"]);
      await expect(workspace).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Temporary 1", exact: true })).toHaveCount(0);
      await expect(navigation.getByRole("button", { name: "Temporary 2", exact: true })).toBeVisible();
      expect(temporaryStarts).toHaveLength(1);
      expect(temporaryTurns).toHaveLength(1);
      expect(temporaryTurns[0]).toEqual(expect.objectContaining({
        message: "Inspect this without changing it.",
        policy: "read",
        promptLabel: "Temporary 1"
      }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  });

  for (const width of [960, 1600]) {
    test(`keeps Main chat navigation stable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ height: 900, width });
      await mockDirectChat(page);
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
      await page.getByRole("button", { name: "Open temporary AI" }).click();

      const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
      const navigation = workspace.getByRole("navigation", {
        name: "Main and temporary conversations"
      });
      await navigation.getByRole("button", { name: "New temporary AI task", exact: true }).click();
      await expect(navigation.getByRole("button", { name: "Temporary 2", exact: true })).toHaveAttribute(
        "aria-current",
        "page"
      );
      await navigation.getByRole("button", { name: "Main chat", exact: true }).click();
      await expect(workspace).not.toBeVisible();
      await expect(page.getByRole("region", { name: "Session chat" })).toBeFocused();

      await page.getByRole("button", { name: "Open temporary AI" }).click();
      await expect(navigation.getByRole("button", { name: "Temporary 1", exact: true })).toBeVisible();
      await expect(navigation.getByRole("button", { name: "Temporary 2", exact: true })).toHaveAttribute(
        "aria-current",
        "page"
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  for (const recovery of [
    {
      diagnostic: "Dependency installation exited with code 1.",
      expectedPrompt: [
        "Workspace preparation needs attention:",
        "Dependency installation exited with code 1.",
        "Please diagnose and fix this in the current workspace, preserving the existing work. When it is fixed, tell me to retry workspace preparation."
      ].join("\n\n"),
      status: "failed"
    },
    {
      diagnostic: "Two Stack components declare different setup recipes.",
      expectedPrompt: [
        "Workspace preparation needs attention:",
        "Two Stack components declare different setup recipes.",
        "Please diagnose and fix this in the current workspace, preserving the existing work. When it is fixed, tell me to retry workspace preparation."
      ].join("\n\n"),
      status: "ambiguous"
    }
  ]) {
    test(`routes ${recovery.status} workspace preparation through Temporary AI`, async ({ page }) => {
      const captured = await mockTemporaryRecovery(page, {
        workspaceSetup: {
          diagnostic: recovery.diagnostic,
          status: recovery.status,
          updatedAt: "2026-08-23T12:00:00.000Z"
        }
      });

      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
      await page.getByRole("button", { name: "Fix with temporary AI", exact: true }).click();

      await expectTemporaryRecovery(page, captured, {
        expectedPrompt: recovery.expectedPrompt,
        promptLabel: "Fix workspace preparation"
      });
    });
  }

  for (const recovery of [
    {
      action: "Save",
      code: "vibe64_session_save_history_diverged",
      operationKey: "operation",
      promptLead: "Help resolve this Vibe64 Save problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:"
    },
    {
      action: "Update",
      code: "vibe64_session_update_conflict",
      operationKey: "updateOperation",
      promptLead: "Help resolve this Vibe64 Update problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:"
    },
    {
      action: "Update",
      code: "vibe64_session_update_history_diverged",
      operationKey: "updateOperation",
      promptLead: "Help resolve this Vibe64 Update problem. Inspect the current session and canonical repository state, preserve all work, and do not publish until the conflict is understood:"
    }
  ]) {
    test(`routes chat ${recovery.code} recovery through Temporary AI`, async ({ page }) => {
      const diagnostic = `${recovery.action} could not preserve the changed history.`;
      const captured = await mockTemporaryRecovery(page, {
        workState: {
          operation: null,
          updateOperation: null,
          unsaved: true,
          [recovery.operationKey]: {
            code: recovery.code,
            error: diagnostic,
            operationId: `operation-${recovery.code}`,
            status: "failed"
          }
        }
      });

      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);
      await page.getByRole("button", { name: "Fix with temporary AI", exact: true }).click();

      await expectTemporaryRecovery(page, captured, {
        expectedPrompt: [
          recovery.promptLead,
          REPOSITORY_RECOVERY_GIT_BOUNDARY,
          diagnostic
        ].join("\n\n"),
        promptLabel: `Resolve ${recovery.action}`
      });
    });
  }

  test("submits assistant numbered questions through the same chat endpoint", async ({ page }) => {
    const messages: Record<string, unknown>[] = [];
    const assistantPrompt = [
      "Please answer these before I continue.",
      "[1] What should change?",
      "[2] What should stay the same?"
    ].join("\n");
    await mockDirectChat(page, {
      conversationLog: [{
        assistant: {
          at: "2026-08-14T01:03:00.000Z",
          role: "assistant",
          text: assistantPrompt
        },
        turnId: "turn-numbered-questions"
      }],
      onMessage(body) {
        messages.push(body);
      }
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    await page.getByLabel("[1] What should change?").fill("Tighten the layout.");
    await page.getByLabel("[2] What should stay the same?").fill("Keep the current copy.");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect.poll(() => messages).toHaveLength(1);
    expect(messages[0]).toEqual(expect.objectContaining({
      displayMessage: "[1] Tighten the layout.\n[2] Keep the current copy.",
      message: "[1] Tighten the layout.\n[2] Keep the current copy."
    }));
  });
});

async function mockDirectChat(page: Page, {
  agentActive = false,
  conversationLog = [],
  onMessage = () => undefined,
  onSave = () => undefined,
  onTemporaryConversation = () => undefined,
  onTemporaryDelete = () => undefined,
  onTemporaryPoll = () => null,
  onTemporaryTurn = () => undefined,
  workspaceSetup = null,
  workState = {
    operation: null,
    unsaved: true,
    updateOperation: null
  }
}: {
  agentActive?: boolean;
  conversationLog?: Record<string, unknown>[];
  onMessage?: (body: Record<string, unknown>) => unknown | Promise<unknown>;
  onSave?: (body: Record<string, unknown>) => unknown | Promise<unknown>;
  onTemporaryConversation?: (body: Record<string, unknown>) => unknown | Promise<unknown>;
  onTemporaryDelete?: (conversationId: string) => unknown | Promise<unknown>;
  onTemporaryPoll?: () => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;
  onTemporaryTurn?: (body: Record<string, unknown>) => unknown | Promise<unknown>;
  workspaceSetup?: Record<string, unknown> | null;
  workState?: Record<string, unknown>;
} = {}) {
  await mockProjectGateReady(page);
  const session = directSession({ agentActive, workspaceSetup });

  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === "PUT" && url.pathname.endsWith("/current")) {
      await fulfillJson(route, {
        ok: true,
        sessionId: SESSION_ID
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/view-state")) {
      await fulfillJson(route, { ok: true });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/agent-message")) {
      const body = requestBodyWithoutOrigin(request);
      await onMessage(body);
      await fulfillJson(route, {
        delivered: true,
        messageId: String(body.messageId || ""),
        ok: true,
        sessionId: SESSION_ID
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/save")) {
      const body = requestBodyWithoutOrigin(request);
      await onSave(body);
      await fulfillJson(route, {
        ok: true,
        operation: {
          events: [{ message: "Saved to the canonical project repository." }],
          status: "succeeded"
        },
        sessionId: SESSION_ID,
        status: "saved"
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/temporary-conversations")) {
      const body = requestBodyWithoutOrigin(request);
      await onTemporaryConversation(body);
      await fulfillJson(route, {
        conversationId: "temporary-conversation-1",
        ok: true
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/temporary-conversations/temporary-conversation-1/turns")) {
      const body = requestBodyWithoutOrigin(request);
      await onTemporaryTurn(body);
      await fulfillJson(route, {
        ok: true,
        runId: "temporary-run-1",
        status: "inProgress"
      });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/temporary-conversations/temporary-conversation-1")) {
      const temporaryPoll = await onTemporaryPoll();
      await fulfillJson(route, temporaryPoll || {
        message: "Temporary answer",
        ok: true,
        runId: "temporary-run-1",
        status: "completed"
      });
      return;
    }
    if (method === "DELETE" && url.pathname.endsWith("/temporary-conversations/temporary-conversation-1")) {
      await onTemporaryDelete("temporary-conversation-1");
      await fulfillJson(route, { ok: true });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/work")) {
      await fulfillJson(route, {
        ...workState,
        ok: true
      });
      return;
    }
    if (method === "GET" && url.pathname.endsWith("/conversation-log")) {
      await fulfillJson(route, {
        conversationLog,
        ok: true,
        pagination: {
          count: conversationLog.length,
          hasMoreBefore: false,
          limit: 20,
          totalTurnCount: conversationLog.length
        },
        sessionId: SESSION_ID
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      await fulfillJson(route, {
        ...session,
        ok: true
      });
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
      sessions: [session]
    });
  }, { prefix: true });
}

function directSession({
  agentActive = false,
  workspaceSetup = null
}: {
  agentActive?: boolean;
  workspaceSetup?: Record<string, unknown> | null;
} = {}) {
  const createdAt = "2026-08-14T00:00:00.000Z";
  const sessionRoot = sessionRuntimeRoot(SESSION_ID);
  const sourcePath = `${sessionRoot}/source`;
  return {
    agentRuns: [],
    agentSession: {
      identity: null,
      providerId: "codex",
      terminal: null,
      thread: {
        id: "thread-direct-chat"
      },
      transportId: "codex_app_server",
      turn: {
        active: agentActive
      },
      workdir: sourcePath
    },
    backgroundTasks: [],
    companion: {
      id: "genesis",
      label: "Genesis"
    },
    conversationLogRoot: `${sessionRoot}/conversation-log`,
    manifest: {
      createdAt,
      product: "vibe64",
      revision: 1,
      schemaVersion: 1,
      sessionId: SESSION_ID,
      updatedAt: createdAt
    },
    metadata: {},
    revision: 1,
    sessionId: SESSION_ID,
    sessionName: "Direct chat",
    sessionRoot,
    sourcePath,
    sourceReady: true,
    stateRoot: `${sessionRoot}/state`,
    status: "active",
    targetRoot: "/workspace/example-target-app",
    updatedAt: createdAt,
    ...(workspaceSetup ? { workspaceSetup } : {})
  };
}

async function mockTemporaryRecovery(page: Page, options: {
  workspaceSetup?: Record<string, unknown> | null;
  workState?: Record<string, unknown>;
}) {
  const messages: Record<string, unknown>[] = [];
  const temporaryStarts: Record<string, unknown>[] = [];
  const temporaryTurns: Record<string, unknown>[] = [];
  await mockDirectChat(page, {
    ...options,
    onMessage(body) {
      messages.push(body);
    },
    onTemporaryConversation(body) {
      temporaryStarts.push(body);
    },
    onTemporaryTurn(body) {
      temporaryTurns.push(body);
    }
  });
  return {
    messages,
    temporaryStarts,
    temporaryTurns
  };
}

async function expectTemporaryRecovery(page: Page, captured: {
  messages: Record<string, unknown>[];
  temporaryStarts: Record<string, unknown>[];
  temporaryTurns: Record<string, unknown>[];
}, {
  expectedPrompt,
  promptLabel
}: {
  expectedPrompt: string;
  promptLabel: string;
}) {
  const workspace = page.getByRole("region", { name: "Temporary AI workspace" });
  await expect(workspace).toBeVisible();
  await expect.poll(() => captured.temporaryStarts).toHaveLength(1);
  expect(captured.temporaryStarts[0]).toEqual(expect.objectContaining({
    policy: "workspace_write"
  }));
  await expect.poll(() => captured.temporaryTurns).toHaveLength(1);
  expect(captured.temporaryTurns[0]).toEqual(expect.objectContaining({
    message: expectedPrompt,
    policy: "workspace_write",
    promptLabel
  }));
  await expect(workspace.getByText("Temporary answer", { exact: true })).toBeVisible();
  await expect(workspace.getByRole("button", {
    name: promptLabel,
    exact: true
  })).toBeVisible();
  await expect(workspace.getByRole("button", {
    name: "Read/write: temporary AI may edit this session",
    exact: true
  })).toBeVisible();
  expect(captured.temporaryStarts).toHaveLength(1);
  expect(captured.temporaryTurns).toHaveLength(1);
  expect(captured.messages).toHaveLength(0);
}

function requestBodyWithoutOrigin(request: Request) {
  const {
    originId: _originId,
    ...body
  } = (request.postDataJSON() || {}) as Record<string, unknown>;
  return body;
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json"
  });
}
