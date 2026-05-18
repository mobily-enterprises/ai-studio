import { expect, test, type Page } from "@playwright/test";

test("home loads through a self-contained mocked Studio shell", async ({ page }) => {
  await mockReadyStudioShell(page);

  await page.goto("/home");

  await expect(page).toHaveURL(/\/home$/u);
  await expect(page.getByRole("link", { name: "Setup", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Target Scripts", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible();
});

async function mockReadyStudioShell(page: Page) {
  await page.route("**/api/ai-studio/project-type", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        projectType: {
          id: "jskit",
          ready: true
        }
      }),
      contentType: "application/json"
    });
  });

  await page.route("**/api/ai-studio/project-config", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        config: {},
        ok: true,
        ready: true
      }),
      contentType: "application/json"
    });
  });

  await page.route("**/api/ai-studio/accounts", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        accounts: [
          {
            connected: true,
            id: "codex",
            label: "Codex",
            status: "connected"
          },
          {
            connected: true,
            id: "github",
            label: "GitHub",
            status: "connected"
          }
        ],
        ok: true,
        ready: true
      }),
      contentType: "application/json"
    });
  });

  await page.route("**/api/studio/studio-setup", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        checks: [],
        ok: true,
        ready: true
      }),
      contentType: "application/json"
    });
  });

  await page.route("**/api/studio/adapter-setup", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        checks: [],
        ok: true,
        ready: true
      }),
      contentType: "application/json"
    });
  });

  await page.route("**/api/studio/project-setup", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        ready: true,
        stages: []
      }),
      contentType: "application/json"
    });
  });

  await page.route("**/api/studio/current-app", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        adapter: {
          id: "jskit",
          label: "JSKIT"
        },
        git: {
          branch: "main",
          checked: true,
          dirty: false,
          isRepo: true
        },
        ok: true,
        rootPath: "/workspace/example-target-app"
      }),
      contentType: "application/json"
    });
  });

  await page.route("**/api/ai-studio/sessions", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        limits: {
          maxOpenSessions: 3,
          openSessionCount: 0
        },
        ok: true,
        sessions: [],
        stepDefinitions: []
      }),
      contentType: "application/json"
    });
  });
}
