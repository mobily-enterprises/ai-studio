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
    expect(component).toContain(':welcome-message="emptyConversationWelcome"');
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

    expect(component).toContain("saveWorkActionLabel");
    expect(component).toContain(":icon=\"mdiIncognito\"");
    expect(component).toContain("saveWorkRequiresUpdate ? mdiSourcePull : mdiContentSaveOutline");
    expect(component).toContain("@click=\"confirmSaveWork\"");
    expect(component).toContain("<Vibe64TerminalSurface");
    expect(component.indexOf("<Vibe64ConversationLog")).toBeLessThan(
      component.indexOf("<Vibe64TerminalSurface")
    );
    expect(component).toContain(':open-error-details="true"');
    expect(component).toContain('#error-actions');
    expect(component).toContain("saveWorkRequiresUpdate ? 'warning' : (saveWorkUnsaved ? 'error' : undefined)");
    expect(composable).toContain("await props.saveSessionWork();");
    expect(composable).toContain("await props.updateSessionWork();");
    expect(composable).toContain("const saveWorkUnsaved = computed");
    expect(composable).toContain("const saveWorkOperationActive = computed");
    expect(component).toContain("saveWorkOperationActive || saveWorkSending || saveWorkError");
    expect(composable).toContain("Vibe64—not Temporary AI—owns every repository operation");
    expect(composable).toContain("Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase");
    expect(composable).toContain("leave both byte-for-byte unchanged");
    expect(composable).toContain("Resolve only by editing the conflicting working-tree files");
    expect(composable).toContain("keep the latest saved version's overlapping lines byte-for-byte");
    expect(composable).toContain("saveWorkExpanded.value = false;");
    expect(composable).not.toContain("SAVE_WORK_PROMPT");
    expect(combined).not.toMatch(/runGit|executeGit|merge pr|finish session/iu);
    expect(component).toContain("sessionGithubActor.displayLabel");
    expect(component).toContain(":to=\"props.githubActorTeleportTarget\"");
    expect(composable).toContain("sessionGithubCommandActor(props.session || {})");
    expect(composable).toContain("sessionGithubActor.value.available");
  });

  it("keeps temporary AI unmistakable, ephemeral, multi-task, and attachment-owned", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const temporaryAi = fs.readFileSync(temporaryAiPath, "utf8");
    const temporaryAiComposable = fs.readFileSync(temporaryAiComposablePath, "utf8");

    expect(component).toContain("Open temporary AI");
    expect(component).toContain("Fix with temporary AI");
    expect(component).toContain("<Vibe64TemporaryAiWorkspace");
    expect(component).toContain("temporaryAiWorkspace.value?.showWorkspace?.()");
    expect(component).toContain("@select-session=\"activateRealSession\"");
    expect(component).toContain("temporaryAiWorkspace.value?.closeWorkspace?.()");
    expect(temporaryAi).toContain('aria-label="New temporary AI task"');
    expect(temporaryAi).toContain("function showWorkspace()");
    expect(temporaryAi).toContain("startTask");
    expect(temporaryAi).not.toContain("Not saved to session history");
    expect(temporaryAi).not.toContain("vibe64-temporary-ai__header");
    expect(temporaryAi).toContain('"R/W" : "R/O"');
    expect(temporaryAi).not.toContain("Read-only guidance");
    expect(temporaryAi).not.toContain("Allow edits");
    expect(temporaryAi).toContain('v-for="task in temporary.tasks.value"');
    expect(temporaryAi).toContain("<Vibe64AgentSettingsMenu");
    expect(temporaryAi).toContain("<Vibe64AutopilotPromptTextarea");
    expect(temporaryAi).toContain('aria-label="Temporary AI progress"');
    expect(temporaryAi).toContain("activeTaskActivityLabel");
    expect(temporaryAi).toContain('class="vibe64-temporary-ai__activity"');
    expect(temporaryAi).toContain('role="status"');
    expect(temporaryAi).toContain("vibe64.temporary-ai.feedback");
    expect(temporaryAi).toContain("finished. Review the result before continuing.");
    expect(temporaryAi).toContain('v-for="update in message.progressUpdates"');
    expect(temporaryAi).not.toContain("Attach visible preview");
    expect(temporaryAi).not.toContain("console & network");
    expect(temporaryAiComposable).toContain("beforeunload");
    expect(temporaryAiComposable).toContain("keepalive: true");
    expect(temporaryAiComposable).toContain("vibe64AgentAttachmentDeletePath");
    expect(temporaryAiComposable).toContain("function showWorkspace()");
    expect(temporaryAiComposable).toContain("async function startTask(options = {})");
    expect(temporaryAiComposable).toContain("if (tasks.value.length === 0)");
    expect(temporaryAiComposable).toContain("progressUpdates: temporaryAiProgressUpdates(response.progressUpdates)");
    expect(temporaryAiComposable).toContain('status: "failed"');
    expect(temporaryAiComposable).not.toMatch(/localStorage|sessionStorage/gu);
  });

  it("keeps direct source, City, preview, terminal, and close controls", () => {
    const component = fs.readFileSync(componentPath, "utf8");

    expect(component).toContain("<Vibe64SessionToolbar");
    expect(component).toContain(":abandon=\"props.sessionAbandon\"");
    expect(component).toContain("<Vibe64SessionSourceEditor");
    expect(component).toContain("<Vibe64SystemWorldView");
    expect(component).toContain("<Vibe64LaunchControls");
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

  it("requires complete compact structured answers while preserving free-form escape", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");

    expect(component).toContain("<v-select");
    expect(component).toContain('item-title="selectLabel"');
    expect(component).toContain(':items="numberedQuestionSelectItems[question.name]"');
    expect(component).not.toContain("#selection=");
    expect(component).toContain("Answer normally instead");
    expect(component).toContain(':prepend-icon="mdiPencilOutline"');
    expect(component.match(/:disabled="!composerCanSubmit"/gu)).toHaveLength(2);
    expect(composable).toContain('const NUMBERED_QUESTION_UNSURE_VALUE = "I am not sure";');
    expect(composable).toContain("numberedQuestions.value.every");
  });

  it("passes only direct chat and tool state through the runtime host", () => {
    const runtimeHost = fs.readFileSync(runtimeHostPath, "utf8");

    expect(runtimeHost).toContain(":send-agent-message=\"sendAgentMessage\"");
    expect(runtimeHost).toContain(":conversation-log=\"conversationLog\"");
    expect(runtimeHost).toContain(":retry-workspace-setup=\"retryWorkspaceSetup\"");
    expect(runtimeHost).toContain(":save-session-work=\"saveSessionWork\"");
    expect(runtimeHost).toContain(":update-session-work=\"updateSessionWork\"");
    expect(runtimeHost).toContain(":work-state=\"workState\"");
    expect(runtimeHost).not.toContain(":source-safety=\"sourceSafety\"");
    expect(runtimeHost).not.toContain(":autopilot-steps=");
    expect(runtimeHost).not.toContain(":automation-enabled=");
    expect(runtimeHost).not.toContain(":report-preview=");
    expect(runtimeHost).not.toContain(":rewind-to-step=");
    expect(runtimeHost).not.toContain(":actions=");
  });

  it("keeps workspace preparation status in chat while routing recovery to Temporary AI", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");

    const chatStart = component.indexOf("class=\"studio-autopilot__chat-panel\"");
    const projectStart = component.indexOf("class=\"studio-autopilot__project-panel\"");
    const statusStart = component.indexOf("class=\"studio-autopilot__workspace-setup\"");

    expect(statusStart).toBeGreaterThan(chatStart);
    expect(statusStart).toBeLessThan(projectStart);
    expect(component).toContain("Fix with temporary AI");
    expect(component).toContain("Retry setup");
    expect(composable).toContain("requestTemporaryAi({");
    expect(composable).toContain('policy: "workspace_write"');
    expect(composable).not.toContain("sendChatPayload(chatMessagePayload(workspaceSetupFixPrompt");
    expect(component).not.toMatch(/workspace.*(?:dialog|stepper)|(?:dialog|stepper).*workspace/iu);
  });

  it("turns a rejected managed preview identity into a Temporary AI repair request", () => {
    const component = fs.readFileSync(componentPath, "utf8");
    const composable = fs.readFileSync(composablePath, "utf8");
    const launchControls = fs.readFileSync(
      path.resolve("src/components/studio/Vibe64LaunchControls.vue"),
      "utf8"
    );

    expect(component).toContain(":ask-codex-to-fix-preview-identity=\"askCodexToFixPreviewIdentity\"");
    expect(launchControls).toContain("previewIdentityFixAvailable");
    expect(launchControls).toContain("Fix with temporary AI");
    expect(launchControls).toContain("previewIdentityFixSending");
    expect(composable).not.toContain("sendChatPayload(chatMessagePayload(previewIdentityFixPrompt(input)))");
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
