<template>
  <section
    v-if="unsafe"
    class="studio-ai-session-source-safety-notice mb-4"
    role="alert"
  >
    <v-icon :icon="mdiAlertOctagonOutline" size="34" />
    <div>
      <strong>{{ title }}</strong>
      <p>{{ message }}</p>
      <v-btn
        v-if="protectable"
        class="mt-3"
        color="error"
        :disabled="sourceSafety.prompting || sourceSafety.promptSent"
        :loading="sourceSafety.prompting"
        :prepend-icon="mdiSourceCommit"
        size="small"
        variant="flat"
        @click="protectWork"
      >
        {{ protectWorkLabel }} instead
      </v-btn>
      <p
        v-if="sourceSafety.promptError"
        class="studio-ai-session-source-safety-notice__prompt-error mt-2"
      >
        {{ sourceSafety.promptError }}
      </p>
    </div>
  </section>

  <v-alert
    v-else-if="sourceSafety.error"
    class="mb-4"
    color="warning"
    density="compact"
    :icon="mdiAlertCircleOutline"
    variant="tonal"
  >
    Vibe64 could not verify whether this session's work is safely stored:
    {{ sourceSafety.error }}
  </v-alert>

  <div
    v-else-if="sourceSafety.loading || !sourceSafety.initialized"
    class="studio-ai-session-source-safety-notice__checking mb-4"
    role="status"
  >
    <v-progress-circular indeterminate size="18" width="2" />
    Checking the session's existing source-safety status…
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiAlertCircleOutline,
  mdiAlertOctagonOutline,
  mdiSourceCommit
} from "@mdi/js";
import {
  sourceSafetyButtonLabel,
  sourceSafetyDialogMessage,
  sourceSafetyDialogTitle,
  sourceSafetyIsUnsafe
} from "@/lib/vibe64SessionSourceSafety.js";

const props = defineProps({
  message: {
    default: "",
    type: String
  },
  protectable: {
    default: false,
    type: Boolean
  },
  sourceSafety: {
    default: () => ({}),
    type: Object
  }
});

const emit = defineEmits(["protected"]);
const unsafe = computed(() => sourceSafetyIsUnsafe(props.sourceSafety));
const title = computed(() => sourceSafetyDialogTitle(props.sourceSafety));
const message = computed(() => props.message || sourceSafetyDialogMessage(props.sourceSafety));
const protectWorkLabel = computed(() => sourceSafetyButtonLabel(props.sourceSafety));

async function protectWork() {
  if (await props.sourceSafety.prompt?.()) {
    emit("protected");
  }
}
</script>

<style scoped>
.studio-ai-session-source-safety-notice {
  align-items: flex-start;
  background:
    linear-gradient(135deg, rgba(var(--v-theme-error), 0.2), rgba(var(--v-theme-error), 0.08));
  border: 2px solid rgb(var(--v-theme-error));
  border-radius: 12px;
  box-shadow: 0 0.45rem 1.3rem rgba(var(--v-theme-error), 0.18);
  color: rgb(var(--v-theme-error));
  display: grid;
  gap: 0.85rem;
  grid-template-columns: auto minmax(0, 1fr);
  padding: 1rem;
}

.studio-ai-session-source-safety-notice strong {
  display: block;
  font-size: 1.08rem;
  line-height: 1.25;
}

.studio-ai-session-source-safety-notice p {
  color: rgb(var(--v-theme-on-surface));
  line-height: 1.45;
  margin: 0.4rem 0 0;
}

.studio-ai-session-source-safety-notice .studio-ai-session-source-safety-notice__prompt-error {
  color: rgb(var(--v-theme-error));
  font-size: 0.78rem;
  font-weight: 650;
}

.studio-ai-session-source-safety-notice__checking {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: flex;
  font-size: 0.86rem;
  gap: 0.55rem;
}
</style>
