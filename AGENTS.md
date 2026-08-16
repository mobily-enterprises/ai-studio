# Vibe64 Agent Notes

This repository is implemented with JSKIT runtime APIs and package-owned source
patterns, but the product is Vibe64. There is no current JSKIT CLI. Use the
repository's npm scripts and the installed JSKIT skill and patterns for
maintenance and verification.

Important boundaries:

- `/home/merc/Development/current/vibe64` is the writable public Vibe64 source of truth.
- `/home/merc/Development/current/vibe64-online/submodules/public-vibe64-local-editor` is a deployment-managed read-only submodule mirror. Do not edit, commit, or deploy from inside that submodule.
- To deploy editor changes: change, commit, and push `/home/merc/Development/current/vibe64`; then update, commit, and push `/home/merc/Development/current/vibe64-online`; then run `npm run deploy` from `/home/merc/Development/current/vibe64-online`.
- Genesis owns project intent, technology guidance, explanatory Program, agent skills, hooks, verification guidance, and Machine/Program Cities. Its portable files live below `genesis/`, `.genesis/`, `.agents/skills/`, and `.codex/hooks.json`.
- `vibe64.project.json` and `vibe64.runtime-lock.json` are unsupported obsolete contracts. Do not recreate or read them.
- `.vibe64/` is not product, prompt, Stack, Program, indexing, or City authority. Keep only narrowly declared application helpers such as a Genesis Launch preview-identity executable when required.
- Runtime/session state is Vibe64-owned runtime-local state, not source-owned repository content.
- Do not create loose workboard files.
- Do not restore `jskit doctor`, generator commands, scaffold provenance,
  receipts, migration copies, or CLI-managed CI state. Verify current source,
  runtime behavior, package boundaries, and tests through their direct owners.
- Never deploy unless the user explicitly requests deployment.

## Known Session Defects To Fix

These defects were reproduced on the hosted `sas/dogandgroom` session
`2026-08-15_01-59-27` on 2026-08-15. Do not lose them during the Genesis-first
session rewrite:

- Direct chat can continue successfully while a stale
  `step-state/<current-step>` record remains `waiting_for_input` with
  `source: system_recovery`. The UI then incorrectly shows “This session needs
  recovery”. Goal state and direct-chat delivery must have one unambiguous
  owner, and successful later delivery must supersede any stale recovery
  marker without deleting or restarting the Codex thread.
- Session source permissions must be correct when files are created. Every
  hosted writer enters through the shared `vibe64` group with umask `0007`, and
  managed project roots are setgid and carry the mandatory inherited default
  group ACL. Do not add recursive permission repair after Git, agent, package,
  or preview work; a host that cannot satisfy the creation-time contract must
  fail before work begins. The incident evidence, exact modes, ACLs, and
  cross-identity verification requirements are durable in
  `docs/managed-session-filesystem-contract.md`.
