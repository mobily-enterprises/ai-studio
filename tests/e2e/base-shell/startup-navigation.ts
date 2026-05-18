import { expect, test } from "@playwright/test";

import { BASE_URL, currentAppPayload } from "../support/base-shell-data";
import { expectSessionsRoute } from "../support/base-shell-assertions";
import {
  mockAppSetupBlocked,
  mockBootstrapBlocked,
  mockCurrentAppInspection,
  mockStudioReady,
  mockTargetAppBlocked,
  mockTargetScripts,
  trackStudioApiRequests
} from "../support/base-shell-mocks";

test.describe("studio startup navigation", () => {
  test("root redirects to home without running setup doctors", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockBootstrapBlocked(page);
    await mockCurrentAppInspection(page);
    await page.goto(`${BASE_URL}/`);
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/studio-setup/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(1);
  });

  test("home loads the current app without running setup doctors", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockTargetAppBlocked(page);
    await mockCurrentAppInspection(page);
    await page.goto(`${BASE_URL}/home`);
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
    await expect(page.getByRole("link", { name: "Setup", exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Target Scripts", exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Studio Setup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Adapter Setup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Project Setup", exact: true })).toHaveCount(0);
    await expect(page.locator(".target-scripts-panel")).toHaveCount(0);
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(1);
  });

  test("target scripts page persists stars, resets defaults, and runs one terminal", async ({ page }) => {
    const terminalInputs: string[] = [];
    const terminalStarts: string[] = [];
    await page.route("**/api/studio/current-app", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentAppPayload)
      });
    });
    await page.route("**/api/ai-studio/sessions", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 3,
            openSessionCount: 0
          },
          ok: true,
          sessions: [],
          stepDefinitions: []
        })
      });
    });
    await mockTargetScripts(page, {
      terminalInputs,
      terminalStarts
    });

    await page.goto(`${BASE_URL}/home/target-scripts`);
    const panel = page.locator(".target-scripts-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByRole("link", { name: "Target Scripts", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Target Scripts", exact: true })).toHaveCount(0);

    await expect.poll(async () => {
      return panel.locator(".target-scripts-panel__starred button[aria-label^='Run ']")
        .evaluateAll((buttons) => buttons.map((button) =>
          String(button.getAttribute("aria-label") || "").replace(/^Run /u, "")
        ));
    }).toEqual(["jskit:update", "build", "server", "verify"]);
    await expect(panel.getByText("vite preview")).toBeVisible();

    await panel.getByRole("button", { name: "Unstar jskit:update" }).click();
    await expect(panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run jskit:update" }))
      .toHaveCount(0);
    await panel.getByRole("button", { name: "Star preview" }).click();
    await expect(panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run preview" }))
      .toBeVisible();
    await expect(panel.locator(".target-scripts-panel__other-scripts").getByRole("button", { name: "Run preview" }))
      .toHaveCount(0);
    await panel.getByRole("button", { name: "Reset" }).click();
    await expect(panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run preview" }))
      .toHaveCount(0);
    await expect(panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run jskit:update" }))
      .toBeVisible();

    await panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run build" }).click();
    await expect.poll(() => terminalStarts).toEqual(["build"]);
    const terminal = page.locator(".target-script-terminal");
    await expect(terminal).toHaveCount(1);
    await expect(terminal).toContainText("vite build");
    await expect(terminal.locator(".xterm-rows")).toContainText("Started target-term-build.");
    const viewport = page.viewportSize();
    await expect.poll(async () => {
      const box = await terminal.boundingBox();
      return Boolean(
        box &&
        viewport &&
        Math.round(box.width) === viewport.width &&
        Math.round(box.height) === viewport.height
      );
    }).toBe(true);
    await terminal.getByRole("button", { name: "Ctrl-C" }).click();
    await expect.poll(() => terminalInputs).toContain("\u0003");
    await terminal.getByRole("button", { name: "Close target script terminal" }).click();
    await expect(terminal).toHaveCount(0);

    await panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run server" }).click();
    await expect.poll(() => terminalStarts).toEqual(["build", "server"]);
    await expect(terminal).toHaveCount(1);
    await expect(terminal).toContainText("node server.js");
  });

  test("home stays on home even when setup checks would be blocked", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockAppSetupBlocked(page);
    await mockCurrentAppInspection(page);
    await page.goto(`${BASE_URL}/home`);
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(1);
  });

  test("root redirects to home when every setup gate is ready", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/`);
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(1);
  });

  test("direct Adapter Setup tab runs the adapter setup stream once", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockTargetAppBlocked(page);
    await page.goto(`${BASE_URL}/setup?tab=adapter-setup`);
    await expect(page.getByRole("heading", { name: "Adapter Setup", exact: true })).toBeVisible();
    await expect(page.getByText("Adapter Setup blocked").first()).toBeVisible();
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(1);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup/stream")).toBe(1);
  });

  test("direct Project Setup tab runs the Project Setup doctor stream once", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockAppSetupBlocked(page);
    await page.goto(`${BASE_URL}/setup?tab=project-setup`);
    await expect(page.getByRole("heading", { name: "Project Setup", exact: true })).toBeVisible();
    await expect(page.getByText("Project Setup blocked").first()).toBeVisible();
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(1);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(1);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup/stream")).toBe(1);
  });

  test("setup tab clicks update the URL query", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/setup?tab=studio-setup`);
    await expect(page.getByRole("tab", { name: "Studio Setup", exact: true })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Adapter Setup", exact: true }).click();
    await expect(page).toHaveURL(/\/setup\?tab=adapter-setup$/u);
    await expect(page.getByRole("tab", { name: "Adapter Setup", exact: true })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Project Setup", exact: true }).click();
    await expect(page).toHaveURL(/\/setup\?tab=project-setup$/u);
    await expect(page.getByRole("tab", { name: "Project Setup", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("ready continue moves from Studio Setup to Adapter Setup tab", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/setup?tab=studio-setup`);
    await page.getByRole("button", { name: "Continue to Adapter Setup" }).click();
    await expect(page).toHaveURL(/\/setup\?tab=adapter-setup$/u);
    await expect(page.getByRole("heading", { name: "Adapter Setup", exact: true })).toBeVisible();
  });

  test("ready continue moves from Adapter Setup to Project Setup tab", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/setup?tab=adapter-setup`);
    await page.getByRole("button", { name: "Continue to Project Setup" }).click();
    await expect(page).toHaveURL(/\/setup\?tab=project-setup$/u);
    await expect(page.getByRole("heading", { name: "Project Setup", exact: true })).toBeVisible();
  });

  test("ready continue moves from Project Setup to home", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/setup?tab=project-setup`);
    await page.getByRole("link", { name: "Continue to home" }).click();
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
  });

  test("old setup routes do not redirect to the new setup page", async ({ page }) => {
    for (const oldRoute of ["/bootup", "/app-bootup", "/app-setup"]) {
      await page.goto(`${BASE_URL}${oldRoute}`);
      await expect(page).not.toHaveURL(/\/setup/u);
    }
  });

});
