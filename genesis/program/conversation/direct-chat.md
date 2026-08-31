# Direct agent conversation

People work with the coding agent through one ordinary project conversation,
including follow-up guidance while a turn is active.

## Sources

- `packages/vibe64-sessions/src/server/inputSchemas.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-runtime/src/shared/assistantSelection.js`
- `packages/vibe64-runtime/src/server/codexAppServerProvider.js`
- `packages/vibe64-runtime/src/server/codexSessionCommandHook.js`
- `packages/vibe64-execution/src/host/execHelper.js`
- `packages/vibe64-execution/src/server/engines/helperClient.js`
- `packages/vibe64-terminals/src/server/agentCommandEnvironment.js`
- `packages/vibe64-terminals/src/server/agentSessionCommand.js`
- `packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js`
- `packages/vibe64-terminals/src/server/codexAppServerEvents.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/codexTurnOutcomeNotice.js`
- `packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js`
- `packages/vibe64-terminals/src/server/opencodeServerClient.js`
- `packages/vibe64-terminals/src/server/opencodeServerProcess.js`
- `packages/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js`
- `packages/vibe64-terminals/src/server/opencodeTerminal.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/vibe64-terminals/src/server/sessionPromptHints.js`
- `src/composables/useVibe64AssistantCatalog.js`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64PromptHints.js`
- `src/components/studio/Vibe64CodexSession.vue`
- `src/components/studio/Vibe64InteractiveTerminal.vue`
- `src/components/studio/Vibe64OpenCodeSession.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64ConversationLog.vue`
- `src/components/studio/vibe64-session/Vibe64PromptHints.vue`
- `src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue`
- `src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue`
- `vite.config.mjs`

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
When an OpenCode provider reports successful completion without a user-facing
response, Vibe64 makes one bounded continuation request for that response. If
the provider again returns no response, the turn fails visibly instead of
appearing to have completed silently.

The chat cog opens a compact selector for the AI used by that session. It shows
only currently connected providers and their available models, chooses a
compatible conversation agent automatically, and offers the selected model's
thinking choices when present. A provider-default thinking choice delegates
that setting to the provider instead of substituting another listed choice.
The new-session AI chooser is a separate, preloaded view of Vibe64's saved AI
connections. It presents one choice for Codex when connected and one choice for
each saved OpenCode route, using each connection's verified default model. It
does not start OpenCode or read OpenCode's provider and model catalogue when
the chooser opens or when the session is created; creation validates the
selection against the same saved connection view. A session keeps the
assistant engine that owns its native history: Codex cannot be changed to
OpenCode or vice versa. Between turns, the explicitly opened chat selector may
load and apply a complete, compatible model choice within that fixed engine;
merely opening or creating a session does not load that catalogue, and an
active turn cannot change the selection. Distinct OpenCode provider ids remain
distinct choices, so separate routes or plans from one provider can coexist and
be selected independently without becoming Codex. People can choose among
already connected AIs even when they cannot manage account connections; only
people who can manage connections see the shortcut to configure more. Loading,
retryable failures, and the absence of a connected AI remain visible in the
relevant selector.

Managed OpenCode requests allow up to 128K output tokens only when the selected
model advertises that capacity. A smaller advertised output limit remains
authoritative, while a missing or invalid limit retains OpenCode's 32K
fallback. OpenCode uses the same managed ceiling when reserving context for the
response and deciding when to compact the conversation.

The AI Terminal follows that fixed session engine without substituting another
one: Codex sessions expose a Codex terminal and OpenCode sessions expose an
OpenCode terminal. A person starts the interactive terminal explicitly and
sees the complete terminal rather than a collapsed status line. Closing it
terminates and hides the terminal, and a clean terminal exit such as Ctrl-D
hides it without affecting the durable conversation.

Open sessions in one workspace share a single running Codex service and a
single running OpenCode service according to the assistant each session has
selected. Codex and OpenCode remain independent: a provider service runs while
at least one matching session is open and stops after the final matching
session closes. On a managed host, the provider also remains attached to the
exact Vibe64 server controller that started it; if that controller disappears,
the provider's complete process tree stops rather than surviving as an orphan.
Conversation identity, working directory, command environment,
model settings, and provider history remain session-specific even though the
resident provider process is shared. Capability discovery without an open
session may run a bounded command but does not leave another provider service
running. OpenCode shell commands and any descendants they leave running are
attributed to the originating project session, and closing that session drains
those descendants. On a managed host, supported browser commands run through
Codex's optimized shared command executor are temporarily routed through the
originating session boundary, so their browser descendants are attributed to
that session and drain when it closes. Other optimized Codex command
descendants remain inside the workspace's managed Codex scope because the
executor does not expose their per-command boundary; they are reported with
the workspace Codex service and drain when its final session closes.

Contextual prompt suggestions may preview their full text in an otherwise empty
composer without modifying the draft. Showing or hiding that preview preserves
the composer's geometry, while text the person actually enters still grows the
composer normally. Selecting a suggestion inserts ordinary editable text.

If an OpenCode provider later rejects a previously saved key, the failed turn
records a durable recovery notice that links the owner to AI Accounts without
exposing the raw provider credential error. Other structured OpenCode API
failures preserve the readable provider message and add the same durable
account-management route. Existing conversation and project changes remain
available for either failure, and the person can retry after the account is
recovered.

When Codex reports its exact structured usage-limit condition, the durable turn
outcome links directly to Codex usage and billing while preserving completed
project changes. Similar prose alone is not classified as quota exhaustion, so
an unrelated failure cannot gain an account link merely because of its wording.

## Implementation map

- `codexAppServerRuntimeOptionsForSession()` keeps the Codex process identity
  workspace-wide while carrying each session's directory and environment into
  its thread requests.
- `codexAppServerCommandBaseEnv()` and
  `normalizeCodexAppServerTerminalEnv()` pass the curated host and session
  environment explicitly while withholding the desktop message-bus variables
  that would let a descendant move itself out of the managed Codex execution
  scope. The command runner does not merge the host process environment again,
  and the managed startup shell repeats the exclusion at the final process
  boundary.
- `runCodexAuthPreflight()` recreates the private volatile runtime directory
  before using it, so a shared Codex service can start normally after a host
  reboot has cleared that directory.
- `withCodexAppServerProviderLifecycle()` serializes provider attachment,
  replacement, and final-runtime shutdown so concurrent session closes make
  one authoritative last-owner decision.
- `stopOwnedCodexAppServerExecution()` stops the exact managed Codex execution
  scope and can prove that scope empty after its ordinary resource-history
  record expires, without treating an unrelated process as the provider.
- `ensureSharedProcess()` and `stopProcessRecord()` own OpenCode's one-process
  lifecycle. Established session targets and pending starts both retain that
  process; directory-scoped clients and `Vibe64SessionEnvironment` preserve
  each session's working and command boundary.
- `safeOpenCodeEnvironment()` disables project configuration and default
  plugins while loading Vibe64's single trusted session-environment plugin,
  so the shared service can route commands through the authenticated session
  boundary without executing arbitrary project plugins. It raises OpenCode's
  response and compaction ceiling only alongside that trusted plugin.
- `readOpenCodeCatalog()` starts a bounded, credential-free temporary OpenCode
  service and reads its complete provider and agent APIs while the resident
  session service stays asleep. The client allowlists safe provider and model
  capability fields before they can enter the catalogue cache, and the
  temporary service must be proven stopped before the result is returned.
- `openCodeConfiguredAssistantCapabilities()` projects saved connection labels,
  access descriptions, and verified default models into the new-session choices
  without consulting the live OpenCode catalogue. The configured-only
  capability and session-creation paths both use that projection, while
  `Vibe64AssistantSessionDialog` preloads it before the dialog opens.
- `verifyConnection()` checks the exact current provider and model before
  `verifyOpenCodeApiKey()` runs one finite, tool-free request in an isolated
  credential home. It omits provider URL overrides so OpenCode owns native
  routing, bounds time, output, and captured bytes, sanitizes failures, and
  removes the temporary credential root on every outcome.
- `Vibe64SessionEnvironment` presents ordinary shell commands rather than
  Vibe64's transport wrapper in the model-facing instructions and history. At
  execution it recognizes only canonical invocations of the session's exact
  trusted wrapper, removes any repeated copies, and applies that wrapper once;
  persisted provider history remains unchanged. It also clamps the raised
  response allowance to the selected model's advertised output limit and
  restores the 32K fallback when no valid limit is advertised.
- OpenCode's turn monitor detects a successful provider result with no text,
  queues one tool-free request for the missing final response, and records an
  explicit failure if that bounded recovery also returns no text.
- `prepareAgentSessionCommand()` publishes the authenticated session command
  broker. OpenCode's session environment plugin routes commands through that
  boundary before execution. Codex can route commands exposed through its
  pre-tool hook, but optimized Code Mode currently does not emit those command
  events because of OpenAI Codex issue #23411. While that issue remains,
  `codexAppServerDeveloperInstructions()` tells Codex to keep supported browser
  commands PATH-resolved so a managed host's temporary browser-only policy can
  send them through the broker. That guidance and host policy must be removed
  when #23411 is fixed; other optimized descendants retain workspace-level
  ownership. The broker environment applies the same desktop message-bus
  exclusion so a session-owned descendant remains inside its managed execution
  scope.
- `Vibe64SessionRuntimeHost` selects exactly one interactive terminal from the
  session's immutable engine id and has no cross-engine fallback.
- `startAttachedTerminal()` attaches OpenCode's native TUI to the session's
  existing upstream history in a session-owned PTY. The OpenCode controller
  owns its bounded snapshot, stream, input, resize, close, and session cleanup;
  ordinary input transport does not repeat assistant-selection authorization.
- `helperOperationForRequest()` keeps assistant PTYs on the project command
  policy instead of the home-only account-login policy, and maps both the
  resident OpenCode service and its credential-free catalogue service to the
  constrained OpenCode provider-workspace policy.
- `resolveAllowedCwd()` admits only the exact Codex or OpenCode provider
  workspace beneath either the hosted workspace runtime or the target OS
  user's per-user runtime, covering hosted services and standalone local use
  without granting general access outside managed project roots.
- `runManagedExecutionPayload()` holds a managed service's controller lease and
  terminates the detached service process group if that lease closes.
- `vite.config.mjs` temporarily preserves xterm identifiers and syntax because
  re-minifying xterm 6.0.0 breaks terminal query parsing under
  xtermjs/xterm.js#5800. Remove the workaround after Vibe64 upgrades to a fixed
  xterm release.
