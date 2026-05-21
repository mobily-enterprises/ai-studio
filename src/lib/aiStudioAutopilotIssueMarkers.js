import {
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import {
  autopilotQuestionMarkerRecords
} from "@/lib/aiStudioAutopilotStepMarkers.js";

const AUTOPILOT_ISSUE_MARKER_START = "[[AI_STUDIO_AUTOPILOT_ISSUE_V1]]";
const AUTOPILOT_ISSUE_MARKER_END = "[[/AI_STUDIO_AUTOPILOT_ISSUE_V1]]";
const ISSUE_MARKER_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u;

function normalizeMarkerText(value = "") {
  return stripTerminalControlSequences(value)
    .replace(/\r\n?/gu, "\n");
}

function normalizeMarkerPayload(value = {}) {
  const requestId = String(value.requestId || "").trim();
  const title = String(value.title || "").trim();
  const body = String(value.body || "").trim();
  if (!ISSUE_MARKER_REQUEST_ID_PATTERN.test(requestId) || !title || !body) {
    return null;
  }
  return {
    body,
    requestId,
    title
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

function decodeJsonStringContent(value = "") {
  const source = String(value || "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\n/gu, "\\n");
  try {
    return JSON.parse(`"${source}"`);
  } catch {
    return String(value || "").replace(/\r\n?/gu, "\n");
  }
}

function readJsonStringField(source = "", fieldName = "") {
  const fieldStart = String(source || "").indexOf(`"${fieldName}"`);
  if (fieldStart < 0) {
    return "";
  }

  let cursor = fieldStart + fieldName.length + 2;
  while (/\s/u.test(source[cursor] || "")) {
    cursor += 1;
  }
  if (source[cursor] !== ":") {
    return "";
  }

  cursor += 1;
  while (/\s/u.test(source[cursor] || "")) {
    cursor += 1;
  }
  if (source[cursor] !== "\"") {
    return "";
  }

  let rawValue = "";
  let escaped = false;
  for (cursor += 1; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (escaped) {
      rawValue += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      rawValue += character;
      escaped = true;
      continue;
    }
    if (character === "\"") {
      return decodeJsonStringContent(rawValue);
    }
    rawValue += character;
  }
  return "";
}

function parseLooseIssueMarkerPayload(blockText = "") {
  const source = markerObjectText(blockText);
  return normalizeMarkerPayload({
    body: readJsonStringField(source, "body"),
    requestId: readJsonStringField(source, "requestId"),
    title: readJsonStringField(source, "title")
  });
}

function parseIssueMarkerBlock(blockText = "") {
  const source = markerObjectText(blockText);
  try {
    return normalizeMarkerPayload(JSON.parse(source));
  } catch {
    if (String(blockText || "").includes(AUTOPILOT_ISSUE_MARKER_START)) {
      return null;
    }
    return parseLooseIssueMarkerPayload(source);
  }
}

function markerBlockRecords(output = "", {
  endMarker = "",
  kind = "",
  parseBlock = () => null,
  startMarker = ""
} = {}) {
  const source = normalizeMarkerText(output);
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf(startMarker, cursor);
    if (start < 0) {
      return blocks;
    }

    const contentStart = start + startMarker.length;
    const end = source.indexOf(endMarker, contentStart);
    if (end < 0) {
      return blocks;
    }

    const marker = parseBlock(source.slice(contentStart, end));
    if (marker) {
      blocks.push({
        kind,
        marker,
        start
      });
      cursor = end + endMarker.length;
      continue;
    }
    cursor = contentStart;
  }
  return blocks;
}

function issueMarkerRecords(output = "") {
  return markerBlockRecords(output, {
    endMarker: AUTOPILOT_ISSUE_MARKER_END,
    kind: "issue",
    parseBlock: parseIssueMarkerBlock,
    startMarker: AUTOPILOT_ISSUE_MARKER_START
  });
}

function issueMarkerBlocks(output = "") {
  return issueMarkerRecords(output).map((record) => record.marker);
}

function issueQuestionMarkerBlocks(output = "") {
  return autopilotQuestionMarkerRecords(output).map((record) => record.marker);
}

function ignoredRequestIdSet({
  ignoredRequestIds = null,
  rejectedRequestIds = new Set()
} = {}) {
  const ids = ignoredRequestIds || rejectedRequestIds;
  return ids instanceof Set ? ids : new Set(ids || []);
}

function latestMarkerRecord(records = [], {
  ignoredRequestIds = null,
  rejectedRequestIds = new Set(),
  requestId = ""
} = {}) {
  const ignoredIds = ignoredRequestIdSet({
    ignoredRequestIds,
    rejectedRequestIds
  });
  const expectedRequestId = String(requestId || "").trim();
  return records
    .filter((record) => !ignoredIds.has(record.marker.requestId))
    .filter((record) => !expectedRequestId || record.marker.requestId === expectedRequestId)
    .sort((left, right) => left.start - right.start)
    .at(-1) || null;
}

function latestIssueMarker(output = "", options = {}) {
  return latestMarkerRecord(issueMarkerRecords(output), options)?.marker || null;
}

function latestIssueQuestionMarker(output = "", options = {}) {
  return latestMarkerRecord(autopilotQuestionMarkerRecords(output), options)?.marker || null;
}

function latestIssueDefinitionMarker(output = "", options = {}) {
  const latestRecord = latestMarkerRecord([
    ...issueMarkerRecords(output),
    ...autopilotQuestionMarkerRecords(output)
  ], options);
  if (!latestRecord) {
    return null;
  }
  return {
    ...latestRecord.marker,
    kind: latestRecord.kind
  };
}

function issueMarkerExample(requestId = "request-id") {
  return [
    AUTOPILOT_ISSUE_MARKER_START,
    JSON.stringify({
      requestId,
      title: "Concise issue title",
      body: "Markdown issue body"
    }, null, 2),
    AUTOPILOT_ISSUE_MARKER_END
  ].join("\n");
}

export {
  AUTOPILOT_ISSUE_MARKER_END,
  AUTOPILOT_ISSUE_MARKER_START,
  issueQuestionMarkerBlocks,
  issueMarkerBlocks,
  issueMarkerExample,
  latestIssueDefinitionMarker,
  latestIssueMarker,
  latestIssueQuestionMarker
};
