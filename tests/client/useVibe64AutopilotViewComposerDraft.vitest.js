import { nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = reactive({
  path: "/app/project/chat-test/dashboard/env"
});
const router = {
  push: vi.fn()
};

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => router
}));
vi.mock("@/composables/useVibe64ProjectScope.js", async () => {
  const { ref } = await import("vue");
  return {
    useVibe64ProjectSlug: () => ref("chat-test")
  };
});
vi.mock("@/composables/useVibe64AgentSettings.js", async () => {
  const { ref } = await import("vue");
  return {
    useVibe64AgentSettings: () => ({
      settings: ref({
        model: "",
        providerId: "codex",
        thinking: ""
      }),
      update: vi.fn()
    })
  };
});
vi.mock("@/lib/vibe64AsyncComponent.js", () => ({
  defineVibe64AsyncComponent: ({ label = "Async component" } = {}) => ({
    name: label.replaceAll(" ", "")
  })
}));

function viewProps(overrides = {}) {
  return reactive({
    active: true,
    agentConnectionStatus: "connected",
    cancelAgentMessage: vi.fn(async () => true),
    chatCollapsed: false,
    conversationLog: {
      turns: []
    },
    interruptAgentTurn: vi.fn(async () => true),
    page: {},
    projectContext: {},
    projectPane: "dashboard",
    refreshSessionData: vi.fn(async () => null),
    retryWorkspaceSetup: vi.fn(async () => true),
    saveSessionWork: vi.fn(async () => ({ ok: true, status: "saved" })),
    sendAgentMessage: vi.fn(async () => true),
    session: {
      agentSession: {
        turn: {}
      },
      sessionId: "session-1",
      sessionRoot: "/tmp/session-1",
      source: "/tmp/source",
      targetRoot: "/tmp/source"
    },
    sessionAbandon: {},
    sessionSelectionClosed: false,
    sessionsApiPath: "/api/sessions",
    sessionToolbar: {},
    ...overrides
  });
}

async function createView(overrides = {}) {
  const { useVibe64AutopilotView } = await import(
    "../../src/composables/useVibe64AutopilotView.js"
  );
  return useVibe64AutopilotView(viewProps(overrides), vi.fn());
}

describe("useVibe64AutopilotView direct chat", () => {
  beforeEach(() => {
    route.path = "/app/project/chat-test/dashboard/env";
    router.push.mockReset();
  });

  it("keeps chat available for steering while Codex is working", async () => {
    const view = await createView({
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1"
          }
        }
      }
    });

    view.composerDraft.value = "Use the existing parser.";

    expect(view.agentStopVisible.value).toBe(true);
    expect(view.composerDisabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(true);
    expect(view.composerHint.value).toBe("");
  });

  it("keeps chat usable while workspace preparation runs", async () => {
    const retryWorkspaceSetup = vi.fn(async () => true);
    const view = await createView({
      retryWorkspaceSetup,
      session: {
        ...viewProps().session,
        workspaceSetup: {
          currentLabel: "Install dependencies",
          status: "running"
        }
      }
    });
    view.composerDraft.value = "Please start with the routes.";

    expect(view.workspaceSetupVisible.value).toBe(true);
    expect(view.workspaceSetupTitle.value).toBe("Preparing workspace…");
    expect(view.workspaceSetupCurrentLabel.value).toBe("Install dependencies");
    expect(view.workspaceSetupRetryDisabled.value).toBe(true);
    expect(view.composerDisabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(true);
    await expect(view.retryWorkspaceSetup()).resolves.toBe(false);
    expect(retryWorkspaceSetup).not.toHaveBeenCalled();
  });

  it("keeps a ready workspace out of the chat activity area", async () => {
    const view = await createView({
      session: {
        ...viewProps().session,
        workspaceSetup: {
          status: "succeeded"
        }
      }
    });

    expect(view.workspaceSetupVisible.value).toBe(false);
    expect(view.workspaceSetupTitle.value).toBe("");
    expect(view.composerHint.value).toBe("");
  });

  it("retries failed workspace preparation without blocking chat", async () => {
    const retryWorkspaceSetup = vi.fn(async () => true);
    const view = await createView({
      retryWorkspaceSetup,
      session: {
        ...viewProps().session,
        workspaceSetup: {
          diagnostic: "Dependency installation exited with code 1.",
          status: "failed"
        }
      }
    });

    expect(view.workspaceSetupNeedsAttention.value).toBe(true);
    expect(view.workspaceSetupDiagnostic.value).toBe(
      "Dependency installation exited with code 1."
    );
    await expect(view.retryWorkspaceSetup()).resolves.toBe(true);
    expect(retryWorkspaceSetup).toHaveBeenCalledTimes(1);
  });

  it("sends workspace setup diagnostics through ordinary direct chat", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        workspaceSetup: {
          diagnostic: "Two Stack components declare different setup recipes.",
          status: "ambiguous"
        }
      }
    });

    expect(view.workspaceSetupTitle.value).toBe("Workspace setup needs a choice");
    await expect(view.askCodexToFixWorkspaceSetup()).resolves.toBe(true);

    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      displayMessage: expect.stringContaining(
        "Two Stack components declare different setup recipes."
      ),
      message: expect.stringContaining("preserving the existing work"),
      messageId: expect.stringMatching(/^message_tab_/u)
    }));
    expect(view.chatTurns.value.at(-1)?.user?.text).toContain(
      "Workspace preparation needs attention"
    );
  });

  it("sends a normal chat message and shows it optimistically", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const view = await createView({ sendAgentMessage });
    view.composerDraft.value = "Make the smallest safe change.";

    await expect(view.submitComposerMessage()).resolves.toBe(true);

    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      displayMessage: "Make the smallest safe change.",
      message: "Make the smallest safe change."
    }));
    expect(sendAgentMessage.mock.calls[0][0].messageId).toMatch(/^message_tab_/u);
    expect(view.composerDraft.value).toBe("");
    expect(view.chatTurns.value.at(-1)?.user?.text).toBe("Make the smallest safe change.");
  });

  it("includes uploaded attachments in the Codex message", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const view = await createView({ sendAgentMessage });
    view.composerDraft.value = "Inspect this screenshot.";
    view.updateComposerAttachments([{
      fileName: "screen.png",
      path: "/tmp/screen.png",
      size: 1024
    }]);

    await view.submitComposerMessage();

    expect(sendAgentMessage.mock.calls[0][0].message).toContain(
      "- screen.png (1.0 KB): /tmp/screen.png"
    );
    expect(sendAgentMessage.mock.calls[0][0].displayMessage).toContain("screen.png");
  });

  it("connects preview capture and diagnostics actions to direct chat", async () => {
    const capture = vi.fn(async () => true);
    const attachDiagnostics = vi.fn(async () => true);
    const view = await createView();

    expect(view.captureVisiblePreview()).toBe(false);
    expect(view.attachPreviewDiagnostics()).toBe(false);

    view.updatePreviewAttachmentState({
      attachDiagnostics,
      capture,
      captureAvailable: true,
      captureBusy: true,
      diagnosticsAvailable: true,
      diagnosticsBusy: false
    });

    expect(view.previewAttachmentState.value).toMatchObject({
      captureAvailable: true,
      captureBusy: true,
      diagnosticsAvailable: true,
      diagnosticsBusy: false
    });
    await expect(view.captureVisiblePreview()).resolves.toBe(true);
    await expect(view.attachPreviewDiagnostics()).resolves.toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(attachDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("keeps failed sends recoverable without a workflow retry state", async () => {
    const sendAgentMessage = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const view = await createView({ sendAgentMessage });
    view.composerDraft.value = "Try this change.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    const failedTurn = view.chatTurns.value.at(-1);
    expect(failedTurn.optimistic.status).toBe("failed");

    await expect(view.resendOptimisticMessage(failedTurn.optimistic.id)).resolves.toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
    expect(sendAgentMessage.mock.calls[1][0].messageId).toBe(
      sendAgentMessage.mock.calls[0][0].messageId
    );
    expect(view.chatTurns.value.at(-1)?.user?.text).toBe("Try this change.");
  });

  it("shows the server's delivery failure instead of a generic send error", async () => {
    const sendAgentMessage = vi.fn(async () => {
      throw new Error("Codex app-server connection closed during thread reconciliation.");
    });
    const view = await createView({ sendAgentMessage });
    view.composerDraft.value = "Continue the import.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);

    const failedTurn = view.chatTurns.value.at(-1);
    expect(failedTurn.optimistic).toMatchObject({
      error: "Codex app-server connection closed during thread reconciliation.",
      status: "failed"
    });
    expect(view.composerError.value).toBe(
      "Codex app-server connection closed during thread reconciliation."
    );
  });

  it("exposes only the direct session tools, including changes and history", async () => {
    const view = await createView();

    expect(view.sessionToolControls.value.map((tool) => tool.id)).toEqual([
      "info",
      "changes",
      "repository",
      "editor",
      "system",
      "ai-terminal"
    ]);
    expect(view.sessionToolControls.value.map((tool) => tool.id)).not.toContain("session-details");

    expect(view.selectSessionTool("info")).toBe(true);
    await nextTick();
    expect(view.dashboardRouteVisible.value).toBe(true);
    expect(router.push).toHaveBeenCalledWith("/app/project/chat-test/dashboard/session");

    expect(view.selectSessionTool("diff")).toBe(false);
  });

  it("prefills chat from source and City tools", async () => {
    const view = await createView();

    expect(view.askCodexAboutSourceEditorFile("src/main.js")).toBe(true);
    expect(view.composerDraft.value).toBe("Please look at `src/main.js` and help me with this file.");

    expect(view.askCodexAboutSystemContext({ prompt: "Explain this subsystem." })).toBe(true);
    expect(view.composerDraft.value).toBe("Explain this subsystem.");
  });

  it("keeps structured numbered questions in ordinary chat", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const view = await createView({
      conversationLog: {
        turns: [{
          assistant: {
            text: "Please answer both.\n[1] Which file?\n[2] Which existing helper?"
          }
        }]
      },
      sendAgentMessage
    });

    expect(view.numberedQuestions.value.map((question) => question.label)).toEqual([
      "Which file?",
      "Which existing helper?"
    ]);
    view.questionAnswers.value.__ui_question_1 = "src/main.js";
    view.questionAnswers.value.__ui_question_2 = "parseInput";

    await view.submitComposerMessage();

    expect(sendAgentMessage.mock.calls[0][0].message).toBe(
      "[1] src/main.js\n[2] parseInput"
    );
  });

  it("keeps per-question choices from an ordinary assistant message", async () => {
    const view = await createView({
      conversationLog: {
        turns: [{
          assistant: {
            text: [
              "[1] Include callbacks?",
              "Possible answers:",
              "- Complete lifecycle (Recommended)",
              "- Sending first",
              "[2] Existing files?",
              "Possible answers:",
              "- No existing files (Recommended)",
              "- Migration required"
            ].join("\n")
          }
        }]
      }
    });

    expect(view.numberedQuestions.value).toMatchObject([
      {
        choices: [
          { recommended: true, value: "Complete lifecycle" },
          { recommended: false, value: "Sending first" }
        ]
      },
      {
        choices: [
          { recommended: true, value: "No existing files" },
          { recommended: false, value: "Migration required" }
        ]
      }
    ]);
  });

  it("lets the user leave structured questions and answer normally", async () => {
    const props = viewProps({
      conversationLog: {
        turns: [{
          assistant: {
            text: "Please answer both.\n[1] Which file?\n[2] Which existing helper?"
          }
        }]
      }
    });
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = useVibe64AutopilotView(props, vi.fn());

    view.composerDraft.value = "Let me explain this in my own words.";
    expect(view.dismissNumberedQuestions()).toBe(true);
    expect(view.numberedQuestions.value).toEqual([]);
    expect(view.composerDraft.value).toBe("Let me explain this in my own words.");
    expect(view.composerCanSubmit.value).toBe(true);

    props.conversationLog = {
      turns: [{
        assistant: {
          text: "Different questions.\n[1] Which subsystem?\n[2] Which operation?"
        }
      }]
    };
    await nextTick();

    expect(view.numberedQuestions.value.map((question) => question.label)).toEqual([
      "Which subsystem?",
      "Which operation?"
    ]);
  });

  it("saves work through the native Save operation without sending a chat prompt", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const saveSessionWork = vi.fn(async () => ({ ok: true, status: "saved" }));
    const view = await createView({
      saveSessionWork,
      sendAgentMessage,
      workState: {
        unsaved: true,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.requestSaveWork()).toBe(true);
    expect(view.saveWorkConfirmOpen.value).toBe(true);
    await expect(view.confirmSaveWork()).resolves.toEqual({
      ok: true,
      status: "saved"
    });

    expect(saveSessionWork).toHaveBeenCalledWith();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(view.saveWorkConfirmOpen.value).toBe(false);
    expect(view.saveWorkExpanded.value).toBe(false);
  });

  it("treats a Save authority race as an ordinary update requirement", async () => {
    const view = await createView({
      saveSessionWork: vi.fn(async () => ({
        code: "vibe64_session_save_update_required",
        error: "Update before saving.",
        ok: false
      })),
      workState: {
        operation: {
          code: "vibe64_session_save_update_required",
          error: "Update before saving.",
          operationId: "save-race",
          status: "failed"
        },
        unsaved: true,
        updateAvailable: true,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkRequiresUpdate.value).toBe(true);
    expect(view.saveWorkError.value).toBe("");
    expect(view.saveWorkFailure.value).toBeNull();
    expect(view.saveWorkCanResolveWithTemporaryAi.value).toBe(false);
  });

  it("fails closed when Save has no work or the canonical version needs checking", async () => {
    const noChanges = await createView({
      workState: {
        unsaved: false,
        updateAvailable: false,
        updateStatusPending: false
      }
    });
    expect(noChanges.saveWorkDisabled.value).toBe(true);
    expect(noChanges.saveWorkTitle.value).toBe("No work to save");

    const updateSessionWork = vi.fn(async () => ({ ok: true, status: "updated" }));
    const updatePending = await createView({
      updateSessionWork,
      workState: {
        unsaved: true,
        updateAvailable: true,
        updateStatusPending: true
      }
    });
    expect(updatePending.saveWorkDisabled.value).toBe(false);
    expect(updatePending.saveWorkActionLabel.value).toBe("Update this session (rebase)");
    expect(updatePending.saveWorkTitle.value).toContain("preserving its unsaved work");
    await expect(updatePending.requestSaveWork()).resolves.toEqual({
      ok: true,
      status: "updated"
    });
    expect(updateSessionWork).toHaveBeenCalledOnce();
    expect(updatePending.saveWorkConfirmOpen.value).toBe(false);
  });

  it("keeps a failed rebase labeled as an update while Save stays unavailable", async () => {
    const updateOperation = {
      code: "vibe64_session_update_conflict",
      error: "One file needs review.",
      operationId: "update-1",
      status: "failed"
    };
    const view = await createView({
      workState: {
        operation: null,
        unsaved: false,
        updateAvailable: false,
        updateOperation,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkDisabled.value).toBe(true);
    expect(view.saveWorkActionLabel.value).toBe("Save work");
    expect(view.saveWorkActivityIsUpdate.value).toBe(true);
    expect(view.saveWorkActivityLabel.value).toBe("Update this session (rebase)");
    expect(view.saveWorkOperation.value).toStrictEqual(updateOperation);
  });

  it("turns the toolbar Save action into Update when the panel monitor finds an incoming version", async () => {
    const updateSessionWork = vi.fn(async () => ({ ok: true, status: "updated" }));
    const view = await createView({
      sessionToolbar: {
        sessions: [{
          repositoryWorkState: {
            state: "update_available"
          },
          sessionId: "session-1"
        }]
      },
      updateSessionWork,
      workState: {
        unsaved: false,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkDisabled.value).toBe(false);
    expect(view.saveWorkActionLabel.value).toBe("Update this session (rebase)");
    expect(view.saveWorkTitle.value).toBe(
      "Update this session (rebase) to the latest saved project version."
    );
    await expect(view.requestSaveWork()).resolves.toEqual({ ok: true, status: "updated" });
    expect(updateSessionWork).toHaveBeenCalledOnce();
  });

  it("enables Save when the newer toolbar inspection finds unsaved work", async () => {
    const view = await createView({
      sessionToolbar: {
        sessions: [{
          repositoryWorkState: {
            changedCount: 10,
            checkedAt: "2026-08-20T06:20:00.000Z",
            state: "unsaved"
          },
          sessionId: "session-1"
        }]
      },
      workState: {
        checkedAt: "2026-08-20T06:10:00.000Z",
        unsaved: false,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkUnsaved.value).toBe(true);
    expect(view.saveWorkDisabled.value).toBe(false);
    expect(view.saveWorkActionLabel.value).toBe("Save work");
    expect(view.saveWorkTitle.value).toBe("Save this session's work to the project repository");
  });

  it("keeps failed Save work retryable when repository inspection is still healthy", async () => {
    const view = await createView({
      sessionToolbar: {
        sessions: [{
          repositoryWorkState: {
            checkedAt: "2026-08-21T03:00:00.000Z",
            state: "needs_help"
          },
          sessionId: "session-1"
        }]
      },
      workState: {
        checkedAt: "2026-08-21T02:59:00.000Z",
        error: "",
        operation: {
          code: "vibe64_session_save_git_failed",
          error: "The managed repository could not publish this Save.",
          operationId: "save-failed",
          status: "failed"
        },
        unsaved: true,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkError.value).toBe("The managed repository could not publish this Save.");
    expect(view.saveWorkDisabled.value).toBe(false);
    expect(view.saveWorkRetryable.value).toBe(true);
    expect(view.retrySaveWork()).toBe(true);
    expect(view.saveWorkConfirmOpen.value).toBe(true);
  });

  it("does not revive stale unsaved toolbar state after a newer selected-session check", async () => {
    const view = await createView({
      sessionToolbar: {
        sessions: [{
          repositoryWorkState: {
            changedCount: 10,
            checkedAt: "2026-08-20T06:10:00.000Z",
            state: "unsaved"
          },
          sessionId: "session-1"
        }]
      },
      workState: {
        checkedAt: "2026-08-20T06:20:00.000Z",
        unsaved: false,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkUnsaved.value).toBe(false);
    expect(view.saveWorkDisabled.value).toBe(true);
    expect(view.saveWorkTitle.value).toBe("No work to save");
  });

  it("does not start a duplicate operation while the repository monitor sees an update running", async () => {
    const view = await createView({
      sessionToolbar: {
        sessions: [{
          repositoryWorkState: {
            checkedAt: "2026-08-20T06:20:00.000Z",
            state: "updating"
          },
          sessionId: "session-1"
        }]
      },
      workState: {
        checkedAt: "2026-08-20T06:10:00.000Z",
        unsaved: true,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkActionLabel.value).toBe("Update this session (rebase)");
    expect(view.saveWorkDisabled.value).toBe(true);
    expect(view.saveWorkTitle.value).toBe("Wait for the current repository operation to finish");
  });
});
