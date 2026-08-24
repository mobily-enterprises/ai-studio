import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";
import {
  PROJECT_AI_POLICY_EXPERTISE_LEVELS,
  PROJECT_AI_POLICY_RATIONALE_LEVELS,
  PROJECT_AI_POLICY_RESPONSE_LENGTHS,
  PROJECT_AI_POLICY_TONES
} from "@local/vibe64-core/server/projectAiPolicy";

function patchSchema(fields) {
  return deepFreeze({
    schema: createSchema(fields),
    mode: "patch"
  });
}

const optionalUser = {
  vibe64User: {
    type: "object",
    additionalProperties: true,
    required: false
  }
};

const projectsReadInputValidator = patchSchema({});
const previewApplicationIdentitiesReadInputValidator = patchSchema({
  sessionId: {
    type: "string",
    noTrim: false
  }
});
const projectSettingsReadInputValidator = patchSchema({
  ...optionalUser
});

const projectAiPolicyInputValidator = patchSchema({
  ...optionalUser,
  customNote: {
    noTrim: false,
    required: true,
    type: "string"
  },
  expertise: {
    enum: PROJECT_AI_POLICY_EXPERTISE_LEVELS,
    noTrim: false,
    required: true,
    type: "string"
  },
  promptHints: {
    required: true,
    type: "boolean"
  },
  rationale: {
    enum: PROJECT_AI_POLICY_RATIONALE_LEVELS,
    noTrim: false,
    required: true,
    type: "string"
  },
  responseLength: {
    enum: PROJECT_AI_POLICY_RESPONSE_LENGTHS,
    noTrim: false,
    required: true,
    type: "string"
  },
  tone: {
    enum: PROJECT_AI_POLICY_TONES,
    noTrim: false,
    required: true,
    type: "string"
  }
});

const projectCreateInputValidator = patchSchema({
  name: {
    type: "string",
    noTrim: false
  },
  repository: {
    type: "object",
    additionalProperties: true
  },
  slug: {
    type: "string",
    noTrim: false
  }
});

const projectSelectInputValidator = patchSchema({
  slug: {
    type: "string",
    noTrim: false,
    required: true
  }
});

const projectEnvReadInputValidator = patchSchema({
  environment: {
    type: "string",
    noTrim: false
  },
  sessionId: {
    type: "string",
    noTrim: false
  }
});

const projectEnvSecretRevealInputValidator = patchSchema({
  environment: {
    type: "string",
    noTrim: false
  },
  key: {
    type: "string",
    noTrim: false,
    required: true
  },
  sessionId: {
    type: "string",
    noTrim: false
  }
});

const projectEnvUserValuesInputValidator = patchSchema({
  environment: {
    type: "string",
    noTrim: false
  },
  sessionId: {
    type: "string",
    noTrim: false
  },
  values: {
    type: "object",
    additionalProperties: true,
    required: true
  }
});

const projectDevelopmentDatabaseScopeInputValidator = patchSchema({
  scope: {
    type: "string",
    enum: ["project", "session"],
    noTrim: false,
    required: true
  }
});

const previewApplicationIdentitiesInputValidator = patchSchema({
  identities: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: true
    },
    required: true
  },
  sessionId: {
    type: "string",
    noTrim: false
  }
});

export {
  projectAiPolicyInputValidator,
  projectDevelopmentDatabaseScopeInputValidator,
  projectCreateInputValidator,
  projectEnvReadInputValidator,
  projectEnvSecretRevealInputValidator,
  projectEnvUserValuesInputValidator,
  projectsReadInputValidator,
  projectSelectInputValidator,
  projectSettingsReadInputValidator,
  previewApplicationIdentitiesInputValidator,
  previewApplicationIdentitiesReadInputValidator
};
