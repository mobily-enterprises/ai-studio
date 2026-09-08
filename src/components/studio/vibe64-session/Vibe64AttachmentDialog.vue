<template>
  <v-dialog :model-value="Boolean(attachment)" max-width="960" @update:model-value="!$event && emit('close')">
    <v-card v-if="attachment" :title="attachment.fileName">
      <v-card-text>
        <img
          v-if="imageSupported && !imageFailed"
          :key="url"
          :alt="attachment.fileName"
          class="vibe64-attachment-preview"
          :src="`${url}?inline=1`"
          @error="imageFailed = true"
        >
        <p v-else>Preview is unavailable for this file. You can download it below.</p>
      </v-card-text>
      <v-card-actions>
        <v-btn :href="url" :download="attachment.fileName" :prepend-icon="mdiDownload" variant="tonal">Download</v-btn>
        <v-spacer />
        <v-btn @click="emit('close')">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { mdiDownload } from "@mdi/js";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { conversationAttachmentContentType } from "@local/vibe64-runtime/shared";
import { VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID, vibe64AgentAttachmentFilePath } from "@/lib/vibe64SessionRequestConfig.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";

const props = defineProps({
  attachment: { type: Object, default: null },
  sessionId: { type: String, required: true }
});
const emit = defineEmits(["close"]);
const paths = usePaths();
const imageFailed = ref(false);
const url = computed(() => resolveStudioRequestUrl(vibe64AgentAttachmentFilePath(
  paths.api(VIBE64_SESSIONS_API_SUFFIX, { surface: VIBE64_SURFACE_ID }),
  props.sessionId, props.attachment?.attachmentId
)));
const imageSupported = computed(() => conversationAttachmentContentType(props.attachment?.fileName).startsWith("image/"));
watch(() => props.attachment, () => { imageFailed.value = false; });
</script>

<style scoped>
.vibe64-attachment-preview { display: block; margin: auto; max-height: 70vh; max-width: 100%; object-fit: contain; }
</style>
