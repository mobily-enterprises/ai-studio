import {
  agentAttachmentActionInputValidator,
  launchTargetActionInputValidator,
  openLaunchTargetActionInputValidator,
  previewIdentityActionInputValidator
} from "./inputSchemas.js";

const ACTION_START_LAUNCH_TARGET_TERMINAL = "vibe64.terminals.launch-target-terminal.start";
const ACTION_OPEN_LAUNCH_TARGET = "vibe64.terminals.launch-target.open";
const ACTION_SELECT_PREVIEW_IDENTITY = "vibe64.terminals.preview-identity.select";
const ACTION_UPLOAD_AGENT_ATTACHMENT = "vibe64.terminals.agent-attachment.upload";

function action({ execute, id, idempotency = "optional", input }) {
  return Object.freeze({
    id,
    version: 1,
    kind: "command",
    input,
    output: null,
    idempotency,
    audit: { actionName: id },
    observability: {},
    execute
  });
}

function createTerminalActions({ terminals } = {}) {
  if (!terminals) {
    throw new TypeError("createTerminalActions requires terminals.");
  }
  return Object.freeze([
    action({
      id: ACTION_START_LAUNCH_TARGET_TERMINAL,
      input: launchTargetActionInputValidator,
      execute: (input) => terminals.startLaunchTargetTerminal(input.sessionId, {
        forceRestart: input.forceRestart === true,
        launchInput: input.launchInput || {},
        launchTargetId: input.launchTargetId,
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      })
    }),
    action({
      id: ACTION_OPEN_LAUNCH_TARGET,
      input: openLaunchTargetActionInputValidator,
      execute: (input) => terminals.openLaunchTarget(input.sessionId)
    }),
    action({
      id: ACTION_SELECT_PREVIEW_IDENTITY,
      input: previewIdentityActionInputValidator,
      idempotency: "none",
      execute: (input) => terminals.selectPreviewIdentity(input.sessionId, {
        identityName: input.identityName || "",
        mode: input.mode
      }, {
        publicHost: input.publicHost || "",
        publicProtocol: input.publicProtocol || ""
      })
    }),
    action({
      id: ACTION_UPLOAD_AGENT_ATTACHMENT,
      input: agentAttachmentActionInputValidator,
      execute: (input) => terminals.uploadAgentAttachment(input.sessionId, input)
    })
  ]);
}

export {
  ACTION_OPEN_LAUNCH_TARGET,
  ACTION_SELECT_PREVIEW_IDENTITY,
  ACTION_START_LAUNCH_TARGET_TERMINAL,
  ACTION_UPLOAD_AGENT_ATTACHMENT,
  createTerminalActions
};
