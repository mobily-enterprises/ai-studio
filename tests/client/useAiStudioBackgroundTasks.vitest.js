import { describe, expect, it } from "vitest";

import {
  normalizeBackgroundTasks
} from "../../src/composables/useAiStudioBackgroundTasks.js";

describe("useAiStudioBackgroundTasks", () => {
  it("normalizes presentation background tasks for the UI", () => {
    expect(normalizeBackgroundTasks({
      presentation: {
        backgroundTasks: [
          {
            error: "  no worktree  ",
            id: "codex_bootstrap",
            label: "Codex bootstrap",
            message: "failed",
            retry: {
              clientAction: "start_codex_terminal",
              label: "Retry Codex"
            },
            status: "failed",
            updatedAt: "2026-05-25T00:00:00.000Z"
          },
          {
            id: "",
            status: "running"
          }
        ]
      }
    })).toEqual([
      {
        error: "no worktree",
        id: "codex_bootstrap",
        label: "Codex bootstrap",
        message: "failed",
        retry: {
          clientAction: "start_codex_terminal",
          label: "Retry Codex"
        },
        status: "failed",
        updatedAt: "2026-05-25T00:00:00.000Z"
      }
    ]);
  });
});
