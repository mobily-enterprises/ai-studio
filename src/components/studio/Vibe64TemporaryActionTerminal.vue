<template>
  <v-sheet
    v-if="visible && !detailsOpen"
    class="vibe64-temporary-action-terminal__summary"
    :class="{ 'vibe64-temporary-action-terminal__summary--error': Boolean(error) }"
    rounded="lg"
    color="surface-variant"
    role="status"
  >
    <strong class="vibe64-temporary-action-terminal__title">{{ title }}</strong>
    <v-chip
      v-if="status"
      class="vibe64-temporary-action-terminal__status"
      size="x-small"
      variant="tonal"
    >
      {{ status }}
    </v-chip>
    <span class="vibe64-temporary-action-terminal__line">
      {{ summaryText }}
    </span>
    <div class="vibe64-temporary-action-terminal__actions">
      <v-btn
        :aria-label="`Show ${title} details`"
        :color="error ? 'error' : undefined"
        :icon="error ? mdiAlertCircleOutline : mdiConsoleLine"
        size="small"
        :title="`Show ${title} details`"
        variant="text"
        @click="openDetails"
      />
      <v-btn
        :aria-label="`Dismiss ${title}`"
        :icon="mdiClose"
        size="small"
        :title="`Dismiss ${title}`"
        variant="text"
        @click="dismiss"
      />
    </div>
  </v-sheet>

  <Vibe64TerminalSurface
    v-else-if="visible"
    body-mode="log"
    close-label="Dismiss"
    :collapsible="false"
    :error="error"
    :error-title="errorTitle"
    :height="height"
    mobile-takeover
    :open-error-details="Boolean(error)"
    :output="output"
    :retryable="retryable"
    show-close
    :show-copy="Boolean(output)"
    :show-interrupt="false"
    :stage="stage"
    :starting="starting"
    :status="status"
    :subtitle="subtitle"
    :title="title"
    @close="dismiss"
    @copy="$emit('copy')"
    @retry="$emit('retry')"
  >
    <template v-for="slotName in forwardedSlots" #[slotName]="slotProps">
      <slot :name="slotName" v-bind="slotProps || {}" />
    </template>
  </Vibe64TerminalSurface>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { mdiAlertCircleOutline, mdiClose, mdiConsoleLine } from "@mdi/js";
import Vibe64TerminalSurface from "@/components/studio/Vibe64TerminalSurface.vue";
import { terminalLastMeaningfulLine } from "@/lib/codexOutput.js";

const props = defineProps({
  active: {
    default: false,
    type: Boolean
  },
  dismissed: {
    default: false,
    type: Boolean
  },
  error: {
    default: "",
    type: String
  },
  errorTitle: {
    default: "Action needs attention",
    type: String
  },
  height: {
    default: "clamp(8rem, 22vh, 14rem)",
    type: String
  },
  operationKey: {
    default: "",
    type: String
  },
  output: {
    default: "",
    type: String
  },
  retryable: {
    default: false,
    type: Boolean
  },
  stage: {
    default: "",
    type: String
  },
  starting: {
    default: false,
    type: Boolean
  },
  status: {
    default: "",
    type: String
  },
  subtitle: {
    default: "",
    type: String
  },
  title: {
    default: "Action",
    type: String
  }
});

const emit = defineEmits(["copy", "dismiss", "retry"]);

const detailsOpen = ref(false);
const forwardedSlots = [
  "actions-after",
  "actions-before",
  "error-actions",
  "output"
];
const visible = computed(() => !props.dismissed && Boolean(
  props.active || props.error || detailsOpen.value
));
const summaryText = computed(() => {
  const outputLine = terminalLastMeaningfulLine(props.output);
  if (props.error) {
    return props.error;
  }
  if (props.stage && outputLine && props.stage !== outputLine) {
    return `${props.stage} · ${outputLine}`;
  }
  return props.stage || outputLine || "Working…";
});

function openDetails() {
  detailsOpen.value = true;
}

function dismiss() {
  detailsOpen.value = false;
  emit("dismiss");
}

watch(() => props.operationKey, () => {
  detailsOpen.value = false;
}, { immediate: true });

watch(() => props.active, (active, previousActive) => {
  if (active && !previousActive) {
    detailsOpen.value = false;
  }
}, { immediate: true });
</script>

<style scoped>
.vibe64-temporary-action-terminal__summary {
  align-items: center;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  min-height: 2.75rem;
  padding: 0.35rem 0.45rem 0.35rem 0.8rem;
}

.vibe64-temporary-action-terminal__summary--error {
  border-inline-start: 0.25rem solid rgb(var(--v-theme-error));
}

.vibe64-temporary-action-terminal__actions {
  align-items: center;
  display: flex;
}

.vibe64-temporary-action-terminal__title,
.vibe64-temporary-action-terminal__line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-temporary-action-terminal__line {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.82rem;
}

@media (max-width: 600px) {
  .vibe64-temporary-action-terminal__summary {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .vibe64-temporary-action-terminal__status {
    display: none;
  }
}
</style>
