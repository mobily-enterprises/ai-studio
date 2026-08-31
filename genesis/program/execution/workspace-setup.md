# Workspace preparation

Vibe64 can prepare a fresh session source using its exact Workspace setup
contract transported by the project's Stack.

## Sources

- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-genesis/src/server/workspaceSetup.js`
- `src/components/studio/Vibe64TemporaryActionTerminal.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/composables/useVibe64AutopilotView.js`

## Public contract

`vibe64.workspace-setup.v1` is the only accepted schema. Its source is strict,
readable Markdown: each `Prepare` entry declares a label, runtimes, optional
working directory and path condition, then separate backticked argv values.
Vibe64 parses that opaque Stack section mechanically and runs the normalized
argv with the project's resolved environment. It runs once for a fresh recipe,
records progress and exact recipe identity, waits before dependent work, and
exposes retry after failure. Missing or ambiguous declarations remain explicit;
Vibe64 never guesses an installer or reads a retired grammar.

During preparation, the workspace shows one compact progress line. Opening its
details reveals the bounded transcript and keeps it available after completion
until dismissed. The browser remembers that dismissal across reloads for the
exact preparation attempt without changing its result; a new attempt is visible
again. A successful preparation left compact disappears when it finishes; a
failure remains visible with its recovery actions until dismissed.
