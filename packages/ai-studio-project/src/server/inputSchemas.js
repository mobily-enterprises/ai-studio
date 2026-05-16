import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const projectTypeReadInputValidator = deepFreeze({
  schema: createSchema({}),
  mode: "patch"
});

const projectTypeInputValidator = deepFreeze({
  schema: createSchema({
    projectType: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

export {
  projectTypeInputValidator,
  projectTypeReadInputValidator
};
