<template>
  <v-dialog
    :aria-labelledby="titleId"
    :model-value="finish.open"
    max-width="620"
    persistent
    @update:model-value="updateOpen"
  >
    <v-card
      class="studio-ai-session-finish-dialog"
      :class="{ 'studio-ai-session-finish-dialog--unsafe': unsafeWork }"
    >
      <v-card-title
        :id="titleId"
        class="studio-ai-session-finish-dialog__title"
      >
        <v-icon
          :icon="unsafeWork ? mdiAlertOctagonOutline : mdiArchiveCheckOutline"
          :color="unsafeWork ? 'error' : 'primary'"
        />
        Finish session?
      </v-card-title>
      <v-card-text>
        <Vibe64SessionSourceSafetyNotice
          :message="unsafeWorkMessage"
          :source-safety="sourceSafety"
        />

        <p class="text-body-2 mb-0">
          Finishing archives this session and closes its terminals.
        </p>
      </v-card-text>
      <v-card-actions class="studio-ai-session-finish-dialog__actions">
        <v-btn
          variant="text"
          @click="finish.cancel"
        >
          Cancel
        </v-btn>
        <v-btn
          :color="unsafeWork ? 'error' : 'primary'"
          :disabled="sourceSafety.loading || !sourceSafety.initialized"
          variant="flat"
          @click="finish.confirm"
        >
          {{ unsafeWork ? "Finish anyway" : "Finish session" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, unref, useId } from "vue";
import {
  mdiAlertOctagonOutline,
  mdiArchiveCheckOutline
} from "@mdi/js";
import Vibe64SessionSourceSafetyNotice from "@/components/studio/vibe64-session/Vibe64SessionSourceSafetyNotice.vue";
import {
  sourceSafetyIsUnsafe,
  sourceSafetyRequiresPush
} from "@/lib/vibe64SessionSourceSafety.js";

const props = defineProps({
  finish: {
    default: () => ({}),
    type: Object
  }
});

const sourceSafety = computed(() => unref(props.finish.sourceSafety) || {});
const unsafeWork = computed(() => sourceSafetyIsUnsafe(sourceSafety.value));
const unsafeWorkMessage = computed(() => (
  "These changes will be archived away with the session. " +
  (
    sourceSafetyRequiresPush(sourceSafety.value)
      ? "They will not be pushed to origin/main."
      : "They will not be committed to the project source."
  )
));
const titleId = `vibe64-session-finish-dialog-${useId()}`;

function updateOpen(open) {
  if (open !== true) {
    props.finish.cancel();
  }
}
</script>

<style scoped>
.studio-ai-session-finish-dialog {
  border: 1px solid rgba(var(--v-theme-primary), 0.3);
}

.studio-ai-session-finish-dialog--unsafe {
  border: 2px solid rgb(var(--v-theme-error));
}

.studio-ai-session-finish-dialog__title,
.studio-ai-session-finish-dialog__actions {
  align-items: center;
  display: flex;
  gap: 0.55rem;
}

.studio-ai-session-finish-dialog__actions {
  justify-content: flex-end;
  padding: 0 1rem 1rem;
}
</style>
