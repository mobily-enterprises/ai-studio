import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const artifactReadInputValidator = deepFreeze({
  schema: createSchema({
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

const artifactsInputValidator = deepFreeze({
  schema: createSchema({
    artifacts: {
      type: "object",
      additionalProperties: true,
      required: true
    }
  }),
  mode: "patch"
});

const artifactSaveInputValidator = deepFreeze({
  schema: createSchema({
    artifacts: {
      type: "object",
      additionalProperties: true,
      required: true
    },
    sessionId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

export {
  artifactReadInputValidator,
  artifactsInputValidator,
  artifactSaveInputValidator
};
