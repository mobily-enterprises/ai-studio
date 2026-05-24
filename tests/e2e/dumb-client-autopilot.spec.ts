import { expect, test, type Page, type Route } from "@playwright/test";

import { BASE_URL } from "./support/base-shell-data";
import {
  mockStudioReady
} from "./support/base-shell-mocks";

test.describe("Autopilot dumb client contract", () => {
  test("renders server-provided intents and posts the chosen intent without client workflow knowledge", async ({ page }) => {
    const intentRequests: unknown[] = [];
    const session = sessionPayload({
      intents: [
        {
          enabled: true,
          id: "server_feedback",
          inputFields: [
            {
              kind: "textarea",
              label: "Feedback",
              name: "feedback"
            }
          ],
          label: "Ask server",
          style: "primary"
        }
      ],
      presentation: {
        auto: {
          canResume: false,
          canStart: false,
          nextOperation: {
            kind: "stop",
            reason: "user"
          }
        },
        screen: {
          kind: "review",
          message: "This text came from the server.",
          primaryIntentId: "server_feedback",
          sections: [],
          title: "Server Review"
        }
      }
    });
    await mockAiStudioSession(page, session, {
      onIntent: (body) => {
        intentRequests.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Server Review" })).toBeVisible();
    await expect(page.getByText("This text came from the server.")).toBeVisible();

    await page.getByLabel("Feedback").fill("Please adjust the copy.");
    await page.getByRole("button", { name: "Ask server" }).click();

    await expect.poll(() => intentRequests).toEqual([
      {
        fields: {
          feedback: "Please adjust the copy."
        },
        stepId: "server_step",
        stepStatus: "ready"
      }
    ]);
  });

  test("renders numbered questions as UI sugar and submits only the logical response field", async ({ page }) => {
    const stepInputs: unknown[] = [];
    const session = sessionPayload({
      currentStepDefinition: {
        id: "server_step",
        label: "Server Questions"
      },
      presentation: {
        auto: {
          canResume: false,
          canStart: false,
          nextOperation: {
            kind: "wait",
            reason: "input"
          }
        },
        screen: {
          input: {
            fields: [
              {
                kind: "textarea",
                label: "Response",
                name: "response"
              }
            ],
            prompt: "Answer these before continuing.\n[1] What should change?\n[2] What should stay the same?",
            submitLabel: "Submit",
            title: "Server Questions"
          },
          kind: "input",
          message: "Answer these before continuing.",
          sections: [],
          title: "Server Questions"
        },
        step: {
          id: "server_step",
          label: "Server Questions",
          status: "waiting_for_input"
        }
      }
    });
    await mockAiStudioSession(page, session, {
      onStepInput: (body) => {
        stepInputs.push(body);
      }
    });

    await page.goto(`${BASE_URL}/home`);

    await expect(page.getByRole("heading", { name: "Server Questions" })).toBeVisible();
    await page.getByLabel("What should change?").fill("Tighten the layout.");
    await page.getByLabel("What should stay the same?").fill("Keep the current copy.");
    await page.getByRole("button", { name: "Submit" }).click();

    await expect.poll(() => stepInputs).toEqual([
      {
        fields: {
          response: "[1] Tighten the layout.\n[2] Keep the current copy."
        },
        kind: "ready",
        source: "ui",
        stepId: "server_step",
        stepStatus: "waiting_for_input"
      }
    ]);
  });
});

async function mockAiStudioSession(
  page: Page,
  session: Record<string, unknown>,
  {
    onIntent = () => undefined,
    onStepInput = () => undefined
  }: {
    onIntent?: (body: unknown) => void;
    onStepInput?: (body: unknown) => void;
  } = {}
) {
  await mockStudioReady(page);
  await page.route("**/api/ai-studio/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "POST" && /\/intents\/[^/]+$/u.test(url.pathname)) {
      onIntent(request.postDataJSON());
      await fulfillJson(route, {
        ok: true,
        ...session
      });
      return;
    }
    if (method === "POST" && url.pathname.endsWith("/current-step/input")) {
      onStepInput(request.postDataJSON());
      await fulfillJson(route, {
        ok: true,
        ...session
      });
      return;
    }
    if (method === "GET" && /\/sessions\/[^/]+$/u.test(url.pathname)) {
      await fulfillJson(route, {
        ok: true,
        ...session
      });
      return;
    }
    await fulfillJson(route, {
      creation: {
        canCreate: true,
        defaultWorkflowProfile: "big_feature",
        mode: "select",
        workflowProfiles: []
      },
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 1
      },
      ok: true,
      sessions: [session]
    });
  });
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json"
  });
}

function sessionPayload(overrides: Record<string, unknown> = {}) {
  const currentStepDefinition = overrides.currentStepDefinition || {
    id: "server_step",
    label: "Server step"
  };
  const intents = Array.isArray(overrides.intents) ? overrides.intents : [];
  const presentation = {
    intents,
    step: {
      id: "server_step",
      label: "Server step",
      status: "ready"
    },
    ...((overrides.presentation as Record<string, unknown>) || {})
  };
  return {
    actionResults: [],
    actions: [],
    artifactsRoot: "/workspace/example-target-app/.ai-studio/sessions/active/session-renderer/artifacts",
    completedSteps: [],
    createdAt: "2026-05-24T00:00:00.000Z",
    currentStep: "server_step",
    currentStepDefinition,
    intents,
    metadata: {},
    next: {
      disabledReason: "Server controls this step.",
      enabled: false,
      label: "Next",
      stepId: "next_step",
      visible: true
    },
    presentation,
    sessionId: "session-renderer",
    status: "active",
    stepDefinitions: [
      {
        id: "server_step",
        label: "Server step",
        status: "current"
      }
    ],
    stepMachine: {
      status: String((presentation.step as Record<string, unknown>)?.status || "ready"),
      stepId: "server_step"
    },
    targetRoot: "/workspace/example-target-app",
    title: "Renderer session",
    updatedAt: "2026-05-24T00:00:00.000Z",
    workflowId: "test-workflow",
    ...overrides
  };
}
