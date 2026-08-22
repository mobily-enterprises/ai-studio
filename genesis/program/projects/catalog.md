# Project catalog

People can create, select, and reopen the projects available to their Vibe64
workspace.

## Sources

- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/actions.js`
- `src/composables/useVibe64ProjectsResource.js`

## Public contract

The catalog lists stable project identities, creates blank or trusted-template
projects, and selects one project as the current context. Project creation
produces a real Git source and Genesis foundation before a coding session uses
it. Selection changes the active project without rewriting its application
source. A hosted project namespace may contain repository mirrors and session
state without itself being a Git worktree; only an explicit checkout is treated
as inspectable source.
