import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  startAiStudioCodexTerminal
} from "@/lib/aiStudioSessionApi.js";
import {
  AI_STUDIO_CLIENT_CONTROL_ACTIONS
} from "../../src/lib/aiStudioPresentationControls.js";
import {
  useAiStudioBackgroundTasks,
  normalizeBackgroundTasks
} from "../../src/composables/useAiStudioBackgroundTasks.js";

vi.mock("@/lib/aiStudioSessionApi.js", () => ({
  startAiStudioCodexTerminal: vi.fn()
}));

describe("useAiStudioBackgroundTasks", () => {
  beforeEach(() => {
    vi.mocked(startAiStudioCodexTerminal).mockReset();
  });

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
              control: {
                action: AI_STUDIO_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL
              },
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
          control: {
            action: AI_STUDIO_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL
          },
          label: "Retry Codex"
        },
        status: "failed",
        updatedAt: "2026-05-25T00:00:00.000Z"
      }
    ]);
  });

  it("retries background tasks through server-declared retry controls", async () => {
    const refreshSessionData = vi.fn();
    vi.mocked(startAiStudioCodexTerminal).mockResolvedValue({
      ok: true
    });
    const session = ref({
      sessionId: "session_123",
      presentation: {
        backgroundTasks: [
          {
            id: "codex_bootstrap",
            retry: {
              control: {
                action: AI_STUDIO_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL
              },
              label: "Retry Codex"
            },
            status: "failed"
          }
        ]
      }
    });
    const backgroundTasks = useAiStudioBackgroundTasks({
      refreshSessionData,
      session
    });

    await expect(backgroundTasks.retryBackgroundTask(backgroundTasks.backgroundTasks.value[0]))
      .resolves.toBe(true);

    expect(startAiStudioCodexTerminal).toHaveBeenCalledWith("session_123");
    expect(refreshSessionData).toHaveBeenCalledTimes(1);
  });
});
