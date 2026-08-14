import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const optionalUser = {
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const optionalOrigin = {
  originId: {
    type: "string",
    noTrim: false,
    required: false
  }
};

function patchSchema(fields) {
  return deepFreeze({
    schema: createSchema(fields),
    mode: "patch"
  });
}

const agentMessageInputValidator = patchSchema({
  agentSettings: {
    type: "object",
    additionalProperties: true,
    required: false
  },
  displayMessage: {
    type: "string",
    noTrim: false,
    required: false
  },
  message: {
    type: "string",
    noTrim: false,
    required: true
  },
  ...optionalOrigin,
  messageId: {
    type: "string",
    noTrim: false,
    required: false
  }
});

const agentTurnInterruptInputValidator = patchSchema({
  ...optionalOrigin,
  reason: {
    type: "string",
    noTrim: false,
    required: false
  }
});

const sessionListInputValidator = patchSchema({
  ...optionalUser,
  archive: {
    type: "string",
    noTrim: false,
    required: false
  }
});

const sessionCreateInputValidator = patchSchema({
  ...optionalOrigin,
  ...optionalUser
});

const currentSessionInputValidator = patchSchema({
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: false
  }
});

const sessionIdInputValidator = patchSchema({
  ...optionalOrigin,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionInspectInputValidator = patchSchema({
  ...optionalOrigin,
  ...optionalUser,
  projectSlug: {
    type: "string",
    noTrim: false,
    required: false
  },
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionDiffInputValidator = patchSchema({
  ...optionalOrigin,
  ...optionalUser,
  full: {
    type: "string",
    noTrim: false,
    required: false
  },
  lineLimit: {
    type: "string",
    noTrim: false,
    required: false
  },
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionConversationLogInputValidator = patchSchema({
  ...optionalUser,
  beforeTurnId: {
    type: "string",
    noTrim: false,
    required: false
  },
  limit: {
    type: "string",
    noTrim: false,
    required: false
  },
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

export {
  agentMessageInputValidator,
  agentTurnInterruptInputValidator,
  currentSessionInputValidator,
  sessionConversationLogInputValidator,
  sessionCreateInputValidator,
  sessionDiffInputValidator,
  sessionIdInputValidator,
  sessionInspectInputValidator,
  sessionListInputValidator
};
