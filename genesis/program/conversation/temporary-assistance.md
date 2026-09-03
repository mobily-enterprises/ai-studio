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
- `src/composables/useVibe64AutopilotView.js`
- `src/components/studio/Vibe64TemporaryAiFixAction.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64ConversationAttachments.vue`
- `src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue`

## Public contract

Each temporary task has its own model settings, optional attachments, message
stream, and explicit read-only or workspace-writing policy. Temporary tasks do
not offer preview, console, or network diagnostic attachments and are visually
distinct from the durable project conversation. Closing a task stops its live
turn, deletes its provider conversation and exact uploaded attachments, and
removes its browser-local state. Tasks are not restored after reload and never
appear in session History.
Sent task attachments remain separate from the message as compact, read-only
file details showing the safe file name and size.

Every product-owned repair entry uses the shared Fix it with AI control. It
opens, selects, and focuses a separate Temporary AI task immediately. That task
shows a concise user-facing repair request plus a prominent explanation that it
can edit the session, where to follow progress or answer questions, and what
the product will do after the AI finishes. Detailed diagnostics remain in the
AI request without overwhelming the visible user message.

A product-owned recovery action may remember the exact temporary task it
started and observe that task's terminal result. Workspace preparation uses
this narrow handoff: after an accepted repair turn completes or fails, Vibe64
reruns its own safe deterministic preparation operation because a provider
timeout may arrive after useful edits were made. An unrelated, still-active,
or deliberately interrupted task does nothing. Temporary AI can edit or
explain, but it never declares the managed operation successful; the managed
operation's own result remains authoritative and visible.
When that deterministic check succeeds, its verified result becomes the task's
headline even if the AI provider timed out after making useful edits. The
provider timeout remains visible as secondary audit detail instead of leaving
the user with a false failure conclusion.

Temporary and lightweight helper conversations use the parent session's
selected Codex or OpenCode service, but they do not start or retain a second
resident assistant service. A user-visible temporary conversation receives one
stable Genesis and Vibe64 context for its read-only or workspace-writing kind,
while each human turn contains only the person's authored text. It keeps the
session directory and appropriate command boundary.

Prompt suggestions, commit subjects, database help, and source explanations
use the bounded low-cost execution profile in a private non-project workspace.
Their complete task prompt is their only model context: they receive neither
Genesis project context nor Vibe64 driver output. Codex helper admission is
bound to that shared service's selected
account identity, so a credential refresh for the same account remains valid
while an account switch cannot reuse earlier helper ownership. OpenCode tasks
use the same model-advertised response-limit policy as the main conversation,
and any narrower task-specific limit remains authoritative.

Codex restores durable helper ownership only while its exact managed runtime
and provider context remain current. If the runtime has disappeared, Vibe64
atomically retires the stale ownership. If the provider context changed under
the same account, it first verifies retirement of the earlier runtime and then
retires the ownership, allowing a fresh bounded helper instead of reporting a
false account conflict. A real account change remains blocked.

Database Copilot begins with only bounded database identity and object counts.
Its temporary helper can search the refreshed schema, list object names and
kinds, and request complete SQL-relevant definitions for a bounded set of
matches before proposing a query. Truncation is explicit and another search is
available; credentials never enter the helper conversation. PostgreSQL and
MySQL or MariaDB implement one server dialect contract for connection,
inspection, SQL policy, read-only execution, and result interpretation, while
the assistant consumes only the normalized schema contract. Any requested
query runs only through the session's read-only database identity.
