import { describe, expect, it } from "vitest";
import {
  buildAnsweredIssueDraftPrompt,
  buildInitialIssueDraftPrompt
} from "../../src/lib/aiStudioAutopilotIssuePrompt.js";
import {
  stripStudioContextBlocksForDisplay
} from "../../src/lib/codexOutput.js";

describe("aiStudioAutopilotIssuePrompt", () => {
  it("keeps the marker format visible while hiding the long prompt body", () => {
    const prompt = buildInitialIssueDraftPrompt({
      requestId: "request-123",
      requestText: "Add booking reports"
    });
    const visiblePrompt = stripStudioContextBlocksForDisplay(prompt);

    expect(visiblePrompt).toContain("[[AI_STUDIO_AUTOPILOT_ISSUE_V1]]");
    expect(visiblePrompt).toContain("[[AI_STUDIO_AUTOPILOT_ISSUE_QUESTIONS_V1]]");
    expect(visiblePrompt).not.toContain("Add booking reports");
    expect(visiblePrompt).not.toContain("Do not inspect AI Studio session internals");
    expect(prompt).toContain("If clarification is needed, ask the minimum useful number of questions, up to three.");
    expect(prompt).toContain("If the user explicitly asks to be asked questions, honor that request before producing the issue.");
    expect(prompt).toContain("When honoring an explicit question request, ask the requested number of questions, capped at three.");
    expect(prompt).toContain("Do not dismiss an explicit question request as test noise or as unrelated to issue scope.");
  });

  it("builds a hidden answer follow-up prompt", () => {
    const prompt = buildAnsweredIssueDraftPrompt({
      questions: [
        {
          answer: "Admins only.",
          text: "Who can see the report?"
        }
      ],
      requestId: "request-456",
      requestText: "Add booking reports"
    });
    const visiblePrompt = stripStudioContextBlocksForDisplay(prompt);

    expect(visiblePrompt).toContain("[[AI_STUDIO_AUTOPILOT_ISSUE_QUESTIONS_V1]]");
    expect(visiblePrompt).toContain("[[AI_STUDIO_AUTOPILOT_ISSUE_V1]]");
    expect(visiblePrompt).not.toContain("Admins only.");
    expect(visiblePrompt).not.toContain("Who can see the report?");
  });
});
