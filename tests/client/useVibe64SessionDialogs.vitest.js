import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({ useCommand: vi.fn() }));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));
import { useVibe64SessionDialogs } from "../../src/composables/useVibe64SessionDialogs.js";

function dialogOptions(overrides = {}) {
  return {
    clearSelectedSession: vi.fn(),
    isSelectedSessionClosed: ref(false),
    refreshSessionData: vi.fn(async () => null),
    selectedSessionId: ref("session-1"),
    selectedSessionTitle: ref("Session one"),
    sessionsApiPath: ref("/api/app/project/example/vibe64/sessions"),
    ...overrides
  };
}

describe("useVibe64SessionDialogs", () => {
  beforeEach(() => {
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        const response = { ok: true };
        await options.onRunSuccess?.(response, { context });
        return response;
      })
    }));
  });

  it("opens and cancels the close confirmation", () => {
    const dialogs = useVibe64SessionDialogs(dialogOptions());
    dialogs.abandon.request();
    expect(dialogs.abandon.open.value).toBe(true);
    expect(dialogs.abandon.sessionTitle.value).toBe("Session one");
    dialogs.abandon.cancel();
    expect(dialogs.abandon.open.value).toBe(false);
  });

  it("closes the selected session and refreshes the session list", async () => {
    const selectedSessionId = ref("session-1");
    const clearSelectedSession = vi.fn(() => {
      selectedSessionId.value = "";
    });
    const refreshSessionData = vi.fn(async () => null);
    const dialogs = useVibe64SessionDialogs(dialogOptions({
      clearSelectedSession,
      refreshSessionData,
      selectedSessionId
    }));

    dialogs.abandon.request();
    await dialogs.abandon.confirm();

    expect(clearSelectedSession).toHaveBeenCalledOnce();
    expect(refreshSessionData).toHaveBeenCalledWith({
      includeList: true,
      reason: "close-session"
    });
    expect(dialogs.abandon.closing.value).toBe(false);
  });

  it("does not clear the selection when closing fails", async () => {
    commandMocks.useCommand.mockImplementationOnce(() => ({
      isRunning: false,
      message: "Close failed.",
      run: vi.fn(async () => {
        throw new Error("Close failed.");
      })
    }));
    const clearSelectedSession = vi.fn();
    const dialogs = useVibe64SessionDialogs(dialogOptions({ clearSelectedSession }));

    dialogs.abandon.request();
    await expect(dialogs.abandon.confirm()).rejects.toThrow("Close failed.");
    expect(clearSelectedSession).not.toHaveBeenCalled();
    expect(dialogs.abandon.closing.value).toBe(false);
  });

  it("rejects a structured close failure instead of reporting success", async () => {
    commandMocks.useCommand.mockImplementationOnce((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        const response = {
          errors: [{ message: "The failed session could not be archived." }],
          ok: false
        };
        await options.onRunSuccess?.(response, { context });
        return response;
      })
    }));
    const clearSelectedSession = vi.fn();
    const refreshSessionData = vi.fn();
    const dialogs = useVibe64SessionDialogs(dialogOptions({
      clearSelectedSession,
      refreshSessionData
    }));

    dialogs.abandon.request();
    await expect(dialogs.abandon.confirm()).rejects.toThrow("The failed session could not be archived.");
    expect(clearSelectedSession).not.toHaveBeenCalled();
    expect(refreshSessionData).not.toHaveBeenCalled();
  });
});
