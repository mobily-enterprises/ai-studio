import {
  agentAttachmentActionInputValidator,
  launchTargetActionInputValidator,
  openLaunchTargetActionInputValidator,
  previewIdentityActionInputValidator
} from "./inputSchemas.js";

const ACTION_START_LAUNCH_TARGET_TERMINAL = "feature.vibe64-terminals.launch-target-terminal.start";
const ACTION_OPEN_LAUNCH_TARGET = "feature.vibe64-terminals.launch-target.open";
const ACTION_SELECT_PREVIEW_IDENTITY = "feature.vibe64-terminals.preview-identity.select";
const ACTION_UPLOAD_AGENT_ATTACHMENT = "feature.vibe64-terminals.agent-attachment.upload";

const featureActions = Object.freeze([
  {
    id: ACTION_START_LAUNCH_TARGET_TERMINAL,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: launchTargetActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_START_LAUNCH_TARGET_TERMINAL
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.startLaunchTargetTerminal(input.sessionId, {
        forceRestart: input.forceRestart === true,
        launchInput: input.launchInput || {},
        launchTargetId: input.launchTargetId,
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      });
    }
  },
  {
    id: ACTION_OPEN_LAUNCH_TARGET,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: openLaunchTargetActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_OPEN_LAUNCH_TARGET
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.openLaunchTarget(input.sessionId);
    }
  },
  {
    id: ACTION_SELECT_PREVIEW_IDENTITY,
    version: 1,
    kind: "command",
    channels: ["api", "internal"],
    surfaces: ["app"],
    input: previewIdentityActionInputValidator,
    output: null,
    idempotency: "none",
    audit: {
      actionName: ACTION_SELECT_PREVIEW_IDENTITY
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.selectPreviewIdentity(input.sessionId, {
        identityName: input.identityName || "",
        mode: input.mode
      }, {
        publicHost: input.publicHost || "",
        publicProtocol: input.publicProtocol || ""
      });
    }
  },
  {
    id: ACTION_UPLOAD_AGENT_ATTACHMENT,
    version: 1,
    kind: "command",
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input: agentAttachmentActionInputValidator,
    output: null,
    idempotency: "optional",
    audit: {
      actionName: ACTION_UPLOAD_AGENT_ATTACHMENT
    },
    observability: {},
    async execute(input, context, deps) {
      void context;
      return deps.featureService.uploadAgentAttachment(input.sessionId, input);
    }
  }
]);

export {
  ACTION_OPEN_LAUNCH_TARGET,
  ACTION_SELECT_PREVIEW_IDENTITY,
  ACTION_START_LAUNCH_TARGET_TERMINAL,
  ACTION_UPLOAD_AGENT_ATTACHMENT,
  featureActions
};
