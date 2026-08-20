import { describe, expect, it } from "vitest";

import {
  chatMessagePayload,
  createChatMessageId,
  unmatchedOptimisticMessages
} from "../../src/lib/vibe64ChatMessage.js";

describe("direct chat messages", () => {
  it("builds a plain message payload", () => {
    expect(chatMessagePayload("  Tighten the tests.  ")).toEqual({
      displayMessage: "Tighten the tests.",
      message: "Tighten the tests."
    });
    expect(chatMessagePayload("   ")).toBeNull();
  });

  it("adds attachment references without exposing paths in visible chat", () => {
    const payload = chatMessagePayload("Please inspect this.", [{
      fileName: "screenshot.png",
      path: "/tmp/vibe64-attachments/session/screenshot.png",
      size: 2048
    }]);

    expect(payload.displayMessage).toBe("Please inspect this.\n\nscreenshot.png");
    expect(payload.message).toContain(
      "- screenshot.png (2.0 KB): /tmp/vibe64-attachments/session/screenshot.png"
    );
  });

  it("creates unique ids for one browser origin", () => {
    const first = createChatMessageId({
      now: 1234,
      originId: "tab:test",
      sequence: 1
    });
    const second = createChatMessageId({
      now: 1234,
      originId: "tab:test",
      sequence: 2
    });

    expect(first).toBe("message_tab_test_ya_1");
    expect(second).toBe("message_tab_test_ya_2");
  });

  it("removes optimistic messages when canonical conversation turns arrive", () => {
    const optimistic = {
      createdAtMs: Date.parse("2026-08-14T01:02:03.000Z"),
      id: "message:test",
      status: "pending",
      text: "Build it."
    };
    expect(unmatchedOptimisticMessages([{
      user: {
        at: "2026-08-14T01:02:04.000Z",
        text: "Build it."
      }
    }], [optimistic])).toEqual([]);
    expect(unmatchedOptimisticMessages([], [{
      ...optimistic,
      status: "failed"
    }])).toHaveLength(1);
    expect(unmatchedOptimisticMessages([{
      user: {
        at: "2026-08-14T01:03:00.000Z",
        messageId: "message:test",
        text: "Server-rendered text"
      }
    }], [{
      ...optimistic,
      status: "failed"
    }])).toEqual([]);
  });
});
