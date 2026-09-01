# Workspace preparation

Vibe64 can prepare a fresh session source using its exact Workspace setup
contract transported by the project's Stack.

## Sources

- `packages/vibe64-terminals/src/server/workspaceSetup.js`
- `packages/vibe64-sessions/src/server/service.js`
- `packages/vibe64-genesis/bin/genesis`
- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-genesis/src/server/workspaceSetup.js`
- `src/components/studio/Vibe64TemporaryActionTerminal.vue`
- `src/components/studio/Vibe64TemporaryAiFixAction.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue`
- `src/composables/useVibe64AutopilotView.js`
- `src/composables/useVibe64TemporaryAi.js`

## Public contract

`vibe64.workspace-setup.v1` is the only accepted schema. Its source is strict,
readable Markdown: each `Prepare` entry declares a label, runtimes, optional
working directory and path condition, then separate backticked argv values.
Vibe64 parses that opaque Stack section mechanically and runs the normalized
argv with the project's resolved environment. It runs once for a fresh recipe,
records progress and exact recipe identity, waits before dependent work, and
exposes retry after failure. Missing or ambiguous declarations remain explicit;
Vibe64 never guesses an installer or reads a retired grammar.

If an explicit retry finds that Genesis recognizes the project as unversioned
or outdated and prescribes migration, Vibe64 runs its bundled `genesis migrate`
command through the same locked managed-source execution boundary. That command
declares both its Node and Git runtimes and receives the exact session source as
a Git-safe directory, so the managed daemon identity can inspect the
session-owned worktree without weakening Git policy elsewhere. Vibe64 records
the bounded output, re-inspects the resulting Stack contract, and then runs the
declared preparation recipe. It does not migrate a current, newer, invalid, or
otherwise unrecognized project merely because setup inspection failed.

During preparation, the workspace shows one compact progress line. Opening its
details reveals the bounded transcript and keeps it available after completion
until dismissed. The browser remembers that dismissal across reloads for the
exact preparation attempt without changing its result; a new attempt is visible
again. A successful preparation left compact disappears when it finishes; a
failure remains visible with direct Retry and Fix it with AI actions until
dismissed, without requiring the person to expand terminal details. Fix it
opens a workspace-writing Temporary AI task with the current diagnostic and
bounded transcript, selects and focuses that separate chat, and presents a
concise visible request instead of the complete operational prompt. A prominent
notice explains that Temporary AI may edit the session, that progress and
questions remain in this chat, and that Vibe64 will verify the result. Every
product surface that offers this ephemeral repair path uses the same Fix it with
AI control and handoff presentation.

After an accepted repair turn completes or fails, Vibe64—not the assistant—runs
the deterministic preparation retry and records its result. This includes a
provider timeout after edits may already have landed; an explicit user stop is
not treated as permission to retry. A repair that changed nothing simply
returns to the same authoritative setup failure. If the assistant needs human
input, that question remains in the temporary conversation instead of being
mistaken for a completed repair.
