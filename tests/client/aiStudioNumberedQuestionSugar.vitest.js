import { describe, expect, it } from "vitest";

import {
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSugarForInput,
  UI_QUESTION_FIELD_PREFIX
} from "../../src/lib/aiStudioNumberedQuestionSugar.js";

const plainResponseField = {
  kind: "textarea",
  label: "Response",
  name: "response",
  required: true
};

function sugarForPrompt(prompt, fields = [plainResponseField]) {
  return numberedQuestionSugarForInput({
    prompt
  }, fields);
}

describe("aiStudioNumberedQuestionSugar", () => {
  it("turns a clean numbered prompt into private UI-only fields", () => {
    const sugar = sugarForPrompt([
      "Codex needs these details:",
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n"));

    expect(sugar.intro).toBe("Codex needs these details:");
    expect(sugar.questions.map((question) => question.name)).toEqual([
      `${UI_QUESTION_FIELD_PREFIX}1`,
      `${UI_QUESTION_FIELD_PREFIX}2`
    ]);
    expect(numberedQuestionInputFields(sugar.questions).map((field) => field.name)).toEqual([
      "__ui_question_1",
      "__ui_question_2"
    ]);
  });

  it("submits generated answers as one response field", () => {
    const sugar = sugarForPrompt([
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n"));

    expect(numberedQuestionSubmissionFields(sugar.questions, {
      __ui_question_1: "app.js",
      __ui_question_2: "use the existing helper"
    })).toEqual({
      response: "[1] app.js\n[2] use the existing helper"
    });
  });

  it("does not reinterpret already structured server input", () => {
    const sugar = sugarForPrompt([
      "[1] Which file should change?",
      "[2] What should it contain?"
    ].join("\n"), [
      {
        kind: "text",
        label: "Title",
        name: "title"
      },
      plainResponseField
    ]);

    expect(sugar.questions).toEqual([]);
  });

  it("rejects ambiguous numbered prompts", () => {
    expect(sugarForPrompt([
      "[1] Which file should change?",
      "[3] What should it contain?"
    ].join("\n")).questions).toEqual([]);
    expect(sugarForPrompt([
      "[01] Which file should change?",
      "[2] What should it contain?"
    ].join("\n")).questions).toEqual([]);
    expect(sugarForPrompt([
      "[1] Which file should change?",
      "Then explain why.",
      "[2] What should it contain?"
    ].join("\n")).questions).toEqual([]);
  });
});
