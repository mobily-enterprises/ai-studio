import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotView.vue");
const composablePath = path.resolve("src/composables/useVibe64AutopilotView.js");
const runtimeHostPath = path.resolve("src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue");

describe("Vibe64 direct session view", () => {
  it("is chat-first and contains no workflow state-machine surface", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const retiredNames = [
      "AutopilotNavigation",
      "WorkflowControlForm",
      "SessionCurrentStep",
      "SessionTimeline",
      "ReportPreview",
      "SessionRecoveryNotice",
      "StepInputDisplayFields",
      "activateWorkflowButtonControl",
      "runNextOperation",
      "rewindToAutopilotStep"
    ];

    expect(component).toContain("<Vibe64ConversationLog");
    expect(component).toContain("<Vibe64AutopilotPromptTextarea");
    for (const retiredName of retiredNames) {
      expect(component).not.toContain(retiredName);
      expect(composable).not.toContain(retiredName);
    }
  });

  it("offers save as an ordinary confirmed chat request, not Git orchestration", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const combined = `${component}\n${composable}`;

    expect(component).toContain("Save work");
    expect(component).toContain("@click=\"confirmSaveWork\"");
    expect(composable).toContain("sendChatPayload(chatMessagePayload(SAVE_WORK_PROMPT))");
    expect(combined).not.toMatch(/runGit|executeGit|merge pr|finish session/iu);
    expect(combined).not.toContain("sessionGithubActor");
    expect(combined).not.toContain("githubActorTeleportTarget");
  });

  it("keeps direct source, City, preview, diff, terminal, and close controls", () => {
    const component = fs.readFileSync(componentPath, "utf8");

    expect(component).toContain("<Vibe64SessionSourceEditor");
    expect(component).toContain("<Vibe64SystemWorldView");
    expect(component).toContain("<Vibe64LaunchControls");
    expect(component).toContain("<Vibe64SessionDiffPanel");
    expect(component).toContain("name=\"ai-terminal\"");
    expect(component).toContain("title=\"Close session\"");
  });

  it("offers preview attachments as ordinary direct-chat controls", () => {
    const component = fs.readFileSync(componentPath, "utf8");

    expect(component).toContain("aria-label=\"Attach visible preview\"");
    expect(component).toContain("aria-label=\"Attach console & network\"");
    expect(component).toContain("@preview-attachment-state=\"updatePreviewAttachmentState\"");
    expect(component).not.toContain("Composer menu");
  });

  it("passes only direct chat and tool state through the runtime host", () => {
    const runtimeHost = fs.readFileSync(runtimeHostPath, "utf8");

    expect(runtimeHost).toContain(":send-agent-message=\"sendAgentMessage\"");
    expect(runtimeHost).toContain(":conversation-log=\"conversationLog\"");
    expect(runtimeHost).toContain(":retry-workspace-setup=\"retryWorkspaceSetup\"");
    expect(runtimeHost).not.toContain(":source-safety=\"sourceSafety\"");
    expect(runtimeHost).not.toContain(":autopilot-steps=");
    expect(runtimeHost).not.toContain(":automation-enabled=");
    expect(runtimeHost).not.toContain(":report-preview=");
    expect(runtimeHost).not.toContain(":rewind-to-step=");
    expect(runtimeHost).not.toContain(":actions=");
  });

  it("keeps workspace preparation status and recovery inside direct chat", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");

    const chatStart = component.indexOf("class=\"studio-autopilot__chat-panel\"");
    const projectStart = component.indexOf("class=\"studio-autopilot__project-panel\"");
    const statusStart = component.indexOf("class=\"studio-autopilot__workspace-setup\"");

    expect(statusStart).toBeGreaterThan(chatStart);
    expect(statusStart).toBeLessThan(projectStart);
    expect(component).toContain("Ask Codex to fix");
    expect(component).toContain("Retry setup");
    expect(composable).toContain("sendChatPayload(chatMessagePayload(workspaceSetupFixPrompt");
    expect(component).not.toMatch(/workspace.*(?:dialog|stepper)|(?:dialog|stepper).*workspace/iu);
  });
});
