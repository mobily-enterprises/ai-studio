# Source editing and change review

People can inspect and make focused source changes, see every file that differs
from saved project work, and inspect one exact file change at a time.

## Sources

- `packages/vibe64-source-editor/src/server/service.js`
- `packages/vibe64-terminals/src/server/sessionWorkOperationCommand.js`
- `packages/vibe64-terminals/src/server/sessionWorkSave.js`
- `src/composables/useVibe64SourceEditor.js`
- `src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue`
- `src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue`
- `src/composables/useVibe64RepositoryWorkspace.js`
- `src/composables/useVibe64SessionRuntimeHost.js`
- `src/components/studio/repository/Vibe64RepositoryWorkspace.vue`
- `src/components/studio/repository/Vibe64RepositoryDiff.vue`
- `src/lib/vibe64RepositoryRealtime.js`

## Public contract

The source browser lists, searches, opens, edits, and saves allowed project
files inside the selected session source. It rejects paths outside that source
and reports concurrent changes rather than silently overwriting them. The
source editor publishes successful creates and saves with project, session,
path, hash, and originating-tab identity. A foreign create refreshes the file
tree, while a foreign save refreshes a clean matching file or warns without
overwriting a dirty draft.

A source explanation is temporary assistance for a selected code range or file.
A matching cached answer can appear without starting a provider conversation;
its first follow-up starts an independently owned conversation through the same
verified low-cost execution profile. The server retains source, account, profile,
and conversation authorization. The browser submits the explanation identity
and question, not a provider thread or model configuration. Failed conversations
offer regeneration instead of another follow-up; unavailable assistants leave
the existing answer readable with generation and follow-up actions disabled.
Stop targets the selected explanation. Closing keeps its answer visible and
disables conflicting actions until cleanup is acknowledged. Failed cleanup
retains the answer and reports action feedback so Close can be retried. Changing
session or unmounting releases the old stream's pending browser state; a late
Stop response, cleanup result or streamed event cannot reopen that explanation
or overwrite a newer request, including a follow-up in the same conversation.

The Repository presents the session's complete current changes against saved project
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

- The source-editor service owns explanation cache lookup, temporary conversation
  creation and cleanup. `useVibe64SourceEditor()` owns the selected explanation,
  request generation, streamed messages and acknowledged Close state;
  `Vibe64SourceExplanationPanel` presents the answer, follow-up, cancellation
  and recovery controls. An answered cache record does not need a thread id to
  enable its first follow-up.
- `runSessionWorkOperation()` admits each Current Changes, file-diff, work-state,
  or update-check request as one managed job. Canonical Save uses one managed
  checkpoint-and-summary job before commit naming and one managed
  publish-and-reconcile transaction under the project source lock.
  `sessionWorkOperationCommand.js` performs each operation's exact Git work
  inside its admitted child instead of paying managed-host admission cost for
  every individual Git command.
- `refreshWorkState(observedWork)` accepts the complete work-state snapshot
  already returned by Current Changes. The runtime host also projects Save and
  Update task events directly from the mounted realtime session, so visible
  progress does not wait for repository inspection behind an active source
  lock.
- Current Changes calculates its initial selected-file difference inside the
  file-list managed job, reusing that job's exact worktree tree instead of
  admitting and scanning the worktree a second time.
- Concurrent update checks for one session share the same exact server
  operation, and repeated repository refresh events collapse into one bounded
  follow-up Current Changes inspection.
