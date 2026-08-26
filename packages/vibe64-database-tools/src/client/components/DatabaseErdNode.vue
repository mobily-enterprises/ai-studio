<template>
  <article class="database-erd-node" :class="{ 'database-erd-node--collapsed': data.collapsed }">
    <Handle :position="Position.Left" type="target" />
    <header>
      <div>
        <small>{{ data.table.schema }}</small>
        <strong>{{ data.table.name }}</strong>
      </div>
      <button
        :aria-label="data.collapsed ? 'Expand table' : 'Collapse table'"
        type="button"
        @click.stop="data.onToggle?.(id)"
      >
        <v-icon :icon="data.collapsed ? mdiChevronDown : mdiChevronUp" size="16" />
      </button>
    </header>
    <div v-if="!data.collapsed" class="database-erd-node__columns">
      <div
        v-for="column in data.table.columns"
        :key="column.name"
        class="database-erd-node__column"
        :title="column.comment || column.nativeType"
      >
        <v-icon
          :icon="data.primaryColumns.has(column.name) ? mdiKeyVariant : (data.foreignColumns.has(column.name) ? mdiLinkVariant : mdiCircleSmall)"
          :class="{
            'database-erd-node__key': data.primaryColumns.has(column.name),
            'database-erd-node__foreign': data.foreignColumns.has(column.name)
          }"
          size="14"
        />
        <span>{{ column.name }}</span>
        <small>{{ column.nativeType }}</small>
      </div>
    </div>
    <footer v-if="!data.collapsed">
      {{ data.table.kind }}
      <span>{{ data.table.columns.length }} columns</span>
    </footer>
    <Handle :position="Position.Right" type="source" />
  </article>
</template>

<script setup>
import {
  mdiChevronDown,
  mdiChevronUp,
  mdiCircleSmall,
  mdiKeyVariant,
  mdiLinkVariant
} from "@mdi/js";
import {
  Handle,
  Position
} from "@vue-flow/core";

defineProps({
  data: {
    required: true,
    type: Object
  },
  id: {
    required: true,
    type: String
  }
});
</script>

<style scoped>
.database-erd-node {
  width: 17.5rem;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-outline), 0.35);
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-container));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  color: rgb(var(--v-theme-on-surface));
}

.database-erd-node header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 3.2rem;
  padding: 0.55rem 0.7rem 0.55rem 0.85rem;
  background: rgba(var(--v-theme-primary), 0.11);
}

.database-erd-node header div {
  min-width: 0;
}

.database-erd-node header small,
.database-erd-node header strong {
  display: block;
}

.database-erd-node header small {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.64rem;
  line-height: 1.05;
}

.database-erd-node header strong {
  overflow: hidden;
  font-size: 0.87rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.database-erd-node header button {
  display: grid;
  flex: 0 0 1.8rem;
  width: 1.8rem;
  height: 1.8rem;
  place-items: center;
  border-radius: 999px;
  color: inherit;
}

.database-erd-node header button:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.database-erd-node__columns {
  max-height: 20rem;
  overflow: auto;
  padding: 0.35rem 0;
}

.database-erd-node__column {
  display: grid;
  grid-template-columns: 1rem minmax(0, 1fr) auto;
  gap: 0.35rem;
  align-items: center;
  min-height: 1.72rem;
  padding: 0 0.75rem;
  font-size: 0.72rem;
}

.database-erd-node__column span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.database-erd-node__column small {
  max-width: 7rem;
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.62rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.database-erd-node__key {
  color: rgb(var(--v-theme-tertiary));
}

.database-erd-node__foreign {
  color: rgb(var(--v-theme-primary));
}

.database-erd-node footer {
  display: flex;
  justify-content: space-between;
  padding: 0.35rem 0.8rem;
  border-top: 1px solid rgba(var(--v-theme-outline), 0.16);
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.61rem;
}

.database-erd-node--collapsed {
  width: 13rem;
}
</style>
