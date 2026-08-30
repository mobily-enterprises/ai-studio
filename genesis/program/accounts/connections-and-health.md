# Accounts, connections, and Studio health

People can connect the external accounts needed for agent and repository work
and see whether the Studio host is ready to support them.

## Sources

- `packages/vibe64-accounts/src/server/service.js`
- `packages/vibe64-accounts/src/server/Vibe64AccountsFeature.js`
- `packages/vibe64-accounts/src/client/composables/useAccountAuthSessions.js`
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
