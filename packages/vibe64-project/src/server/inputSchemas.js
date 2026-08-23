import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

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
const projectTemplatesReadInputValidator = patchSchema({
  ...optionalUser
});
const projectTemplateApplyInputValidator = patchSchema({
  ...optionalUser,
  templateId: {
    type: "string",
    noTrim: false,
    required: true
  }
});
const previewApplicationIdentitiesReadInputValidator = patchSchema({
  sessionId: {
    type: "string",
    noTrim: false
  }
});
const projectSettingsReadInputValidator = patchSchema({});

const projectTemplateParamsValidator = patchSchema({
  slug: {
    type: "string",
    required: false
  },
  templateId: {
    type: "string",
    noTrim: false,
    required: true
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
  projectDevelopmentDatabaseScopeInputValidator,
  projectCreateInputValidator,
  projectEnvReadInputValidator,
  projectEnvSecretRevealInputValidator,
  projectEnvUserValuesInputValidator,
  projectsReadInputValidator,
  projectSelectInputValidator,
  projectSettingsReadInputValidator,
  projectTemplateApplyInputValidator,
  projectTemplateParamsValidator,
  projectTemplatesReadInputValidator,
  previewApplicationIdentitiesInputValidator,
  previewApplicationIdentitiesReadInputValidator
};
