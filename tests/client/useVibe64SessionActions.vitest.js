import { ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const commandMocks = vi.hoisted(() => ({
  runErrorPlacement: "",
  runError: null,
  useCommand: vi.fn()
}));

vi.mock("@jskit-ai/users-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

import {
  runActionSuccessShouldRefreshSession
} from "../../src/composables/useVibe64SessionActions.js";
import {
  useVibe64SessionActions
} from "../../src/composables/useVibe64SessionActions.js";

describe("useVibe64SessionActions refresh ownership", () => {
  beforeEach(() => {
    commandMocks.runError = null;
    commandMocks.runErrorPlacement = "";
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options = {}) => ({
      isRunning: false,
      message: "",
      run: vi.fn(async (context = {}) => {
        if (
          commandMocks.runError &&
          (
            !commandMocks.runErrorPlacement ||
            options.placementSource === commandMocks.runErrorPlacement
          )
        ) {
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

  it("leaves successful action refresh to realtime", () => {
    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "prompt_ready"
      }
    }, {
      stepMachine: {
        status: "awaiting_agent_result"
      }
    })).toBe(false);

    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "prompt_ready"
      }
    }, {
      stepMachine: {
        status: "done"
      }
    })).toBe(false);

    expect(runActionSuccessShouldRefreshSession({
      actionResult: {
        status: "saved"
      }
    }, {
      stepMachine: {
        status: "awaiting_agent_result"
      }
    })).toBe(false);
  });

  it("refreshes session data when an intent result is stale", async () => {
    commandMocks.runErrorPlacement = "vibe64.sessions.intent";
    commandMocks.runError = {
      code: "vibe64_action_not_available",
      operationOutcome: "stale_operation",
      refreshRecommended: true,
      status: 409
    };
    const refreshSessionData = vi.fn(async () => null);
    const actions = useVibe64SessionActions({
      commandBusy: () => false,
      commandTerminal: {
        clear: vi.fn()
      },
      refreshSessionData,
      selectedSession: ref({
        currentStep: "changes_accepted",
        stepMachine: {
          status: "ready"
        }
      }),
      selectedSessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/example/vibe64/sessions")
    });

    await expect(actions.runIntentById({
      intentId: "accept_review"
    })).rejects.toMatchObject({
      code: "vibe64_action_not_available",
      ok: false,
      stale: true,
      status: 409
    });
    expect(refreshSessionData).toHaveBeenCalledTimes(1);
  });

  it("clears command terminal intent and refreshes when an action is stale", async () => {
    commandMocks.runErrorPlacement = "vibe64.sessions.action";
    commandMocks.runError = {
      code: "vibe64_action_disabled",
      details: {
        operationOutcome: "state_rejected",
        refreshRecommended: true
      },
      status: 409
    };
    const commandTerminal = {
      clear: vi.fn()
    };
    const refreshSessionData = vi.fn(async () => null);
    const actions = useVibe64SessionActions({
      commandBusy: () => false,
      commandTerminal,
      refreshSessionData,
      selectedSession: ref({
        currentStep: "seed_plan_executed",
        stepMachine: {
          status: "awaiting_agent_result"
        }
      }),
      selectedSessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/example/vibe64/sessions")
    });

    await expect(actions.runActionById({
      actionId: "create_source"
    })).rejects.toMatchObject({
      code: "vibe64_action_disabled",
      ok: false,
      operationOutcome: "state_rejected",
      refreshRecommended: true,
      stale: true,
      status: 409
    });
    expect(commandTerminal.clear).toHaveBeenCalledTimes(1);
    expect(refreshSessionData).toHaveBeenCalledTimes(1);
  });

  it("runs Finish only after its confirmation is accepted", async () => {
    const requestFinishConfirmation = vi.fn(async () => true);
    const actions = useVibe64SessionActions({
      commandBusy: () => false,
      commandTerminal: {
        clear: vi.fn()
      },
      refreshSessionData: vi.fn(async () => null),
      requestFinishConfirmation,
      selectedSession: ref({
        currentStep: "local_session_finished"
      }),
      selectedSessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/example/vibe64/sessions")
    });
    const finishAction = {
      enabled: true,
      id: "finish_session",
      label: "Finish",
      type: "finish"
    };

    await actions.runAction(finishAction);

    expect(requestFinishConfirmation).toHaveBeenCalledWith(finishAction);
    expect(actions.runActionCommand.run).toHaveBeenCalledTimes(1);
    expect(actions.runActionCommand.run).toHaveBeenCalledWith(expect.objectContaining({
      actionId: "finish_session",
      sessionId: "session-1"
    }));
  });

  it("does not run Finish when its confirmation is cancelled", async () => {
    const actions = useVibe64SessionActions({
      commandBusy: () => false,
      commandTerminal: {
        clear: vi.fn()
      },
      refreshSessionData: vi.fn(async () => null),
      requestFinishConfirmation: vi.fn(async () => false),
      selectedSession: ref({
        currentStep: "local_session_finished"
      }),
      selectedSessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/example/vibe64/sessions")
    });

    await actions.runAction({
      enabled: true,
      id: "finish_session",
      label: "Finish",
      type: "finish"
    });

    expect(actions.runActionCommand.run).not.toHaveBeenCalled();
  });
});
