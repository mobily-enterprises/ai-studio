<template>
  <div class="project-foundation-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Project foundation could not load"
      :error="errorMessage"
      compact
    />

    <v-skeleton-loader
      v-if="foundationInitialLoading"
      aria-label="Loading project foundation"
      class="project-foundation-gate__loading"
      type="article"
    />

    <ProjectTemplateSetup
      v-else-if="foundationSetupVisible"
      :applying-template-id="applyingTemplateId"
      :loading="projectTemplatesLoading"
      :templates="projectTemplates"
      @apply="applyProjectTemplate"
    />

    <slot
      v-else-if="foundationReady"
      :target-project="projectState"
      :reload="loadProjectFoundation"
    />
  </div>
</template>

<script setup>
import ProjectTemplateSetup from "@/components/studio/ProjectTemplateSetup.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useProjectFoundationGate } from "@/composables/useProjectFoundationGate.js";

const emit = defineEmits(["ready", "missing", "error"]);

const {
  applyProjectTemplate,
  applyingTemplateId,
  errorMessage,
  foundationInitialLoading,
  foundationReady,
  foundationSetupVisible,
  loadProjectFoundation,
  projectState,
  projectTemplates,
  projectTemplatesLoading
} = useProjectFoundationGate(emit);
</script>

<style scoped>
.project-foundation-gate {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.project-foundation-gate__loading {
  flex: 1 1 auto;
  min-height: 18rem;
}
</style>
