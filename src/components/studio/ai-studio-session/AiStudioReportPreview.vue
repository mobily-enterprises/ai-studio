<template>
  <section class="studio-report-preview" :aria-label="title || 'Preview'">
    <div
      v-if="title || titleIcon || loading"
      class="studio-report-preview__header"
    >
      <div class="studio-report-preview__identity">
        <v-icon
          v-if="titleIcon"
          :icon="titleIcon"
          size="18"
        />
        <strong v-if="title">{{ title }}</strong>
      </div>
      <v-progress-circular
        v-if="loading"
        color="primary"
        indeterminate
        size="18"
        width="2"
      />
    </div>

    <v-alert
      v-if="error"
      density="compact"
      type="warning"
      variant="tonal"
    >
      {{ error }}
    </v-alert>

    <div v-else class="studio-report-preview__body">
      <LongTextPreviewBlocks
        v-if="textBlocks.length"
        :blocks="textBlocks"
      />
      <p v-else class="studio-report-preview__empty">{{ emptyText }}</p>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";

import LongTextPreviewBlocks from "@/components/studio/LongTextPreviewBlocks.vue";
import { parseLongTextReviewBlocks } from "@/lib/studioLongTextBlocks.js";

const props = defineProps({
  emptyText: {
    default: "Report is not ready yet.",
    type: String
  },
  error: {
    default: "",
    type: String
  },
  loading: {
    default: false,
    type: Boolean
  },
  text: {
    default: "",
    type: String
  },
  title: {
    default: "Session report",
    type: String
  },
  titleIcon: {
    default: "",
    type: String
  }
});

const textBlocks = computed(() => parseLongTextReviewBlocks(props.text));
</script>

<style scoped>
.studio-report-preview {
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
  border-radius: 8px;
  display: grid;
  gap: 0.55rem;
  padding: 0.75rem;
  text-align: left;
}

.studio-report-preview__header {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.studio-report-preview__identity {
  align-items: center;
  color: rgb(var(--v-theme-primary));
  display: flex;
  gap: 0.38rem;
  min-width: 0;
}

.studio-report-preview__identity strong {
  color: rgb(var(--v-theme-on-surface));
}

.studio-report-preview__body {
  color: rgb(var(--v-theme-on-surface));
  max-height: 18rem;
  overflow: auto;
}

.studio-report-preview__empty {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.86rem;
  line-height: 1.45;
  margin: 0;
}
</style>
