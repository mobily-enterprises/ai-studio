import { describe, expect, it } from "vitest";

import {
  currentStepWorkflowControls,
  workflowControlSourceAction
} from "../../src/lib/vibe64WorkflowControlModel.js";

describe("vibe64WorkflowControlModel", () => {
  it("uses server presentation controls before action fallbacks", () => {
    const controls = currentStepWorkflowControls({
      actions: [
        {
          enabled: true,
          id: "raw_action",
          label: "Raw action"
        }
      ],
      session: {
        intents: [
          {
            enabled: true,
            id: "server_intent",
            label: "Server intent"
          }
        ]
      }
    });

    expect(controls.map((control) => control.id)).toEqual(["server_intent"]);
    expect(workflowControlSourceAction(controls[0])).toBeNull();
  });

  it("falls back to current actions when no presentation controls exist", () => {
    const action = {
      enabled: true,
      icon: "codex",
      id: "ask_codex",
      inputFields: [
        {
          kind: "textarea",
          label: "Question",
          name: "conversationRequest"
        }
      ],
      label: "Ask Codex"
    };
    const controls = currentStepWorkflowControls({
      actions: [action],
      session: {}
    });

    expect(controls).toHaveLength(1);
    expect(controls[0]).toMatchObject({
      actionId: "ask_codex",
      enabled: true,
      id: "ask_codex",
      inputFields: action.inputFields,
      label: "Ask Codex",
      style: "primary"
    });
    expect(workflowControlSourceAction(controls[0])).toBe(action);
  });

  it("does not turn no-input actions into workflow controls", () => {
    const controls = currentStepWorkflowControls({
      actions: [
        {
          enabled: true,
          id: "create_worktree",
          label: "Create worktree"
        }
      ],
      session: {}
    });

    expect(controls).toEqual([]);
  });
});
