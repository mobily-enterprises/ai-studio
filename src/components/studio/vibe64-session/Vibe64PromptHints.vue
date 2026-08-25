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
        <span class="vibe64-prompt-hints__typing" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>

      <div
        v-else
        class="vibe64-prompt-hints__options"
        aria-label="Suggested prompts"
        role="group"
      >
        <v-btn
          v-for="suggestion in suggestions"
          :key="suggestion"
          :aria-label="`Use suggestion: ${suggestion}`"
          block
          class="vibe64-prompt-hints__option"
          :title="suggestion"
          type="button"
          variant="text"
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
  height: 4.5rem;
  min-height: 4.5rem;
  min-width: 0;
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
  font-size: 0.72rem;
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
  gap: 0.42rem;
  min-width: 0;
  padding-inline: 0.5rem;
}

.vibe64-prompt-hints__typing {
  align-items: center;
  display: inline-flex;
  gap: 0.18rem;
}

.vibe64-prompt-hints__typing span {
  animation: vibe64-prompt-hints-type 1.1s ease-in-out infinite;
  background: currentColor;
  border-radius: 50%;
  height: 0.24rem;
  opacity: 0.35;
  width: 0.24rem;
}

.vibe64-prompt-hints__typing span:nth-child(2) {
  animation-delay: 120ms;
}

.vibe64-prompt-hints__typing span:nth-child(3) {
  animation-delay: 240ms;
}

.vibe64-prompt-hints__options {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  height: 100%;
  min-width: 0;
}

.vibe64-prompt-hints__option {
  border-radius: 0;
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.72rem;
  font-weight: 500;
  height: 100%;
  letter-spacing: 0;
  line-height: 1.25;
  min-height: 3rem;
  min-width: 0;
  padding-inline: 0.45rem;
  text-transform: none;
}

.vibe64-prompt-hints__option + .vibe64-prompt-hints__option {
  border-inline-start: 1px solid rgba(var(--v-theme-outline), 0.2);
}

.vibe64-prompt-hints__option span {
  display: block;
  max-width: 100%;
  overflow-wrap: anywhere;
  text-align: start;
  white-space: normal;
}

@container studio-chat-pane (max-width: 42rem) {
  .vibe64-prompt-hints {
    height: 5.5rem;
    min-height: 5.5rem;
  }

  .vibe64-prompt-hints__label span {
    display: none;
  }

  .vibe64-prompt-hints__label {
    padding-inline: 0.35rem;
  }

  .vibe64-prompt-hints__options {
    display: flex;
    height: 100%;
    min-width: 0;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    scroll-snap-type: inline proximity;
    scrollbar-width: thin;
  }

  .vibe64-prompt-hints__option {
    flex: 0 0 calc(100% - 1.25rem);
    height: auto;
    min-height: 4.5rem;
    padding-block: 0.4rem;
    scroll-snap-align: start;
  }

  .vibe64-prompt-hints__option span {
    max-width: 100%;
  }
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

@keyframes vibe64-prompt-hints-type {
  0%,
  60%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 0.9;
    transform: translateY(-0.12rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-prompt-hints__assistant-mark,
  .vibe64-prompt-hints__typing span {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
</style>
