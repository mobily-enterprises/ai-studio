<template>
  <v-dialog
    :model-value="modelValue"
    fullscreen
    transition="dialog-bottom-transition"
    @update:model-value="updateOpen"
  >
    <v-card class="ai-studio-draft-editor">
      <v-toolbar
        border
        color="surface"
        density="comfortable"
      >
        <v-btn
          :disabled="saving"
          :icon="mdiClose"
          :title="closeLabel"
          variant="text"
          @click="updateOpen(false)"
        />
        <v-toolbar-title class="ai-studio-draft-editor__title">
          {{ editorTitle }}
        </v-toolbar-title>
        <v-spacer />
        <v-btn
          color="primary"
          :disabled="saveDisabled"
          :loading="saving"
          :prepend-icon="mdiContentSave"
          variant="flat"
          @click="$emit('save')"
        >
          Save
        </v-btn>
      </v-toolbar>

      <v-card-text class="ai-studio-draft-editor__body">
        <StudioErrorNotice
          v-if="error"
          title="Draft editor needs attention"
          :error="error"
          compact
        />

        <v-progress-linear
          v-if="loading"
          color="primary"
          height="6"
          indeterminate
          rounded
        />

        <div class="ai-studio-draft-editor__fields">
          <v-text-field
            v-if="isIssue"
            :model-value="issueTitle"
            label="Issue title"
            variant="outlined"
            :disabled="loading || saving"
            @update:model-value="$emit('update:issueTitle', $event)"
          />

          <v-textarea
            :model-value="bodyText"
            :label="bodyLabel"
            variant="outlined"
            auto-grow
            rows="22"
            :disabled="loading || saving"
            @update:model-value="$emit('update:bodyText', $event)"
          />
        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiClose,
  mdiContentSave
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";

const props = defineProps({
  bodyText: {
    type: String,
    default: ""
  },
  error: {
    type: String,
    default: ""
  },
  issueTitle: {
    type: String,
    default: ""
  },
  kind: {
    type: String,
    default: "issue"
  },
  loading: {
    type: Boolean,
    default: false
  },
  modelValue: {
    type: Boolean,
    default: false
  },
  saving: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits([
  "save",
  "update:bodyText",
  "update:issueTitle",
  "update:modelValue"
]);

const isIssue = computed(() => props.kind === "issue");
const editorTitle = computed(() => isIssue.value ? "Edit issue" : "Edit pull request");
const bodyLabel = computed(() => isIssue.value ? "Issue body" : "Pull request body");
const closeLabel = computed(() => `Close ${editorTitle.value.toLowerCase()}`);
const saveDisabled = computed(() => {
  if (props.loading || props.saving) {
    return true;
  }
  if (!String(props.bodyText || "").trim()) {
    return true;
  }
  return isIssue.value && !String(props.issueTitle || "").trim();
});

function updateOpen(open) {
  emit("update:modelValue", open === true);
}
</script>

<style scoped>
.ai-studio-draft-editor {
  min-width: 0;
}

.ai-studio-draft-editor__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-studio-draft-editor__body {
  display: grid;
  gap: 0.9rem;
  height: 100%;
  min-height: 0;
  padding: 1rem;
}

.ai-studio-draft-editor__fields {
  display: grid;
  gap: 0.8rem;
  margin-inline: auto;
  max-width: 72rem;
  min-width: 0;
  width: 100%;
}

.ai-studio-draft-editor__fields :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  line-height: 1.45;
}
</style>
