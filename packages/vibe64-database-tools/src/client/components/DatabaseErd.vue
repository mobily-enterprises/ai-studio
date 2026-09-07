<template>
  <section ref="erdRoot" class="database-erd" :class="{ 'database-erd--fullscreen': fullscreen }" @keydown="onKeydown">
    <header aria-label="ERD controls" class="database-erd__toolbar">
      <v-autocomplete
        v-model="searchChoice"
        v-model:search="searchText"
        class="database-erd__search"
        clearable
        density="compact"
        hide-details
        item-title="title"
        :item-value="item => JSON.stringify([item.table, item.column])"
        :items="searchMatches"
        label="Find table or column"
        :menu-props="{ attach: erdRoot }"
        no-filter
        :prepend-inner-icon="mdiMagnify"
        return-object
        variant="outlined"
        @update:model-value="locate"
      />
      <div class="database-erd__toolbar-actions">
        <v-btn-toggle :model-value="columnMode" mandatory density="compact" @update:model-value="changeColumnMode">
          <v-btn value="keys" size="small">Keys only</v-btn>
          <v-btn value="all" size="small">All columns</v-btn>
        </v-btn-toggle>
        <v-btn :disabled="layoutPending || !nodes.length" :prepend-icon="mdiImageFilterCenterFocus" size="small" variant="text" @click="fitDiagram">Fit</v-btn>
        <v-btn :disabled="layoutPending || !nodes.length" :prepend-icon="mdiRestore" size="small" title="Arrange relationships while preserving pinned tables" variant="tonal" @click="resetPositions">Reset positions</v-btn>
        <v-btn :disabled="layoutPending || !undoStack.length" :icon="mdiUndo" aria-label="Undo diagram change" size="small" variant="text" @click="undo" />
        <v-btn :disabled="layoutPending || !redoStack.length" :icon="mdiRedo" aria-label="Redo diagram change" size="small" variant="text" @click="redo" />
        <v-menu :attach="erdRoot">
          <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" size="small" variant="text">Views</v-btn></template>
          <v-list density="compact">
            <v-list-item title="Save view…" @click="viewName = ''; viewDialog = true" />
            <v-list-item v-for="view in views" :key="view.id" :title="view.name" @click="loadView(view)">
              <template #append><v-btn :icon="mdiClose" :aria-label="'Delete view ' + view.name" size="x-small" variant="text" @click.stop="removeView(view.id)" /></template>
            </v-list-item>
          </v-list>
        </v-menu>
        <v-btn size="small" variant="text" @click="editGroup()">Groups</v-btn>
        <v-btn v-if="fullscreenAvailable" :prepend-icon="fullscreen ? mdiFullscreenExit : mdiFullscreen" size="small" variant="text" @click="toggleFullscreen">{{ fullscreen ? 'Exit full screen' : 'Full screen' }}</v-btn>
      </div>
    </header>
    <div v-if="focusTable || groups.length || automaticGroups.length || disconnectedCount" class="database-erd__filters">
      <v-select
        :model-value="activeGroup"
        class="database-erd__group-select"
        density="compact"
        hide-details
        :items="groupItems"
        label="Table group"
        :menu-props="{ attach: erdRoot }"
        variant="outlined"
        @update:model-value="changeGroupFilter"
      />
      <v-chip v-if="focusTable" closable @click:close="setFocus('')">Focus: {{ tableName(focusTable) }}</v-chip>
      <span>{{ visibleCount }} / {{ nodes.length }} tables</span>
    </div>
    <div class="database-erd__canvas">
      <div v-if="layoutPending && !nodes.length" class="database-erd__skeleton" role="status">
        <v-skeleton-loader v-for="index in 6" :key="index" type="card, list-item-two-line@3" />
      </div>
      <VueFlow
        v-else
        v-model:edges="edges"
        v-model:nodes="nodes"
        :default-edge-options="defaultEdgeOptions"
        default-marker-color="rgb(var(--v-theme-primary))"
        :edges-updatable="false"
        :elements-selectable="true"
        :max-zoom="1.8"
        :min-zoom="0.08"
        :nodes-connectable="false"
        :nodes-draggable="!layoutPending"
        @init="onFlowInit"
        @node-click="onNodeClick"
        @node-drag-start="onNodeDragStart"
        @node-drag="onNodeDrag"
        @node-drag-stop="onNodeDragStop"
        @edge-click="onEdgeClick"
        @edge-mouse-enter="onEdgeHover"
        @edge-mouse-leave="onEdgeLeave"
        @pane-click="clearSelection"
        @move-end="onViewportMove"
      >
        <template #node-table="nodeProps"><DatabaseErdNode v-bind="nodeProps" /></template>
        <template #edge-relationship="edgeProps"><DatabaseErdEdge v-bind="edgeProps" /></template>
        <MiniMap pannable zoomable />
      </VueFlow>
      <div v-if="layoutPending && nodes.length" class="database-erd__notice" role="status">Arranging tables…</div>
      <div v-else-if="layoutError" class="database-erd__notice" role="alert">{{ layoutError }} <v-btn size="x-small" variant="text" @click="rebuild()">Retry</v-btn></div>
      <div v-else-if="obstructedCount" class="database-erd__notice" role="status">Some connections are blocked by overlapping tables. Move or unpin those tables, then reset positions.</div>
      <v-sheet v-if="selectedRelationship || selectedNode" class="database-erd__inspector" rounded="lg" elevation="2">
        <div class="database-erd__inspector-heading">
          <strong>{{ selectedRelationship ? 'Relationship' : selectedNode.data.table.name }}</strong>
          <v-btn :icon="mdiClose" aria-label="Close diagram details" size="x-small" variant="text" @click="clearSelection" />
        </div>
        <template v-if="selectedRelationship">
          <div class="database-erd__constraint">{{ selectedRelationship.constraintName }}</div>
          <div v-for="(column, index) in selectedRelationship.columns" :key="column" class="database-erd__mapping">
            <span>{{ tableName(selectedRelationship.referencedTable) }}.{{ selectedRelationship.referencedColumns[index] }}</span>
            <span>→ {{ tableName(selectedRelationship.sourceTable) }}.{{ column }}</span>
          </div>
          <p>Per child: {{ selectedCardinality.parent }} parent{{ selectedCardinality.parent === '1' ? '' : 's' }}.<br>Per parent: {{ selectedCardinality.child }} children.</p>
          <p class="database-erd__muted">0 = optional · 1 = one · N = many · ? = unknown</p>
          <dl><dt>On delete</dt><dd>{{ selectedRelationship.deleteAction || 'Unknown' }}</dd><dt>On update</dt><dd>{{ selectedRelationship.updateAction || 'Unknown' }}</dd></dl>
          <v-btn size="small" variant="tonal" @click="setFocus(selectedRelationship.sourceTable)">Focus child table</v-btn>
        </template>
        <template v-else-if="selectedNode">
          <p>{{ selectedNode.data.table.columns.length }} columns · {{ incomingCount }} incoming · {{ outgoingCount }} outgoing</p>
          <div class="database-erd__inspector-actions">
            <v-btn size="small" variant="tonal" @click="setFocus(selectedNode.id)">Focus on this table</v-btn>
            <v-btn size="small" variant="text" @click="emit('select-table', selectedNode.data.table)">Open data</v-btn>
            <v-btn size="small" :prepend-icon="selectedNode.data.pinned ? mdiPin : mdiPinOutline" variant="text" @click="togglePin(selectedNode.id)">{{ selectedNode.data.pinned ? 'Unpin' : 'Pin position' }}</v-btn>
            <v-btn size="small" variant="text" @click="editGroup(selectedNode.data.group)">Edit group</v-btn>
          </div>
        </template>
      </v-sheet>
    </div>
    <v-dialog v-model="viewDialog" :attach="erdRoot" max-width="440">
      <v-card title="Save diagram view">
        <v-card-text><v-text-field v-model="viewName" label="View name" maxlength="80" autofocus :hint="matchingView ? 'This replaces the saved view with the same name.' : 'Includes positions, pins, groups, focus, columns and zoom.'" persistent-hint @keydown.enter.prevent="saveView" /></v-card-text>
        <v-card-actions><v-spacer /><v-btn @click="viewDialog = false">Cancel</v-btn><v-btn :disabled="!viewName.trim() || (!matchingView && views.length >= 20)" @click="saveView">Save view</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog v-model="groupDialog" :attach="erdRoot" max-width="520">
      <v-card title="Table groups">
        <v-card-text>
          <v-select v-if="groups.length" :model-value="editingGroup" :items="[{ title: 'New group', value: '' }, ...groups.map(group => ({ title: group.name, value: group.id }))]" label="Group to edit" :menu-props="{ attach: erdRoot }" @update:model-value="editGroup" />
          <v-text-field v-model="groupName" label="Group name" maxlength="80" />
          <v-autocomplete v-model="groupTables" :items="tableItems" label="Tables in group" multiple chips closable-chips :menu-props="{ attach: erdRoot }" />
        </v-card-text>
        <v-card-actions><v-btn v-if="editingGroup" @click="removeGroup">Remove group</v-btn><v-spacer /><v-btn @click="groupDialog = false">Cancel</v-btn><v-btn :disabled="!groupName.trim() || !groupTables.length" @click="saveGroup">Save group</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { mdiClose, mdiFullscreen, mdiFullscreenExit, mdiImageFilterCenterFocus, mdiMagnify, mdiPin, mdiPinOutline, mdiRedo, mdiRestore, mdiUndo } from "@mdi/js";
import { MarkerType, VueFlow } from "@vue-flow/core";
import { MiniMap } from "@vue-flow/minimap";
import DatabaseErdEdge from "./DatabaseErdEdge.vue";
import DatabaseErdNode from "./DatabaseErdNode.vue";
import { createErdRelationshipRoutes } from "../erdRelationships.js";
import { ERD_NODE_WIDTH, erdCardinality, erdColumns, erdLayoutGroups, erdNeighbours, erdNodeHeight, erdSearch, placeErdNodes } from "../erdModel.js";

const props = defineProps({
  layout: { default: () => ({ nodes: [] }), type: Object },
  schema: { default: () => ({ relationships: [], tables: [] }), type: Object }
});
const emit = defineEmits(["save-layout", "select-table"]);
const nodes = ref([]);
const edges = ref([]);
const erdRoot = ref(null);
const fullscreen = ref(false);
const fullscreenAvailable = ref(false);
const layoutError = ref("");
const layoutPending = ref(false);
const columnMode = ref(props.layout.columnMode || "keys");
const focusTable = ref(props.layout.focusTable || "");
const activeGroup = ref(props.layout.activeGroup || "");
const groups = ref((props.layout.groups || []).map((group) => ({ ...group })));
const views = ref(JSON.parse(JSON.stringify(props.layout.views || [])));
const undoStack = ref([]);
const redoStack = ref([]);
const selectedTable = ref("");
const selectedRelationshipId = ref("");
const hoveredRelationshipId = ref("");
const searchText = ref("");
const searchChoice = ref(null);
const searchColumn = ref("");
const viewDialog = ref(false);
const viewName = ref("");
const groupDialog = ref(false);
const editingGroup = ref("");
const groupName = ref("");
const groupTables = ref([]);
const obstructedCount = ref(0);
const feedback = useUiFeedback({ source: "vibe64.database-erd.feedback" });
const defaultEdgeOptions = {
  type: "relationship",
  markerEnd: { height: 16, width: 16, markerUnits: "userSpaceOnUse", type: MarkerType.ArrowClosed }
};
const relationships = computed(() => props.schema.relationships || []);
const tables = computed(() => props.schema.tables || []);
const tableItems = computed(() => tables.value.map((table) => ({ title: table.name, value: table.qualifiedName })));
const searchMatches = computed(() => erdSearch(tables.value, searchText.value || ""));
const selectedNode = computed(() => nodes.value.find((node) => node.id === selectedTable.value));
const selectedRelationship = computed(() => relationships.value.find((relationship) => relationship.id === selectedRelationshipId.value));
const selectedCardinality = computed(() => selectedRelationship.value ? erdCardinality(selectedRelationship.value,
  tables.value.find((table) => table.qualifiedName === selectedRelationship.value.referencedTable),
  tables.value.find((table) => table.qualifiedName === selectedRelationship.value.sourceTable)) : {});
const incomingCount = computed(() => relationships.value.filter((relationship) => relationship.referencedTable === selectedTable.value).length);
const outgoingCount = computed(() => relationships.value.filter((relationship) => relationship.sourceTable === selectedTable.value).length);
const connectedTables = computed(() => new Set(relationships.value.flatMap((relationship) => [relationship.sourceTable, relationship.referencedTable])));
const disconnectedCount = computed(() => tables.value.filter((table) => !connectedTables.value.has(table.qualifiedName)).length);
const visibleCount = computed(() => nodes.value.filter((node) => !node.hidden).length);
const automaticGroups = computed(() => erdLayoutGroups(nodes.value, relationships.value).filter((group) => group.id.startsWith("erd-auto:")));
const groupItems = computed(() => [
  { title: "All groups", value: "" },
  ...groups.value.map((group) => ({ title: group.name, value: group.id })),
  ...automaticGroups.value.map((group) => ({ title: group.name, value: group.id })),
  { title: "Related tables", value: "erd-related" },
  ...(disconnectedCount.value ? [{ title: "Disconnected tables", value: "erd-disconnected" }] : [])
]);
const matchingView = computed(() => views.value.find((view) => view.name.toLowerCase() === viewName.value.trim().toLowerCase()));
let flow = null;
let layoutWorker = null;
let layoutRequestId = 0;
let rebuildId = 0;
let relationshipDragFrame = null;
let routes = [];
let storedNodes = props.layout.nodes || [];
let draggingSnapshot = null;
let pendingRemoteLayout = null;
let appliedLayoutRevision = props.layout.revision || 0;
let disposed = false;
const layoutResolvers = new Map();

function tableName(id) { return tables.value.find((table) => table.qualifiedName === id)?.name || id; }
function snapshot() {
  return {
    nodes: nodes.value.map((node) => ({ table: node.id, x: node.position.x, y: node.position.y, collapsed: node.data.collapsed, expanded: node.data.expanded, pinned: node.data.pinned, group: node.data.group, hidden: false })),
    columnMode: columnMode.value, focusTable: focusTable.value, activeGroup: activeGroup.value,
    groups: groups.value.map((group) => ({ ...group })),
    viewport: { ...(flow?.getViewport?.() || { x: 0, y: 0, zoom: 1 }) }
  };
}
function checkpoint() {
  undoStack.value = [...undoStack.value, snapshot()].slice(-30);
  redoStack.value = [];
}
function persistPositions() { emit("save-layout", { ...snapshot(), views: views.value }); }
function buildNodes(saved = storedNodes) {
  const records = new Map(saved.map((node) => [node.table, node]));
  const memberships = new Map(erdLayoutGroups(tables.value.map((table) => ({ id: table.qualifiedName, data: { table, group: records.get(table.qualifiedName)?.group } })), relationships.value)
    .flatMap((group) => group.tables.map((id) => [id, group])));
  return tables.value.map((table) => {
    const record = records.get(table.qualifiedName) || {};
    const columns = erdColumns(table, relationships.value, columnMode.value, record.expanded);
    const group = record.group || "";
    return {
      id: table.qualifiedName, type: "table", draggable: !record.pinned,
      position: { x: record.x || 0, y: record.y || 0 },
      dimensions: { width: ERD_NODE_WIDTH, height: erdNodeHeight(columns, record.collapsed) },
      data: {
        table, columns, group, collapsed: record.collapsed === true, expanded: record.expanded === true, pinned: record.pinned === true,
        columnMode: columnMode.value, keyColumnCount: erdColumns(table, relationships.value).length,
        primaryColumns: new Set((table.keys || []).filter((key) => key.primary).flatMap((key) => key.columns)),
        uniqueColumns: new Set((table.keys || []).flatMap((key) => key.columns)),
        foreignColumns: new Set(relationships.value.filter((relationship) => relationship.sourceTable === table.qualifiedName).flatMap((relationship) => relationship.columns)),
        layoutGroup: memberships.get(table.qualifiedName)?.id,
        groupName: groups.value.find((item) => item.id === group)?.name || memberships.get(table.qualifiedName)?.name,
        onToggle: toggleNode, onExpand: expandNode, onPin: togglePin
      }
    };
  });
}
function applyVisibility() {
  const neighbours = erdNeighbours(focusTable.value, relationships.value);
  nodes.value = nodes.value.map((node) => {
    const matchesGroup = !activeGroup.value || activeGroup.value === node.data.layoutGroup ||
      (activeGroup.value === "erd-related" && connectedTables.value.has(node.id));
    return { ...node, hidden: Boolean((focusTable.value && !neighbours.has(node.id)) || !matchesGroup) };
  });
}
function emphasize() {
  const relationId = hoveredRelationshipId.value || selectedRelationshipId.value;
  const highlighted = routes.filter((route) => relationId ? route.relationshipId === relationId :
    selectedTable.value && (route.source === selectedTable.value || route.target === selectedTable.value));
  const highlightedIds = new Set(highlighted.map((route) => route.id));
  const hasSelection = Boolean(relationId || selectedTable.value);
  nodes.value = nodes.value.map((node) => {
    const columns = highlighted.flatMap((route) => [
      ...(route.source === node.id ? [route.sourceColumn] : []),
      ...(route.target === node.id ? [route.targetColumn] : [])
    ]).filter(Boolean);
    if (node.id === selectedTable.value && searchColumn.value) columns.push(searchColumn.value);
    const active = node.id === selectedTable.value || columns.length > 0 || highlighted.some((route) => route.source === node.id || route.target === node.id);
    return { ...node, data: { ...node.data, highlighted: active, dimmed: hasSelection && !active, highlightedColumns: columns } };
  });
  edges.value = edges.value.map((edge) => {
    const active = highlightedIds.has(edge.id);
    return { ...edge, selected: edge.data.relationshipId === selectedRelationshipId.value,
      data: { ...edge.data, emphasized: active },
      style: { stroke: "rgb(var(--v-theme-primary))", strokeWidth: active ? 2.4 : 1.6, strokeOpacity: hasSelection && !active ? 0.12 : 0.85, strokeDasharray: edge.data.cardinality.optional ? "6 3" : undefined, strokeLinejoin: "round" }
    };
  });
}
async function refreshGraph({ dragging = false, reset = false, layoutPaths = new Map() } = {}) {
  applyVisibility();
  const graph = createErdRelationshipRoutes(nodes.value.filter((node) => !node.hidden), relationships.value, { previousRoutes: reset ? [] : routes, dragging, fixedSides: reset, layoutPaths });
  routes = graph.routes;
  nodes.value = nodes.value.map((node) => ({ ...node, data: { ...node.data, relationshipPorts: graph.portsByNode.get(node.id) || [] } }));
  edges.value = routes.map((route) => ({
    id: route.id, type: "relationship", source: route.source, target: route.target,
    sourceHandle: route.sourceHandle, targetHandle: route.targetHandle,
    ariaLabel: `${tableName(route.source)}.${route.sourceColumn || "(collapsed)"} → ${tableName(route.target)}.${route.targetColumn || "(collapsed)"}; ${route.cardinality.parent} parent(s) per child; ${route.cardinality.child} children per parent; ${route.relationship.constraintName}`,
    data: { relationshipId: route.relationshipId, points: route.points, cardinality: route.cardinality }
  }));
  obstructedCount.value = routes.filter((route) => route.obstructed).length;
  emphasize();
  await nextTick();
  if (!disposed) flow?.updateNodeInternals?.(nodes.value.filter((node) => !node.hidden).map((node) => node.id));
}
function workerLayout(sourceNodes, graph) {
  const id = ++layoutRequestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { layoutResolvers.delete(id); reject(new Error("The layout worker timed out.")); }, 15000);
    layoutResolvers.set(id, { resolve, reject, timeout });
    layoutWorker.postMessage({
      id,
      nodes: sourceNodes.map((node) => ({ id: node.id, ...node.dimensions, ports: graph.portsByNode.get(node.id) })),
      edges: graph.routes.map((route) => ({ id: route.id, source: route.source, target: route.target, sourceHandle: route.sourceHandle, targetHandle: route.targetHandle })),
      groups: erdLayoutGroups(sourceNodes, relationships.value)
    });
  });
}
async function rebuild({ force = false } = {}) {
  if (!layoutWorker) return;
  const request = ++rebuildId;
  layoutPending.value = true;
  layoutError.value = "";
  const saved = nodes.value.length ? snapshot().nodes : storedNodes;
  const initialViewport = !nodes.value.length && saved.length ? props.layout.viewport : null;
  try {
    const sourceNodes = buildNodes(saved);
    const savedTables = new Set(saved.map((node) => node.table));
    const needsSave = force || sourceNodes.some((node) => !savedTables.has(node.id));
    const graph = createErdRelationshipRoutes(sourceNodes, relationships.value, { fixedSides: true, calculatePaths: false });
    const layout = await workerLayout(sourceNodes, graph);
    if (disposed || request !== rebuildId) return;
    nodes.value = placeErdNodes(sourceNodes, layout.nodes, saved, force);
    await refreshGraph({ reset: true, layoutPaths: new Map(layout.paths.map((path) => [path.id, path.points])) });
    await updateViewport(initialViewport);
    if (needsSave) persistPositions();
    if (layout.fallback) feedback.error(new Error("The recommended layout was unavailable; a basic arrangement was used."), "Layout needs attention.");
  } catch (error) {
    if (request === rebuildId) layoutError.value = error.message || "The ERD could not be arranged.";
  } finally {
    if (request === rebuildId) layoutPending.value = false;
  }
}
async function restore(state, { remote = false } = {}) {
  rebuildId += 1;
  layoutPending.value = true;
  columnMode.value = state.columnMode || "keys";
  focusTable.value = state.focusTable || "";
  activeGroup.value = state.activeGroup || "";
  groups.value = (state.groups || []).map((group) => ({ ...group }));
  if (remote) {
    views.value = JSON.parse(JSON.stringify(state.views || []));
  } else {
    selectedTable.value = "";
    selectedRelationshipId.value = "";
    hoveredRelationshipId.value = "";
  }
  nodes.value = buildNodes(state.nodes);
  await refreshGraph({ reset: true });
  if (!remote) await updateViewport(state.viewport);
  layoutPending.value = false;
  if (!remote) persistPositions();
}
async function undo() {
  if (!undoStack.value.length || layoutPending.value) return;
  redoStack.value.push(snapshot());
  await restore(undoStack.value.pop());
}
async function redo() {
  if (!redoStack.value.length || layoutPending.value) return;
  undoStack.value.push(snapshot());
  await restore(redoStack.value.pop());
}
async function changeColumnMode(mode) {
  if (mode === columnMode.value || layoutPending.value) return;
  checkpoint();
  columnMode.value = mode;
  const saved = snapshot().nodes.map((node) => ({ ...node, expanded: false }));
  nodes.value = buildNodes(saved);
  await refreshGraph();
  persistPositions();
}
async function changeNode(id, changes) {
  checkpoint();
  const saved = snapshot().nodes.map((node) => node.table === id ? { ...node, ...changes } : node);
  nodes.value = buildNodes(saved);
  await refreshGraph();
  persistPositions();
}
function toggleNode(id) { return changeNode(id, { collapsed: !nodes.value.find((node) => node.id === id).data.collapsed }); }
function expandNode(id) { return changeNode(id, { expanded: !nodes.value.find((node) => node.id === id).data.expanded }); }
function togglePin(id) { return changeNode(id, { pinned: !nodes.value.find((node) => node.id === id).data.pinned }); }
function onNodeDragStart() { draggingSnapshot = snapshot(); }
function onNodeDrag() {
  if (relationshipDragFrame !== null) return;
  relationshipDragFrame = globalThis.requestAnimationFrame(() => {
    relationshipDragFrame = null;
    void refreshGraph({ dragging: true });
  });
}
async function onNodeDragStop() {
  if (relationshipDragFrame !== null) globalThis.cancelAnimationFrame(relationshipDragFrame);
  relationshipDragFrame = null;
  const beforeDrag = draggingSnapshot;
  if (beforeDrag) {
    undoStack.value = [...undoStack.value, beforeDrag].slice(-30);
    redoStack.value = [];
    draggingSnapshot = null;
  }
  if (pendingRemoteLayout) {
    // Keep this drag without reverting tables moved by another viewer during it.
    const previous = new Map(beforeDrag.nodes.map((node) => [node.table, node]));
    const moved = new Map(snapshot().nodes.filter((node) => {
      const before = previous.get(node.table);
      return before && (node.x !== before.x || node.y !== before.y);
    }).map((node) => [node.table, node]));
    const shared = pendingRemoteLayout;
    pendingRemoteLayout = null;
    await restore({ ...shared, nodes: shared.nodes.map((node) => {
      const position = moved.get(node.table);
      return position ? { ...node, x: position.x, y: position.y } : node;
    }) }, { remote: true });
  }
  await refreshGraph();
  persistPositions();
}
function onNodeClick({ node }) { selectedTable.value = node.id; selectedRelationshipId.value = ""; hoveredRelationshipId.value = ""; searchColumn.value = ""; emphasize(); }
function onEdgeClick({ edge }) { selectedRelationshipId.value = edge.data.relationshipId; selectedTable.value = ""; emphasize(); }
function onEdgeHover({ edge }) { hoveredRelationshipId.value = edge.data.relationshipId; emphasize(); }
function onEdgeLeave() { hoveredRelationshipId.value = ""; emphasize(); }
function clearSelection() { selectedTable.value = ""; selectedRelationshipId.value = ""; hoveredRelationshipId.value = ""; searchColumn.value = ""; emphasize(); }
async function setFocus(id) {
  checkpoint();
  focusTable.value = id;
  activeGroup.value = "";
  clearSelection();
  await refreshGraph();
  await fitDiagram();
  persistPositions();
}
async function changeGroupFilter(id) {
  checkpoint();
  activeGroup.value = id;
  focusTable.value = "";
  clearSelection();
  await refreshGraph();
  await fitDiagram();
  persistPositions();
}
async function locate(item) {
  if (!item) return;
  checkpoint();
  focusTable.value = "";
  activeGroup.value = "";
  selectedRelationshipId.value = "";
  hoveredRelationshipId.value = "";
  selectedTable.value = item.table;
  searchColumn.value = item.column;
  const saved = snapshot().nodes.map((node) => node.table === item.table ? { ...node, collapsed: false, expanded: Boolean(item.column) || node.expanded } : node);
  nodes.value = placeErdNodes(buildNodes(saved), [], saved);
  await refreshGraph();
  await nextTick();
  await flow?.fitView?.({ nodes: [item.table], maxZoom: 1.2, padding: 0.5, duration: 220 });
  persistPositions();
}
async function resetPositions() { checkpoint(); await rebuild({ force: true }); }
async function updateViewport(viewport) {
  await nextTick();
  await new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)));
  if (disposed) return;
  if (viewport) await flow?.setViewport?.(viewport, { duration: 180 });
  else await flow?.fitView?.({ nodes: nodes.value.filter((node) => !node.hidden).map((node) => node.id), duration: 220, padding: 0.18 });
}
function fitDiagram() { return updateViewport(); }
function onFlowInit(instance) { flow = instance; }
function onViewportMove() { if (!layoutPending.value && !draggingSnapshot && nodes.value.length) persistPositions(); }
function editGroup(id = "") {
  const group = groups.value.find((item) => item.id === id);
  editingGroup.value = group?.id || "";
  groupName.value = group?.name || "";
  groupTables.value = group ? nodes.value.filter((node) => node.data.group === id).map((node) => node.id) : selectedTable.value ? [selectedTable.value] : [];
  groupDialog.value = true;
}
async function saveGroup() {
  if (!groupName.value.trim() || !groupTables.value.length) return;
  checkpoint();
  const existing = groups.value.find((group) => group.name.toLowerCase() === groupName.value.trim().toLowerCase());
  const id = editingGroup.value || existing?.id || crypto.randomUUID();
  groups.value = [...groups.value.filter((group) => group.id !== id), { id, name: groupName.value.trim() }];
  const members = new Set(groupTables.value);
  const saved = snapshot().nodes.map((node) => ({ ...node, group: members.has(node.table) ? id : node.group === id ? "" : node.group }));
  nodes.value = buildNodes(saved);
  activeGroup.value = id;
  focusTable.value = "";
  clearSelection();
  groupDialog.value = false;
  await rebuild({ force: true });
}
async function removeGroup() {
  checkpoint();
  const id = editingGroup.value;
  groups.value = groups.value.filter((group) => group.id !== id);
  if (activeGroup.value === id) activeGroup.value = "";
  const saved = snapshot().nodes.map((node) => ({ ...node, group: node.group === id ? "" : node.group }));
  nodes.value = buildNodes(saved);
  groupDialog.value = false;
  await rebuild({ force: true });
}
function saveView() {
  if (!viewName.value.trim() || (!matchingView.value && views.value.length >= 20)) return;
  const id = matchingView.value?.id || crypto.randomUUID();
  const view = { ...snapshot(), id, name: viewName.value.trim() };
  views.value = [...views.value.filter((item) => item.id !== id), view];
  viewDialog.value = false;
  persistPositions();
}
async function loadView(view) { checkpoint(); await restore(view); }
function removeView(id) { views.value = views.value.filter((view) => view.id !== id); persistPositions(); }
function onFullscreenChange() {
  fullscreen.value = document.fullscreenElement === erdRoot.value;
  void nextTick().then(() => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(fitDiagram)));
}
async function toggleFullscreen() {
  try {
    if (fullscreen.value) await document.exitFullscreen();
    else await erdRoot.value.requestFullscreen();
  } catch (error) { feedback.error(error, "The ERD could not change full screen mode."); }
}
function onKeydown(event) {
  if (event.target.closest("input, textarea, [contenteditable=true]")) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) void redo(); else void undo();
  } else if (event.key === "Escape" && !viewDialog.value && !groupDialog.value) clearSelection();
}
watch(() => props.schema, () => { if (layoutWorker) void rebuild(); });
watch(() => props.layout, (layout) => {
  if (!layout.revision || layout.revision <= appliedLayoutRevision) return;
  appliedLayoutRevision = layout.revision;
  if (draggingSnapshot) {
    pendingRemoteLayout = layout;
  } else if (layoutWorker) {
    void restore(layout, { remote: true });
  }
});
onMounted(() => {
  fullscreenAvailable.value = typeof erdRoot.value?.requestFullscreen === "function";
  document.addEventListener("fullscreenchange", onFullscreenChange);
  layoutWorker = new Worker(new URL("../workers/erdLayout.worker.js", import.meta.url), { type: "module" });
  layoutWorker.addEventListener("message", ({ data }) => {
    const resolver = layoutResolvers.get(data.id);
    if (!resolver) return;
    layoutResolvers.delete(data.id);
    clearTimeout(resolver.timeout);
    if (data.ok === false) resolver.reject(new Error(data.error));
    else resolver.resolve(data);
  });
  layoutWorker.addEventListener("error", (event) => {
    for (const resolver of layoutResolvers.values()) { clearTimeout(resolver.timeout); resolver.reject(new Error(event.message || "The layout worker failed.")); }
    layoutResolvers.clear();
  });
  void rebuild();
});
onBeforeUnmount(() => {
  disposed = true;
  rebuildId += 1;
  if (relationshipDragFrame !== null) globalThis.cancelAnimationFrame(relationshipDragFrame);
  document.removeEventListener("fullscreenchange", onFullscreenChange);
  for (const resolver of layoutResolvers.values()) { clearTimeout(resolver.timeout); resolver.reject(new Error("ERD closed.")); }
  layoutResolvers.clear();
  layoutWorker?.terminate();
});
</script>

<style>
@import "@vue-flow/core/dist/style.css";
@import "@vue-flow/core/dist/theme-default.css";
@import "@vue-flow/minimap/dist/style.css";
</style>
<style scoped>
.database-erd { display: flex; flex-direction: column; min-height: 0; height: 100%; background: rgb(var(--v-theme-surface)); }
.database-erd__toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px; border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.12); }
.database-erd__search { flex: 1 1 220px; min-width: 180px; max-width: 360px; }
.database-erd__toolbar-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.database-erd__filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 6px 8px; font-size: 12px; }
.database-erd__group-select { flex: 0 1 240px; min-width: 180px; }
.database-erd--fullscreen, .database-erd:fullscreen { width: 100%; height: 100%; }
.database-erd__canvas { position: relative; flex: 1; min-height: 300px; overflow: hidden; background: rgb(var(--v-theme-surface)); }
.database-erd__canvas :deep(.vue-flow) { height: 100%; }
.database-erd__canvas :deep(.vue-flow__edge-text) { fill: rgb(var(--v-theme-on-surface)); font-size: 10px; }
.database-erd__canvas :deep(.vue-flow__edge-textbg) { fill: rgb(var(--v-theme-surface)); }
.database-erd__canvas :deep(.vue-flow__edge) { transition: opacity 100ms ease; }
.database-erd__canvas :deep(.vue-flow__minimap) { background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.2); border-radius: 10px; }
.database-erd__canvas :deep(.vue-flow__minimap-mask) { fill: rgba(var(--v-theme-surface), 0.7); }
.database-erd__canvas :deep(.vue-flow__minimap-node) { fill: rgba(var(--v-theme-on-surface), 0.35); }
.database-erd__notice { position: absolute; bottom: 10px; left: 10px; max-width: min(520px, 75%); padding: 8px 12px; background: rgb(var(--v-theme-surface)); border: 1px solid rgba(var(--v-theme-on-surface), 0.2); border-radius: 8px; font-size: 12px; }
.database-erd__inspector { position: absolute; top: 10px; right: 10px; width: 290px; max-width: calc(100% - 20px); max-height: calc(100% - 20px); overflow: auto; padding: 14px; font-size: 12px; }
.database-erd__inspector-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.database-erd__inspector-heading strong { overflow-wrap: anywhere; }
.database-erd__constraint { margin: 8px 0; font-weight: 600; overflow-wrap: anywhere; }
.database-erd__mapping { display: grid; gap: 4px; margin: 10px 0; overflow-wrap: anywhere; }
.database-erd__inspector p { margin: 10px 0; }
.database-erd__muted { opacity: 0.7; font-size: 11px; }
.database-erd__inspector dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 12px 0; }
.database-erd__inspector dd { margin: 0; }
.database-erd__inspector-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.database-erd__skeleton { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 40px; padding: 24px; }
@media (prefers-reduced-motion: reduce) { .database-erd__canvas :deep(.vue-flow__edge) { transition: none; } }
</style>
