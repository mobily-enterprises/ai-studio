import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AI_STUDIO_CLIENT_CONTROL_ACTIONS
} from "../../src/lib/aiStudioPresentationControls.js";
import {
  runAiStudioClientControl
} from "../../src/lib/aiStudioClientControlDispatcher.js";
import {
  startAiStudioCodexTerminal
} from "@/lib/aiStudioSessionApi.js";

vi.mock("@/lib/aiStudioSessionApi.js", () => ({
  startAiStudioCodexTerminal: vi.fn()
}));

describe("aiStudioClientControlDispatcher", () => {
  beforeEach(() => {
    vi.mocked(startAiStudioCodexTerminal).mockReset();
  });

  it("dispatches the open diff control through the shared action contract", async () => {
    const openDialog = vi.fn();

    await expect(runAiStudioClientControl({
      control: {
        action: AI_STUDIO_CLIENT_CONTROL_ACTIONS.OPEN_DIFF
      }
    }, {
      diff: {
        openDialog
      }
    })).resolves.toBe(true);

    expect(openDialog).toHaveBeenCalledTimes(1);
  });

  it("dispatches Codex terminal retry controls without workflow-specific UI checks", async () => {
    const refreshSessionData = vi.fn();
    vi.mocked(startAiStudioCodexTerminal).mockResolvedValue({
      ok: true
    });

    await expect(runAiStudioClientControl({
      control: {
        action: AI_STUDIO_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL
      }
    }, {
      refreshSessionData,
      sessionId: "session_123"
    })).resolves.toBe(true);

    expect(startAiStudioCodexTerminal).toHaveBeenCalledWith("session_123");
    expect(refreshSessionData).toHaveBeenCalledTimes(1);
  });
});
