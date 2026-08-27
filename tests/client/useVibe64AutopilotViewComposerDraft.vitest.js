import { nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = reactive({
  path: "/app/project/chat-test/dashboard/env"
});
const router = {
  push: vi.fn(),
  replace: vi.fn()
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
vi.mock("@local/vibe64-accounts/client", () => ({
  useVibe64Accounts: () => ({
    status: {
      value: null
    }
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
      metadata: {
        repository_mode: "github",
        source_kind: "session_clone",
        source_path: "/tmp/sessions/active/session-1/source",
        source_path_authority: "managed_session_source"
      },
      sessionId: "session-1",
      sessionRoot: "/tmp/state/session-1",
      source: "/tmp/sessions/active/session-1/source"
    },
    sessionAbandon: {},
    sessionSelectionClosed: false,
    sessionsApiPath: "/api/sessions",
    sessionToolbar: {},
    updateSessionWork: vi.fn(async () => ({ ok: true, status: "updated" })),
    workState: {},
    ...overrides
  });
}

async function createView(overrides = {}, options = {}) {
  return (await createViewWithProps(overrides, options)).view;
}

async function createViewWithProps(overrides = {}, options = {}) {
  const { useVibe64AutopilotView } = await import(
    "../../src/composables/useVibe64AutopilotView.js"
  );
  const props = viewProps(overrides);
  const emit = options.emit || vi.fn();
  const viewOptions = { ...options };
  delete viewOptions.emit;
  return {
    emit,
    props,
    view: useVibe64AutopilotView(props, emit, viewOptions)
  };
}

function deferredResult() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("useVibe64AutopilotView direct chat", () => {
  beforeEach(() => {
    route.path = "/app/project/chat-test/dashboard/env";
    router.push.mockReset();
    router.replace.mockReset();
  });

  it("uses the new-build welcome for a blank, workspace-unconfigured project", async () => {
    const view = await createView();

    expect(view.chatTurns.value).toEqual([]);
    expect(view.workspaceSetupStatus.value).toBe("unconfigured");
    expect(view.emptyConversationWelcome.value).toBe(
      "Hi! 👋 I’m excited to build something with you. Tell me what you have in mind—even a half-formed idea is perfect. We’ll shape it together."
    );
    expect(view.composerPlaceholder.value).toBe("");

    const loadingView = await createView({
      conversationLog: {
        loading: true,
        turns: []
      }
    });
    expect(loadingView.chatTurns.value).toEqual([]);
    expect(loadingView.emptyConversationWelcome.value).toBe("");

    const existingView = await createView({
      conversationLog: {
        turns: [{
          assistant: {
            role: "assistant",
            text: "Existing reply."
          },
          turnId: "turn-1"
        }]
      }
    });
    expect(existingView.chatTurns.value).toHaveLength(1);
    expect(existingView.chatTurns.value[0].turnId).toBe("turn-1");
    expect(existingView.emptyConversationWelcome.value).toBe("");
  });

  it("recognises an existing configured project in the empty-conversation welcome", async () => {
    const view = await createView({
      session: {
        ...viewProps().session,
        workspaceSetup: {
          status: "succeeded"
        }
      }
    });

    expect(view.chatTurns.value).toEqual([]);
    expect(view.emptyConversationWelcome.value).toBe(
      "Hi! 👋 This is an existing project. Tell me what you’d like to change, check, or improve, and we’ll work through it together."
    );
  });

  it("makes renewed-session continuity explicit instead of showing new-project onboarding", async () => {
    const { emptyConversationWelcomeText } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = await createView({
      session: {
        ...viewProps().session,
        metadata: {
          ...viewProps().session.metadata,
          renewed_from: "previous-session"
        }
      }
    });

    expect(view.emptyConversationWelcome.value).toBe(
      "Hi! 👋 I’ve received the handover from the previous session and I’m ready to continue. Tell me what you’d like to do next."
    );
    expect(emptyConversationWelcomeText({
      existingProject: false,
      renewedSession: true
    })).toBe(
      "Hi! 👋 I’ve received the handover from the previous session and I’m ready to continue. Tell me what you’d like to do next."
    );
    expect(emptyConversationWelcomeText({
      existingProject: true,
      preferredName: "Ada",
      renewedSession: true
    })).toBe(
      "Hi Ada! 👋 I’ve received the handover from the previous session and I’m ready to continue. Tell me what you’d like to do next."
    );
  });

  it("uses a saved preferred name naturally in both project welcomes", async () => {
    const { emptyConversationWelcomeText } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );

    expect(emptyConversationWelcomeText({ preferredName: "Ada" })).toMatch(/^Hi Ada! 👋/u);
    expect(emptyConversationWelcomeText({
      existingProject: true,
      preferredName: "Ada"
    })).toBe(
      "Hi Ada! 👋 This is an existing project. Tell me what you’d like to change, check, or improve, and we’ll work through it together."
    );
  });

  it("keeps chat available for steering while Codex is working", async () => {
    const view = await createView({
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
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

  it("keeps the editor writable while initial delivery is unresolved", async () => {
    const delivery = deferredResult();
    const sendAgentMessage = vi.fn(() => delivery.promise);
    const { props, view } = await createViewWithProps({ sendAgentMessage });
    view.composerDraft.value = "Start with the parser.";

    const submission = view.submitComposerMessage();
    await nextTick();

    expect(view.composerSending.value).toBe(true);
    expect(view.composerSubmitMode.value).toBe("sending");
    expect(view.composerDisabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(false);
    expect(view.composerDraft.value).toBe("");

    view.composerDraft.value = "Then cover the completion race.";
    props.session.agentSession.turn = {
      active: true,
      id: "",
      state: "starting"
    };
    await nextTick();

    expect(view.composerDraft.value).toBe("Then cover the completion race.");
    expect(view.composerDisabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(false);

    delivery.resolve(true);
    await expect(submission).resolves.toBe(true);
    expect(view.composerDraft.value).toBe("Then cover the completion race.");
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps scroll identity stable and follows only an accepted local submission", async () => {
    const delivery = deferredResult();
    const sendAgentMessage = vi.fn()
      .mockImplementationOnce(() => delivery.promise)
      .mockResolvedValueOnce(false);
    const { props, view } = await createViewWithProps({ sendAgentMessage });

    expect(view.conversationScrollKey.value).toBe("session-1");
    expect(view.conversationFollowLatestKey.value).toBe(0);

    props.conversationLog.turns.push({
      turnId: "remote-turn",
      user: {
        role: "user",
        text: "A collaborator sent this."
      }
    });
    await nextTick();
    expect(view.conversationScrollKey.value).toBe("session-1");
    expect(view.conversationFollowLatestKey.value).toBe(0);

    view.composerDraft.value = "Follow my accepted message.";
    const accepted = view.submitComposerMessage();
    await nextTick();
    expect(view.conversationFollowLatestKey.value).toBe(0);

    delivery.resolve(true);
    await expect(accepted).resolves.toBe(true);
    expect(view.conversationFollowLatestKey.value).toBe(1);

    view.composerDraft.value = "Do not follow a rejected message.";
    await expect(view.submitComposerMessage()).resolves.toBe(false);
    expect(view.conversationFollowLatestKey.value).toBe(1);
  });

  it("waits for authoritative connected turn readiness before offering Steer", async () => {
    const { props, view } = await createViewWithProps();
    view.composerDraft.value = "Use the existing helper.";

    props.session.agentSession.turn = {
      active: true,
      id: "",
      state: "starting"
    };
    await nextTick();
    expect(view.composerSubmitMode.value).toBe("waiting");
    expect(view.composerCanSubmit.value).toBe(false);

    props.session.agentSession.turn = {
      active: true,
      id: "turn-1",
      state: "finalizing"
    };
    await nextTick();
    expect(view.composerSubmitMode.value).toBe("waiting");
    expect(view.composerCanSubmit.value).toBe(false);

    props.session.agentSession.turn = {
      active: true,
      id: "turn-1",
      state: "active"
    };
    props.agentConnectionStatus = "disconnected";
    await nextTick();
    expect(view.composerSubmitMode.value).toBe("waiting");
    expect(view.composerCanSubmit.value).toBe(false);

    props.agentConnectionStatus = "connected";
    await nextTick();
    expect(view.composerSubmitMode.value).toBe("steer");
    expect(view.composerCanSubmit.value).toBe(true);
  });

  it("preserves a session draft through hidden, reconnecting, and warm-route states", async () => {
    const { props, view } = await createViewWithProps();
    view.composerDraft.value = "Keep this session-specific draft.";

    props.active = false;
    props.agentConnectionStatus = "reconciling";
    route.path = "/app/project/chat-test/dashboard/files";
    await nextTick();

    expect(view.composerDraft.value).toBe("Keep this session-specific draft.");
    expect(view.composerDisabled.value).toBe(true);

    props.active = true;
    props.agentConnectionStatus = "connected";
    route.path = "/app/project/chat-test/dashboard/env";
    await nextTick();
    expect(view.composerDraft.value).toBe("Keep this session-specific draft.");

    props.session = {
      ...props.session,
      sessionId: "session-2"
    };
    await nextTick();
    expect(view.composerDraft.value).toBe("");
  });

  it("sends one text-only Steer and preserves text typed before acceptance", async () => {
    const delivery = deferredResult();
    const sendAgentMessage = vi.fn(() => delivery.promise);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Keep the parser.";

    const submission = view.submitComposerMessage();
    await nextTick();
    expect(view.composerSubmitMode.value).toBe("steering");
    expect(view.composerDraft.value).toBe("Keep the parser.");
    await expect(view.submitComposerMessage()).resolves.toBe(false);
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage.mock.calls[0][0]).toMatchObject({
      displayMessage: "Keep the parser.",
      message: "Keep the parser."
    });

    view.composerDraft.value += " Add the race test.";
    delivery.resolve(true);
    await expect(submission).resolves.toBe(true);

    expect(view.composerDraft.value).toBe(" Add the race test.");
    expect(view.composerSubmitMode.value).toBe("steer");
  });

  it("retains a rejected Steer draft and excludes queued attachments", async () => {
    const sendAgentMessage = vi.fn(async () => false);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Do not lose this.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    expect(view.composerDraft.value).toBe("Do not lose this.");

    view.updateComposerAttachments([{
      fileName: "later.txt",
      path: "/tmp/later.txt",
      size: 5
    }]);
    expect(view.composerAttachmentsEnabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(false);
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
  });

  it("reuses a rejected Steer message id so a lost response cannot duplicate it", async () => {
    const sendAgentMessage = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Keep this idempotent.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    const firstMessageId = sendAgentMessage.mock.calls[0][0].messageId;
    expect(view.composerSubmitMode.value).toBe("retry");
    expect(view.composerDraft.value).toBe("Keep this idempotent.");

    await expect(view.submitComposerMessage()).resolves.toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
    expect(sendAgentMessage.mock.calls[1][0].messageId).toBe(firstMessageId);
    expect(view.composerDraft.value).toBe("");
  });

  it("retries only the original Steer and retains text appended after submission", async () => {
    const sendAgentMessage = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Original steer.";

    const first = view.submitComposerMessage();
    view.composerDraft.value += " New thought.";
    await expect(first).resolves.toBe(false);
    const messageId = sendAgentMessage.mock.calls[0][0].messageId;

    await expect(view.submitComposerMessage()).resolves.toBe(true);
    expect(sendAgentMessage.mock.calls[1][0]).toMatchObject({
      message: "Original steer.",
      messageId
    });
    expect(view.composerDraft.value).toBe(" New thought.");
  });

  it("settles an ambiguous Steer when the canonical message id arrives", async () => {
    const sendAgentMessage = vi.fn(async () => false);
    const { props, view } = await createViewWithProps({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "The server may already have this.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    const messageId = sendAgentMessage.mock.calls[0][0].messageId;
    expect(view.composerSubmitMode.value).toBe("retry");

    props.conversationLog.turns = [{
      turnId: "turn-1",
      user: {
        at: new Date().toISOString(),
        messageId,
        role: "user",
        text: "The server may already have this."
      }
    }];
    await nextTick();

    expect(view.composerDraft.value).toBe("");
    expect(view.composerSubmitMode.value).toBe("steer");
    expect(view.chatTurns.value).toHaveLength(1);
  });

  it("settles the retained Steer draft when the failed bubble is resent", async () => {
    const sendAgentMessage = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Retry from the bubble.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    const failedMessageId = view.chatTurns.value.at(-1).optimistic.id;
    await expect(view.resendOptimisticMessage(failedMessageId)).resolves.toBe(true);

    expect(sendAgentMessage.mock.calls[1][0].messageId).toBe(failedMessageId);
    expect(view.composerDraft.value).toBe("");
  });

  it("turns the same unsent draft into a normal message if the turn finishes", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const { props, view } = await createViewWithProps({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "This can be the next turn.";

    props.session.agentSession.turn = {
      active: false,
      id: "turn-1",
      state: "idle"
    };
    await nextTick();

    expect(view.composerSubmitMode.value).toBe("send");
    await expect(view.submitComposerMessage()).resolves.toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "This can be the next turn."
    }));
  });

  it("keeps Stop and Steer mutually exclusive without locking the editor", async () => {
    const interrupt = deferredResult();
    const steer = deferredResult();
    const interruptAgentTurn = vi.fn(() => interrupt.promise);
    const sendAgentMessage = vi.fn(() => steer.promise);
    const view = await createView({
      interruptAgentTurn,
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Keep this draft safe.";

    const stopping = view.requestAgentInterrupt();
    await nextTick();
    expect(view.composerDisabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(false);
    await expect(view.submitComposerMessage()).resolves.toBe(false);
    expect(sendAgentMessage).not.toHaveBeenCalled();
    interrupt.resolve(true);
    await expect(stopping).resolves.toBe(true);

    const steering = view.submitComposerMessage();
    await nextTick();
    expect(view.agentStopEnabled.value).toBe(false);
    await expect(view.requestAgentInterrupt()).resolves.toBe(false);
    expect(interruptAgentTurn).toHaveBeenCalledTimes(1);
    steer.resolve(true);
    await expect(steering).resolves.toBe(true);
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
    expect(view.workspaceSetupTitle.value).toBe("Workspace prepared");
    expect(view.composerHint.value).toBe("");
  });

  it("keeps bounded workspace preparation output available after reload", async () => {
    const view = await createView({
      session: {
        ...viewProps().session,
        workspaceSetup: {
          status: "succeeded",
          transcript: "Installing dependencies\nWorkspace ready"
        }
      }
    });

    expect(view.workspaceSetupVisible.value).toBe(true);
    expect(view.workspaceSetupTitle.value).toBe("Workspace prepared");
    expect(view.workspaceSetupOutput.value).toBe(
      "Installing dependencies\nWorkspace ready"
    );
    expect(view.workspaceSetupExpanded.value).toBe(false);
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

  it.each([
    ["failed", "Workspace preparation failed", "Dependency installation exited with code 1."],
    ["ambiguous", "Workspace setup needs a choice", "Two Stack components declare different setup recipes."]
  ])("routes %s workspace recovery through Temporary AI", async (status, title, diagnostic) => {
    const sendAgentMessage = vi.fn(async () => true);
    const requestTemporaryAi = vi.fn(async () => ({ ok: true }));
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        workspaceSetup: {
          diagnostic,
          status,
          updatedAt: "2026-08-23T12:00:00.000Z"
        }
      }
    }, {
      requestTemporaryAi
    });
    const originalTurns = [...view.chatTurns.value];

    expect(view.workspaceSetupTitle.value).toBe(title);
    await expect(view.askCodexToFixWorkspaceSetup()).resolves.toBe(true);

    expect(requestTemporaryAi).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: expect.stringContaining(`workspace-setup|session-1|${status}|`),
      message: expect.stringContaining(diagnostic),
      policy: "workspace_write",
      title: "Fix workspace preparation"
    }));
    expect(requestTemporaryAi.mock.calls[0][0].message).toContain("preserving the existing work");
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(view.chatTurns.value).toEqual(originalTurns);
  });

  it("keeps a workspace recovery action pending and ignores a rapid duplicate activation", async () => {
    let resolveRecovery;
    const requestTemporaryAi = vi.fn(() => new Promise((resolve) => {
      resolveRecovery = resolve;
    }));
    const view = await createView({
      session: {
        ...viewProps().session,
        workspaceSetup: {
          diagnostic: "Dependency installation exited with code 1.",
          status: "failed"
        }
      }
    }, { requestTemporaryAi });

    const firstRequest = view.askCodexToFixWorkspaceSetup();
    expect(view.workspaceSetupFixSending.value).toBe(true);
    expect(view.workspaceSetupAskDisabled.value).toBe(true);
    await expect(view.askCodexToFixWorkspaceSetup()).resolves.toBe(false);
    expect(requestTemporaryAi).toHaveBeenCalledTimes(1);

    resolveRecovery({ ok: true });
    await expect(firstRequest).resolves.toBe(true);
    expect(view.workspaceSetupFixSending.value).toBe(false);
  });

  it("routes a rejected preview identity through Temporary AI without touching direct chat", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const requestTemporaryAi = vi.fn(async () => ({ ok: true }));
    const view = await createView({ sendAgentMessage }, { requestTemporaryAi });
    const originalTurns = [...view.chatTurns.value];

    await expect(view.askCodexToFixPreviewIdentity({
      error: "User not found.",
      identity: {
        name: "Admin",
        type: "email",
        value: "ada@example.test"
      }
    })).resolves.toBe(true);

    expect(requestTemporaryAi).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: expect.stringContaining("preview-identity|session-1|email|ada@example.test|User not found."),
      message: expect.stringContaining("app-owned, idempotent development seed"),
      policy: "workspace_write",
      title: "Fix preview identity"
    }));
    expect(requestTemporaryAi.mock.calls[0][0].message).toContain("User not found.");
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(view.chatTurns.value).toEqual(originalTurns);
  });

  it.each([
    ["vibe64_session_save_history_diverged", "Save", "operation"],
    ["vibe64_session_update_conflict", "Update", "updateOperation"],
    ["vibe64_session_update_history_diverged", "Update", "updateOperation"]
  ])("routes %s chat recovery through Temporary AI", async (code, action, operationKey) => {
    const requestTemporaryAi = vi.fn(async () => ({ ok: true }));
    const sendAgentMessage = vi.fn(async () => true);
    const diagnostic = `${action} could not preserve the changed history.`;
    const view = await createView({
      sendAgentMessage,
      workState: {
        [operationKey]: {
          code,
          error: diagnostic,
          operationId: `operation-${code}`,
          status: "failed"
        }
      }
    }, { requestTemporaryAi });
    const originalTurns = [...view.chatTurns.value];

    expect(view.saveWorkCanResolveWithTemporaryAi.value).toBe(true);
    await expect(view.fixRepositoryActionError()).resolves.toBe(true);

    expect(requestTemporaryAi).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: `repository-recovery|session-1|${code}|${diagnostic}`,
      message: expect.stringContaining(diagnostic),
      policy: "workspace_write",
      title: `Resolve ${action}`
    }));
    const prompt = requestTemporaryAi.mock.calls[0][0].message;
    expect(prompt).toContain("Vibe64—not Temporary AI—owns every repository operation");
    expect(prompt).toContain("Do not run git add, commit, checkout");
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(view.chatTurns.value).toEqual(originalTurns);
  });

  it.each([
    "vibe64_session_update_conflict",
    "vibe64_session_update_history_diverged"
  ])("routes %s Dashboard recovery through Temporary AI", async (code) => {
    const requestTemporaryAi = vi.fn(async () => ({ ok: true }));
    const sendAgentMessage = vi.fn(async () => true);
    const diagnostic = `Repository update failed with ${code}.`;
    const view = await createView({ sendAgentMessage }, { requestTemporaryAi });
    const originalTurns = [...view.chatTurns.value];

    await expect(view.fixRepositoryError({
      code,
      error: diagnostic,
      title: "Resolve repository update"
    })).resolves.toBe(true);

    expect(requestTemporaryAi).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: `repository-recovery|session-1|${code}|${diagnostic}`,
      message: expect.stringContaining(diagnostic),
      policy: "workspace_write",
      title: "Resolve repository update"
    }));
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(view.chatTurns.value).toEqual(originalTurns);
  });

  it("shares one recovery identity between chat and Dashboard for the same update failure", async () => {
    const requestTemporaryAi = vi.fn(async () => ({ ok: true }));
    const code = "vibe64_session_update_conflict";
    const diagnostic = "One file needs review.";
    const view = await createView({
      workState: {
        updateOperation: {
          code,
          error: diagnostic,
          operationId: "update-1",
          status: "failed"
        }
      }
    }, { requestTemporaryAi });

    await expect(view.fixRepositoryActionError()).resolves.toBe(true);
    await expect(view.fixRepositoryError({
      code,
      error: `  ${diagnostic}  `,
      title: "Resolve repository update"
    })).resolves.toBe(true);

    const [chatRecovery, dashboardRecovery] = requestTemporaryAi.mock.calls.map(([request]) => request);
    expect(chatRecovery.dedupeKey).toBe(
      `repository-recovery|session-1|${code}|${diagnostic}`
    );
    expect(dashboardRecovery.dedupeKey).toBe(chatRecovery.dedupeKey);
    expect(chatRecovery.title).toBe("Resolve Update");
    expect(dashboardRecovery.title).toBe("Resolve repository update");
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

  it("does not overwrite a newer draft when editing a failed message", async () => {
    const sendAgentMessage = vi.fn(async () => false);
    const view = await createView({ sendAgentMessage });
    view.composerDraft.value = "First message.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    const failedMessageId = view.chatTurns.value.at(-1).optimistic.id;
    view.composerDraft.value = "New thought typed while delivery was pending.";

    expect(view.editOptimisticMessage(failedMessageId)).toBe(true);
    expect(view.composerDraft.value).toBe(
      "First message.\n\nNew thought typed while delivery was pending."
    );
  });

  it("does not truncate text appended to a failed Steer when editing it", async () => {
    const sendAgentMessage = vi.fn(async () => false);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Failed steer.";

    const submission = view.submitComposerMessage();
    view.composerDraft.value += " New suffix.";
    await expect(submission).resolves.toBe(false);
    const failedMessageId = view.chatTurns.value.at(-1).optimistic.id;

    expect(view.editOptimisticMessage(failedMessageId)).toBe(true);
    expect(view.composerDraft.value).toBe("Failed steer. New suffix.");
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

  it("raises structured execution attention when assistant ownership blocks a send", async () => {
    const message = "Vibe64 refused to start a replacement until the earlier execution is proven empty.";
    const sendAgentMessage = vi.fn(async () => {
      const error = new Error(message);
      error.code = "vibe64_codex_app_server_process_identity_unverified";
      throw error;
    });
    const emit = vi.fn();
    const { view } = await createViewWithProps({ sendAgentMessage }, { emit });
    view.composerDraft.value = "Continue safely.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);

    expect(emit).toHaveBeenCalledWith("execution-attention", {
      category: "ownership",
      code: "vibe64_codex_app_server_process_identity_unverified",
      message
    });
    expect(view.chatTurns.value.at(-1).optimistic.status).toBe("failed");
  });

  it("exposes only the direct session tools, including changes and history", async () => {
    const view = await createView();

    expect(view.sessionToolControls.value.map((tool) => tool.id)).toEqual([
      "info",
      "changes",
      "repository",
      "editor",
      "database",
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

  it("hides the Codex-only raw terminal from OpenCode sessions", async () => {
    route.path = "/app/project/chat-test/dashboard/ai-terminal";
    const view = await createView({
      session: {
        ...viewProps().session,
        assistantSelection: {
          engineId: "opencode"
        }
      }
    });

    expect(view.sessionToolControls.value.map((tool) => tool.id)).not.toContain("ai-terminal");
    expect(view.selectSessionTool("ai-terminal")).toBe(false);
    expect(view.rightPaneTab.value).toBe("dashboard");
    expect(router.replace).toHaveBeenCalledWith("/app/project/chat-test/dashboard/env");
  });

  it("prefills chat from source tools", async () => {
    const view = await createView();

    expect(view.askCodexAboutSourceEditorFile("src/main.js")).toBe(true);
    expect(view.composerDraft.value).toBe("Please look at `src/main.js` and help me with this file.");
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
    expect(view.composerCanSubmit.value).toBe(false);
    view.questionAnswers.value.__ui_question_1 = "src/main.js";
    expect(view.composerCanSubmit.value).toBe(false);
    view.questionAnswers.value.__ui_question_2 = "parseInput";
    expect(view.composerCanSubmit.value).toBe(true);

    await view.submitComposerMessage();

    expect(sendAgentMessage.mock.calls[0][0].message).toBe(
      "[1] src/main.js\n[2] parseInput"
    );
  });

  it("hides a submitted structured form while delivery is pending", async () => {
    const delivery = deferredResult();
    const sendAgentMessage = vi.fn(() => delivery.promise);
    const view = await createView({
      conversationLog: {
        turns: [{
          assistant: {
            text: "Please answer.\n[1] Which file?\n[2] Which helper?"
          }
        }]
      },
      sendAgentMessage
    });
    view.questionAnswers.value.__ui_question_1 = "src/main.js";
    view.questionAnswers.value.__ui_question_2 = "parseInput";

    const submission = view.submitComposerMessage();
    await nextTick();

    expect(view.numberedQuestions.value).toEqual([]);
    expect(view.composerDisabled.value).toBe(false);
    view.composerDraft.value = "My next thought stays editable.";
    expect(view.composerDraft.value).toBe("My next thought stays editable.");

    delivery.resolve(true);
    await expect(submission).resolves.toBe(true);
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
    expect(view.numberedQuestionSelectItems.value).toMatchObject({
      __ui_question_1: [
        { value: "Complete lifecycle" },
        { value: "Sending first" },
        { selectLabel: "I am not sure", value: "I am not sure" }
      ],
      __ui_question_2: [
        { value: "No existing files" },
        { value: "Migration required" },
        { selectLabel: "I am not sure", value: "I am not sure" }
      ]
    });
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

  it("projects the selected session Save action only into an active configured app-bar host", async () => {
    const { props, view } = await createViewWithProps({
      saveWorkTeleportTarget: "#save-host",
      workState: {
        unsaved: true,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkHeaderVisible.value).toBe(true);
    expect(view.saveWorkHeaderAriaLabel.value).toBe("Save selected session work");
    expect(view.saveWorkHeaderLabel.value).toBe("Save");

    props.active = false;
    await nextTick();
    expect(view.saveWorkHeaderVisible.value).toBe(false);

    props.active = true;
    props.saveWorkTeleportTarget = "";
    await nextTick();
    expect(view.saveWorkHeaderVisible.value).toBe(false);

    props.saveWorkTeleportTarget = "#save-host";
    props.session = null;
    await nextTick();
    expect(view.saveWorkHeaderVisible.value).toBe(false);
  });

  it("uses stable short Save and Update labels while their operations are pending", async () => {
    const saveResult = deferredResult();
    const save = await createView({
      saveSessionWork: vi.fn(() => saveResult.promise),
      saveWorkTeleportTarget: "#save-host",
      workState: {
        unsaved: true,
        updateAvailable: false,
        updateStatusPending: false
      }
    });
    save.requestSaveWork();
    const saving = save.confirmSaveWork();
    await nextTick();
    expect(save.saveWorkHeaderAriaLabel.value).toBe("Save selected session work");
    expect(save.saveWorkHeaderLabel.value).toBe("Saving…");
    saveResult.resolve({ ok: true, status: "saved" });
    await expect(saving).resolves.toEqual({ ok: true, status: "saved" });

    const updateResult = deferredResult();
    const update = await createView({
      saveWorkTeleportTarget: "#save-host",
      updateSessionWork: vi.fn(() => updateResult.promise),
      workState: {
        unsaved: true,
        updateAvailable: true,
        updateStatusPending: false
      }
    });
    const updating = update.requestSaveWork();
    await nextTick();
    expect(update.saveWorkHeaderAriaLabel.value).toBe("Update selected session (rebase)");
    expect(update.saveWorkHeaderLabel.value).toBe("Updating…");
    updateResult.resolve({ ok: true, status: "updated" });
    await expect(updating).resolves.toEqual({ ok: true, status: "updated" });
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

  it("keeps the newest completed repository activity available and collapsed", async () => {
    const saveOperation = {
      events: [{ at: "2026-08-23T01:00:00.000Z", message: "Saved older work" }],
      status: "succeeded",
      updatedAt: "2026-08-23T01:00:00.000Z"
    };
    const updateOperation = {
      events: [{ at: "2026-08-23T02:00:00.000Z", message: "Session updated" }],
      status: "succeeded",
      updatedAt: "2026-08-23T02:00:00.000Z"
    };
    const view = await createView({
      workState: {
        operation: saveOperation,
        unsaved: false,
        updateAvailable: false,
        updateOperation,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkActivityVisible.value).toBe(true);
    expect(view.saveWorkOperation.value).toStrictEqual(updateOperation);
    expect(view.saveWorkActivityIsUpdate.value).toBe(true);
    expect(view.saveWorkActivityLabel.value).toBe("Update this session (rebase)");
    expect(view.saveWorkOutput.value).toContain("Session updated");
    expect(view.saveWorkExpanded.value).toBe(false);
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
