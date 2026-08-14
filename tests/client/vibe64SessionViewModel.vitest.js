import { describe, expect, it } from "vitest";

import {
  isClosedVibe64Session,
  isOpenVibe64Session,
  shortVibe64SessionId,
  vibe64SessionDisplayTitle,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "../../src/lib/vibe64SessionViewModel.js";

describe("plain Vibe64 session view", () => {
  it("uses the explicit session label and a short-id fallback", () => {
    expect(vibe64SessionDisplayTitle({
      metadata: { label: "Improve search" },
      sessionId: "2026-session-1"
    })).toBe("Improve search");
    expect(vibe64SessionDisplayTitle({ sessionId: "2026-session-1" })).toBe("Session session-1");
    expect(shortVibe64SessionId("2026-session-1")).toBe("session-1");
  });

  it("distinguishes open and archived sessions", () => {
    expect(isOpenVibe64Session({ status: "active" })).toBe(true);
    expect(isClosedVibe64Session({ status: "abandoned" })).toBe(true);
  });

  it("presents the small plain-session status set", () => {
    expect(vibe64SessionStatusLabel("active")).toBe("active");
    expect(vibe64SessionStatusColor("abandoned")).toBe("error");
    expect(vibe64SessionStatusColor("blocked")).toBe("error");
    expect(vibe64SessionStatusColor("active")).toBe("primary");
  });
});
