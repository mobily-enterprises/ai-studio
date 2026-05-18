<template>
  <section class="project-type-setup">
    <div class="project-type-setup__heading">
      <p class="project-type-setup__eyebrow">AI Studio</p>
      <h2 class="project-type-setup__title">Choose the project engine</h2>
      <p class="project-type-setup__message">
        {{ headingMessage }}
      </p>
    </div>

    <div class="project-type-setup__options">
      <article
        v-for="projectType in projectTypes"
        :key="projectType.id"
        class="project-type-setup__option"
        :title="projectType.label"
      >
        <div class="project-type-setup__option-top">
          <div>
            <p class="project-type-setup__option-kicker">{{ projectType.id }}</p>
            <h3 class="project-type-setup__option-title">{{ projectType.label }}</h3>
          </div>
          <v-chip
            color="success"
            density="comfortable"
            size="small"
            variant="tonal"
          >
            Ready
          </v-chip>
        </div>

        <p class="project-type-setup__summary">
          {{ projectType.summary || fallbackSummary(projectType) }}
        </p>

        <dl class="project-type-setup__details">
          <div>
            <dt>What it is</dt>
            <dd>{{ projectType.description || "An AI Studio target adapter." }}</dd>
          </div>
          <div>
            <dt>Best for</dt>
            <dd>{{ projectType.bestFor || "Project-specific AI Studio workflows." }}</dd>
          </div>
          <div>
            <dt>End result</dt>
            <dd>{{ projectType.outcome || "Studio will use this adapter once it is implemented." }}</dd>
          </div>
        </dl>

        <div
          v-if="projectType.techStack.length"
          class="project-type-setup__stack"
          aria-label="Technology stack"
        >
          <v-chip
            v-for="tech in projectType.techStack"
            :key="tech"
            class="project-type-setup__stack-chip"
            density="comfortable"
            size="small"
            variant="tonal"
          >
            {{ tech }}
          </v-chip>
        </div>

        <div class="project-type-setup__option-actions">
          <a
            v-if="projectType.projectUrl"
            class="project-type-setup__project-link"
            :href="projectType.projectUrl"
            rel="noreferrer"
            target="_blank"
          >
            <span>{{ projectType.projectUrlLabel || "Open project" }}</span>
            <v-icon :icon="mdiOpenInNew" size="16" />
          </a>
          <span v-else class="project-type-setup__project-link project-type-setup__project-link--empty">
            Project link coming later
          </span>

          <v-btn
            color="primary"
            variant="flat"
            :disabled="saving"
            :loading="savingType === projectType.id"
            @click="emit('select', projectType.id)"
          >
            Use {{ projectType.label }}
          </v-btn>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiOpenInNew
} from "@mdi/js";

const props = defineProps({
  savingType: {
    type: String,
    default: ""
  },
  state: {
    type: Object,
    default: () => ({})
  }
});

const emit = defineEmits(["select"]);

const saving = computed(() => Boolean(props.savingType));
const headingMessage = computed(() => {
  if (props.state?.status && props.state.status !== "missing" && props.state.message) {
    return props.state.message;
  }
  return "Pick the adapter that matches the application you want Studio and Codex to build, inspect, run, and ship.";
});
const projectTypes = computed(() => {
  return Array.isArray(props.state?.availableProjectTypes)
    ? props.state.availableProjectTypes
        .map((projectType) => ({
          ...projectType,
          techStack: Array.isArray(projectType.techStack) ? projectType.techStack : []
        }))
        .filter((projectType) => projectType.enabled === true)
    : [];
});

function fallbackSummary() {
  return "A configured AI Studio adapter for this project type.";
}
</script>

<style scoped>
.project-type-setup {
  display: grid;
  gap: 1rem;
  margin-inline: auto;
  max-width: 78rem;
}

.project-type-setup__heading {
  display: grid;
  gap: 0.25rem;
  max-width: 54rem;
}

.project-type-setup__eyebrow {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  line-height: 1.1;
  margin: 0;
  text-transform: uppercase;
}

.project-type-setup__title {
  font-size: clamp(1.55rem, 2.4vw, 2.2rem);
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.08;
  margin: 0;
}

.project-type-setup__message {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.98rem;
  line-height: 1.45;
  margin: 0;
}

.project-type-setup__options {
  display: grid;
  gap: 0.85rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
}

.project-type-setup__option {
  align-content: start;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  display: grid;
  gap: 0.8rem;
  min-height: 100%;
  padding: 1rem;
}

.project-type-setup__option-top,
.project-type-setup__option-actions {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.project-type-setup__option-kicker {
  color: rgba(var(--v-theme-on-surface), 0.54);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.06em;
  line-height: 1.1;
  margin: 0 0 0.15rem;
  text-transform: uppercase;
}

.project-type-setup__option-title {
  font-size: 1.18rem;
  font-weight: 760;
  letter-spacing: 0;
  line-height: 1.12;
  margin: 0;
}

.project-type-setup__summary {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.95rem;
  font-weight: 650;
  line-height: 1.38;
  margin: 0;
}

.project-type-setup__details {
  display: grid;
  gap: 0.65rem;
  margin: 0;
}

.project-type-setup__details div {
  display: grid;
  gap: 0.18rem;
}

.project-type-setup__details dt {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.72rem;
  font-weight: 760;
  letter-spacing: 0.04em;
  line-height: 1.15;
  text-transform: uppercase;
}

.project-type-setup__details dd {
  color: rgba(var(--v-theme-on-surface), 0.74);
  font-size: 0.88rem;
  line-height: 1.42;
  margin: 0;
}

.project-type-setup__stack {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.project-type-setup__stack-chip {
  color: rgba(var(--v-theme-on-surface), 0.78);
}

.project-type-setup__project-link {
  align-items: center;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  font-size: 0.86rem;
  font-weight: 700;
  gap: 0.25rem;
  min-height: 2.25rem;
  text-decoration: none;
}

.project-type-setup__project-link:hover {
  text-decoration: underline;
}

.project-type-setup__project-link--empty {
  color: rgba(var(--v-theme-on-surface), 0.5);
}

@media (max-width: 700px) {
  .project-type-setup__option-actions {
    align-items: stretch;
    flex-direction: column;
  }

  .project-type-setup__project-link {
    min-height: 1.5rem;
  }
}
</style>
