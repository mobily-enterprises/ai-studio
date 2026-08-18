import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const componentPath = path.resolve("src/components/studio/vibe64-session/Vibe64AutopilotView.vue");
const composablePath = path.resolve("src/composables/useVibe64AutopilotView.js");
const promptTextareaPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue"
);
const runtimeHostPath = path.resolve("src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue");
const temporaryAiPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue"
);
const temporaryAiComposablePath = path.resolve("src/composables/useVibe64TemporaryAi.js");

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

  it("offers native confirmed Save with persistent operation output, not an AI prompt", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const combined = `${component}\n${composable}`;

    expect(component).toContain("Save work");
    expect(component).toContain("@click=\"confirmSaveWork\"");
    expect(component).toContain("<Vibe64TerminalSurface");
    expect(component).toContain(':color="saveWorkUnsaved ? \'error\' : undefined"');
    expect(composable).toContain("await props.saveSessionWork({");
    expect(composable).toContain("const saveWorkUnsaved = computed");
    expect(composable).not.toContain("SAVE_WORK_PROMPT");
    expect(combined).not.toMatch(/runGit|executeGit|merge pr|finish session/iu);
    expect(component).toContain("sessionGithubActor.displayLabel");
    expect(component).toContain(":to=\"props.githubActorTeleportTarget\"");
    expect(composable).toContain("sessionGithubCommandActor(props.session || {})");
  });

  it("keeps temporary AI unmistakable, ephemeral, multi-task, and attachment-owned", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const temporaryAi = fs.readFileSync(temporaryAiPath, "utf8");
    const temporaryAiComposable = fs.readFileSync(temporaryAiComposablePath, "utf8");

    expect(component).toContain("Open temporary AI");
    expect(component).toContain("Resolve with temporary AI");
    expect(component).toContain("<Vibe64TemporaryAiWorkspace");
    expect(temporaryAi).toContain("Not saved to session history");
    expect(temporaryAi).toContain('v-for="task in temporary.tasks.value"');
    expect(temporaryAi).toContain("<Vibe64AgentSettingsMenu");
    expect(temporaryAi).toContain("<Vibe64AutopilotPromptTextarea");
    expect(temporaryAi).not.toContain("Attach visible preview");
    expect(temporaryAi).not.toContain("console & network");
    expect(temporaryAiComposable).toContain("beforeunload");
    expect(temporaryAiComposable).toContain("keepalive: true");
    expect(temporaryAiComposable).toContain("vibe64AgentAttachmentDeletePath");
    expect(temporaryAiComposable).not.toMatch(/localStorage|sessionStorage/gu);
  });

  it("keeps direct source, City, preview, diff, terminal, and close controls", () => {
    const component = fs.readFileSync(componentPath, "utf8");

    expect(component).toContain("<Vibe64SessionToolbar");
    expect(component).toContain(":abandon=\"props.sessionAbandon\"");
    expect(component).toContain("<Vibe64SessionSourceEditor");
    expect(component).toContain("<Vibe64SystemWorldView");
    expect(component).toContain("<Vibe64LaunchControls");
    expect(component).toContain("<Vibe64SessionDiffPanel");
    expect(component).toContain("name=\"ai-terminal\"");
    expect(component).not.toContain("Session tools");
    expect(component).not.toContain("mdiDotsHorizontal");
  });

  it("offers preview attachments as ordinary direct-chat controls", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const promptTextarea = fs.readFileSync(promptTextareaPath, "utf8");

    expect(component).toContain("aria-label=\"Attach visible preview\"");
    expect(component).toContain("aria-label=\"Attach console & network\"");
    expect(component).toContain("@preview-attachment-state=\"updatePreviewAttachmentState\"");
    expect(component).not.toContain("Composer menu");
    expect(promptTextarea).toContain("const codexCommands = useVibe64CodexCommands();");
    expect(promptTextarea).toContain("canUpload: () => props.attachmentsEnabled && !props.disabled");
    expect(promptTextarea).toContain("onError: attachmentFeedback.error");
    expect(promptTextarea).toContain('source: "vibe64.agent-attachment.upload.feedback"');
    expect(promptTextarea).not.toContain("attachments.status.value");
    expect(promptTextarea).not.toContain("Attachments are disabled for this prompt.");
  });

  it("labels active-turn messages as compact steering", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");

    expect(component).toContain('v-if="agentStopVisible"');
    expect(component).toContain('aria-label="Steer assistant"');
    expect(component).toContain(':prepend-icon="mdiArrowTopRight"');
    expect(component).toContain('v-else');
    expect(component).toContain('aria-label="Send message"');
    expect(component).toContain(':icon="mdiSend"');
    expect(component).not.toContain(":icon=\"agentStopVisible ? undefined : mdiSend\"");
    expect(composable).not.toContain("Send guidance while the assistant is working.");
  });

  it("passes only direct chat and tool state through the runtime host", () => {
    const runtimeHost = fs.readFileSync(runtimeHostPath, "utf8");

    expect(runtimeHost).toContain(":send-agent-message=\"sendAgentMessage\"");
    expect(runtimeHost).toContain(":conversation-log=\"conversationLog\"");
    expect(runtimeHost).toContain(":retry-workspace-setup=\"retryWorkspaceSetup\"");
    expect(runtimeHost).toContain(":save-session-work=\"saveSessionWork\"");
    expect(runtimeHost).toContain(":work-state=\"workState\"");
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

  it("turns a rejected managed preview identity into an ordinary Codex repair request", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const launchControls = fs.readFileSync(
      path.resolve("src/components/studio/Vibe64LaunchControls.vue"),
      "utf8"
    );

    expect(component).toContain(":ask-codex-to-fix-preview-identity=\"askCodexToFixPreviewIdentity\"");
    expect(launchControls).toContain("previewIdentityFixAvailable");
    expect(launchControls).toContain("Ask Codex to fix");
    expect(composable).toContain("sendChatPayload(chatMessagePayload(previewIdentityFixPrompt(input)))");
    expect(composable).toContain("app-owned, idempotent development seed");
    expect(composable).toContain("Keep preview authentication material host-managed");
  });

  it("uses multiline Enter and moves Tab directly from chat input to Send", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const promptTextarea = fs.readFileSync(promptTextareaPath, "utf8");

    expect(component).toContain("tab-to-submit");
    expect(component).toContain("@tab-to-submit=\"focusComposerSendButton\"");
    expect(component).not.toContain("submit-on-enter");
    expect(composable).not.toContain("Enter sends. Shift+Enter adds a line.");
    expect(promptTextarea).toContain('event.key === "Enter" && !props.submitOnEnter');
    expect(promptTextarea).toContain("event.stopPropagation()");
  });

});
