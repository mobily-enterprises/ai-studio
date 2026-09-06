<template>
  <section
    ref="erdRoot"
    class="database-erd"
    :class="{ 'database-erd--fullscreen': fullscreen }"
  >
    <header
      v-if="!fullscreen"
      aria-label="ERD controls"
      class="database-erd__toolbar"
    >
      <div class="database-erd__toolbar-actions">
        <v-btn
          :disabled="layoutPending || nodes.length === 0"
          :prepend-icon="mdiImageFilterCenterFocus"
          size="small"
          type="button"
          variant="text"
          @click="fitDiagram"
        >
          Fit
        </v-btn>
        <v-btn
          :disabled="layoutPending || nodes.length === 0"
          :prepend-icon="mdiRestore"
          size="small"
          title="Restore the recommended relationship-aware layout"
          type="button"
          variant="tonal"
          @click="resetPositions"
        >
          Reset positions
        </v-btn>
        <v-btn
          :disabled="layoutPending || nodes.length === 0 || !fullscreenAvailable"
          :prepend-icon="mdiFullscreen"
          size="small"
          :title="fullscreenAvailable ? 'Show only the ERD in full screen' : 'Full screen is unavailable'"
          type="button"
          variant="text"
          @click="enterFullscreen"
        >
          Full screen
        </v-btn>
      </div>
    </header>

    <div v-if="!fullscreen && layoutError" class="database-erd__error" role="alert">
      <v-icon :icon="mdiAlertOutline" size="18" />
      <span>{{ layoutError }}</span>
      <v-btn size="x-small" type="button" variant="text" @click="resetPositions">Retry</v-btn>
    </div>

    <div class="database-erd__canvas">
      <div v-if="layoutPending && nodes.length === 0" class="database-erd__skeleton" role="status">
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
        :fit-view-on-init="true"
        :max-zoom="1.8"
        :min-zoom="0.08"
        :nodes-connectable="false"
        :nodes-draggable="true"
        @init="onFlowInit"
        @node-click="onNodeClick"
        @node-drag="onNodeDrag"
        @node-drag-stop="onNodeDragStop"
      >
        <template #node-table="nodeProps">
          <DatabaseErdNode
            v-bind="nodeProps"
            :controls-visible="!fullscreen"
          />
        </template>
        <template #edge-relationship="edgeProps">
          <DatabaseErdEdge v-bind="edgeProps" />
        </template>
        <MiniMap pannable zoomable />
      </VueFlow>
    </div>
  </section>
</template>

<script setup>
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import {
  mdiAlertOutline,
  mdiFullscreen,
  mdiImageFilterCenterFocus,
  mdiRestore
} from "@mdi/js";
import {
  MarkerType,
  VueFlow
} from "@vue-flow/core";
import {
  MiniMap
} from "@vue-flow/minimap";

import DatabaseErdEdge from "./DatabaseErdEdge.vue";
import DatabaseErdNode from "./DatabaseErdNode.vue";
import { createErdRelationshipRoutes } from "../erdRelationships.js";

const props = defineProps({
  layout: {
    default: () => ({ nodes: [] }),
    type: Object
  },
  schema: {
    default: () => ({ relationships: [], tables: [] }),
    type: Object
  }
});
const emit = defineEmits(["save-layout", "select-table"]);
const LAYOUT_TIMEOUT_MS = 15_000;

const nodes = ref([]);
const edges = ref([]);
const erdRoot = ref(null);
const fullscreen = ref(false);
const fullscreenAvailable = ref(false);
const layoutError = ref("");
const layoutPending = ref(false);
const fullscreenFeedback = useUiFeedback({
  source: "vibe64.database-erd.fullscreen.feedback"
});
const defaultEdgeOptions = {
  interactionWidth: 24,
  labelBgBorderRadius: 6,
  labelBgPadding: [6, 4],
  labelShowBg: true,
  markerEnd: {
    height: 20,
    markerUnits: "userSpaceOnUse",
    strokeWidth: 1.4,
    type: MarkerType.ArrowClosed,
    width: 20
  },
  style: {
    strokeLinecap: "round",
    strokeLinejoin: "round",
    stroke: "rgb(var(--v-theme-primary))",
    strokeOpacity: 0.88,
    strokeWidth: 2.25
  },
  type: "relationship"
};
let flow = null;
let fullscreenDocument = null;
let layoutWorker = null;
let layoutRequestId = 0;
let relationshipDragFrame = null;
const layoutResolvers = new Map();

function persistedNodes() {
  return new Map((Array.isArray(props.layout?.nodes) ? props.layout.nodes : []).map((node) => [
    node.table,
    node
  ]));
}

function primaryColumns(table = {}) {
  return new Set((Array.isArray(table.keys) ? table.keys : [])
    .filter((key) => key.primary)
    .flatMap((key) => key.columns));
}

function foreignColumns(table = {}) {
  return new Set((Array.isArray(props.schema?.relationships) ? props.schema.relationships : [])
    .filter((relationship) => relationship.sourceTable === table.qualifiedName)
    .flatMap((relationship) => relationship.columns));
}

function nodeHeight(table = {}, collapsed = false) {
  return collapsed ? 54 : Math.min(420, 92 + (table.columns?.length || 0) * 28);
}

function tableNodes() {
  const stored = persistedNodes();
  return (Array.isArray(props.schema?.tables) ? props.schema.tables : [])
    .filter((table) => stored.get(table.qualifiedName)?.hidden !== true)
    .map((table) => {
      const saved = stored.get(table.qualifiedName) || {};
      const collapsed = saved.collapsed === true;
      return {
        data: {
          collapsed,
          foreignColumns: foreignColumns(table),
          onToggle: toggleNode,
          primaryColumns: primaryColumns(table),
          table
        },
        dimensions: {
          height: nodeHeight(table, collapsed),
          width: collapsed ? 208 : 280
        },
        id: table.qualifiedName,
        position: {
          x: Number(saved.x || 0),
          y: Number(saved.y || 0)
        },
        type: "table"
      };
    });
}

function relationshipGraph(sourceNodes = nodes.value) {
  const graph = createErdRelationshipRoutes(
    sourceNodes,
    Array.isArray(props.schema?.relationships) ? props.schema.relationships : []
  );
  return {
    edges: graph.routes.map((route) => {
      const relationship = route.relationship;
      const referencedColumns = (relationship.referencedColumns || []).join(", ");
      const foreignKeyColumns = (relationship.columns || []).join(", ");
      return {
        ariaLabel: `One ${relationship.referencedTable} row to many ${relationship.sourceTable} rows through ${relationship.constraintName}: ${referencedColumns} to ${foreignKeyColumns}`,
        data: {
          laneX: route.laneX,
          sourceTrackOffset: route.sourceTrackOffset,
          targetTrackOffset: route.targetTrackOffset
        },
        id: route.id,
        label: "1 → N",
        source: route.source,
        sourceHandle: route.sourceHandle,
        target: route.target,
        targetHandle: route.targetHandle,
        type: "relationship"
      };
    }),
    nodes: sourceNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        relationshipPorts: graph.portsByNode.get(node.id) || []
      }
    }))
  };
}

function workerLayout(sourceNodes, sourceEdges) {
  if (!layoutWorker) {
    return Promise.reject(new Error("The ERD layout worker is not ready."));
  }
  layoutRequestId += 1;
  const id = layoutRequestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (layoutResolvers.delete(id)) {
        reject(new Error("The ERD layout worker did not respond."));
      }
    }, LAYOUT_TIMEOUT_MS);
    layoutResolvers.set(id, { reject, resolve, timeout });
    layoutWorker.postMessage({
      edges: sourceEdges,
      id,
      nodes: sourceNodes.map((node) => ({
        height: node.dimensions.height,
        id: node.id,
        width: node.dimensions.width
      }))
    });
  });
}

function rejectPendingLayouts(error) {
  for (const resolver of layoutResolvers.values()) {
    clearTimeout(resolver.timeout);
    resolver.reject(error);
  }
  layoutResolvers.clear();
}

function rectanglesOverlap(left = {}, right = {}) {
  return left.x < right.x + right.width + 36 &&
    left.x + left.width + 36 > right.x &&
    left.y < right.y + right.height + 36 &&
    left.y + left.height + 36 > right.y;
}

function mergeStoredPositions(sourceNodes, positions = [], force = false) {
  const stored = persistedNodes();
  const laidOut = new Map(positions.map((position) => [position.id, position]));
  const occupied = force ? [] : sourceNodes.flatMap((node) => {
    const saved = stored.get(node.id);
    return saved ? [{
      height: node.dimensions.height,
      width: node.dimensions.width,
      x: Number(saved.x || 0),
      y: Number(saved.y || 0)
    }] : [];
  });
  return sourceNodes.map((node) => {
    const saved = stored.get(node.id);
    const candidate = laidOut.get(node.id) || { x: 0, y: 0 };
    let position = !force && saved
      ? { x: Number(saved.x || 0), y: Number(saved.y || 0) }
      : { x: candidate.x, y: candidate.y };
    const rectangle = {
      height: node.dimensions.height,
      width: node.dimensions.width,
      ...position
    };
    if (!force && !saved) {
      while (occupied.some((other) => rectanglesOverlap(rectangle, other))) {
        rectangle.y += 76;
        if (rectangle.y > 3_000) {
          rectangle.y = 0;
          rectangle.x += 340;
        }
      }
      position = { x: rectangle.x, y: rectangle.y };
    }
    if (force || !saved) {
      occupied.push({
        height: rectangle.height,
        width: rectangle.width,
        ...position
      });
    }
    return {
      ...node,
      position
    };
  });
}

async function rebuild({ force = false } = {}) {
  if (!layoutWorker) {
    return;
  }
  layoutError.value = "";
  layoutPending.value = true;
  try {
    const sourceNodes = tableNodes();
    const stored = persistedNodes();
    const layoutNeedsSave = force || sourceNodes.some((node) => !stored.has(node.id));
    const sourceGraph = relationshipGraph(sourceNodes);
    nodes.value = sourceGraph.nodes;
    edges.value = sourceGraph.edges;
    const positions = sourceNodes.length > 0
      ? await workerLayout(sourceNodes, sourceGraph.edges)
      : [];
    const positionedGraph = relationshipGraph(mergeStoredPositions(sourceNodes, positions, force));
    nodes.value = positionedGraph.nodes;
    edges.value = positionedGraph.edges;
    await nextTick();
    flow?.updateNodeInternals?.(nodes.value.map((node) => node.id));
    await nextTick();
    flow?.fitView?.({ duration: 280, padding: 0.16 });
    if (layoutNeedsSave) {
      persistPositions();
    }
  } catch (error) {
    layoutError.value = String(error?.message || error || "The ERD could not be arranged.");
  } finally {
    layoutPending.value = false;
  }
}

function serializedLayout() {
  return {
    nodes: nodes.value.map((node) => ({
      collapsed: node.data?.collapsed === true,
      hidden: false,
      table: node.id,
      x: Number(node.position?.x || 0),
      y: Number(node.position?.y || 0)
    }))
  };
}

function persistPositions() {
  emit("save-layout", serializedLayout());
}

async function toggleNode(nodeId = "") {
  const updatedNodes = nodes.value.map((node) => {
    if (node.id !== nodeId) return node;
    const collapsed = !node.data.collapsed;
    return {
      ...node,
      data: {
        ...node.data,
        collapsed
      },
      dimensions: {
        height: nodeHeight(node.data.table, collapsed),
        width: collapsed ? 208 : 280
      }
    };
  });
  const graph = relationshipGraph(updatedNodes);
  nodes.value = graph.nodes;
  edges.value = graph.edges;
  await nextTick();
  flow?.updateNodeInternals?.([nodeId]);
  persistPositions();
}

async function onNodeDragStop() {
  if (relationshipDragFrame !== null) {
    globalThis.cancelAnimationFrame(relationshipDragFrame);
    relationshipDragFrame = null;
  }
  const graph = relationshipGraph(nodes.value);
  nodes.value = graph.nodes;
  edges.value = graph.edges;
  await nextTick();
  flow?.updateNodeInternals?.(nodes.value.map((node) => node.id));
  persistPositions();
}

function onNodeDrag() {
  if (relationshipDragFrame !== null) {
    return;
  }
  relationshipDragFrame = globalThis.requestAnimationFrame(async () => {
    relationshipDragFrame = null;
    const graph = relationshipGraph(nodes.value);
    nodes.value = graph.nodes;
    edges.value = graph.edges;
    await nextTick();
    flow?.updateNodeInternals?.(nodes.value.map((node) => node.id));
  });
}

function onFlowInit(instance) {
  flow = instance;
}

function onNodeClick(event = {}) {
  const table = event.node?.data?.table;
  if (table) {
    emit("select-table", table);
  }
}

function fitDiagram() {
  flow?.fitView?.({ duration: 280, padding: 0.16 });
}

function resetPositions() {
  return rebuild({ force: true });
}

function onFullscreenChange() {
  const active = fullscreenDocument?.fullscreenElement === erdRoot.value;
  if (fullscreen.value === active) {
    return;
  }
  fullscreen.value = active;
  void nextTick().then(() => {
    globalThis.requestAnimationFrame(() => {
      globalThis.requestAnimationFrame(fitDiagram);
    });
  });
}

async function enterFullscreen() {
  if (!fullscreenAvailable.value || typeof erdRoot.value?.requestFullscreen !== "function") {
    return;
  }
  try {
    await erdRoot.value.requestFullscreen();
  } catch (error) {
    fullscreenFeedback.error(error, "The ERD could not enter full screen.");
  }
}

watch(() => props.schema, () => {
  if (layoutWorker) {
    void rebuild();
  }
}, { immediate: true });

onMounted(() => {
  fullscreenDocument = erdRoot.value?.ownerDocument || globalThis.document;
  fullscreenAvailable.value = typeof erdRoot.value?.requestFullscreen === "function";
  fullscreenDocument?.addEventListener("fullscreenchange", onFullscreenChange);
  layoutWorker = new Worker(new URL("../workers/erdLayout.worker.js", import.meta.url), {
    type: "module"
  });
  layoutWorker.addEventListener("message", (event) => {
    const response = event.data || {};
    const resolver = layoutResolvers.get(response.id);
    if (!resolver) {
      return;
    }
    layoutResolvers.delete(response.id);
    clearTimeout(resolver.timeout);
    if (response.ok === false) {
      resolver.reject(new Error(response.error || "ERD layout failed."));
    } else {
      resolver.resolve(Array.isArray(response.nodes) ? response.nodes : []);
    }
  });
  layoutWorker.addEventListener("error", (event) => {
    rejectPendingLayouts(new Error(event.message || "The ERD layout worker failed."));
  });
  void rebuild();
});

onBeforeUnmount(() => {
  if (relationshipDragFrame !== null) {
    globalThis.cancelAnimationFrame(relationshipDragFrame);
    relationshipDragFrame = null;
  }
  fullscreenDocument?.removeEventListener("fullscreenchange", onFullscreenChange);
  fullscreenDocument = null;
  rejectPendingLayouts(new Error("ERD closed."));
  layoutWorker?.terminate();
});
</script>

<style>
@import "@vue-flow/core/dist/style.css";
@import "@vue-flow/core/dist/theme-default.css";
@import "@vue-flow/minimap/dist/style.css";
</style>

<style scoped>
.database-erd {
  display: grid;
  grid-template-areas:
    "toolbar"
    "error"
    "canvas";
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 0;
  height: 100%;
}

.database-erd__toolbar {
  grid-area: toolbar;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 2.85rem;
  overflow-x: auto;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.16);
}

.database-erd__toolbar-actions {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.25rem;
  align-items: center;
  white-space: nowrap;
}

.database-erd--fullscreen,
.database-erd:fullscreen {
  width: 100%;
  height: 100%;
  grid-template-areas: "canvas";
  grid-template-rows: minmax(0, 1fr);
  background: rgb(var(--v-theme-surface));
}

.database-erd--fullscreen .database-erd__canvas,
.database-erd:fullscreen .database-erd__canvas {
  min-height: 0;
}

.database-erd__error {
  grid-area: error;
  display: flex;
  gap: 0.45rem;
  align-items: center;
  padding: 0.45rem 0.8rem;
  background: rgba(var(--v-theme-error), 0.09);
  color: rgb(var(--v-theme-error));
  font-size: 0.75rem;
}

.database-erd__canvas {
  position: relative;
  grid-area: canvas;
  min-height: 24rem;
  overflow: hidden;
  background-color: rgb(var(--v-theme-surface));
  background-image: radial-gradient(rgba(var(--v-theme-on-surface), 0.11) 0.7px, transparent 0.7px);
  background-size: 16px 16px;
}

.database-erd__canvas :deep(.vue-flow) {
  height: 100%;
}

.database-erd__canvas :deep(.vue-flow__edge-text) {
  fill: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 10px;
  font-weight: 800;
}

.database-erd__canvas :deep(.vue-flow__edge-textbg) {
  fill: rgb(var(--v-theme-surface));
  fill-opacity: 0.94;
  stroke: rgba(var(--v-theme-outline), 0.32);
  stroke-width: 0.75px;
}

.database-erd__canvas :deep(.vue-flow__edge) {
  transition: filter 120ms ease, opacity 120ms ease;
}

.database-erd__canvas :deep(.vue-flow__edge:hover),
.database-erd__canvas :deep(.vue-flow__edge.selected) {
  filter: drop-shadow(0 0 3px rgba(var(--v-theme-primary), 0.72));
}

.database-erd__canvas :deep(.vue-flow__viewport:has(.vue-flow__edge:hover) .vue-flow__edge),
.database-erd__canvas :deep(.vue-flow__viewport:has(.vue-flow__edge.selected) .vue-flow__edge) {
  opacity: 0.16;
}

.database-erd__canvas :deep(.vue-flow__viewport:has(.vue-flow__edge:hover) .vue-flow__edge:hover),
.database-erd__canvas :deep(.vue-flow__viewport:has(.vue-flow__edge.selected) .vue-flow__edge.selected) {
  opacity: 1;
}

.database-erd__canvas :deep(.vue-flow__minimap) {
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-outline), 0.25);
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-high));
}

.database-erd__skeleton {
  display: grid;
  grid-template-columns: repeat(3, minmax(13rem, 1fr));
  gap: 3rem;
  padding: 2rem;
}

@media (max-width: 900px) {
  .database-erd__skeleton {
    grid-template-columns: repeat(2, minmax(12rem, 1fr));
  }
}
</style>
