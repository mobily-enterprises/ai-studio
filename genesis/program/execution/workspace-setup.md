# Workspace preparation

Vibe64 can prepare a fresh session source using its exact Workspace setup
contract transported by the project's Stack.

## Sources

- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-genesis/src/server/workspaceSetup.js`

## Public contract

`vibe64.workspace-setup.v1` is the only accepted schema. Its source is strict,
readable Markdown: each `Prepare` entry declares a label, runtimes, optional
working directory and path condition, then separate backticked argv values.
Vibe64 parses that opaque Stack section mechanically and runs the normalized
argv with the project's resolved environment. It runs once for a fresh recipe,
records progress and exact recipe identity, waits before dependent work, and
exposes retry after failure. Missing or ambiguous declarations remain explicit;
Vibe64 never guesses an installer or reads a retired grammar.
