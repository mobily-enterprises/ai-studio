# Direct agent conversation

People work with the coding agent through one ordinary project conversation,
including follow-up guidance while a turn is active.

## Sources

- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-runtime/src/server/codexAppServerProvider.js`
- `packages/vibe64-runtime/src/server/codexSessionCommandHook.js`
- `packages/vibe64-terminals/src/server/agentCommandEnvironment.js`
- `packages/vibe64-terminals/src/server/agentSessionCommand.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/opencodeServerClient.js`
- `packages/vibe64-terminals/src/server/opencodeServerProcess.js`
- `packages/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js`
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

Message delivery and provider work remain visibly distinct. The composer shows
the initial send while the message is being accepted, then reports the selected
assistant as working for the rest of the active turn. The session tab and
assistant avatar use that same live turn state until completion or interruption.

Open sessions in one workspace share a single running Codex service and a
single running OpenCode service according to the assistant each session has
selected. Codex and OpenCode remain independent: a provider service runs while
at least one matching session is open and stops after the final matching
session closes. Conversation identity, working directory, command environment,
model settings, and provider history remain session-specific even though the
resident provider process is shared. Capability discovery without an open
session may run a bounded command but does not leave another provider service
running. Shell commands and any descendants they leave running are attributed
to the originating project session rather than to the shared provider service,
and closing that session drains those descendants.

Contextual prompt suggestions may preview their full text in an otherwise empty
composer without modifying the draft. Showing or hiding that preview preserves
the composer's geometry, while text the person actually enters still grows the
composer normally. Selecting a suggestion inserts ordinary editable text.

If an OpenCode provider later rejects a previously saved key, the failed turn
records a durable recovery notice that links the owner to AI Accounts without
exposing the raw provider credential error. Existing conversation and project
changes remain available, and the person can retry after the owner verifies a
replacement key.

## Implementation map

- `codexAppServerRuntimeOptionsForSession()` keeps the Codex process identity
  workspace-wide while carrying each session's directory and environment into
  its thread requests.
- `withCodexAppServerProviderLifecycle()` serializes provider attachment,
  replacement, and final-runtime shutdown so concurrent session closes make
  one authoritative last-owner decision.
- `ensureSharedProcess()` and `stopProcessRecord()` own OpenCode's one-process
  lifecycle. Established session targets and pending starts both retain that
  process; directory-scoped clients and `Vibe64SessionEnvironment` preserve
  each session's working and command boundary.
- `prepareAgentSessionCommand()` publishes the authenticated session command
  broker. Codex rewrites shell tools through its pre-tool hook, while OpenCode's
  session environment plugin performs the equivalent rewrite before execution.
