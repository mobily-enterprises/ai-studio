import { describe, expect, it } from "vitest";

import {
  buildIssueSessionCodexPromptSignature,
  shouldAutoRunCodexPromptHandoff
} from "../../src/lib/issueSessionPromptAutomation.js";

describe("issue session prompt automation", () => {
  it("keeps existing prompt delivery retryable until terminal acknowledgement", () => {
    expect(shouldAutoRunCodexPromptHandoff({
      alreadyStarted: true,
      baseReady: true,
      hasPrompt: true,
      hasPromptToInject: true
    })).toBe(true);
  });

  it("does not regenerate a prompt after the generation path has started", () => {
    expect(shouldAutoRunCodexPromptHandoff({
      alreadyStarted: true,
      baseReady: true,
      hasPrompt: false,
      hasPromptToInject: false
    })).toBe(false);
  });

  it("starts prompt generation once when JSKIT has not rendered the prompt yet", () => {
    expect(shouldAutoRunCodexPromptHandoff({
      alreadyStarted: false,
      baseReady: true,
      hasPrompt: false,
      hasPromptToInject: false
    })).toBe(true);
  });

  it("stays idle when the step is not ready for automation", () => {
    expect(shouldAutoRunCodexPromptHandoff({
      alreadyStarted: false,
      baseReady: false,
      hasPrompt: false,
      hasPromptToInject: true
    })).toBe(false);
  });

  it("keeps the same prompt signature after JSKIT advances to the user decision step", () => {
    const base = {
      activeCycle: "001",
      currentReviewPass: "002",
      prompt: "Review this worktree and return [deslop_result].",
      sessionId: "session-1"
    };

    expect(buildIssueSessionCodexPromptSignature({
      ...base,
      currentStep: "review_prompt_rendered"
    })).toBe(buildIssueSessionCodexPromptSignature({
      ...base,
      currentStep: "review_changes_accepted"
    }));
  });

  it("uses the review pass to separate repeated deslop prompts with the same text", () => {
    const base = {
      activeCycle: "001",
      prompt: "Review this worktree and return [deslop_result].",
      sessionId: "session-1"
    };

    expect(buildIssueSessionCodexPromptSignature({
      ...base,
      currentReviewPass: "001"
    })).not.toBe(buildIssueSessionCodexPromptSignature({
      ...base,
      currentReviewPass: "002"
    }));
  });
});
