import { describe, expect, it } from "vitest";

import {
  canUseIssueSessionTerminal,
  isClosedIssueSession,
  issueSessionCodexExpectedOutputs,
  issueSessionCodexPromptActionLabel,
  issueSessionFacts,
  issueSessionStatusColor,
  issueSessionTitleFromIssueText,
  parseGithubSessionLink,
  shouldAutoInjectIssueSessionCodexPrompt,
  shouldUseManualIssueSessionCodexPrompt,
  shortIssueSessionId
} from "../../src/lib/issueSessionViewModel.js";

describe("issue session view model", () => {
  it("centralizes session status and terminal availability rules", () => {
    expect(isClosedIssueSession({ status: "abandoned" })).toBe(true);
    expect(isClosedIssueSession({ status: "finished" })).toBe(true);
    expect(canUseIssueSessionTerminal({
      completedSteps: ["dependencies_installed"],
      status: "running",
      worktreeReady: true
    })).toBe(true);
    expect(canUseIssueSessionTerminal({
      completedSteps: [],
      status: "running",
      worktreeReady: true
    })).toBe(false);
    expect(canUseIssueSessionTerminal({
      completedSteps: ["dependencies_installed"],
      status: "running",
      worktreeReady: false
    })).toBe(false);
    expect(canUseIssueSessionTerminal({
      completedSteps: ["dependencies_installed"],
      status: "abandoned",
      worktreeReady: true
    })).toBe(false);
    expect(issueSessionStatusColor("waiting_for_user")).toBe("warning");
  });

  it("only auto-injects Codex prompts explicitly marked for auto injection", () => {
    const structuredHandoff = {
      prompt: "Draft the issue.",
      codex: {
        expectedOutputs: [
          { field: "issue" },
          { field: "" }
        ],
        mode: "inject_prompt",
        promptField: "prompt"
      }
    };
    const sideEffectHandoff = {
      prompt: "Execute the approved plan.",
      codex: {
        autoInject: true,
        mode: "inject_prompt",
        promptActionLabel: "Execute plan",
        promptField: "prompt"
      }
    };

    expect(issueSessionCodexExpectedOutputs(structuredHandoff)).toEqual([{ field: "issue" }]);
    expect(shouldAutoInjectIssueSessionCodexPrompt(structuredHandoff)).toBe(false);
    expect(shouldUseManualIssueSessionCodexPrompt(structuredHandoff)).toBe(true);
    expect(shouldAutoInjectIssueSessionCodexPrompt(sideEffectHandoff)).toBe(true);
    expect(shouldUseManualIssueSessionCodexPrompt(sideEffectHandoff)).toBe(false);
    expect(issueSessionCodexPromptActionLabel(sideEffectHandoff)).toBe("Execute plan");
    expect(issueSessionCodexPromptActionLabel({})).toBe("Submit prompt to Codex");
    expect(shouldUseManualIssueSessionCodexPrompt({
      ...sideEffectHandoff,
      prompt: ""
    })).toBe(false);
  });

  it("derives display labels from session fields", () => {
    expect(shortIssueSessionId("2026-05-12_13-07-36")).toBe("05-12_13-07-36");
    expect(issueSessionTitleFromIssueText("# Add reports\n\nBody")).toBe("Add reports");
    expect(parseGithubSessionLink("https://github.com/example/app/issues/12", "issue")).toEqual({
      label: "Issue #12",
      repo: "example/app"
    });
    expect(parseGithubSessionLink("https://github.com/example/app/pull/34", "pr")).toEqual({
      label: "PR #34",
      repo: "example/app"
    });
  });

  it("returns only available facts in session lifecycle order", () => {
    const facts = issueSessionFacts({
      branch: "jskit-studio/2026-05-12_13-07-36",
      codexThreadId: "019e1575-2458-7b93-bf9d-e7d7ffd49ad2",
      completedSteps: ["session_created", "worktree_created"],
      currentStep: "issue_prompt_rendered",
      issueTitle: "Add report filters",
      issueText: "Expose filters on the reports page.",
      issueUrl: "https://github.com/example/app/issues/12",
      planText: "1. Inspect reports.\n2. Add filters.",
      sessionId: "2026-05-12_13-07-36",
      sessionRoot: "/repo/.jskit/sessions/active/2026-05-12_13-07-36",
      status: "running",
      worktree: "/repo/.jskit/sessions/active/2026-05-12_13-07-36/worktree",
      worktreeReady: true
    }, [
      { id: "session_created", label: "Session created" },
      { id: "worktree_created", label: "Worktree created" },
      { id: "issue_prompt_rendered", label: "Initial issue prompt" }
    ]);

    expect(facts.map((fact) => fact.key)).toEqual([
      "step",
      "session",
      "worktree",
      "branch",
      "codex",
      "issue",
      "plan"
    ]);
    expect(facts.find((fact) => fact.key === "issue")?.value).toBe("Issue #12");
    expect(facts.find((fact) => fact.key === "issue")?.detail).toBe("Add report filters");
    expect(facts.find((fact) => fact.key === "issue")?.expandedValue).toBe("Expose filters on the reports page.");
    expect(facts.find((fact) => fact.key === "plan")?.expandedValue).toBe("1. Inspect reports.\n2. Add filters.");
    expect(facts.find((fact) => fact.key === "pr")).toBeUndefined();
  });
});
