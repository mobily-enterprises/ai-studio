# Save session work

People can deliberately publish the complete current session work to the
project's configured source authority without asking the coding agent to run
Git commands.

## Sources

- `packages/vibe64-terminals/src/server/sessionWorkSave.js`
- `packages/vibe64-sessions/src/server/service.js`
- `src/components/studio/Vibe64TemporaryActionTerminal.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`

## Public contract

Save captures tracked, staged, unstaged, and relevant untracked session work,
preserves non-conflicting canonical changes, and publishes one ordinary commit
to the exact configured GitHub, managed-Git, or local-source authority. It
refuses ambiguous authority, overlapping sibling work, conflicting changes,
dirty local authority, or a moving canonical branch. Progress and bounded
command output remain visible across reloads. A verified publication advances
the session baseline and preserves any later session edits; an interrupted Save
is reconciled only when the canonical authority proves the prepared commit was
already published.

While Save runs, the workspace shows one compact progress line. Opening its
details reveals the bounded command history and keeps it available after Save
finishes until hidden. A successful Save left compact disappears on completion;
a failed Save remains visible with its recovery actions. The selected session's
icon-only Save or Update action stays in the chat header beside the session it
will affect, rather than occupying the application-wide toolbar.

## Implementation map

- `packages/vibe64-execution/src/server/gitTurnCheckpoint.js` captures private,
  non-advertised worktree checkpoints without changing the user's index.
- `packages/vibe64-project/src/server/projectSourceMutationLock.js` serializes
  canonical source mutations across processes.
- `scopedSessionWorkCommand()` assigns one semantic operation identity plus
  project and session ownership to the commands used by inspection, update,
  Save, and recovery, and runs those commands in sequence so one operation does
  not compete with itself for host admission.
