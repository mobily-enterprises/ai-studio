import { describe, expect, it } from "vitest";
import {
  buildAnsweredSeedIssueDraftPrompt,
  buildInitialSeedIssueDraftPrompt,
  buildAnsweredIssueDraftPrompt,
  buildInitialIssueDraftPrompt
} from "../../src/lib/aiStudioAutopilotIssuePrompt.js";
import {
  stripStudioContextBlocksForDisplay
} from "../../src/lib/codexOutput.js";

describe("aiStudioAutopilotIssuePrompt", () => {
  it("shows only the short visible prompt while hiding the long file instructions", () => {
    const prompt = buildInitialIssueDraftPrompt({
      artifactsRoot: "/tmp/session/artifacts",
      requestText: "Add booking reports"
    });
    const visiblePrompt = stripStudioContextBlocksForDisplay(prompt);

    expect(visiblePrompt).toBe("Discuss and define issue.\n\n");
    expect(visiblePrompt).not.toContain("Add booking reports");
    expect(visiblePrompt).not.toContain("/tmp/session/artifacts");
    expect(prompt).toContain("/tmp/session/artifacts/input_format.json");
    expect(prompt).toContain("/tmp/session/artifacts/response.md");
    expect(prompt).toContain("If clarification is needed, ask the minimum useful number of questions, up to three.");
    expect(prompt).toContain("a deliberate one-word session label");
    expect(prompt).toContain("\"word\": \"Label\"");
    expect(prompt).toContain("If the user explicitly asks to be asked questions, honor that request before producing the issue.");
    expect(prompt).toContain("When honoring an explicit question request, ask the requested number of questions, capped at three.");
    expect(prompt).toContain("Do not dismiss an explicit question request as test noise or as unrelated to issue scope.");
  });

  it("builds a hidden answer follow-up prompt", () => {
    const prompt = buildAnsweredIssueDraftPrompt({
      artifactsRoot: "/tmp/session/artifacts",
      questions: [
        {
          answer: "Admins only.",
          text: "Who can see the report?"
        }
      ],
      requestText: "Add booking reports"
    });
    const visiblePrompt = stripStudioContextBlocksForDisplay(prompt);

    expect(visiblePrompt).toBe("Discuss and define issue.\n\n");
    expect(visiblePrompt).not.toContain("Admins only.");
    expect(visiblePrompt).not.toContain("Who can see the report?");
    expect(prompt).toContain("Q1: Who can see the report?");
    expect(prompt).toContain("A1: Admins only.");
  });

  it("requires seed readiness before writing a seed issue draft", () => {
    const initialPrompt = buildInitialSeedIssueDraftPrompt({
      artifactsRoot: "/tmp/session/artifacts",
      requestText: "Seed a JSKIT app",
      seedGuidance: "Ask about auth, tenancy, database, and local dev secrets."
    });
    const answeredPrompt = buildAnsweredSeedIssueDraftPrompt({
      artifactsRoot: "/tmp/session/artifacts",
      questions: [
        {
          answer: "Use users and MariaDB.",
          text: "Which auth and database choices should the seed use?"
        }
      ],
      requestText: "Seed a JSKIT app",
      seedGuidance: "Ask about auth, tenancy, database, and local dev secrets."
    });

    expect(initialPrompt).toContain("Seed readiness gate:");
    expect(initialPrompt).toContain("Treat the adapter seed guidance as the required setup checklist.");
    expect(initialPrompt).toContain("Do not write an issue draft input format until every scaffold-affecting setup choice is answered");
    expect(initialPrompt).toContain("It is acceptable to ask more questions after the user answers a previous question set.");
    expect(answeredPrompt).toContain("Only write an issue_draft input format if the seed readiness gate is satisfied; otherwise ask another question set.");
  });
});
