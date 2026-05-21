import {
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import {
  AUTOPILOT_COMPLETION_TOKEN_PREFIX,
  AUTOPILOT_QUESTIONS_MARKER_END,
  AUTOPILOT_QUESTIONS_MARKER_START,
  AUTOPILOT_REQUEST_ID_PATTERN,
  autopilotQuestionsMarkerExample,
  createStepCompletionToken,
  normalizeStepCompletionToken,
  stepCompletionTokenInstruction
} from "../../server/lib/aiStudio/autopilotPromptContract.js";

function outputHasStepCompletionToken(output = "", token = "") {
  const expectedToken = normalizeStepCompletionToken(token);
  if (!expectedToken) {
    return false;
  }
  const source = String(output || "");
  if (source.includes(expectedToken)) {
    return true;
  }
  if (!source.includes(AUTOPILOT_COMPLETION_TOKEN_PREFIX)) {
    return false;
  }
  return stripTerminalControlSequences(source).includes(expectedToken);
}

function normalizeQuestion(value = "", index = 0) {
  const text = String(typeof value === "string" ? value : value?.question || value?.text || "").trim();
  if (!text) {
    return null;
  }
  return {
    answer: "",
    id: `q${index + 1}`,
    text
  };
}

function normalizeAutopilotQuestionsPayload(value = {}) {
  const requestId = String(value.requestId || "").trim();
  const questions = (Array.isArray(value.questions) ? value.questions : [])
    .map(normalizeQuestion)
    .filter(Boolean);
  if (!AUTOPILOT_REQUEST_ID_PATTERN.test(requestId) || questions.length <= 0) {
    return null;
  }
  return {
    questions,
    requestId
  };
}

function markerObjectText(blockText = "") {
  const source = String(blockText || "").trim();
  const objectStart = source.indexOf("{");
  const objectEnd = source.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) {
    return source;
  }
  return source.slice(objectStart, objectEnd + 1);
}

function normalizeJsonLineBreaksInsideStrings(value = "") {
  const source = String(value || "");
  let output = "";
  let insideString = false;
  let escaped = false;
  let skippingLineBreakIndent = false;

  for (const character of source) {
    if (escaped) {
      output += character;
      escaped = false;
      skippingLineBreakIndent = false;
      continue;
    }
    if (character === "\\" && insideString) {
      output += character;
      escaped = true;
      skippingLineBreakIndent = false;
      continue;
    }
    if (character === "\"") {
      insideString = !insideString;
      output += character;
      skippingLineBreakIndent = false;
      continue;
    }
    if (insideString && (character === "\n" || character === "\r")) {
      output += " ";
      skippingLineBreakIndent = true;
      continue;
    }
    if (insideString && skippingLineBreakIndent && /[ \t]/u.test(character)) {
      continue;
    }
    skippingLineBreakIndent = false;
    output += character;
  }

  return output;
}

function parseAutopilotQuestionsBlock(blockText = "") {
  const jsonText = markerObjectText(blockText);
  try {
    return normalizeAutopilotQuestionsPayload(JSON.parse(jsonText));
  } catch {
    try {
      return normalizeAutopilotQuestionsPayload(JSON.parse(normalizeJsonLineBreaksInsideStrings(jsonText)));
    } catch {
      return null;
    }
  }
}

function autopilotQuestionMarkerSource(output = "") {
  const source = String(output || "");
  if (source.includes(AUTOPILOT_QUESTIONS_MARKER_START)) {
    return source;
  }
  if (!source.includes("AI_STUDIO_AUTOPILOT_QUESTIONS_V1")) {
    return "";
  }
  return stripTerminalControlSequences(source);
}

function latestAutopilotQuestionsMarker(output = "", {
  allowAnyRequestId = false,
  requestId = ""
} = {}) {
  const records = autopilotQuestionMarkerRecords(output);
  const expectedRequestId = String(requestId || "").trim();
  const matchingRecord = records
    .filter((record) => !expectedRequestId || record.marker.requestId === expectedRequestId)
    .at(-1);
  if (matchingRecord) {
    return matchingRecord.marker;
  }
  return allowAnyRequestId ? records.at(-1)?.marker || null : null;
}

function autopilotQuestionMarkerRecords(output = "") {
  const source = autopilotQuestionMarkerSource(output);
  const records = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(AUTOPILOT_QUESTIONS_MARKER_START, cursor);
    if (start < 0) {
      return records;
    }

    const contentStart = start + AUTOPILOT_QUESTIONS_MARKER_START.length;
    const end = source.indexOf(AUTOPILOT_QUESTIONS_MARKER_END, contentStart);
    if (end < 0) {
      return records;
    }

    const marker = parseAutopilotQuestionsBlock(source.slice(contentStart, end));
    if (marker) {
      records.push({
        kind: "questions",
        marker,
        start
      });
      cursor = end + AUTOPILOT_QUESTIONS_MARKER_END.length;
      continue;
    }
    cursor = contentStart;
  }
  return records;
}

function autopilotQuestionAnswersInstruction({
  actionLabel = "",
  completionToken = "",
  questions = [],
  requestId = ""
} = {}) {
  return autopilotQuestionAnswersPrompt({
    contextLabel: actionLabel || "Current workflow action",
    continuationLines: [
      "Continue the same workflow action using these answers.",
      "If these answers are still not enough, ask another question block.",
      "If the action is now fully complete, print the completion token.",
      "",
      stepCompletionTokenInstruction({
        requestId,
        token: completionToken
      })
    ],
    questions
  });
}

function autopilotQuestionAnswersPrompt({
  contextLabel = "",
  continuationLines = [],
  questions = []
} = {}) {
  const answers = (Array.isArray(questions) ? questions : []).map((question, index) => {
    return [
      `Q${index + 1}: ${String(question.text || question.question || question || "").trim()}`,
      `A${index + 1}: ${String(question.answer || "").trim()}`
    ].join("\n");
  }).join("\n\n");

  return [
    "AI Studio Autopilot clarification answers:",
    String(contextLabel || "Current Codex task"),
    "",
    answers,
    "",
    ...(Array.isArray(continuationLines) ? continuationLines : [continuationLines])
  ].join("\n");
}

export {
  AUTOPILOT_COMPLETION_TOKEN_PREFIX,
  AUTOPILOT_QUESTIONS_MARKER_END,
  AUTOPILOT_QUESTIONS_MARKER_START,
  autopilotQuestionAnswersPrompt,
  autopilotQuestionMarkerRecords,
  autopilotQuestionsMarkerExample,
  createStepCompletionToken,
  latestAutopilotQuestionsMarker,
  normalizeStepCompletionToken,
  outputHasStepCompletionToken,
  autopilotQuestionAnswersInstruction,
  stepCompletionTokenInstruction
};
