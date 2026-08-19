# Isolated work sessions

Each coding task can use a recoverable source workspace that is isolated from
the canonical project and from other sessions.

## Sources

- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-runtime/src/server/runtime.js`
- `packages/vibe64-terminals/src/server/sessionSource.js`

## Public contract

People can create, select, inspect, and abandon sessions. A new session receives
its own Git source and stable identity. Its conversation, source location,
agent activity, workspace preparation, and repository status remain available across UI
refreshes. Abandoning a session closes the active work while preserving the
read-only history needed to recover its conversation and understand what
happened.
