<template>
  <v-sheet rounded="lg" border class="project-type-setup">
    <div class="project-type-setup__heading">
      <p class="project-type-setup__eyebrow">AI Studio</p>
      <h2 class="project-type-setup__title">Choose project type</h2>
      <p class="project-type-setup__message">
        {{ state.message || "Choose the adapter AI Studio should use for this project." }}
      </p>
    </div>

    <div class="project-type-setup__options">
      <v-btn
        v-for="projectType in projectTypes"
        :key="projectType.id"
        class="project-type-setup__option"
        color="primary"
        :disabled="saving || projectType.enabled !== true"
        :loading="savingType === projectType.id"
        :title="projectType.disabledReason || projectType.label"
        variant="tonal"
        @click="emit('select', projectType.id)"
      >
        {{ projectType.label }}
      </v-btn>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed } from "vue";

const props = defineProps({
  savingType: {
    type: String,
    default: ""
  },
  state: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(["select"]);

const saving = computed(() => Boolean(props.savingType));
const projectTypes = computed(() => {
  return Array.isArray(props.state?.availableProjectTypes)
    ? props.state.availableProjectTypes
    : [];
});
</script>

<style scoped>
.project-type-setup {
  display: grid;
  gap: 0.9rem;
  padding: 1rem;
}

.project-type-setup__heading {
  display: grid;
  gap: 0.25rem;
}

.project-type-setup__eyebrow {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  line-height: 1.1;
  margin: 0;
  text-transform: uppercase;
}

.project-type-setup__title {
  font-size: 1.18rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.16;
  margin: 0;
}

.project-type-setup__message {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.9rem;
  line-height: 1.35;
  margin: 0;
}

.project-type-setup__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.project-type-setup__option {
  min-width: 8rem;
}
</style>
