<template>
  <section class="database-erd">
    <header class="database-erd__toolbar">
      <div>
        <strong>Entity relationship diagram</strong>
        <span>Arrows run 1 → N from referenced tables to foreign-key tables. Drag to arrange; positions stay with this session.</span>
      </div>
      <div>
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
          :prepend-icon="mdiAutoFix"
          size="small"
          type="button"
          variant="tonal"
          @click="autoArrange"
        >
          Auto-arrange
        </v-btn>
      </div>
    </header>

    <div v-if="layoutError" class="database-erd__error" role="alert">
      <v-icon :icon="mdiAlertOutline" size="18" />
      <span>{{ layoutError }}</span>
      <v-btn size="x-small" type="button" variant="text" @click="autoArrange">Retry</v-btn>
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
        @node-drag-stop="persistPositions"
      >
        <template #node-table="nodeProps">
          <DatabaseErdNode v-bind="nodeProps" />
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
import {
  mdiAlertOutline,
  mdiAutoFix,
  mdiImageFilterCenterFocus
} from "@mdi/js";
import {
  MarkerType,
  VueFlow
} from "@vue-flow/core";
import {
  MiniMap
} from "@vue-flow/minimap";

import DatabaseErdNode from "./DatabaseErdNode.vue";

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
const layoutError = ref("");
const layoutPending = ref(false);
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
    stroke: "rgb(var(--v-theme-primary))",
    strokeOpacity: 0.88,
    strokeWidth: 2.25
  },
  type: "smoothstep"
};
let flow = null;
let layoutWorker = null;
let layoutRequestId = 0;
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

function relationshipEdges() {
  const nodeIds = new Set(nodes.value.map((node) => node.id));
  return (Array.isArray(props.schema?.relationships) ? props.schema.relationships : [])
    .filter((relationship) => nodeIds.has(relationship.sourceTable) && nodeIds.has(relationship.referencedTable))
    .map((relationship) => {
      const referencedColumns = (relationship.referencedColumns || []).join(", ");
      const foreignKeyColumns = (relationship.columns || []).join(", ");
      return {
        ariaLabel: `One ${relationship.referencedTable} row to many ${relationship.sourceTable} rows through ${relationship.constraintName}: ${referencedColumns} to ${foreignKeyColumns}`,
        id: relationship.id,
        label: "1 → N",
        source: relationship.referencedTable,
        target: relationship.sourceTable
      };
    });
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
    nodes.value = sourceNodes;
    const sourceEdges = relationshipEdges();
    const positions = sourceNodes.length > 0
      ? await workerLayout(sourceNodes, sourceEdges)
      : [];
    nodes.value = mergeStoredPositions(sourceNodes, positions, force);
    edges.value = relationshipEdges();
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

function toggleNode(nodeId = "") {
  nodes.value = nodes.value.map((node) => node.id === nodeId
    ? {
        ...node,
        data: {
          ...node.data,
          collapsed: !node.data.collapsed
        },
        dimensions: {
          height: nodeHeight(node.data.table, !node.data.collapsed),
          width: !node.data.collapsed ? 208 : 280
        }
      }
    : node);
  persistPositions();
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

function autoArrange() {
  return rebuild({ force: true });
}

watch(() => props.schema, () => {
  if (layoutWorker) {
    void rebuild();
  }
}, { immediate: true });

onMounted(() => {
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
  gap: 1rem;
  align-items: center;
  justify-content: space-between;
  min-height: 3.7rem;
  padding: 0.55rem 0.8rem 0.55rem 1rem;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.16);
}

.database-erd__toolbar > div:first-child {
  min-width: 0;
}

.database-erd__toolbar strong,
.database-erd__toolbar span {
  display: block;
}

.database-erd__toolbar span {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  .database-erd__toolbar span {
    display: none;
  }

  .database-erd__skeleton {
    grid-template-columns: repeat(2, minmax(12rem, 1fr));
  }
}
</style>
