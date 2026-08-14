<template>
  <section class="vibe64-dashboard-page">
    <header class="vibe64-dashboard-page__header">
      <h1>Session History</h1>
    </header>

    <ArchivedVibe64Sessions
      empty-text="Abandoned chats will appear here after their sources are removed."
      empty-title="No abandoned chats"
    />
  </section>
</template>

<script setup>
import ArchivedVibe64Sessions from "@/components/studio/ArchivedVibe64Sessions.vue";
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  margin-inline: auto;
  max-width: 68rem;
  min-width: 0;
  width: 100%;
}

.vibe64-dashboard-page__header {
  min-width: 0;
}

.vibe64-dashboard-page__header h1 {
  color: rgb(var(--v-theme-on-surface));
  font-size: var(--generated-ui-screen-title-size, clamp(1.2rem, 1.7vw, 1.55rem));
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.05;
  margin: 0 0 0.15rem;
}
</style>
