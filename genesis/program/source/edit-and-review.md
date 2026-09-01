# Source editing and change review

People can inspect and make focused source changes, see every file that differs
from saved project work, and inspect one exact file change at a time.

## Sources

- `packages/vibe64-source-editor/src/server/service.js`
- `packages/vibe64-terminals/src/server/sessionWorkOperationCommand.js`
- `packages/vibe64-terminals/src/server/sessionWorkSave.js`
- `src/composables/useVibe64SourceEditor.js`
- `src/composables/useVibe64RepositoryWorkspace.js`
- `src/composables/useVibe64SessionRuntimeHost.js`
- `src/components/studio/repository/Vibe64RepositoryWorkspace.vue`
- `src/components/studio/repository/Vibe64RepositoryDiff.vue`
- `src/lib/vibe64RepositoryRealtime.js`

## Public contract

The source browser lists, searches, opens, edits, and saves allowed project
files inside the selected session source. It rejects paths outside that source
and reports concurrent changes rather than silently overwriting them. The
Repository presents the session's complete current changes against saved project
work, even when those changes are already committed inside the session. It can
open an exact changed file without exposing staging mechanics to the user.
Current changes refreshes when an assistant turn becomes idle and when Vibe64
observes editor, Save, or repository-status events, so work completed during a
turn appears without a manual reload. Arbitrary filesystem writes that produce
none of those events are not promised to appear immediately.
Current Changes first renders from the last locally proven canonical version
while Vibe64 checks the configured GitHub, managed-Git, or local-repository
authority in the background. Save remains unavailable until that authority
check succeeds. The initially selected file difference comes from the same
immutable worktree snapshot as the file list.

## Implementation map

- `runSessionWorkOperation()` admits each Current Changes, file-diff, work-state,
  or update-check request as one managed job. `sessionWorkOperationCommand.js`
  performs that request's exact Git queries inside the admitted child instead
  of paying managed-host admission cost for every individual Git command.
- `refreshWorkState(observedWork)` accepts the complete work-state snapshot
  already returned by Current Changes, so the selected session's Save or Update
  control does not immediately repeat the same repository inspection.
- Current Changes calculates its initial selected-file difference inside the
  file-list managed job, reusing that job's exact worktree tree instead of
  admitting and scanning the worktree a second time.
- Concurrent update checks for one session share the same exact server
  operation, and repeated repository refresh events collapse into one bounded
  follow-up Current Changes inspection.
