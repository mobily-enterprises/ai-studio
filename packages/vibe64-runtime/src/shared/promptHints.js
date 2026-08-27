const VIBE64_PROMPT_HINT_LABEL_MAX_CHARACTERS = 24;
const VIBE64_PROMPT_HINT_PROMPT_MAX_CHARACTERS = 108;

const VIBE64_PROMPT_HINT_OUTPUT_SCHEMA = Object.freeze({
  additionalProperties: false,
  properties: Object.freeze({
    suggestions: Object.freeze({
      items: Object.freeze({
        additionalProperties: false,
        properties: Object.freeze({
          label: Object.freeze({
            maxLength: VIBE64_PROMPT_HINT_LABEL_MAX_CHARACTERS,
            minLength: 1,
            type: "string"
          }),
          prompt: Object.freeze({
            maxLength: VIBE64_PROMPT_HINT_PROMPT_MAX_CHARACTERS,
            minLength: 1,
            type: "string"
          })
        }),
        required: Object.freeze(["label", "prompt"]),
        type: "object"
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
    Object.freeze({
      label: "Tour this project",
      prompt: "Give me a quick tour of this project"
    }),
    Object.freeze({
      label: "Find first improvement",
      prompt: "What should I improve first?"
    }),
    Object.freeze({
      label: "Plan safe change",
      prompt: "Help me plan a small safe change"
    })
  ]),
  greenfield: Object.freeze([
    Object.freeze({
      label: "Shape app idea",
      prompt: "Help me shape my app idea"
    }),
    Object.freeze({
      label: "Plan first version",
      prompt: "Show me the simplest useful first version"
    }),
    Object.freeze({
      label: "Decide first steps",
      prompt: "What should we decide first?"
    })
  ])
});

export {
  VIBE64_PROMPT_HINT_LABEL_MAX_CHARACTERS,
  VIBE64_PROMPT_HINT_OUTPUT_SCHEMA,
  VIBE64_PROMPT_HINT_PROMPT_MAX_CHARACTERS,
  VIBE64_PROMPT_HINT_STATIC_STARTERS
};
