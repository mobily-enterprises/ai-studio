<template>
  <section class="studio-ai-sessions__main">
    <div class="studio-ai-sessions__heading">
      <div>
        <p class="studio-ai-sessions__eyebrow">AI Studio session</p>
        <h2 class="studio-ai-sessions__title">{{ selection.selectedSessionTitle }}</h2>
      </div>
      <v-chip
        :color="selection.statusColor(selection.selectedSession.status)"
        variant="tonal"
      >
        {{ selection.statusLabel(selection.selectedSession.status) }}
      </v-chip>
    </div>

    <AiStudioSessionTimeline
      :busy="page.busy"
      :steps="timeline.steps"
      @rewind="timeline.rewindToStep"
    >
      <template #current-step>
        <AiStudioSessionCurrentStep
          :actions="actions"
          :diff="dialogs.diff"
          :issue-request="issueRequest"
          :page="page"
          :review="review"
          @update-issue-request-text="emit('update-issue-request-text', $event)"
        />
      </template>
    </AiStudioSessionTimeline>

    <AiStudioSessionFacts
      class="studio-ai-sessions__facts"
      :facts="selection.facts"
      :status-color="selection.statusColor(selection.selectedSession.status)"
      :status-label="selection.statusLabel(selection.selectedSession.status)"
      @copy="page.copyText"
    />
  </section>
</template>

<script setup>
import AiStudioSessionCurrentStep from "@/components/studio/ai-studio-session/AiStudioSessionCurrentStep.vue";
import AiStudioSessionFacts from "@/components/studio/ai-studio-session/AiStudioSessionFacts.vue";
import AiStudioSessionTimeline from "@/components/studio/ai-studio-session/AiStudioSessionTimeline.vue";

defineProps({
  actions: {
    default: () => ({}),
    type: Object
  },
  dialogs: {
    default: () => ({}),
    type: Object
  },
  issueRequest: {
    default: () => ({}),
    type: Object
  },
  page: {
    default: () => ({}),
    type: Object
  },
  review: {
    default: () => ({}),
    type: Object
  },
  selection: {
    default: () => ({}),
    type: Object
  },
  timeline: {
    default: () => ({}),
    type: Object
  }
});

const emit = defineEmits(["update-issue-request-text"]);
</script>

<style scoped>
.studio-ai-sessions__main {
  min-height: 0;
  min-width: 0;
}

.studio-ai-sessions__facts {
  margin-top: 0.9rem;
}

.studio-ai-sessions__heading {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  margin-bottom: 0.75rem;
  min-width: 0;
}

.studio-ai-sessions__eyebrow {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.02em;
  line-height: 1.1;
  margin: 0 0 0.18rem;
  text-transform: uppercase;
}

.studio-ai-sessions__title {
  font-size: 1.08rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.18;
  margin: 0;
  overflow-wrap: anywhere;
}

@media (min-width: 981px) {
  .studio-ai-sessions__main {
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 0.25rem;
    scrollbar-gutter: stable;
  }
}

@media (max-width: 640px) {
  .studio-ai-sessions__heading {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
