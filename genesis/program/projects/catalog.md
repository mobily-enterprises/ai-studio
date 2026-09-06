# Project catalog

People can create, select, and reopen the projects available to their Vibe64
workspace.

## Sources

- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/managedProject.js`
- `packages/vibe64-genesis/src/server/index.js`
- `src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue`
- `packages/vibe64-core/src/server/studioProjectContext.js`
- `src/composables/useVibe64ProjectsResource.js`
- `src/composables/useProjectSelectionGate.js`

## Public contract

The catalog lists stable project identities, creates projects, and selects one
project as the current context. The default creation path produces one real Git
commit containing a technology-neutral, current-format Genesis foundation; a
trusted technology template is materialized only when a caller selects it
explicitly. Selection changes the active project without rewriting its
application source. A hosted project namespace may contain repository mirrors
and session state without itself being a Git worktree; only an explicit checkout
is treated as inspectable source.

The Preview pane uses Genesis's read-only inspection of the current session:
empty/bootstrap source offers explicit starter choices or conversation; existing
source without a completed Genesis description asks what the project does;
current described projects show their outputs; outdated or incomplete Genesis
configuration shows the specific repair needed. Missing Genesis files never
authorize overwriting an existing application.

Starter catalogues are owned by Genesis and map a namespace-qualified choice to
one technology repository and branch. Applying a choice uses the ordinary
session and project source-write locks, preserves Git history and existing
bootstrap preferences, and leaves the added source for the normal Save flow.
The browser sends only the selected catalogue ID. Neither session startup nor
inspection runs application verification or workspace preparation.

The hosted project namespace is the catalog authority. When that namespace has
been removed outside Vibe64, the next catalog read removes its stale private
project state so the deleted project cannot remain or block recreation. If it
was selected, that read retires the selection as well; an explicit external
source folder remains independent of the hosted catalog. Cleanup rechecks the
exact namespace before deleting suspected orphan state, and a listing cannot
retire a different target selected while it was reading.

Durable project mutations publish one shared project refresh event. Consumers
use it only to invalidate their project list, selection, settings, repository,
or access reads; the HTTP resources remain authoritative.
The routed shell and selection gate share the query for that route's scoped
project response. The gate owns its refresh-event subscription and invalidates
that shared query once, even while both readers are mounted. Its cache identity
remains separate from the global catalog, whose selected project may differ
from the current browser route.
Runtime lifecycle publication uses that same project-event owner. Deletion
publishes only a catalog refresh hint, so clients can remove a deleted project
without exposing its former identity to a broader audience.
