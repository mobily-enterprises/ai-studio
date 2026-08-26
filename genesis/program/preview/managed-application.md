# Managed project outputs

People can run and inspect a project's web, terminal, and finite build outputs
without leaving the coding workspace.

## Sources

- `packages/vibe64-genesis/src/server/outputs.js`
- `packages/vibe64-terminals/src/server/vibe64OutputTargets.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminal.js`
- `packages/vibe64-terminals/src/server/outputResults.js`
- `packages/vibe64-terminals/src/server/launchPreviewProxy.js`
- `src/components/studio/Vibe64OutputControls.vue`

## Public contract

Vibe64 lists only targets in the strict Markdown `vibe64.outputs.v1` contract
transported as an opaque Stack section by Genesis. Each target declares exact
Prepare, Build, and Run argv, a working directory and runtime requirements,
plus either an interactive presentation or finite downloadable results. Vibe64
never guesses a framework command or substitutes an unknown runtime.

Starting a target waits for the separately owned workspace-setup recipe, then
runs every step through the managed execution gateway. Web targets use the
preview resource profile, finite targets use the bounded job profile, and
interactive terminal targets use the terminal profile. Web presentation owns
port allocation, readiness and the managed proxy. Finite runs snapshot only
their declared regular files into bounded immutable result storage and expose
downloads by generated result identity rather than a caller-supplied path.

Status inspection never starts work. Logs, retry, stop, open, fresh restart,
result history, and authenticated downloads remain available through the
session-owned output controller and studio controls.
