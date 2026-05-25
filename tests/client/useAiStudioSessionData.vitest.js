import { describe, expect, it } from "vitest";
import {
  compareSessionFreshness,
  freshestSessionRecord
} from "../../src/composables/useAiStudioSessionData.js";

describe("useAiStudioSessionData freshness", () => {
  it("prefers the record with the newer server revision over local progress-shaped data", () => {
    const detailRecord = {
      actionResults: Array.from({ length: 4 }, (_value, index) => ({
        actionId: `action_${index}`,
        at: "9999-01-01T00:00:00.000Z",
        status: "completed"
      })),
      completedSteps: ["step_a", "step_b"],
      currentStep: "step_b",
      revision: 4,
      sessionId: "session-1",
      updatedAt: "2026-05-25T00:00:00.000Z"
    };
    const listRecord = {
      currentStep: "step_c",
      revision: 5,
      sessionId: "session-1",
      updatedAt: "2026-05-25T00:00:01.000Z"
    };

    expect(freshestSessionRecord(detailRecord, listRecord)).toBe(listRecord);
  });

  it("uses updatedAt as the freshness tie-breaker", () => {
    const olderRecord = {
      revision: 8,
      sessionId: "session-1",
      updatedAt: "2026-05-25T00:00:00.000Z"
    };
    const newerRecord = {
      revision: 8,
      sessionId: "session-1",
      updatedAt: "2026-05-25T00:00:02.000Z"
    };

    expect(compareSessionFreshness(newerRecord, olderRecord)).toBeGreaterThan(0);
    expect(freshestSessionRecord(olderRecord, newerRecord)).toBe(newerRecord);
  });

  it("keeps the selected detail record when server markers are equal", () => {
    const detailRecord = {
      actions: [
        {
          id: "inspect"
        }
      ],
      revision: 3,
      sessionId: "session-1",
      updatedAt: "2026-05-25T00:00:00.000Z"
    };
    const listRecord = {
      revision: 3,
      sessionId: "session-1",
      updatedAt: "2026-05-25T00:00:00.000Z"
    };

    expect(freshestSessionRecord(detailRecord, listRecord)).toBe(detailRecord);
  });
});
