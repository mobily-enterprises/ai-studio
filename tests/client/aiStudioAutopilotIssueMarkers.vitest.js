import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_ISSUE_MARKER_END,
  AUTOPILOT_ISSUE_MARKER_START,
  AUTOPILOT_ISSUE_QUESTIONS_MARKER_END,
  AUTOPILOT_ISSUE_QUESTIONS_MARKER_START,
  issueQuestionMarkerBlocks,
  issueMarkerBlocks,
  latestIssueDefinitionMarker,
  latestIssueMarker,
  latestIssueQuestionMarker
} from "../../src/lib/aiStudioAutopilotIssueMarkers.js";

function marker(payload) {
  return [
    AUTOPILOT_ISSUE_MARKER_START,
    JSON.stringify(payload),
    AUTOPILOT_ISSUE_MARKER_END
  ].join("\n");
}

function questionsMarker(payload) {
  return [
    AUTOPILOT_ISSUE_QUESTIONS_MARKER_START,
    JSON.stringify(payload),
    AUTOPILOT_ISSUE_QUESTIONS_MARKER_END
  ].join("\n");
}

describe("aiStudioAutopilotIssueMarkers", () => {
  it("extracts the latest complete valid issue marker from terminal output", () => {
    const output = [
      "thinking...\n",
      marker({
        body: "First body",
        requestId: "first",
        title: "First title"
      }),
      "\nmore terminal output\n",
      marker({
        body: "Second body",
        requestId: "second",
        title: "Second title"
      })
    ].join("");

    expect(latestIssueMarker(output)).toEqual({
      body: "Second body",
      requestId: "second",
      title: "Second title"
    });
  });

  it("extracts a Codex-rendered marker when the body text is terminal wrapped", () => {
    const output = [
      "• ",
      AUTOPILOT_ISSUE_MARKER_START,
      "\n  {\n",
      "  \"requestId\": \"b513f260-43bb-4543-b8c1-dc9081d5215a\",\n",
      "  \"title\": \"Create p.txt in project root\",\n",
      "  \"body\": \"## Request\n",
      "Create a new file named p.txt in the project's root directory.\n\n",
      "## Acceptance Criteria\n",
      "- p.txt exists at the project root.\n",
      "- No unrelated files are modified.\"\n",
      "  }\n  ",
      AUTOPILOT_ISSUE_MARKER_END
    ].join("");

    expect(latestIssueMarker(output)).toEqual({
      body: [
        "## Request",
        "Create a new file named p.txt in the project's root directory.",
        "",
        "## Acceptance Criteria",
        "- p.txt exists at the project root.",
        "- No unrelated files are modified."
      ].join("\n"),
      requestId: "b513f260-43bb-4543-b8c1-dc9081d5215a",
      title: "Create p.txt in project root"
    });
  });

  it("ignores ansi controls, invalid json, incomplete blocks, and rejected ids", () => {
    const output = [
      "\u001b[32m",
      marker({
        body: "Rejected body",
        requestId: "rejected",
        title: "Rejected title"
      }),
      "\u001b[0m",
      AUTOPILOT_ISSUE_MARKER_START,
      "{not json}",
      AUTOPILOT_ISSUE_MARKER_END,
      AUTOPILOT_ISSUE_MARKER_START,
      JSON.stringify({
        body: "Partial body",
        requestId: "partial",
        title: "Partial title"
      }),
      marker({
        body: "Accepted body",
        requestId: "accepted",
        title: "Accepted title"
      })
    ].join("\n");

    expect(issueMarkerBlocks(output)).toEqual([
      {
        body: "Rejected body",
        requestId: "rejected",
        title: "Rejected title"
      },
      {
        body: "Accepted body",
        requestId: "accepted",
        title: "Accepted title"
      }
    ]);
    expect(latestIssueMarker(output, {
      rejectedRequestIds: new Set(["rejected"])
    })).toEqual({
      body: "Accepted body",
      requestId: "accepted",
      title: "Accepted title"
    });
  });

  it("extracts clarification question markers", () => {
    const output = questionsMarker({
      questions: [
        "Should reports include cancelled bookings?",
        "Who can see the report?"
      ],
      requestId: "questions-1"
    });

    expect(issueQuestionMarkerBlocks(output)).toEqual([
      {
        questions: [
          {
            id: "q1",
            text: "Should reports include cancelled bookings?"
          },
          {
            id: "q2",
            text: "Who can see the report?"
          }
        ],
        requestId: "questions-1"
      }
    ]);
    expect(latestIssueQuestionMarker(output)).toEqual({
      questions: [
        {
          id: "q1",
          text: "Should reports include cancelled bookings?"
        },
        {
          id: "q2",
          text: "Who can see the report?"
        }
      ],
      requestId: "questions-1"
    });
  });

  it("extracts terminal-wrapped clarification questions", () => {
    const output = [
      AUTOPILOT_ISSUE_QUESTIONS_MARKER_START,
      "\n{\n",
      "\"requestId\":\"questions-1\",\n",
      "\"questions\":[\"Should the report include bookings\n",
      "that were cancelled?\",\"Who can see it?\"]\n",
      "}\n",
      AUTOPILOT_ISSUE_QUESTIONS_MARKER_END
    ].join("");

    expect(latestIssueQuestionMarker(output)).toEqual({
      questions: [
        {
          id: "q1",
          text: "Should the report include bookings\nthat were cancelled?"
        },
        {
          id: "q2",
          text: "Who can see it?"
        }
      ],
      requestId: "questions-1"
    });
  });

  it("returns the latest issue-definition marker across questions and issue drafts", () => {
    const output = [
      questionsMarker({
        questions: ["What should be built?"],
        requestId: "questions-1"
      }),
      marker({
        body: "Build booking reports.",
        requestId: "issue-1",
        title: "Add booking reports"
      })
    ].join("\n");

    expect(latestIssueDefinitionMarker(output)).toEqual({
      body: "Build booking reports.",
      kind: "issue",
      requestId: "issue-1",
      title: "Add booking reports"
    });
  });

  it("can require a specific request id", () => {
    const output = [
      marker({
        body: "Old body",
        requestId: "old",
        title: "Old title"
      }),
      marker({
        body: "Current body",
        requestId: "current",
        title: "Current title"
      })
    ].join("\n");

    expect(latestIssueMarker(output, {
      requestId: "old"
    })).toEqual({
      body: "Old body",
      requestId: "old",
      title: "Old title"
    });
  });

  it("ignores documentation examples that do not use real request ids", () => {
    const output = marker({
      body: "Example body",
      requestId: "<requestId>",
      title: "Example title"
    });

    expect(issueMarkerBlocks(output)).toEqual([]);
    expect(latestIssueMarker(output)).toBeNull();
  });
});
