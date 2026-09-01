# Project catalog

People can create, select, and reopen the projects available to their Vibe64
workspace.

## Sources

- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/managedProject.js`
- `packages/vibe64-project/src/server/projectFoundation.js`
- `src/composables/useVibe64ProjectsResource.js`

## Public contract

The catalog lists stable project identities, creates projects, and selects one
project as the current context. The default creation path produces one real Git
commit containing a technology-neutral, current-format Genesis foundation; a
trusted technology template is materialized only when a caller selects it
explicitly. Selection changes the active project without rewriting its
application source. A hosted project namespace may contain repository mirrors
and session state without itself being a Git worktree; only an explicit checkout
is treated as inspectable source.
