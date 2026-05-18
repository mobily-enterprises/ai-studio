<template>
  <AiStudioDraftEditorDialog
    :model-value="dialogs.draftEditor.open"
    :values="dialogs.draftEditor.values"
    :error="dialogs.draftEditor.error"
    :fields="dialogs.draftEditor.fields"
    :loading="dialogs.draftEditor.loading"
    :saving="dialogs.draftEditor.saving"
    :title="dialogs.draftEditor.title"
    @save="dialogs.draftEditor.save"
    @update:model-value="emit('update-draft-open', $event)"
    @update:values="emit('update-draft-values', $event)"
  />

  <AiStudioSessionInputDialog
    :input="dialogs.input"
    @update-values="emit('update-input-values', $event)"
  />

  <AiStudioSessionDiffDialog :diff="dialogs.diff" />

  <AiStudioSessionAbandonDialog
    :abandon="dialogs.abandon"
    :short-session-id="shortSessionId"
  />
</template>

<script setup>
import AiStudioDraftEditorDialog from "@/components/studio/AiStudioDraftEditorDialog.vue";
import AiStudioSessionAbandonDialog from "@/components/studio/ai-studio-session/AiStudioSessionAbandonDialog.vue";
import AiStudioSessionDiffDialog from "@/components/studio/ai-studio-session/AiStudioSessionDiffDialog.vue";
import AiStudioSessionInputDialog from "@/components/studio/ai-studio-session/AiStudioSessionInputDialog.vue";

defineProps({
  dialogs: {
    default: () => ({}),
    type: Object
  },
  shortSessionId: {
    default: (sessionId) => String(sessionId || ""),
    type: Function
  }
});

const emit = defineEmits([
  "update-draft-open",
  "update-draft-values",
  "update-input-values"
]);
</script>
