<template>
  <div class="vibe64-conversation-progress">
    <button
      v-if="messages.length > previewCount"
      :aria-expanded="expanded"
      class="vibe64-conversation-progress__toggle"
      type="button"
      @click="expanded = !expanded"
    >
      {{ toggleLabel }}
    </button>
    <div
      v-for="(message, index) in visibleMessages"
      :key="message.key || message.id || index"
      class="vibe64-conversation-progress__message"
    >
      {{ message.text }}
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";

const props = defineProps({
  messages: { type: Array, default: () => [] },
  pending: { type: Boolean, default: false },
  previewLimit: { type: Number, default: 2 }
});
const expanded = ref(false);
const previewCount = computed(() => props.pending ? props.previewLimit : 0);
const visibleMessages = computed(() => {
  if (expanded.value) {
    return props.messages;
  }
  return previewCount.value > 0 ? props.messages.slice(-previewCount.value) : [];
});
const toggleLabel = computed(() => {
  if (expanded.value) {
    return previewCount.value > 0
      ? `Show latest ${previewCount.value} progress updates`
      : "Hide progress updates";
  }
  return `Show all ${props.messages.length} progress ${props.messages.length === 1 ? "update" : "updates"}`;
});
</script>

<style scoped>
.vibe64-conversation-progress {
  color: rgba(var(--v-theme-on-surface), 0.58);
  display: grid;
  font-size: 0.78rem;
  gap: 0.18rem;
  line-height: 1.42;
  min-width: 0;
  overflow-wrap: anywhere;
}

.vibe64-conversation-progress__message {
  white-space: pre-wrap;
}

.vibe64-conversation-progress__toggle {
  background: transparent;
  border: 0;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font: inherit;
  justify-self: start;
  padding: 0.12rem 0;
  text-align: left;
}

.vibe64-conversation-progress__toggle:hover {
  text-decoration: underline;
}

.vibe64-conversation-progress__toggle:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

@media (pointer: coarse) {
  .vibe64-conversation-progress__toggle {
    min-height: 3rem;
  }
}
</style>
