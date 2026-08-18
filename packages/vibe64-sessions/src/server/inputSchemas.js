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

const agentMessageFields = {
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
};

const agentMessageInputValidator = patchSchema(agentMessageFields);
const agentMessageActionInputValidator = patchSchema({
  ...agentMessageFields,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const agentTurnInterruptFields = {
  ...optionalOrigin,
  reason: {
    type: "string",
    noTrim: false,
    required: false
  }
};

const agentTurnInterruptInputValidator = patchSchema(agentTurnInterruptFields);
const agentTurnInterruptActionInputValidator = patchSchema({
  ...agentTurnInterruptFields,
  ...optionalUser,
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionViewStateInputValidator = patchSchema({
  ...optionalOrigin,
  projectPane: {
    type: "string",
    noTrim: false,
    required: false
  },
  projectSlug: {
    type: "string",
    noTrim: false,
    required: true
  },
  routeFullPath: {
    type: "string",
    noTrim: false,
    required: true
  },
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const sessionPreviewStateInputValidator = patchSchema({
  ...optionalOrigin,
  projectSlug: {
    type: "string",
    noTrim: false,
    required: true
  },
  route: {
    type: "string",
    noTrim: false,
    required: true
  },
  sessionId: {
    type: "string",
    noTrim: false,
    required: true
  },
  title: {
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

const sessionSaveInputValidator = patchSchema({
  ...optionalOrigin,
  ...optionalUser,
  message: {
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
  agentMessageActionInputValidator,
  agentMessageInputValidator,
  agentTurnInterruptActionInputValidator,
  agentTurnInterruptInputValidator,
  currentSessionInputValidator,
  sessionConversationLogInputValidator,
  sessionCreateInputValidator,
  sessionDiffInputValidator,
  sessionIdInputValidator,
  sessionInspectInputValidator,
  sessionListInputValidator,
  sessionPreviewStateInputValidator,
  sessionSaveInputValidator,
  sessionViewStateInputValidator
};
