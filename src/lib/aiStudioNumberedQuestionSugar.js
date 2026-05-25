const UI_QUESTION_FIELD_PREFIX = "__ui_question_";

function inactiveNumberedQuestionSugar() {
  return {
    intro: "",
    questions: []
  };
}

function isPlainResponseField(field = {}) {
  return field.name === "response" && field.kind === "textarea";
}

function parseNumberedQuestionPrompt(value = "") {
  const lines = String(value || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return inactiveNumberedQuestionSugar();
  }

  const intro = [];
  const questions = [];
  for (const line of lines) {
    const match = line.match(/^\[(\d+)\]\s+(.+)$/u);
    if (!match) {
      if (!questions.length) {
        intro.push(line);
        continue;
      }
      return inactiveNumberedQuestionSugar();
    }

    const number = Number(match[1]);
    if (!Number.isSafeInteger(number) || number !== questions.length + 1 || String(number) !== match[1]) {
      return inactiveNumberedQuestionSugar();
    }

    questions.push({
      label: match[2].trim(),
      name: `${UI_QUESTION_FIELD_PREFIX}${number}`,
      number
    });
  }

  if (!questions.every((question) => question.label) || questions.length < 2) {
    return inactiveNumberedQuestionSugar();
  }
  return {
    intro: intro.join("\n"),
    questions
  };
}

function numberedQuestionSugarForInput(interaction = {}, fields = []) {
  if (fields.length !== 1 || !isPlainResponseField(fields[0])) {
    return inactiveNumberedQuestionSugar();
  }
  return parseNumberedQuestionPrompt(interaction?.prompt);
}

function numberedQuestionInputFields(questions = []) {
  return questions.map((question) => ({
    kind: "textarea",
    label: question.label,
    name: question.name,
    required: true,
    requiredMessage: `Answer question ${question.number}.`,
    rows: 3
  }));
}

function numberedQuestionSubmissionFields(questions = [], values = {}) {
  return {
    response: questions
      .map((question) => `[${question.number}] ${String(values[question.name] || "").trim()}`)
      .join("\n")
  };
}

export {
  numberedQuestionInputFields,
  numberedQuestionSubmissionFields,
  numberedQuestionSugarForInput,
  parseNumberedQuestionPrompt,
  UI_QUESTION_FIELD_PREFIX
};
