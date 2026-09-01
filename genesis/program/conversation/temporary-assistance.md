# Temporary AI assistance

People can open one or more clearly separate, short-lived AI tasks for focused
help without adding those exchanges to the main project conversation or
session history.

## Sources

- `packages/vibe64-runtime/src/server/codexAppServerProvider.js`
- `packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js`
- `packages/vibe64-database-tools/src/server/assistant.js`
- `packages/vibe64-database-tools/src/server/databaseDialect.js`
- `packages/vibe64-database-tools/src/server/schemaAccess.js`
- `packages/vibe64-database-tools/src/server/service.js`
- `packages/vibe64-terminals/src/server/codexEconomyThreadLedger.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/opencodeServerProcess.js`
- `packages/vibe64-terminals/src/server/opencodeTerminal.js`
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

Temporary and lightweight helper conversations use the parent session's
selected Codex or OpenCode service and its bounded low-cost execution profile.
They remain isolated provider conversations with the same session directory and
command boundary, but they do not start or retain a second resident assistant
service. Codex helper admission is bound to that shared service's selected
account identity, so a credential refresh for the same account remains valid
while an account switch cannot reuse earlier helper ownership. OpenCode tasks
use the same model-advertised response-limit policy as the main conversation,
and any narrower task-specific limit remains authoritative.

Database Copilot begins with only bounded database identity and object counts.
Its temporary helper can search the refreshed schema, list object names and
kinds, and request complete SQL-relevant definitions for a bounded set of
matches before proposing a query. Truncation is explicit and another search is
available; credentials never enter the helper conversation. PostgreSQL and
MySQL or MariaDB implement one server dialect contract for connection,
inspection, SQL policy, read-only execution, and result interpretation, while
the assistant consumes only the normalized schema contract. Any requested
query runs only through the session's read-only database identity.
