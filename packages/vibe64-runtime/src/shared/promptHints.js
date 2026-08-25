const VIBE64_PROMPT_HINT_OUTPUT_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: Object.freeze({
    suggestions: Object.freeze({
      items: Object.freeze({
        maxLength: 120,
        minLength: 1,
        type: "string"
      }),
      maxItems: 3,
      minItems: 3,
      type: "array"
    })
  }),
  required: Object.freeze(["suggestions"]),
  type: "object"
});

const VIBE64_PROMPT_HINT_STATIC_STARTERS = Object.freeze({
  existingProject: Object.freeze([
    "Give me a quick tour of this project",
    "What should I improve first?",
    "Help me plan a small safe change"
  ]),
  greenfield: Object.freeze([
    "Help me shape my app idea",
    "Show me the simplest useful first version",
    "What should we decide first?"
  ])
});

export {
  VIBE64_PROMPT_HINT_OUTPUT_SCHEMA,
  VIBE64_PROMPT_HINT_STATIC_STARTERS
};
