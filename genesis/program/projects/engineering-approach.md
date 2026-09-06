# Choose an engineering approach

People can choose how cautiously the AI changes a project without turning that
choice into machine-local Vibe64 metadata.

## Sources

- `packages/vibe64-genesis/src/server/index.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/registerRoutes.js`
- `packages/vibe64-project/src/server/service.js`
- `src/components/studio/ProjectSettingsPanel.vue`
- `src/lib/studioGateApi.js`

## Public contract

Project settings presents the versioned profile names and descriptions supplied
by the exact pinned Genesis contract. Vibe64 does not duplicate that catalog or
interpret its guidance. A selection changes `genesis/engineering.md` in the
standalone source or the chosen hosted session source, so it follows ordinary
source history; Genesis preserves any project-specific requirements already in
that document.

Refreshing the same source preserves an unsaved profile choice. Selecting a
different project or source loads that source's choice instead. Save remains
pending until its canonical refresh finishes, so a newly enabled choice cannot
be overwritten by the previous save's refresh. Project-change events received
while the save request is pending defer to that refresh, including after a
failed save. Events received during or after the refresh remain eligible to
reload the current source.
Save failures use the shared action feedback and keep the selection retryable,
without also opening an unexpected-UI-error dialog. A failed canonical read
uses the existing settings error and Retry view.

When a hosted project has no available source, the setting stays visibly
unavailable instead of treating the project metadata namespace as source. An
active session is selected automatically when needed, then recorded in the URL
so navigation retains the same source context. Writes share the existing agent
and project-source exclusion boundaries, preventing a profile change from
racing renewal or another source mutation.

Every profile retains Genesis's universal simplicity gate: changes remain easy
to reason about, minimal, and targeted, and the AI asks before a concrete need
forces materially greater complexity.

## Implementation map

- `inspectGenesisEngineering()` — accepts only the exact pinned Genesis contract.
- `engineeringProfileState()` — resolves a standalone or session source into the public settings view.
- `saveEngineeringProfileState()` — serializes the source-owned selection and returns its refreshed state.
