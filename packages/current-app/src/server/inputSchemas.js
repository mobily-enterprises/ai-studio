import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const currentAppQueryInputValidator = deepFreeze({
  schema: createSchema({
    includeGit: {
      type: "boolean",
      required: false
    }
  }),
  mode: "patch"
});

const terminalInputValidator = deepFreeze({
  schema: createSchema({
    data: {
      type: "string",
      noTrim: true,
      required: true
    }
  }),
  mode: "patch"
});

const codexThreadInputValidator = deepFreeze({
  schema: createSchema({
    threadId: {
      type: "string",
      noTrim: false,
      required: true
    }
  }),
  mode: "patch"
});

export {
  codexThreadInputValidator,
  currentAppQueryInputValidator,
  terminalInputValidator
};
