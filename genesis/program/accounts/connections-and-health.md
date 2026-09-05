# Accounts, connections, and Studio health

People can connect the external accounts needed for agent and repository work
and see whether the Studio host is ready to support them.

## Sources

- `packages/vibe64-accounts/src/server/service.js`
- `packages/vibe64-accounts/src/server/Vibe64AccountsFeature.js`
- `packages/vibe64-accounts/src/client/composables/useAccountAuthSessions.js`
- `packages/vibe64-execution/src/server/engines/helperClient.js`
- `packages/vibe64-runtime/src/shared/assistantSelection.js`
- `packages/vibe64-sessions/src/server/registerRoutes.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js`
- `packages/vibe64-terminals/src/server/codexTerminal.js`
- `packages/vibe64-terminals/src/server/opencodeServerClient.js`
- `packages/vibe64-terminals/src/server/opencodeServerProcess.js`
- `packages/vibe64-terminals/src/server/opencodeTerminal.js`
- `packages/vibe64-terminals/src/server/service.js`
- `packages/studio-health/src/server/service.js`
- `src/components/studio/StudioHealthScreen.vue`

## Public contract

The Accounts surface reports required providers, guides supported sign-in, and
keeps credentials in host-owned storage. Studio health performs read-only checks
of workspace access, account readiness, command-line tools, Genesis, and the
managed browser runtime. Failures identify the concrete host capability that is
missing without attempting project-specific repairs.

Account sign-in completion arrives through realtime events when available. A
bounded fallback check remains available for missed events, but repeated
failures back off instead of keeping the browser in a tight retry loop.

Account sign-in and sign-out are account-wide operations and do not require a
selected project. When Codex authentication changes, Vibe64 retires active and
detached owned Codex runtimes before accepting the new account state. It reports
success only after process exit is verified; a runtime that cannot be proven
stopped leaves the account transition visibly unsuccessful rather than allowing
an old credential-bearing process to survive silently.

The assistant-capability service can read the complete provider registry from
the pinned OpenCode runtime without a project or configured provider
credentials. It starts a temporary credential-free OpenCode service, reads the
native provider and agent APIs, proves that service stopped, and removes its
private state. Provider data is allowlist-sanitized before caching: consumers
receive exact provider ids, native defaults, safe model capabilities and limits,
definition revisions, and whether Vibe64's one-key connection flow is
compatible, but never raw environment names, credentials, request options,
headers, costs, or upstream connection state. Malformed and empty registries
fail instead of becoming an authoritative empty catalogue.

For OpenCode Zen, Vibe64 also reads Zen's official public `/v1/models` endpoint
and intersects those current ids with the pinned runtime's sanitized metadata.
The bounded request sends no provider credential, and a failed or malformed
response remains a retryable catalogue failure instead of exposing stale Zen
models. This live Zen result shares the existing short-lived catalogue cache;
it is loaded only by explicit full-catalogue operations, never by opening or
creating a session or sending its first message.

The host may contribute redacted connection metadata that marks a connection
as built in, identifies the preferred new-session provider, and restricts it to
one recommended model or a finite enabled-model allowlist. The sanitized
catalogue keeps other live models visible with a locked status and host-supplied
explanation, while selection resolution accepts only available models. A
generic owner-authenticated model-access operation delegates a warned unlock or
relock to the host; a host may reserve more involved account-management actions
for its own management surface. Public Vibe64 does not name a private provider
policy or store provider credentials. Runtime admission remains a separate host
check, so a durable selection cannot bypass a later restriction.

The short-lived credential-free catalogue snapshot is independent of
credential-bearing assistant runtimes. Replacing or removing a connection
still retires those runtimes, but does not discard an unexpired catalogue and
force an otherwise redundant cold discovery.

A host may ask Vibe64 to verify one exact OpenCode provider, model, and API key.
Vibe64 first checks that provider and model against the same current catalogue,
including Zen's live model ids for the native Zen provider, then runs one
finite, tool-free request with a tiny output allowance
in isolated temporary credential storage. Provider rejection is distinct from
a stale catalogue or unavailable managed execution, error details do not expose
the submitted secret, and the temporary credential state is removed on every
outcome. No provider URL override is required: the pinned OpenCode runtime owns
its native provider destinations.
