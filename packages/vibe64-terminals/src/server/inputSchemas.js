import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const optionalText = {
  type: "string",
  noTrim: false,
  required: false
};

const requiredText = {
  ...optionalText,
  required: true
};

const sessionIdField = requiredText;

const agentAttachmentFields = {
  contentType: optionalText,
  dataBase64: {
    type: "string",
    noTrim: true,
    required: true
  },
  fileName: requiredText
};

const launchTargetFields = {
  forceRestart: {
    type: "boolean",
    required: false
  },
  launchInput: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  launchTargetId: requiredText,
  originId: optionalText,
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

function validator(fields) {
  return deepFreeze({
    schema: createSchema(fields),
    mode: "patch"
  });
}

const agentAttachmentInputValidator = validator(agentAttachmentFields);
const agentAttachmentActionInputValidator = validator({
  ...agentAttachmentFields,
  sessionId: sessionIdField
});
const agentAttachmentDeleteActionInputValidator = validator({
  attachmentId: requiredText,
  sessionId: sessionIdField
});
const temporaryConversationCreateActionInputValidator = validator({
  agentSettings: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  policy: optionalText,
  sessionId: sessionIdField
});
const temporaryConversationInputValidator = validator({
  conversationId: requiredText,
  sessionId: sessionIdField
});
const temporaryConversationTurnActionInputValidator = validator({
  agentSettings: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  conversationId: requiredText,
  message: requiredText,
  policy: optionalText,
  promptLabel: optionalText,
  sessionId: sessionIdField
});
const temporaryConversationStopActionInputValidator = validator({
  conversationId: requiredText,
  runId: optionalText,
  sessionId: sessionIdField
});
const launchTargetInputValidator = validator(launchTargetFields);
const launchTargetActionInputValidator = validator({
  ...launchTargetFields,
  sessionId: sessionIdField
});
const openLaunchTargetActionInputValidator = validator({
  sessionId: sessionIdField
});
const previewIdentityInputValidator = validator({
  identityName: optionalText,
  mode: {
    type: "string",
    enum: ["identity", "guest"],
    noTrim: false,
    required: true
  }
});
const previewIdentityActionInputValidator = validator({
  identityName: optionalText,
  mode: {
    type: "string",
    enum: ["identity", "guest"],
    noTrim: false,
    required: true
  },
  publicHost: optionalText,
  publicProtocol: optionalText,
  sessionId: sessionIdField
});
const terminalControlTextInputValidator = validator({
  originId: optionalText,
  text: {
    type: "string",
    noTrim: true,
    required: true
  }
});
const terminalControlKeyInputValidator = validator({
  key: {
    type: "string",
    enum: ["ctrl-c", "enter", "escape", "tab"],
    noTrim: false,
    required: true
  },
  originId: optionalText
});

export {
  agentAttachmentActionInputValidator,
  agentAttachmentDeleteActionInputValidator,
  agentAttachmentInputValidator,
  launchTargetActionInputValidator,
  launchTargetInputValidator,
  openLaunchTargetActionInputValidator,
  previewIdentityActionInputValidator,
  previewIdentityInputValidator,
  terminalControlKeyInputValidator,
  terminalControlTextInputValidator,
  temporaryConversationCreateActionInputValidator,
  temporaryConversationInputValidator,
  temporaryConversationStopActionInputValidator,
  temporaryConversationTurnActionInputValidator
};
