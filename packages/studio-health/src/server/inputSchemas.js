import { createSchema } from "json-rest-schema";
import { deepFreeze } from "@jskit-ai/kernel/shared/support/deepFreeze";

const studioHealthQueryInputValidator = deepFreeze({
  schema: createSchema({
    vibe64User: {
      type: "object",
      additionalProperties: true,
      required: false
    }
  }),
  mode: "patch"
});

export { studioHealthQueryInputValidator };
