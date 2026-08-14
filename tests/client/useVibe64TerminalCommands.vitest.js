import { describe, expect, it, beforeEach, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  runError: null,
  useCommand: vi.fn()
}));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({
    api: (suffix) => `/api${suffix}`
  })
}));

import {
  useVibe64TerminalCommands
} from "../../src/composables/useVibe64TerminalCommands.js";

describe("useVibe64TerminalCommands", () => {
  beforeEach(() => {
    commandMocks.runError = null;
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        if (options.placementSource === "vibe64.terminal.start" && commandMocks.runError) {
          await options.onRunError?.(commandMocks.runError, {
            context
          });
          throw commandMocks.runError;
        }
        return {
          ok: true
        };
      })
    }));
  });

  it("turns stale AI terminal starts into refreshable results instead of generic failures", async () => {
    commandMocks.runError = {
      code: "vibe64_stale_command_start",
      details: {
        operationOutcome: "state_rejected",
        refreshRecommended: true
      },
      status: 409
    };
    const commands = useVibe64TerminalCommands({
      sessionsApiPath: "/api/app/example/vibe64/sessions"
    });

    await expect(commands.startAgentTerminal("session-1")).rejects.toMatchObject({
      code: "vibe64_stale_command_start",
      ok: false,
      operationOutcome: "state_rejected",
      refreshRecommended: true,
      stale: true,
      status: 409
    });
  });
});
