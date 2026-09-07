# Direct agent conversation

People work with the coding agent through one ordinary project conversation,
including follow-up guidance while a turn is active.

## Sources

- `packages/vibe64-core/src/server/sessionRealtimeEvents.js`
- `packages/vibe64-sessions/src/server/inputSchemas.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-sessions/src/server/sessionMessageSuggestions.js`
- `packages/vibe64-runtime/src/server/sessionStore.js`
- `packages/vibe64-runtime/src/shared/conversationAttachments.js`
- `packages/vibe64-runtime/src/shared/assistantSelection.js`
- `packages/vibe64-runtime/src/shared/agentSettings.js`
- `packages/vibe64-runtime/src/shared/promptHints.js`
- `packages/vibe64-runtime/src/server/codexAppServerProvider.js`
- `packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js`
- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-genesis/src/server/promptContext.js`
- `packages/vibe64-runtime/src/server/codexSessionCommandHook.js`
- `packages/vibe64-execution/src/host/execHelper.js`
- `packages/vibe64-execution/src/server/engines/helperClient.js`
- `packages/vibe64-terminals/src/server/agentCommandEnvironment.js`
- `packages/vibe64-terminals/src/server/agentSessionCommand.js`
- `packages/vibe64-terminals/src/server/conversationActor.js`
- `packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js`
- `packages/vibe64-terminals/src/server/agent/providers/codexSessionAgentProvider.js`
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
- `src/composables/useVibe64ConversationLog.js`
- `src/composables/useVibe64PromptHints.js`
- `src/components/studio/Vibe64CodexSession.vue`
- `src/components/studio/Vibe64InteractiveTerminal.vue`
- `src/components/studio/Vibe64OpenCodeSession.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64ConversationLog.vue`
- `src/components/studio/vibe64-session/Vibe64ConversationAttachments.vue`
- `src/components/studio/vibe64-session/Vibe64PromptHints.vue`
- `src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue`
- `src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue`
- `src/lib/vibe64ChatMessage.js`
- `src/lib/vibe64WelcomeName.js`
- `vite.config.mjs`

## Public contract

The conversation accepts messages, structured answers, attachments, and
steering guidance. It streams commentary and the final response, persists the
conversation in order, restores it after reconnection, and lets the person
interrupt the current turn without deleting the session. Agent questions may
be answered as free text or through suggested choices while the submitted
reply remains ordinary conversation text.
An empty conversation's welcome can use a host-provided reactive name for the
current person. Without that presentation provider it uses the standalone
personal profile. An explicitly empty host name stays generic instead of falling
back to an unrelated profile. This name changes only the welcome, not authored
messages or saved conversation history.
An explicit Possible answers block remains one selectable answer group when
explanatory prose or a numbered recommendation list appears before it. Only
actual numbered questions become separate required fields, so ordinary
numbered content retains its normal Markdown presentation.
When canonical session state reports a completed turn that was not observed
through realtime conversation delivery, the mounted conversation rereads its
durable history. A missed notification therefore cannot leave a completed
answer absent until the person sends another message.
Session and terminal services share one session-event publisher. Each event
carries its trusted project identity, allowing the host to authorize delivery
before conversation patches reach a socket. Mutation services own completion
events; action declarations do not publish the same completion again. Lifecycle
progress remains separate from completion.
Long user messages remain available in full but initially use a compact preview
that each reader can expand or collapse.
Sent attachments remain distinct from the person's message as compact,
read-only file details. Their safe file names and sizes remain durable with the
conversation, while temporary provider paths stay out of visible history.

When a host reserves an AI connection for its owner, collaborators can submit
message suggestions for the owner's approval or dismissal. A new suggestion
and each owner decision capture that person's preferred name, falling back to
their trusted account name. Those stored names do not change when a person
later edits their preference. Normal approved delivery sends the authored
message unchanged; its visible attribution names the author and approving owner.
Each approval checks its current caller, including requests that arrive while
an owner's delivery is already pending. Duplicate owner approvals share that
delivery; a failed delivery remains retryable with the same provider message id.

Vibe64 expands the session's opening project request with Genesis guidance once.
Ordinary follow-ups and active-turn steering remain ordinary conversation
instead of regenerating that complete prompt. An explicit Deslop request uses
the same visible message-delivery path with a narrow task marker so Genesis can
compose its committed-scope cleanup instructions for that turn.

If an inactive conversation still names a Codex thread that the provider
reports as exactly missing, the next message enters the established thread
replacement path. Vibe64 records the replacement, restores the durable visible
conversation into the new provider thread, and then delivers that message once.
An active turn and unrelated invalid provider requests remain failures rather
than being reinterpreted as missing history.

Separately, Genesis composes one stable session context containing its project,
Engineering, and Collaboration guidance plus Vibe64's main-conversation rules.
Codex installs it as thread instructions and OpenCode keeps it in the system
context through Genesis's ordinary project plugin. It creates no conversation
message or additional agent turn. Collaboration changes become current only
when that stable context is next established or refreshed; Codex cannot replace
developer instructions inside an already-live thread.
The provider may serialize its system or developer instructions again for a
later stateless model request, but Vibe64 does not rerender them into the
person's message or copy them into the turn-context lane.

Non-project, tool-free conversations have no Genesis project plugin. OpenCode's
host plugin therefore installs their validated, host-supplied context directly
in the system lane, replacing coding-agent defaults for that exact native
conversation only. It reads the current context on each model request so a
refreshed host snapshot takes effect without adding a user message. Ordinary
project conversations keep their existing Genesis prompt lifecycle.

Every real human turn keeps the person's authored text unchanged. Vibe64 adds
no turn context: no name, actor id, policy identifier, tone, response length,
experience, explanation style, project note, question format, or concealment
instruction. Genesis retains a generic bounded turn-context capability for
hosts that need one, but Vibe64 deliberately does not use it. When Codex mirrors
a user message entered through its native terminal into Vibe64 History, that
history item inherits the actor metadata from the latest Vibe64 UI message.
This attribution is internal conversation data and is never sent to the model.

Message delivery and provider work remain visibly distinct. The composer shows
the initial send while the message is being accepted, then reports the selected
assistant as working for the rest of the active turn. The session tab and
assistant avatar use that same live turn state until completion or interruption.
If message delivery fails, the exact error belongs to the failed message with
its Resend, Cancel, and Edit actions inside the scrollable conversation. The
composer does not repeat that raw error below its input or let it displace the
chat layout. If the server disappears after claiming a prompt but before the
provider creates a turn, Vibe64 fails the expired unowned claim automatically
so the next message can start normally.
When an OpenCode provider reports successful completion without a user-facing
response, Vibe64 makes one bounded continuation request for that response. If
the provider again returns no response, the turn fails visibly instead of
appearing to have completed silently.

The chat cog opens a compact selector for the AI used by that session. It shows
only currently connected providers and currently available models, chooses a
compatible conversation agent automatically, and offers the selected model's
thinking choices when present. If a saved model is no longer available, the
draft shown in the cog moves to that provider's available default, then its
first available model, for the person to apply explicitly. If the saved provider
itself is unavailable, the draft offers a connected provider within the same
session engine and explains that Apply is required to reconnect. It never saves
that replacement merely because the picker opened. Up to six models
remain immediate buttons; a longer provider list becomes one searchable
autocomplete so the selector stays compact. When a host
exposes configurable model access, the owner sees the same warned unlock switch
as account settings. The cog also exposes a direct return to the host's
recommended model; relocking first moves the current session to that model, and
a session whose prior model was already relocked can still recover because the
target selection is checked independently. A provider-default thinking choice
delegates that setting to the provider instead of substituting another listed
choice.
Hosts may mark account-wide access controls as management-only; only their
enabled model results appear in the cog, while the control itself remains on
the host's account-management surface.
The new-session AI chooser is a separate, preloaded view of Vibe64's saved AI
connections. It presents one choice for Codex when connected and one choice for
each saved OpenCode route, using each connection's verified default model. It
orders a host-designated preferred provider first, so that choice is selected
when the dialog opens. It does not start OpenCode or read OpenCode's provider
and model catalogue when
the chooser opens or when the session is created; creation validates the
selection against the same saved connection view. A session keeps the
assistant engine that owns its native history: Codex cannot be changed to
OpenCode or vice versa. The explicitly opened chat selector may load a complete,
compatible model choice within that fixed engine. It remains available for
inspection during an active turn, but can apply a choice only between turns.
Merely opening or creating a session does not load that catalogue. Distinct
OpenCode provider ids remain
distinct choices, so separate routes or plans from one provider can coexist and
be selected independently without becoming Codex. People can choose among
already connected AIs even when they cannot manage account connections; only
people who can manage connections see the shortcut to configure more. Loading,
retryable failures, and the absence of a connected AI remain visible in the
relevant selector.

Codex model choices use the running provider's paginated `model/list` catalogue,
including its display names and supported reasoning efforts. If no Codex service
is running, discovery starts one temporarily and verifies its shutdown before
returning. Configured-only new-session choices retain the configured default
without model discovery. Selected model and reasoning ids survive persistence
and turn mapping unchanged; selection validation uses the live catalogue.

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

Opening the selected session view prepares that session's chosen provider and
native thread without sending a model prompt or loading the provider catalogue.
Creating a session by itself does not start a provider. Open sessions in one
workspace share a single running Codex service and a single running OpenCode
service according to the assistant each session has selected. Codex and
OpenCode remain independent: a provider service runs while
at least one matching session is open and stops after the final matching
session closes. On a managed host, the provider also remains attached to the
exact Vibe64 server controller that started it; if that controller disappears,
the provider's complete process tree stops rather than surviving as an orphan.
An OpenCode cold start gets one full readiness window rather than churning
through short-lived replacement processes. Prompt admission still happens only
after that service is ready. An immediate first message joins the same in-flight
provider and native-session preparation instead of starting either operation
again. A startup failure remains attached to the unsent message as a readable
retryable error rather than becoming a generic server response.
Conversation identity, working directory, command environment,
model settings, and provider history remain session-specific even though the
resident provider process is shared. Capability discovery without an open
session may run a bounded command but does not leave another provider service
running. OpenCode and Codex shell commands and any descendants they leave
running are attributed to the originating project session through their
ordinary provider command boundaries, and closing that session drains those
descendants.

Contextual prompt suggestions may preview their full text in an otherwise empty
composer without modifying the draft. Showing or hiding that preview preserves
the composer's geometry, while text the person actually enters still grows the
composer normally. Selecting a suggestion inserts ordinary editable text.
Suggestions must form a complete set of three valid, distinct label/prompt
pairs. Malformed or overfull responses are ignored, not displayed as a filtered
subset. The browser and server share the same normalization contract.

If an OpenCode provider later rejects a previously saved key, the failed turn
records a durable recovery notice that links the owner to AI Accounts without
exposing the raw provider credential error. Other structured OpenCode API
failures preserve the readable provider message and add the same durable
account-management route. Existing conversation and project changes remain
available for either failure, and the person can retry after the account is
recovered. Other OpenCode turn failures preserve their readable error in a
durable conversation notice without sending the person to account settings.

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
  each session's working and command boundary. The shared process receives
  only Vibe64's bundled Genesis executable path; the environment plugin adds
  each session's command paths and private control identity when that session
  executes a tool.
- `safeOpenCodeEnvironment()` retains project configuration and plugins while
  disabling OpenCode's unrelated default plugins and loading Vibe64's
  session-environment plugin for command routing. It raises OpenCode's response
  and compaction ceiling only alongside that host plugin.
- `readOpenCodeCatalog()` starts a bounded temporary OpenCode service and reads
  its complete provider and agent APIs while the resident session service stays
  asleep. Its non-secret Zen `public` identity makes paid-model metadata visible
  without loading an owner's saved key. The client allowlists safe provider and
  model capability fields before they can enter the catalogue cache. That
  metadata is reconciled with the ids from Zen's bounded, credential-free
  public model endpoint before presentation or verification; a newly advertised
  id absent from the pinned metadata receives only a minimal safe fallback. The
  temporary service must be proven stopped before the result is returned.
- `openCodeConfiguredAssistantCapabilities()` projects saved connection labels,
  access descriptions, preferred-provider status, and verified default models
  into the new-session choices
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
  boundary before execution, and Codex's `PreToolUse` hook routes Bash commands
  through the same broker. The broker environment applies the same desktop
  message-bus exclusion so a session-owned descendant remains inside its
  managed execution scope.
- `Vibe64SessionRuntimeHost` selects exactly one interactive terminal from the
  session's immutable engine id and has no cross-engine fallback.
- `Vibe64SessionRuntime.renderPrompt()` owns Genesis prompt composition.
  Codex and OpenCode call it for the opening request and an explicitly marked
  Deslop request; later ordinary messages are sent without rebuilding the full
  Genesis prompt, and Codex steering continues through its existing direct
  steer path.
- `composeVibe64SessionContext()` uses one provider-neutral, session-only
  Vibe64 driver through Genesis for stable Vibe64 conversation rules.
- `sendCodexAppServerPromptForSession()` and `stablePromptBody()` preserve the
  authored user text without attaching Vibe64 turn context.
- `writeMirroredCodexAppServerTerminalMessage()` copies the latest prior UI
  user's existing actor metadata onto a native-terminal user item in History;
  it does not alter provider input.
- `sendCodexAppServerMessage()` recognizes only the provider's exact
  missing-thread response for an inactive conversation and routes it through
  `ensureCodexAppServerThreadForSession()` so its existing replacement,
  durable-history recovery, and identity update complete before the pending
  message starts the new ordinary turn.
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
