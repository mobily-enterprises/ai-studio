<template>
  <section class="vibe64-dashboard-page">
    <ProjectSettingsPanel />
  </section>
</template>

<script setup>
import ProjectSettingsPanel from "@/components/studio/ProjectSettingsPanel.vue";
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
</style>
