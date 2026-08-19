# Source editing and change review

People can inspect and make focused source changes, see every file that differs
from saved project work, and inspect one exact file change at a time.

## Sources

- `packages/vibe64-source-editor/src/server/service.js`
- `src/composables/useVibe64SourceEditor.js`
- `src/components/studio/repository/Vibe64RepositoryWorkspace.vue`
- `src/components/studio/repository/Vibe64RepositoryDiff.vue`

## Public contract

The source browser lists, searches, opens, edits, and saves allowed project
files inside the selected session source. It rejects paths outside that source
and reports concurrent changes rather than silently overwriting them. The
Repository presents the session's complete current changes against saved project
work, even when those changes are already committed inside the session. It can
open an exact changed file without exposing staging mechanics to the user.
