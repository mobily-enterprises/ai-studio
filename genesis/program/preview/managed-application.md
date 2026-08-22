# Managed application preview

People can start and inspect a project application without leaving the coding
workspace.

## Sources

- `packages/vibe64-terminals/src/server/launchTargetTerminal.js`
- `packages/vibe64-terminals/src/server/launchPreviewProxy.js`
- `packages/vibe64-terminals/src/server/vibe64LaunchTargets.js`
- `packages/vibe64-genesis/src/server/launch.js`
- `src/components/studio/Vibe64LaunchControls.vue`

## Public contract

Vibe64 lists only targets in the strict Markdown `vibe64.launch.v1` contract
transported as an opaque Stack section by Genesis. Vibe64 mechanically parses
Target headings and exact list entries, maps abstract runtime needs to supported
host tools, allocates the host and port, starts the declared argv, waits for the
declared readiness condition, and proxies the result into the managed preview.
Status, logs, retry, stop, open, and fresh restart remain available. The managed
browser comes from Vibe64's pinned runtime and project commands cannot download
their own browser.
