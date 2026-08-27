<template>
  <section
    class="vibe64-prompt-hints"
    :class="`vibe64-prompt-hints--${mode}`"
    data-vibe64-prompt-hints
    @focusout="$emit('focusout', $event)"
    @keydown.esc.stop.prevent="$emit('dismiss')"
  >
    <span
      :id="statusId || undefined"
      aria-atomic="true"
      aria-live="polite"
      class="vibe64-prompt-hints__sr-status"
      role="status"
    >{{ statusAnnouncement }}</span>

    <div
      v-if="mode === 'assistant'"
      aria-hidden="true"
      class="vibe64-prompt-hints__assistant-status"
    >
      <span class="vibe64-prompt-hints__assistant-mark" />
      <span>{{ assistantLabel }}</span>
    </div>

    <template v-else-if="mode !== 'hidden'">
      <div class="vibe64-prompt-hints__label" aria-hidden="true">
        <v-icon :icon="mdiLightbulbOnOutline" size="16" />
        <span>Suggestions</span>
      </div>

      <div
        v-if="mode === 'loading'"
        aria-hidden="true"
        class="vibe64-prompt-hints__loading"
      >
        <span>Thinking of a few ideas</span>
      </div>

      <div
        v-else
        class="vibe64-prompt-hints__options"
        aria-label="Suggested prompts"
        aria-orientation="horizontal"
        role="group"
      >
        <v-btn
          v-for="suggestion in suggestions"
          :key="suggestion"
          :aria-label="`Use suggestion: ${suggestion}`"
          class="vibe64-prompt-hints__option"
          rounded="xl"
          :title="suggestion"
          type="button"
          variant="tonal"
          @mousedown.prevent
          @click="$emit('select', suggestion)"
        >
          <span>{{ suggestion }}</span>
        </v-btn>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { mdiLightbulbOnOutline } from "@mdi/js";

defineEmits(["dismiss", "focusout", "select"]);
const props = defineProps({
  assistantLabel: {
    default: "",
    type: String
  },
  loading: {
    default: false,
    type: Boolean
  },
  statusId: {
    default: "",
    type: String
  },
  suggestions: {
    default: () => [],
    type: Array
  }
});

const mode = computed(() => {
  if (String(props.assistantLabel || "").trim()) {
    return "assistant";
  }
  if (props.loading) {
    return "loading";
  }
  return props.suggestions.length === 3 ? "ready" : "hidden";
});
const statusAnnouncement = computed(() => {
  if (mode.value === "assistant") {
    return String(props.assistantLabel || "").trim();
  }
  if (mode.value === "loading") {
    return "Thinking of a few ideas.";
  }
  if (mode.value === "ready") {
    return "Three suggested prompts are available before the message controls.";
  }
  return "";
});
</script>

<style scoped>
.vibe64-prompt-hints {
  align-items: center;
  box-sizing: border-box;
  color: rgba(var(--v-theme-on-surface), 0.68);
  display: grid;
  grid-row: 4;
  grid-template-columns: auto minmax(0, 1fr);
  height: 0;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding-inline: 0;
}

.vibe64-prompt-hints--assistant,
.vibe64-prompt-hints--loading,
.vibe64-prompt-hints--ready {
  height: 3.5rem;
  min-height: 3.5rem;
  padding-inline: 0.3rem;
}

.vibe64-prompt-hints__sr-status {
  block-size: 1px;
  clip-path: inset(50%);
  inline-size: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
}

.vibe64-prompt-hints__label,
.vibe64-prompt-hints__assistant-status,
.vibe64-prompt-hints__loading {
  align-items: center;
  display: flex;
}

.vibe64-prompt-hints__label {
  font-size: 0.75rem;
  font-weight: 600;
  gap: 0.28rem;
  padding-inline: 0.4rem 0.55rem;
  white-space: nowrap;
}

.vibe64-prompt-hints__assistant-status {
  font-size: 0.78rem;
  gap: 0.45rem;
  grid-column: 1 / -1;
  line-height: 1.35;
  min-width: 0;
  overflow-wrap: anywhere;
  padding-inline: 0.55rem;
}

.vibe64-prompt-hints__assistant-mark {
  animation: vibe64-prompt-hints-pulse 1.2s ease-in-out infinite;
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  height: 0.42rem;
  width: 0.42rem;
}

.vibe64-prompt-hints__loading {
  font-size: 0.76rem;
  min-width: 0;
  padding-inline: 0.5rem;
}

.vibe64-prompt-hints__options {
  align-items: center;
  box-sizing: border-box;
  display: flex;
  gap: 0.35rem;
  height: 100%;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  padding: 0.25rem;
  scroll-snap-type: inline proximity;
  scrollbar-width: none;
}

.vibe64-prompt-hints__options::-webkit-scrollbar {
  display: none;
}

.vibe64-prompt-hints__option {
  color: rgb(var(--v-theme-on-surface));
  flex: 0 0 auto;
  font-size: 0.72rem;
  font-weight: 500;
  height: 3rem;
  letter-spacing: 0;
  line-height: 1.25;
  min-height: 3rem;
  min-width: 0;
  max-width: 14rem;
  padding-inline: 0.75rem;
  scroll-snap-align: start;
  text-transform: none;
}

.vibe64-prompt-hints__option span {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-align: start;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes vibe64-prompt-hints-pulse {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-prompt-hints__assistant-mark {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
</style>
