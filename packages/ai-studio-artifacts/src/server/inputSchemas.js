import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

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

export { artifactsInputValidator };
