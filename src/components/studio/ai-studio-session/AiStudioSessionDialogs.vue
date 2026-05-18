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

  <v-dialog
    :model-value="dialogs.input.open"
    max-width="520"
    persistent
    @update:model-value="updateInputDialogOpen"
  >
    <v-card>
      <v-card-title>{{ dialogs.input.title }}</v-card-title>
      <v-card-text class="studio-ai-sessions__input-dialog-body">
        <StudioErrorNotice
          v-if="dialogs.input.error"
          title="Action needs attention"
          :error="dialogs.input.error"
          compact
        />

        <v-text-field
          v-for="field in dialogs.input.fields"
          :key="field.name"
          :model-value="dialogs.input.values[field.name]"
          :disabled="dialogs.input.submitting"
          :label="field.label"
          :placeholder="field.placeholder || undefined"
          variant="outlined"
          @update:model-value="updateInputField(field.name, $event)"
        />
      </v-card-text>
      <v-card-actions class="studio-ai-sessions__input-dialog-actions">
        <v-btn
          variant="text"
          :disabled="dialogs.input.submitting"
          @click="dialogs.input.close"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="dialogs.input.saveDisabled"
          :loading="dialogs.input.submitting"
          @click="dialogs.input.submit"
        >
          Continue
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="dialogs.diff.open"
    max-width="min(94vw, 72rem)"
    @update:model-value="updateDiffDialogOpen"
  >
    <v-card class="studio-ai-sessions__diff-dialog">
      <v-card-title class="studio-ai-sessions__diff-title">
        <span>Review changes</span>
        <v-chip
          v-if="dialogs.diff.payload"
          :color="dialogs.diff.payload.hasChanges ? 'primary' : 'default'"
          size="small"
          variant="tonal"
        >
          {{ dialogs.diff.payload.hasChanges ? "Changes found" : "No changes" }}
        </v-chip>
      </v-card-title>

      <v-card-text
        ref="diffBodyElement"
        class="studio-ai-sessions__diff-body"
        @click="handleDiffBodyClick"
      >
        <StudioErrorNotice
          v-if="dialogs.diff.error"
          title="Diff could not load"
          :error="dialogs.diff.error"
          compact
          class="mb-3"
        />

        <v-progress-linear
          v-if="dialogs.diff.loading"
          color="primary"
          indeterminate
          class="mb-3"
        />

        <pre
          v-if="dialogs.diff.payload?.gitStatus"
          class="studio-ai-sessions__diff-status"
        >{{ dialogs.diff.payload.gitStatus }}</pre>

        <!-- eslint-disable vue/no-v-html -- Diff2Html escapes git diff content before rendering. -->
        <div
          v-if="renderedDiff"
          class="studio-ai-sessions__diff-rendered"
          v-html="renderedDiff"
        />
        <!-- eslint-enable vue/no-v-html -->

        <v-alert
          v-else-if="!dialogs.diff.loading && !dialogs.diff.error"
          type="info"
          variant="tonal"
        >
          No diff is available for this session worktree.
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialogs.diff.close">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="dialogs.abandon.open"
    max-width="520"
    persistent
    @update:model-value="updateAbandonDialogOpen"
  >
    <v-card class="studio-ai-sessions__abandon-dialog">
      <v-card-title class="studio-ai-sessions__abandon-title">
        <v-icon :icon="mdiAlertCircleOutline" color="warning" />
        Abandon session?
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-2">
          This will mark the session as abandoned and close its terminals.
        </p>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Session:
          <strong>{{ dialogs.abandon.sessionTitle || shortSessionId(dialogs.abandon.sessionId) }}</strong>
        </p>
      </v-card-text>
      <v-card-actions class="studio-ai-sessions__abandon-actions">
        <v-btn
          variant="text"
          :disabled="dialogs.abandon.command.isRunning"
          @click="dialogs.abandon.cancel"
        >
          Cancel
        </v-btn>
        <v-btn
          color="warning"
          variant="flat"
          :loading="dialogs.abandon.command.isRunning"
          @click="dialogs.abandon.confirm"
        >
          Abandon session
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import {
  computed,
  ref
} from "vue";
import { html as renderDiffHtml } from "diff2html";
import "diff2html/bundles/css/diff2html.min.css";
import { mdiAlertCircleOutline } from "@mdi/js";
import AiStudioDraftEditorDialog from "@/components/studio/AiStudioDraftEditorDialog.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";

const props = defineProps({
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
  "update-input-values",
  "update-draft-open",
  "update-draft-values"
]);

const diffBodyElement = ref(null);

const combinedDiff = computed(() => {
  const payload = props.dialogs.diff?.payload || {};
  return [payload.stagedDiff, payload.unstagedDiff, payload.untrackedDiff]
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .join("\n");
});

const renderedDiff = computed(() => {
  if (!combinedDiff.value) {
    return "";
  }
  return renderDiffHtml(combinedDiff.value, {
    drawFileList: true,
    matching: "lines",
    outputFormat: "side-by-side"
  });
});

function updateInputDialogOpen(open) {
  if (open !== true) {
    props.dialogs.input.close();
  }
}

function updateDiffDialogOpen(open) {
  if (open !== true) {
    props.dialogs.diff.close();
  }
}

function updateAbandonDialogOpen(open) {
  if (open !== true) {
    props.dialogs.abandon.cancel();
  }
}

function updateInputField(name, value) {
  emit("update-input-values", {
    ...(props.dialogs.input.values || {}),
    [name]: String(value || "")
  });
}

function handleDiffBodyClick(event) {
  const clickedElement = event.target instanceof Element ? event.target : null;
  const link = clickedElement?.closest("a");
  const diffBody = diffBodyElement.value?.$el || diffBodyElement.value;
  if (!link || !diffBody?.contains(link)) {
    return;
  }

  const href = String(link.getAttribute("href") || "");
  if (!href.startsWith("#")) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const target = document.getElementById(href.slice(1));
  if (target && diffBody.contains(target)) {
    target.scrollIntoView({
      block: "start",
      behavior: "smooth"
    });
  }
}
</script>

<style scoped>
.studio-ai-sessions__input-dialog-body {
  display: grid;
  gap: 0.75rem;
}

.studio-ai-sessions__input-dialog-actions {
  justify-content: flex-end;
  padding: 0 1rem 1rem;
}

.studio-ai-sessions__diff-dialog {
  max-height: 90vh;
}

.studio-ai-sessions__diff-title {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.studio-ai-sessions__diff-body {
  max-height: 72vh;
  overflow-x: hidden;
  overflow-y: auto;
}

.studio-ai-sessions__diff-status {
  background: rgba(var(--v-theme-surface-variant), 0.55);
  border: 1px solid rgba(var(--v-border-color), 0.3);
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.35;
  margin: 0 0 0.75rem;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
}

.studio-ai-sessions__diff-rendered {
  min-width: 0;
  overflow-x: hidden;
}

.studio-ai-sessions__diff-rendered :deep(.d2h-wrapper) {
  color: #1f2937;
}

.studio-ai-sessions__diff-rendered :deep(.d2h-file-wrapper) {
  border-color: rgba(var(--v-border-color), 0.34);
  border-radius: 8px;
  margin-bottom: 0.75rem;
}

.studio-ai-sessions__diff-rendered :deep(.d2h-file-header) {
  border-radius: 8px 8px 0 0;
}

.studio-ai-sessions__diff-rendered :deep(.d2h-files-diff),
.studio-ai-sessions__diff-rendered :deep(.d2h-file-side-diff) {
  min-width: 0;
}

.studio-ai-sessions__diff-rendered :deep(.d2h-file-side-diff) {
  overflow-x: auto;
}

.studio-ai-sessions__abandon-dialog {
  border: 1px solid rgba(var(--v-theme-warning), 0.32);
}

.studio-ai-sessions__abandon-title,
.studio-ai-sessions__abandon-actions {
  align-items: center;
  display: flex;
  gap: 0.55rem;
}

.studio-ai-sessions__abandon-actions {
  justify-content: flex-end;
  padding: 0 1rem 1rem;
}
</style>
