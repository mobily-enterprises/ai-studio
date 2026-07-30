<template>
  <v-dialog
    :aria-labelledby="titleId"
    :model-value="abandon.open"
    max-width="620"
    persistent
    @update:model-value="updateOpen"
  >
    <v-card class="studio-ai-session-abandon-dialog">
      <v-card-title
        :id="titleId"
        class="studio-ai-session-abandon-dialog__title"
      >
        <v-icon
          :icon="unsafeWork ? mdiAlertOctagonOutline : mdiAlertCircleOutline"
          :color="unsafeWork ? 'error' : 'warning'"
        />
        Abandon session?
      </v-card-title>
      <v-card-text>
        <Vibe64SessionSourceSafetyNotice
          protectable
          :source-safety="sourceSafety"
          @protected="abandon.cancel"
        />

        <p class="text-body-2 mb-2">
          This will mark the session as abandoned and close its terminals.
        </p>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Session:
          <strong>{{ abandon.sessionTitle || shortSessionId(abandon.sessionId) }}</strong>
        </p>
      </v-card-text>
      <v-card-actions class="studio-ai-session-abandon-dialog__actions">
        <v-btn
          variant="text"
          :disabled="abandon.command.isRunning || sourceSafety.prompting"
          @click="abandon.cancel"
        >
          Cancel
        </v-btn>
        <v-btn
          :color="unsafeWork ? 'error' : 'warning'"
          :disabled="sourceSafety.loading || !sourceSafety.initialized || sourceSafety.prompting"
          variant="flat"
          :loading="abandon.command.isRunning"
          @click="abandon.confirm"
        >
          {{ unsafeWork ? "Abandon anyway" : "Abandon session" }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, unref, useId } from "vue";
import {
  mdiAlertCircleOutline,
  mdiAlertOctagonOutline
} from "@mdi/js";
import Vibe64SessionSourceSafetyNotice from "@/components/studio/vibe64-session/Vibe64SessionSourceSafetyNotice.vue";
import {
  sourceSafetyIsUnsafe
} from "@/lib/vibe64SessionSourceSafety.js";

const props = defineProps({
  abandon: {
    default: () => ({}),
    type: Object
  },
  shortSessionId: {
    default: (sessionId) => String(sessionId || ""),
    type: Function
  }
});

function updateOpen(open) {
  if (open !== true) {
    props.abandon.cancel();
  }
}

const sourceSafety = computed(() => unref(props.abandon.sourceSafety) || {});
const unsafeWork = computed(() => sourceSafetyIsUnsafe(sourceSafety.value));
const titleId = `vibe64-session-abandon-dialog-${useId()}`;
</script>

<style scoped>
.studio-ai-session-abandon-dialog {
  border: 1px solid rgba(var(--v-theme-warning), 0.32);
}

.studio-ai-session-abandon-dialog__title,
.studio-ai-session-abandon-dialog__actions {
  align-items: center;
  display: flex;
  gap: 0.55rem;
}

.studio-ai-session-abandon-dialog__actions {
  justify-content: flex-end;
  padding: 0 1rem 1rem;
}
</style>
