# Direct agent conversation

People work with the coding agent through one ordinary project conversation,
including follow-up guidance while a turn is active.

## Sources

- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/opencodeTerminal.js`
- `packages/vibe64-terminals/src/server/sessionPromptHints.js`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64PromptHints.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64ConversationLog.vue`
- `src/components/studio/vibe64-session/Vibe64PromptHints.vue`

## Public contract

The conversation accepts messages, structured answers, attachments, and
steering guidance. It streams commentary and the final response, persists the
conversation in order, restores it after reconnection, and lets the person
interrupt the current turn without deleting the session. Agent questions may
be answered as free text or through suggested choices while the submitted
reply remains ordinary conversation text.
Long user messages remain available in full but initially use a compact preview
that each reader can expand or collapse.

Contextual prompt suggestions may preview their full text in an otherwise empty
composer without modifying the draft. Showing or hiding that preview preserves
the composer's geometry, while text the person actually enters still grows the
composer normally. Selecting a suggestion inserts ordinary editable text.

If an OpenCode provider later rejects a previously saved key, the failed turn
records a durable recovery notice that links the owner to AI Accounts without
exposing the raw provider credential error. Existing conversation and project
changes remain available, and the person can retry after the owner verifies a
replacement key.
