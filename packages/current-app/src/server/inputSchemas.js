import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const currentAppQueryInputValidator = deepFreeze({
  schema: createSchema({
    sessionId: {
      type: "string",
      noTrim: false,
      required: false
    }
  }),
  mode: "patch"
});

export {
  currentAppQueryInputValidator
};
