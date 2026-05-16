<template>
  <section class="generated-ui-screen generated-ui-screen--app studio-npm-scripts">
    <ProjectTypeGate>
      <template #default>
        <NpmScriptsPanel />
      </template>
    </ProjectTypeGate>
  </section>
</template>

<script setup>
import NpmScriptsPanel from "@/components/studio/NpmScriptsPanel.vue";
import ProjectTypeGate from "@/components/studio/ProjectTypeGate.vue";
</script>

<style scoped>
.studio-npm-scripts {
  margin-inline: auto;
  max-width: min(86rem, calc(100vw - 2rem));
  width: 100%;
}

@media (max-width: 640px) {
  .studio-npm-scripts {
    max-width: min(100%, calc(100vw - 1rem));
  }
}
</style>
