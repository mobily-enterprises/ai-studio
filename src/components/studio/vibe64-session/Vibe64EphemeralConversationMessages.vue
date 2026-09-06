<template>
  <div
    v-if="messages.length === 0"
    class="vibe64-ephemeral-conversation__empty"
  >
    {{ emptyMessage }}
  </div>
  <article
    v-for="message in messages"
    :key="message.id"
    class="vibe64-ephemeral-conversation__message"
    :class="`vibe64-ephemeral-conversation__message--${message.role}`"
  >
    <strong>{{ message.role === "user" ? userLabel : assistantLabel }}</strong>
    <div
      v-if="message.role === 'assistant' && message.progressUpdates?.length"
      class="vibe64-ephemeral-conversation__progress"
      :aria-label="`${assistantLabel} progress`"
    >
      <span
        v-for="update in message.progressUpdates"
        :key="update.id"
        class="vibe64-ephemeral-conversation__progress-update"
      >
        {{ update.text }}
      </span>
    </div>
    <LongTextPreviewBlocks
      v-if="message.text && message.role === 'assistant'"
      :blocks="parseLongTextReviewBlocks(message.text)"
    />
    <p v-else-if="message.text">{{ message.text }}</p>
    <span v-else-if="['starting', 'inProgress'].includes(message.status)">Working…</span>
    <span v-else-if="message.status === 'interrupted'">Stopped.</span>
    <span v-else-if="message.status === 'failed'">{{ assistantLabel }} stopped with an error.</span>
    <Vibe64ConversationAttachments
      v-if="message.attachments?.length"
      :items="message.attachments"
    />
  </article>
</template>

<script setup>
import LongTextPreviewBlocks from "@/components/studio/LongTextPreviewBlocks.vue";
import Vibe64ConversationAttachments from "@/components/studio/vibe64-session/Vibe64ConversationAttachments.vue";
import { parseLongTextReviewBlocks } from "@/lib/studioLongTextBlocks.js";

defineProps({
  assistantLabel: {
    default: "Temporary AI",
    type: String
  },
  emptyMessage: {
    default: "Ask a focused question without adding it to the main conversation.",
    type: String
  },
  messages: {
    default: () => [],
    type: Array
  },
  userLabel: {
    default: "You",
    type: String
  }
});
</script>

<style scoped>
.vibe64-ephemeral-conversation__empty {
  color: rgba(var(--v-theme-on-surface), 0.6);
  margin: auto;
  max-width: 26rem;
  text-align: center;
}

.vibe64-ephemeral-conversation__message {
  border-radius: 10px;
  display: grid;
  gap: 0.2rem;
  max-width: 92%;
  min-width: 0;
  padding: 0.55rem 0.65rem;
}

.vibe64-ephemeral-conversation__message--user {
  align-self: end;
  background: rgba(var(--v-theme-primary), 0.11);
}

.vibe64-ephemeral-conversation__message--assistant {
  align-self: start;
  background: rgba(var(--v-theme-tertiary), 0.09);
}

.vibe64-ephemeral-conversation__message p {
  margin: 0;
  white-space: pre-wrap;
}

.vibe64-ephemeral-conversation__progress {
  display: grid;
  gap: 0.18rem;
  margin: 0.15rem 0;
}

.vibe64-ephemeral-conversation__progress-update,
.vibe64-ephemeral-conversation__message span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  line-height: 1.35;
}
</style>
