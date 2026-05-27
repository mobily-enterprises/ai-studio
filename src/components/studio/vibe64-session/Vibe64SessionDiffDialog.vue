<template>
  <v-dialog
    :model-value="diff.open"
    max-width="min(94vw, 72rem)"
    @update:model-value="updateOpen"
  >
    <v-card class="studio-ai-session-diff-dialog">
      <v-card-title class="studio-ai-session-diff-dialog__title">
        <span>Review changes</span>
        <v-chip
          v-if="diff.payload"
          :color="diff.payload.hasChanges ? 'primary' : 'default'"
          size="small"
          variant="tonal"
        >
          {{ diff.payload.hasChanges ? "Changes found" : "No changes" }}
        </v-chip>
      </v-card-title>

      <v-card-text
        ref="diffBodyElement"
        class="studio-ai-session-diff-dialog__body"
        @click="handleDiffBodyClick"
      >
        <StudioErrorNotice
          v-if="diff.error"
          title="Diff could not load"
          :error="diff.error"
          compact
          class="mb-3"
        />

        <v-progress-linear
          v-if="diff.loading"
          color="primary"
          indeterminate
          class="mb-3"
        />

        <pre
          v-if="diff.payload?.gitStatus"
          class="studio-ai-session-diff-dialog__status"
        >{{ diff.payload.gitStatus }}</pre>

        <!-- eslint-disable vue/no-v-html -- Diff2Html escapes git diff content before rendering. -->
        <div
          v-if="renderedDiff"
          class="studio-ai-session-diff-dialog__rendered"
          v-html="renderedDiff"
        />
        <!-- eslint-enable vue/no-v-html -->

        <v-alert
          v-else-if="!diff.loading && !diff.error"
          type="info"
          variant="tonal"
        >
          No diff is available for this session worktree.
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="diff.close">Close</v-btn>
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
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";

const props = defineProps({
  diff: {
    default: () => ({}),
    type: Object
  }
});

const diffBodyElement = ref(null);

const combinedDiff = computed(() => {
  const payload = props.diff.payload || {};
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

function updateOpen(open) {
  if (open !== true) {
    props.diff.close();
  }
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
.studio-ai-session-diff-dialog {
  max-height: 90vh;
}

.studio-ai-session-diff-dialog__title {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.studio-ai-session-diff-dialog__body {
  max-height: 72vh;
  overflow-x: hidden;
  overflow-y: auto;
}

.studio-ai-session-diff-dialog__status {
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

.studio-ai-session-diff-dialog__rendered {
  min-width: 0;
  overflow-x: hidden;
}

.studio-ai-session-diff-dialog__rendered :deep(.d2h-wrapper) {
  color: #1f2937;
}

.studio-ai-session-diff-dialog__rendered :deep(.d2h-file-wrapper) {
  border-color: rgba(var(--v-border-color), 0.34);
  border-radius: 8px;
  margin-bottom: 0.75rem;
}

.studio-ai-session-diff-dialog__rendered :deep(.d2h-file-header) {
  border-radius: 8px 8px 0 0;
}

.studio-ai-session-diff-dialog__rendered :deep(.d2h-files-diff),
.studio-ai-session-diff-dialog__rendered :deep(.d2h-file-side-diff) {
  min-width: 0;
}

.studio-ai-session-diff-dialog__rendered :deep(.d2h-file-side-diff) {
  overflow-x: auto;
}
</style>
