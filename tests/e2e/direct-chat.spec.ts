import { readFile } from "node:fs/promises";

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
const SAVE_WORK_PROMPT = (await readFile(
  new URL("../../src/prompts/save-work-commit-and-push.md", import.meta.url),
  "utf8"
)).trim();

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
    expect(messages[0].messageId).toMatch(/^message:tab:/u);
    expect(messages[0]).not.toHaveProperty("actionId");
    expect(messages[0]).not.toHaveProperty("intentId");
    await expect(page.getByText("Make the smallest safe change.", { exact: true })).toBeVisible();
    await expect(composer).toHaveValue("");
  });

  test("keeps the commit-and-push prompt behind the Save work confirmation", async ({ page }) => {
    const messages: Record<string, unknown>[] = [];
    let finishDelivery = () => undefined;
    const deliveryPending = new Promise<void>((resolve) => {
      finishDelivery = () => resolve();
    });
    await mockDirectChat(page, {
      onMessage(body) {
        messages.push(body);
        return deliveryPending;
      }
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    await page.getByRole("button", { name: "Save work", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Save current work?", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/authorized canonical destination/iu)).toBeVisible();
    await expect(dialog.getByText(/will not force-push, rebase, open a pull request, or deploy/iu)).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(messages).toHaveLength(0);

    await page.getByRole("button", { name: "Save work", exact: true }).click();
    const confirmButton = dialog.getByRole("button", { name: "Send to Codex", exact: true });
    await confirmButton.click();

    await expect(confirmButton).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save work", exact: true })).toBeDisabled();
    finishDelivery();

    await expect.poll(() => messages).toHaveLength(1);
    expect(messages[0]).toEqual(expect.objectContaining({
      displayMessage: SAVE_WORK_PROMPT,
      message: SAVE_WORK_PROMPT
    }));
    expect(messages[0].messageId).toMatch(/^message:tab:/u);
    expect(messages[0]).not.toHaveProperty("actionId");
    expect(messages[0]).not.toHaveProperty("intentId");
    await expect(dialog).not.toBeVisible();
  });

  test("disables Save work while the agent is active", async ({ page }) => {
    await mockDirectChat(page, {
      agentActive: true
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/env`);

    await expect(page.getByRole("button", { name: "Save work", exact: true })).toBeDisabled();
  });

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
  onMessage = () => undefined
}: {
  agentActive?: boolean;
  conversationLog?: Record<string, unknown>[];
  onMessage?: (body: Record<string, unknown>) => unknown | Promise<unknown>;
} = {}) {
  await mockProjectGateReady(page);
  const session = directSession({ agentActive });

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
  agentActive = false
}: {
  agentActive?: boolean;
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
    updatedAt: createdAt
  };
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
