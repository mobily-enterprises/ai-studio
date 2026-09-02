<template>
  <ul
    v-if="attachments.length"
    aria-label="Attached files"
    class="vibe64-conversation-attachments"
  >
    <li
      v-for="(attachment, index) in attachments"
      :key="attachmentKey(attachment, index)"
      class="vibe64-conversation-attachments__item"
    >
      <v-icon
        aria-hidden="true"
        class="vibe64-conversation-attachments__icon"
        :icon="attachmentIcon(attachment)"
        size="19"
      />
      <span class="vibe64-conversation-attachments__details">
        <span
          class="vibe64-conversation-attachments__name text-body-small font-weight-medium"
          :title="attachment.fileName"
        >
          {{ attachment.fileName }}
        </span>
        <span
          v-if="attachmentSizeLabel(attachment.size)"
          class="vibe64-conversation-attachments__size text-label-small"
        >
          {{ attachmentSizeLabel(attachment.size) }}
        </span>
      </span>
    </li>
  </ul>
</template>

<script setup>
import { computed } from "vue";
import { mdiFileOutline, mdiImageOutline } from "@mdi/js";
import {
  normalizeVibe64ConversationAttachments
} from "@local/vibe64-runtime/shared";

import { attachmentSizeLabel } from "@/lib/vibe64PromptAttachments.js";

const props = defineProps({
  items: {
    default: () => [],
    type: Array
  }
});

const attachments = computed(() => normalizeVibe64ConversationAttachments(props.items));
const imageFilePattern = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/iu;

function attachmentIcon(attachment = {}) {
  return imageFilePattern.test(String(attachment.fileName || ""))
    ? mdiImageOutline
    : mdiFileOutline;
}

function attachmentKey(attachment = {}, index = 0) {
  return `${index}:${attachment.fileName}:${attachment.size ?? ""}`;
}
</script>

<style scoped>
.vibe64-conversation-attachments {
  display: grid;
  gap: 0.35rem;
  list-style: none;
  margin: 0;
  max-width: 100%;
  padding: 0;
  width: min(19rem, 100%);
}

.vibe64-conversation-attachments__item {
  align-items: center;
  background: rgba(var(--v-theme-surface), 0.82);
  border: 1px solid rgba(var(--v-theme-outline), 0.2);
  border-radius: 10px;
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  gap: 0.55rem;
  grid-template-columns: auto minmax(0, 1fr);
  min-height: 2.8rem;
  min-width: 0;
  padding: 0.42rem 0.65rem;
}

.vibe64-conversation-attachments__icon {
  color: rgb(var(--v-theme-primary));
}

.vibe64-conversation-attachments__details {
  display: grid;
  min-width: 0;
}

.vibe64-conversation-attachments__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-conversation-attachments__size {
  color: rgba(var(--v-theme-on-surface), 0.62);
}
</style>
