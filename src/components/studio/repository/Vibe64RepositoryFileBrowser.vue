<template>
  <div
    class="vibe64-repository-file-browser"
    :class="{ 'vibe64-repository-file-browser--embedded': embedded }"
  >
    <aside :aria-label="ariaLabel" class="vibe64-repository-file-browser__list">
      <header v-if="listTitle">
        <strong>{{ listTitle }}</strong>
        <span v-if="listDescription">{{ listDescription }}</span>
      </header>
      <button
        v-for="file in files"
        :key="file.path"
        :aria-current="selectedPath === file.path ? 'true' : undefined"
        class="vibe64-repository-file-browser__file"
        :class="{ 'vibe64-repository-file-browser__file--active': selectedPath === file.path }"
        type="button"
        @click="$emit('select', file)"
      >
        <span class="vibe64-repository-file-browser__path">{{ file.path }}</span>
        <span class="vibe64-repository-file-browser__meta">
          {{ fileStatusLabel(file.status) }}
          <span class="vibe64-repository-file-browser__counts">+{{ file.added }} −{{ file.deleted }}</span>
        </span>
      </button>
      <v-btn
        v-if="truncated"
        :loading="loadingMore"
        size="small"
        type="button"
        variant="text"
        @click="$emit('load-more')"
      >
        Load more files
      </v-btn>
    </aside>
    <main class="vibe64-repository-file-browser__detail">
      <h2>{{ selectedPath || emptyTitle }}</h2>
      <Vibe64RepositoryDiff
        :error="error"
        :loading="loading"
        :payload="payload"
      />
    </main>
  </div>
</template>

<script setup>
import Vibe64RepositoryDiff from "@/components/studio/repository/Vibe64RepositoryDiff.vue";

defineEmits(["load-more", "select"]);

defineProps({
  ariaLabel: { default: "Changed files", type: String },
  embedded: { default: false, type: Boolean },
  emptyTitle: { default: "Select a file", type: String },
  error: { default: "", type: String },
  files: { default: () => [], type: Array },
  listDescription: { default: "", type: String },
  listTitle: { default: "", type: String },
  loading: { default: false, type: Boolean },
  loadingMore: { default: false, type: Boolean },
  payload: { default: null, type: Object },
  selectedPath: { default: "", type: String },
  truncated: { default: false, type: Boolean }
});

function fileStatusLabel(value = "") {
  return ({
    A: "Added",
    C: "Copied",
    D: "Removed",
    M: "Changed",
    R: "Renamed",
    T: "Type changed",
    U: "Needs attention"
  })[String(value || "").slice(0, 1).toUpperCase()] || "Changed";
}
</script>

<style scoped>
.vibe64-repository-file-browser {
  align-items: start;
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  border-radius: 0.75rem;
  display: grid;
  grid-template-columns: minmax(16rem, 21rem) minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.vibe64-repository-file-browser--embedded {
  border: 0;
  border-radius: 0;
  height: 100%;
  width: 100%;
}

.vibe64-repository-file-browser__list {
  border-inline-end: 1px solid rgba(var(--v-theme-outline), 0.16);
  max-height: 44rem;
  min-width: 0;
  overflow: auto;
}

.vibe64-repository-file-browser--embedded .vibe64-repository-file-browser__list {
  max-height: none;
}

.vibe64-repository-file-browser__list header {
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.14);
  display: grid;
  gap: 0.18rem;
  padding: 0.75rem;
}

.vibe64-repository-file-browser__list header span {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
}

.vibe64-repository-file-browser__file {
  background: transparent;
  border: 0;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.1);
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 0.18rem;
  padding: 0.62rem 0.75rem;
  text-align: start;
  width: 100%;
}

.vibe64-repository-file-browser__file:hover,
.vibe64-repository-file-browser__file:focus-visible,
.vibe64-repository-file-browser__file--active {
  background: rgba(var(--v-theme-primary), 0.09);
  outline: none;
}

.vibe64-repository-file-browser__path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.vibe64-repository-file-browser__meta {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: flex;
  font-size: 0.74rem;
  gap: 0.5rem;
  justify-content: space-between;
}

.vibe64-repository-file-browser__counts {
  white-space: nowrap;
}

.vibe64-repository-file-browser__detail {
  align-content: start;
  align-self: start;
  display: grid;
  gap: 0.65rem;
  min-width: 0;
  overflow: auto;
  padding: 0.75rem;
}

.vibe64-repository-file-browser--embedded .vibe64-repository-file-browser__detail {
  align-self: stretch;
  min-height: 0;
}

.vibe64-repository-file-browser__detail h2 {
  font-size: 0.94rem;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

@media (max-width: 780px) {
  .vibe64-repository-file-browser {
    grid-template-columns: minmax(0, 1fr);
  }

  .vibe64-repository-file-browser__list,
  .vibe64-repository-file-browser--embedded .vibe64-repository-file-browser__list {
    border-bottom: 1px solid rgba(var(--v-theme-outline), 0.16);
    border-inline-end: 0;
    max-height: 16rem;
  }
}
</style>
