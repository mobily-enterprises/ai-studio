# Database relationship exploration

The database diagram makes a session's refreshed schema navigable without
requiring every table and field to be read at once.

## Sources

- `packages/vibe64-database-tools/src/client/components/DatabaseErd.vue`
- `packages/vibe64-database-tools/src/client/components/DatabaseErdNode.vue`
- `packages/vibe64-database-tools/src/client/components/DatabaseErdEdge.vue`
- `packages/vibe64-database-tools/src/client/components/Vibe64DatabaseWorkspace.vue`
- `packages/vibe64-database-tools/src/client/composables/useVibe64DatabaseTools.js`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `packages/vibe64-database-tools/src/client/erdModel.js`
- `packages/vibe64-database-tools/src/client/erdRelationships.js`
- `packages/vibe64-database-tools/src/client/erdRouting.js`
- `packages/vibe64-database-tools/src/client/workers/erdLayout.js`
- `packages/vibe64-database-tools/src/client/workers/erdLayout.worker.js`
- `packages/vibe64-database-tools/src/server/sessionState.js`
- `packages/vibe64-database-tools/src/server/service.js`
- `packages/vibe64-database-tools/src/server/events.js`

## Public contract

Automatic database reads follow the visible Database pane. A retained hidden
workspace defers automatic table opening until it is active again, including
when schema data arrives after leaving. Returning to the same selected table
keeps its mounted SQL draft and results rather than running that table again.
When a command finishes after the workspace is hidden, its follow-up state
reload also defers to normal activation. The command keeps its result without
creating an unavailable-resource error behind the hidden pane.

Given the selected session's schema snapshot and its shared saved
diagram, the ERD starts in Keys only mode unless another mode was saved. All
columns, per-table expansion, and collapse change visible detail without moving
any table or changing the camera. Extra fields may overlap neighbouring cards;
they never trigger automatic arrangement, even for very large tables. Fit and
Reset positions remain explicit controls. Search finds
tables or columns, reveals the matching field, and centres its table. Selecting
a table highlights its immediate relationships and linked fields; Focus hides
everything except that table and its immediate neighbours. Open data retains
the database workspace's table-selection operation.

Connections point from referenced parent columns to child foreign-key columns.
Every pair in a composite foreign key is drawn and selects the same constraint.
Selected or hovered connections show endpoint multiplicity; the inspector lists
all field pairs and delete/update actions. Multiplicity derives from known
unique keys and nullability, never implies that a parent must have children,
and marks unknown nullability with `?`. Optional or unknown-requiredness links
are dashed. Collapsed tables use header ports instead of pretending their
hidden fields are visible.

Reset positions uses port-aware orthogonal layout within automatic relationship
neighbourhoods or user-named groups, packs those groups with space between them,
and separates disconnected tables. Named membership takes precedence over
automatic membership. Pinned tables cannot be dragged and retain their exact
positions on Reset; other cards are placed outside occupied bounds. Connection
routing also runs in the worker, keeping typing and navigation responsive while dense schemas are arranged. It checks clear corridors before
a bounded obstacle-grid search, avoids cards and penalizes shared
horizontal/vertical runs and crossings. A route that exhausts the search budget
remains visible with the same notice as an obstructed route. Enclosed endpoints
are detected without searching for an impossible path. The router does not promise a crossing-free graph or clear routes through overlapping
pinned cards. An obstructed-route notice explains how to recover. Worker
failures use an announced basic arrangement where available, or show an error
with Retry; they do not silently claim the recommended layout succeeded.

During dragging, incident paths use inexpensive temporary corridors while
unchanged unrelated routes remain stable. Pending worker updates are coalesced;
only the latest graph can be applied. Acknowledging an unchanged saved graph
does not reroute it or disable its controls. Drop reroutes paths obstructed by the moved
card and persists positions. Undo/Redo retains up to 30 diagram snapshots for
the mounted view, including moves, Reset, display/focus/group changes and
loading a saved view; it does not undo saving or deleting named views.

Up to 20 named views store positions, pins, groups, focus, column display, and
viewport. Saving an existing name replaces that view with a visible notice.
Views and the current layout belong to the session, not an individual user.
Positions, pins, groups, focus and display choices are saved in one shared
session artifact, separate from database tables and the schema snapshot. A
successful save publishes a project/session-scoped refresh hint. Other active
viewers reload protected state and apply the layout without saving it back;
hidden workspaces catch up on activation. A remote move leaves the viewer's
current camera and selection alone. Reload restores the shared saved zoom and
exact positions, even if cards overlap; automatic placement only moves new
tables unless Reset positions was requested. Writes are serialized and assigned
increasing revisions; older refreshes cannot replace newer acknowledged layouts. When no shared layout
exists, the first opened existing user diagram is adopted into the shared
artifact; old artifacts remain recoverable but cannot override it afterwards.
SQL history and snippets remain user-specific. Fullscreen keeps
controls, menus, and dialogs inside the fullscreen element.

## Implementation map

`erdModel.js` owns column visibility, cardinality, one-hop focus, deterministic
neighbourhood grouping, and collision placement. The layout worker supplies
ELK fixed-port routes as well as node coordinates. `erdRelationships.js` assigns
per-column handles and accepts clear worker routes; `erdRouting.js` repairs
cross-group and moved routes using obstacle-aware orthogonal routing with
lane-sharing penalties. `sessionState.js` normalizes bounded layout/view data
and stores the shared diagram through the existing session artifact boundary.
