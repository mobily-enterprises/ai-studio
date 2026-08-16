# Workspace preparation

Vibe64 can prepare a fresh session source using the exact recipe declared by
the project's selected Genesis Stack.

## Sources

- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-genesis/src/server/index.js`

## Public contract

Preparation runs ordered argument arrays in the declared working directories
with supported managed runtimes and the project's resolved environment. It runs
once for a fresh recipe, records progress and the exact recipe identity, waits
before starting dependent work, and exposes a retry after failure. Missing or
ambiguous declarations remain explicit; Vibe64 never guesses an installer.
