# Temporary AI assistance

People can open one or more clearly separate, short-lived AI tasks for focused
help without adding those exchanges to the main project conversation or
session history.

## Sources

- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `src/composables/useVibe64TemporaryAi.js`
- `src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue`

## Public contract

Each temporary task has its own model settings, optional attachments, message
stream, and explicit read-only or workspace-writing policy. Temporary tasks do
not offer preview, console, or network diagnostic attachments and are visually
distinct from the durable project conversation. Closing a task stops its live
turn, deletes its provider conversation and exact uploaded attachments, and
removes its browser-local state. Tasks are not restored after reload and never
appear in session History.
