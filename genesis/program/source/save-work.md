# Save session work

People can deliberately publish the complete current session work to the
project's configured source authority without asking the coding agent to run
Git commands.

## Sources

- `packages/vibe64-terminals/src/server/sessionWorkOperationCommand.js`
- `packages/vibe64-terminals/src/server/sessionWorkSave.js`
- `packages/vibe64-sessions/src/server/service.js`
- `src/components/studio/Vibe64TemporaryActionTerminal.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/composables/useVibe64AutopilotView.js`

## Public contract

Save captures tracked, staged, unstaged, and relevant untracked session work,
asks the session's selected assistant to give that exact checkpoint a concise
commit subject, and publishes one ordinary commit to the exact configured
GitHub, managed-Git, or local-source authority. It refuses ambiguous authority,
changed session history, dirty local authority, or a moving canonical branch.
Worktree edits made after capture are left as unsaved work on top of the named
checkpoint. The non-force publication itself rejects a stale concurrent
publisher; Save does not inspect sibling worktrees first. Progress and bounded
command output remain visible across reloads. A verified publication advances
the session baseline and preserves any later session edits; an interrupted
Save is reconciled only when the canonical authority proves the privately
recorded prepared commit was already published. Disposable GitHub mirror
maintenance runs after Save completes and cannot change the Save result.

While Save runs, the workspace shows one compact progress line. Opening its
details reveals the bounded command progress; while work is active, Collapse
returns to the compact line and Dismiss is unavailable. After the operation
finishes, Dismiss removes it. The browser remembers a dismissal across reloads
for that exact Save or Update attempt without changing its result; a new attempt
is visible again. A successful Save disappears on
completion; a failed Save remains visible with its recovery actions until
dismissed. The selected session's icon-only Save or Update action stays in the
chat header beside the session it will affect, rather than occupying the
application-wide toolbar.

Each Save or Update attempt starts a fresh visible transcript. Retrying after a
failure does not mix the earlier attempt's errors into the new operation.

The current activity is causally bound to the Save or Update command the person
actually invoked. If admission fails before that command creates a durable
operation, the failure is shown without borrowing the label, icon, or transcript
of an older completed repository operation.

Assistant-write lock diagnostics use the normal service logger. Acquisition,
release, contention and rejection name the requesting operation, project and
session, and a unique attempt ID. A blocked request records the holder's
operation, attempt ID, PID, process-identity status, acquisition time and lock
age, together with its own wait budget and elapsed wait. These log records
survive removal of the live lock directory. Named operations include Save,
Update, assistant verification, temporary chat, source editing and preparation.
Waiting emits one initial contention event and a final acquisition or rejection,
not an event for every poll. Prompts, file contents, credentials and the private
lock-release token are excluded. Diagnostics do not change admission or retries.
Contention and rejection are warnings, retained at the default log level;
acquisition and release are informational events.

After a reload, current activity is restored only from the server's exact live
operation identity. Durable task status and timestamp order are not treated as
proof that an operation is still running; interrupted work is reconciled by the
server before it reports the session state. Completed task records remain
diagnostic history and are never selected as current activity.

After a successful reconciled Save, the chat offers a behavior-preserving
Deslop of that exact published commit. Accepting sends one ordinary visible
message through the session's existing assistant path; declining only hides the
offer and records no preference. A Save that still needs reconciliation does
not offer cleanup yet.

## Implementation map

- `packages/vibe64-execution/src/server/gitTurnCheckpoint.js` captures private,
  non-advertised worktree checkpoints without changing the user's index. Each
  checkpoint retains the preceding checkpoint as recoverable history while its
  tree reflects the current saveable worktree, so a newly ignored local file is
  left on disk without remaining in later checkpoint trees.
- `packages/vibe64-project/src/server/projectSourceMutationLock.js` serializes
  canonical source mutations across processes.
- `scopedSessionWorkCommand()` assigns one semantic operation identity plus
  project and session ownership to repository operations. Inspection and update
  checks enter the managed host once through `runSessionWorkOperation()`. Save
  uses one managed checkpoint-and-summary job before its temporary naming turn
  and one managed publish-and-reconcile transaction under the project source
  lock. A deterministic private prepared-commit ref supplies restart evidence;
  disposable mirror refresh is deferred until after Save.
