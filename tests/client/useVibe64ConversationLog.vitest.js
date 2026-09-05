import { effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const endpointMocks = vi.hoisted(() => ({
  resource: null,
  useEndpointResource: vi.fn()
}));
const queryMocks = vi.hoisted(() => ({
  getQueryData: vi.fn(),
  setQueryData: vi.fn()
}));
const realtimeMocks = vi.hoisted(() => ({
  events: [],
  socket: {
    off: vi.fn(),
    on: vi.fn()
  }
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient() {
    return { request: vi.fn() };
  }
}));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    realtimeMocks.events.push(options);
    return options;
  },
  useRealtimeSocket() {
    return realtimeMocks.socket;
  }
}));

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths() {
    return {
      api: () => "/api/vibe64/sessions"
    };
  }
}));

vi.mock("@tanstack/vue-query", () => ({
  useQueryClient() {
    return queryMocks;
  }
}));

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug() {
    return ref("project-a");
  }
}));

import {
  applyConversationLogPatch,
  conversationLogCompletedTurnKey,
  conversationLogReadQuery,
  conversationLogRealtimePatch,
  conversationLogRecoveryStateKey,
  conversationLogRealtimeShouldRefresh,
  mergeConversationLogPages,
  normalizeConversationLog,
  normalizeConversationLogPage,
  sessionIsAwaitingCodex,
  useVibe64ConversationLog
} from "../../src/composables/useVibe64ConversationLog.js";

describe("useVibe64ConversationLog", () => {
  beforeEach(() => {
    endpointMocks.resource = {
      data: ref({
        conversationLog: [],
        ok: true
      }),
      isLoading: ref(false),
      loadError: ref(""),
      reload: vi.fn(async () => null)
    };
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockReturnValue(endpointMocks.resource);
    queryMocks.getQueryData.mockReset();
    queryMocks.setQueryData.mockReset();
    realtimeMocks.events.length = 0;
    realtimeMocks.socket.off.mockReset();
    realtimeMocks.socket.on.mockReset();
  });
  it("builds conversation-log page queries from the shared page limit", () => {
    expect(conversationLogReadQuery()).toEqual({
      limit: "20"
    });
    expect(conversationLogReadQuery({
      beforeTurnId: "000005"
    })).toEqual({
      beforeTurnId: "000005",
      limit: "20"
    });
    expect(conversationLogReadQuery({
      beforeTurnId: "000005",
      limit: 2
    })).toEqual({
      beforeTurnId: "000005",
      limit: "2"
    });
  });

  it("normalizes and merges chronological conversation pages", () => {
    const olderPage = normalizeConversationLogPage({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "First."
          }
        },
        {
          turnId: "000002",
          user: {
            role: "user",
            text: "Second."
          }
        }
      ],
      pagination: {
        count: 2,
        hasMoreBefore: false,
        limit: 2,
        newestTurnId: "000002",
        oldestTurnId: "000001",
        totalTurnCount: 4
      }
    });
    const latestPage = normalizeConversationLogPage({
      conversationLog: [
        {
          turnId: "000002",
          user: {
            role: "user",
            text: "Second updated."
          }
        },
        {
          turnId: "000003",
          user: {
            role: "user",
            text: "Third."
          }
        }
      ],
      pagination: {
        count: 2,
        hasMoreBefore: true,
        limit: 2,
        newestTurnId: "000003",
        oldestTurnId: "000002",
        totalTurnCount: 4
      }
    });

    expect(olderPage.pagination.oldestTurnId).toBe("000001");
    expect(mergeConversationLogPages([
      olderPage,
      latestPage
    ])).toEqual({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "First."
          }
        },
        {
          turnId: "000002",
          user: {
            role: "user",
            text: "Second updated."
          }
        },
        {
          turnId: "000003",
          user: {
            role: "user",
            text: "Third."
          }
        }
      ]
    });
  });

  it("normalizes durable conversation turns and ignores empty messages", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          assistant: {
            at: "2026-05-25T01:03:00.000Z",
            role: "assistant",
            text: "Done."
          },
          commentary: [
            {
              at: "2026-05-25T01:02:45.000Z",
              messageId: "codex-progress-1",
              role: "commentary",
              text: "I found the relevant form and I’m updating it now."
            }
          ],
          thinking: [
            {
              at: "2026-05-25T01:02:30.000Z",
              role: "thinking",
              text: "Thinking\nChecked the current form state."
            }
          ],
          turnId: "000001",
          user: {
            at: "2026-05-25T01:02:00.000Z",
            attachments: [
              {
                fileName: "report.md",
                size: 15379
              }
            ],
            role: "user",
            text: "Please check this."
          }
        },
        {
          assistant: null,
          turnId: "000002",
          user: {
            role: "user",
            text: "   "
          }
        }
      ]
    })).toEqual([
      {
        assistant: {
          at: "2026-05-25T01:03:00.000Z",
          role: "assistant",
          text: "Done."
        },
        commentary: [
          {
            at: "2026-05-25T01:02:45.000Z",
            messageId: "codex-progress-1",
            role: "commentary",
            text: "I found the relevant form and I’m updating it now."
          }
        ],
        messages: [
          {
            at: "2026-05-25T01:02:00.000Z",
            attachments: [
              {
                fileName: "report.md",
                size: 15379
              }
            ],
            role: "user",
            text: "Please check this."
          },
          {
            at: "2026-05-25T01:02:30.000Z",
            role: "thinking",
            text: "Checked the current form state."
          },
          {
            at: "2026-05-25T01:02:45.000Z",
            messageId: "codex-progress-1",
            role: "commentary",
            text: "I found the relevant form and I’m updating it now."
          },
          {
            at: "2026-05-25T01:03:00.000Z",
            role: "assistant",
            text: "Done."
          }
        ],
        thinking: [
          {
            at: "2026-05-25T01:02:30.000Z",
            role: "thinking",
            text: "Checked the current form state."
          }
        ],
        turnId: "000001",
        user: {
          at: "2026-05-25T01:02:00.000Z",
          attachments: [
            {
              fileName: "report.md",
              size: 15379
            }
          ],
          role: "user",
          text: "Please check this."
        }
      }
    ]);
  });

  it("drops generic thinking headings from thinking output", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          thinking: [
            {
              role: "thinking",
              text: "Thinking..."
            },
            {
              role: "thinking",
              text: "Thinking:\nVerifying artifact and guide reading"
            },
            {
              role: "thinking",
              text: "Thinking about whether to use cached output."
            }
          ],
          turnId: "000001"
        }
      ]
    })[0].thinking.map((message) => message.text)).toEqual([
      "Verifying artifact and guide reading",
      "Thinking about whether to use cached output."
    ]);
  });

  it("marks only the latest user-only turn as pending while Codex is awaited", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "Please revise this."
          }
        },
        {
          assistant: {
            role: "assistant",
            text: "Done."
          },
          turnId: "000002",
          user: {
            role: "user",
            text: "One more tweak."
          }
        },
        {
          turnId: "000003",
          user: {
            role: "user",
            text: "Make the file name lower case."
          }
        }
      ]
    }, {
      pending: true
    }).map((turn) => [
      turn.turnId,
      turn.pending === true
    ])).toEqual([
      ["000001", false],
      ["000002", false],
      ["000003", true]
    ]);
  });

  it("leaves user-only turns settled when the session is not awaiting Codex", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "Make the file name lower case."
          }
        }
      ]
    }, {
      pending: false
    })).toEqual([
      {
        assistant: null,
        commentary: [],
        messages: [
          {
            at: "",
            role: "user",
            text: "Make the file name lower case."
          }
        ],
        thinking: [],
        turnId: "000001",
        user: {
          at: "",
          role: "user",
          text: "Make the file name lower case."
        }
      }
    ]);
  });

  it("keeps system turns distinct from user and assistant messages", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          system: {
            role: "system",
            text: "Session clone created."
          },
          turnId: "000001"
        }
      ]
    })).toEqual([
      {
        assistant: null,
        commentary: [],
        messages: [
          {
            at: "",
            role: "system",
            text: "Session clone created."
          }
        ],
        system: {
          at: "",
          role: "system",
          text: "Session clone created."
        },
        thinking: [],
        turnId: "000001",
        user: null
      }
    ]);
  });

  it("derives pending state from the active direct Codex turn", () => {
    expect(sessionIsAwaitingCodex({
      agentSession: {
        turn: { active: true }
      }
    })).toBe(true);
    expect(sessionIsAwaitingCodex({
      agentSession: {
        turn: { active: false }
      }
    })).toBe(false);
  });

  it("builds a stable recovery key from canonical session state", () => {
    expect(conversationLogRecoveryStateKey({
      agentSession: {
        turn: {
          active: true,
          id: "turn-1"
        }
      },
      revision: 7,
      sessionId: "session-1",
      status: "active",
      updatedAt: "2026-08-14T10:00:00.000Z"
    })).toBe("session-1|active|7|2026-08-14T10:00:00.000Z|active|turn-1");
  });

  it("identifies a canonical completed turn for durable-history reconciliation", () => {
    expect(conversationLogCompletedTurnKey({
      agentSession: {
        turn: {
          active: false,
          id: "turn-1"
        }
      },
      revision: 8,
      sessionId: "session-1"
    })).toBe("session-1|8|turn-1");

    expect(conversationLogCompletedTurnKey({
      agentSession: {
        turn: {
          active: true,
          id: "turn-1"
        }
      },
      revision: 7,
      sessionId: "session-1"
    })).toBe("");

    expect(conversationLogCompletedTurnKey({
      revision: 8,
      sessionId: "session-1"
    })).toBe("");
  });

  it("reloads durable history when canonical state completes a turn missed by realtime", async () => {
    const scope = effectScope();
    const session = ref({
      agentSession: {
        turn: {
          active: true,
          id: "turn-1"
        }
      },
      revision: 7,
      sessionId: "session-1"
    });
    scope.run(() => useVibe64ConversationLog({ session }));

    session.value = {
      agentSession: {
        turn: {
          active: false,
          id: "turn-1"
        }
      },
      revision: 8,
      sessionId: "session-1"
    };
    await nextTick();

    expect(endpointMocks.resource.reload).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("does not duplicate the reload when realtime delivered the completed turn", async () => {
    const scope = effectScope();
    const session = ref({
      agentSession: {
        turn: {
          active: true,
          id: "turn-1"
        }
      },
      revision: 7,
      sessionId: "session-1"
    });
    scope.run(() => useVibe64ConversationLog({ session }));
    const completionPayload = {
      agentSession: {
        turn: {
          active: false,
          id: "turn-1"
        }
      },
      reason: "opencode-server-turn-idle",
      revision: 8,
      sessionId: "session-1"
    };
    const completionListener = realtimeMocks.events.find((listener) => (
      listener.matches({ payload: completionPayload })
    ));

    const realtimeReload = completionListener.onEvent({ payload: completionPayload });
    session.value = completionPayload;
    await realtimeReload;
    await nextTick();

    expect(endpointMocks.resource.reload).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("refreshes only for selected-session events that can change durable chat text", () => {
    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-user-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-reasoning-summary",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-live-progress",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-thinking-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-assistant-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-agent-result",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-final-assistant-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "assistant-response-bundle",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-message-delivered",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "session-agent-message-delivered",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "opencode-provider-failure",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-turn-outcome",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-prompt-injected",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-turn-active",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "agent-terminal-closed",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-assistant-message",
        sessionId: "session-2"
      }
    }, "session-1")).toBe(false);
  });

  it("extracts realtime reasoning-summary patches from durable chat events", () => {
    const turn = {
      thinking: [
        {
          role: "thinking",
          text: "Checking database setup."
        }
      ],
      turnId: "000003"
    };

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn,
        type: "upsert-turn"
      },
      reason: "codex-app-server-reasoning-summary",
      sessionId: "session-1"
    })).toEqual({
      turn,
      type: "upsert-turn"
    });

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn,
        type: "upsert-turn"
      },
      reason: "opencode-server-assistant-message",
      sessionId: "session-1"
    })).toEqual({
      turn,
      type: "upsert-turn"
    });

    const providerFailureTurn = {
      system: {
        role: "system",
        text: "OpenCode could not finish.\n\nAborted\n\nSaved project changes remain."
      },
      turnId: "000004"
    };
    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: providerFailureTurn,
        type: "upsert-turn"
      },
      reason: "opencode-provider-failure",
      sessionId: "session-1"
    })).toEqual({
      turn: providerFailureTurn,
      type: "upsert-turn"
    });

    const commentaryTurn = {
      commentary: [
        {
          role: "commentary",
          text: "I found the affected booking and I’m updating only that row."
        }
      ],
      thinking: turn.thinking,
      turnId: "000003"
    };
    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: commentaryTurn,
        type: "upsert-turn"
      },
      reason: "codex-app-server-commentary",
      sessionId: "session-1"
    })).toEqual({
      turn: commentaryTurn,
      type: "upsert-turn"
    });

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn,
        type: "upsert-turn"
      },
      reason: "codex-app-server-terminal-thinking-message",
      sessionId: "session-1"
    })).toEqual({
      turn,
      type: "upsert-turn"
    });

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          turnId: "000004",
          user: {
            role: "user",
            text: "Keep going."
          }
        },
        type: "upsert-turn"
      },
      reason: "codex-app-server-message-delivered",
      sessionId: "session-1"
    })).toEqual({
      turn: {
        turnId: "000004",
        user: {
          role: "user",
          text: "Keep going."
        }
      },
      type: "upsert-turn"
    });

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn,
        type: "upsert-turn"
      },
      reason: "codex-app-server-agent-result",
      sessionId: "session-1"
    })).toBe(null);

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          assistant: {
            role: "assistant",
            text: "Final answer."
          },
          thinking: [
            {
              role: "thinking",
              text: "Checked the result."
            }
          ],
          turnId: "000007"
        },
        type: "upsert-turn"
      },
      reason: "assistant-response-bundle",
      sessionId: "session-1"
    })).toEqual({
      turn: {
        assistant: {
          role: "assistant",
          text: "Final answer."
        },
        thinking: [
          {
            role: "thinking",
            text: "Checked the result."
          }
        ],
        turnId: "000007"
      },
      type: "upsert-turn"
    });

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          assistant: {
            role: "assistant",
            text: "This must not arrive as live progress."
          },
          turnId: "000008"
        },
        type: "upsert-turn"
      },
      reason: "codex-app-server-live-progress",
      sessionId: "session-1"
    })).toBe(null);

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          thinking: [
            {
              role: "thinking",
              text: "This is not a final answer."
            }
          ],
          turnId: "000009"
        },
        type: "upsert-turn"
      },
      reason: "codex-app-server-final-assistant-message",
      sessionId: "session-1"
    })).toBe(null);

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          turnId: "000005",
          user: {
            role: "user",
            text: "Typed directly in the AI Terminal."
          }
        },
        type: "upsert-turn"
      },
      reason: "codex-app-server-terminal-user-message",
      sessionId: "session-1"
    })).toEqual({
      turn: {
        turnId: "000005",
        user: {
          role: "user",
          text: "Typed directly in the AI Terminal."
        }
      },
      type: "upsert-turn"
    });

    expect(conversationLogRealtimePatch({
      conversationLogPatch: {
        turn: {
          assistant: {
            role: "assistant",
            text: "Answered directly from the AI Terminal."
          },
          turnId: "000006"
        },
        type: "upsert-turn"
      },
      reason: "codex-app-server-terminal-assistant-message",
      sessionId: "session-1"
    })).toEqual({
      turn: {
        assistant: {
          role: "assistant",
          text: "Answered directly from the AI Terminal."
        },
        turnId: "000006"
      },
      type: "upsert-turn"
    });
  });

  it("applies realtime conversation-log turn patches without a full reload", () => {
    const originalPayload = {
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "Start."
          }
        },
        {
          thinking: [
            {
              role: "thinking",
              text: "Old thought."
            }
          ],
          turnId: "000002",
          user: {
            role: "user",
            text: "Continue."
          }
        }
      ],
      ok: true,
      revision: 3
    };
    const updatedTurn = {
      thinking: [
        {
          role: "thinking",
          text: "Updated thought."
        }
      ],
      turnId: "000002",
      user: {
        role: "user",
        text: "Continue."
      }
    };

    expect(applyConversationLogPatch(originalPayload, {
      turn: updatedTurn,
      type: "upsert-turn"
    })).toEqual({
      conversationLog: [
        originalPayload.conversationLog[0],
        updatedTurn
      ],
      ok: true,
      pagination: {
        beforeTurnId: "",
        count: 2,
        hasMoreBefore: false,
        limit: 0,
        newestTurnId: "000002",
        nextBeforeTurnId: "",
        oldestTurnId: "000001",
        totalTurnCount: 0
      },
      revision: 3
    });

    const appendedTurn = {
      thinking: [
        {
          role: "thinking",
          text: "New thought."
        }
      ],
      turnId: "000003"
    };
    expect(applyConversationLogPatch(originalPayload, {
      turn: appendedTurn,
      type: "upsert-turn"
    })?.conversationLog).toEqual([
      ...originalPayload.conversationLog,
      appendedTurn
    ]);

    const earlierTurn = {
      turnId: "000000",
      user: {
        role: "user",
        text: "Earlier message."
      }
    };
    expect(applyConversationLogPatch(originalPayload, {
      turn: earlierTurn,
      type: "upsert-turn"
    })?.conversationLog).toEqual([
      earlierTurn,
      ...originalPayload.conversationLog
    ]);
  });

  it("keeps realtime page patches inside the configured latest-page limit", () => {
    const trimmed = applyConversationLogPatch({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "First."
          }
        },
        {
          turnId: "000002",
          user: {
            role: "user",
            text: "Second."
          }
        }
      ],
      ok: true,
      pagination: {
        count: 2,
        hasMoreBefore: false,
        limit: 2,
        newestTurnId: "000002",
        oldestTurnId: "000001",
        totalTurnCount: 2
      }
    }, {
      turn: {
        turnId: "000003",
        user: {
          role: "user",
          text: "Third."
        }
      },
      type: "upsert-turn"
    }, {
      limit: 2
    });

    expect(trimmed.conversationLog.map((turn) => turn.turnId)).toEqual([
      "000002",
      "000003"
    ]);
    expect(trimmed.pagination).toMatchObject({
      count: 2,
      hasMoreBefore: true,
      newestTurnId: "000003",
      oldestTurnId: "000002"
    });
  });
});
