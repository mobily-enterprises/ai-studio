<template>
  <section class="project-settings">
    <header class="project-settings__header">
      <div>
        <h1>Project settings</h1>
        <p>Vibe64 behavior for this project, stored outside its source repository.</p>
      </div>
      <v-btn
        class="project-settings__refresh"
        :disabled="loading"
        size="small"
        type="button"
        variant="tonal"
        @click="refresh"
      >
        {{ loading ? "Refreshing…" : "Refresh" }}
      </v-btn>
    </header>

    <Vibe64AsyncModuleState
      v-if="loading || loadError"
      label="Project settings"
      :loading="loading"
      :message="loadError || 'Loading project settings.'"
      min-height="12rem"
      @reload="reloadPage"
      @retry="refresh"
    />

    <template v-else>
      <section class="project-settings__section" aria-labelledby="development-database-title">
        <div class="project-settings__section-copy">
          <h2 id="development-database-title">Development database</h2>
          <p v-if="managed">
            Choose whether development sessions share data or receive isolated databases.
            This choice is not supplied to the application as an environment value.
          </p>
          <p v-else>
            This Vibe64 installation does not manage development databases. The application
            receives its database connection through the project Env configuration.
          </p>
        </div>

        <template v-if="managed">
          <v-radio-group
            v-model="scopeDraft"
            class="project-settings__options"
            :disabled="!canChange || databaseSaving"
            hide-details
          >
            <v-radio
              label="A separate database for each session"
              value="session"
            />
            <v-radio
              label="One database shared by this project"
              value="project"
            />
          </v-radio-group>

          <div class="project-settings__action">
            <p v-if="disabledReason">{{ disabledReason }}</p>
            <p v-else-if="scopeDraft === 'project'">
              Data and schema changes will be visible to every project session and remain
              after a session is closed.
            </p>
            <v-btn
              :disabled="!databaseChanged || !canChange || databaseSaving"
              color="primary"
              size="small"
              type="button"
              variant="flat"
              @click="saveDatabase"
            >
              {{ databaseSaving ? "Saving…" : "Save database choice" }}
            </v-btn>
          </div>
        </template>
      </section>

      <section class="project-settings__section" aria-labelledby="ai-behaviour-title">
        <div class="project-settings__section-copy">
          <p class="project-settings__scope">This project — owner managed</p>
          <h2 id="ai-behaviour-title">AI behaviour</h2>
          <p>
            Set how the assistant communicates in future turns for everyone working on
            this project. Existing conversation history stays unchanged.
          </p>
          <v-btn
            class="project-settings__account-link"
            size="small"
            type="button"
            variant="text"
            @click="openPersonalSettings"
          >
            Set what the assistant calls you
          </v-btn>
        </div>

        <div class="project-settings__ai-fields">
          <v-select
            v-model="aiPolicyDraft.tone"
            :disabled="!aiPolicyCanEdit || aiPolicySaving"
            density="comfortable"
            hide-details
            item-title="label"
            item-value="value"
            :items="toneOptions"
            label="Tone"
            variant="outlined"
          />
          <v-select
            v-model="aiPolicyDraft.responseLength"
            :disabled="!aiPolicyCanEdit || aiPolicySaving"
            density="comfortable"
            hide-details
            item-title="label"
            item-value="value"
            :items="responseLengthOptions"
            label="Response length"
            variant="outlined"
          />
          <v-select
            v-model="aiPolicyDraft.expertise"
            :disabled="!aiPolicyCanEdit || aiPolicySaving"
            density="comfortable"
            hide-details
            item-title="label"
            item-value="value"
            :items="expertiseOptions"
            label="Experience level"
            variant="outlined"
          />
          <v-select
            v-model="aiPolicyDraft.rationale"
            :disabled="!aiPolicyCanEdit || aiPolicySaving"
            density="comfortable"
            hide-details
            item-title="label"
            item-value="value"
            :items="rationaleOptions"
            label="Explanation style"
            variant="outlined"
          />
          <v-textarea
            v-model="aiPolicyDraft.customNote"
            class="project-settings__ai-note"
            :disabled="!aiPolicyCanEdit || aiPolicySaving"
            density="compact"
            :error-messages="aiPolicyCustomNoteError ? [aiPolicyCustomNoteError] : []"
            :hint="`${aiPolicyCustomNoteLength} of ${AI_POLICY_CUSTOM_NOTE_MAX_LENGTH} characters`"
            hide-details="auto"
            label="Anything else (optional)"
            placeholder="For example: use Australian English."
            persistent-hint
            rows="2"
            variant="outlined"
          />
          <v-switch
            v-model="aiPolicyDraft.promptHints"
            class="project-settings__ai-hints"
            color="primary"
            :disabled="!aiPolicyCanEdit || aiPolicySaving"
            hide-details
            label="Suggest useful next prompts"
          />
        </div>

        <div class="project-settings__action">
          <p v-if="!aiPolicyCanEdit">
            You can view this project's choices. Only its owner can change them.
          </p>
          <p v-else>
            These choices apply to main and Temporary AI conversations from the next turn.
          </p>
          <v-btn
            :disabled="!aiPolicyChanged || !aiPolicyCanEdit || aiPolicySaving || Boolean(aiPolicyCustomNoteError)"
            color="primary"
            size="small"
            type="button"
            variant="flat"
            @click="saveAiPolicy"
          >
            {{ aiPolicySaving ? "Saving…" : "Save AI behaviour" }}
          </v-btn>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  sessionListRealtimeShouldRefresh
} from "@/composables/useVibe64SessionData.js";
import {
  requestVibe64AccountConnectionsDialog
} from "@/lib/vibe64AccountConnectionsDialog.js";
import {
  AI_POLICY_ENDPOINT,
  DEVELOPMENT_DATABASE_ENDPOINT,
  PROJECT_SETTINGS_ENDPOINT,
  VIBE64_AI_POLICY_API_SUFFIX,
  VIBE64_DEVELOPMENT_DATABASE_API_SUFFIX,
  VIBE64_PROJECT_CHANGED_EVENT,
  projectSettingsQueryKey
} from "@/lib/studioGateApi.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  VIBE64_SESSION_CHANGED_EVENT
} from "@/lib/vibe64SessionRequestConfig.js";

const projectSlug = useVibe64ProjectSlug();
const AI_POLICY_CUSTOM_NOTE_MAX_LENGTH = 500;
const scopeDraft = ref("session");
const aiPolicyDraft = ref(normalizeAiPolicyDraft());
const savedAiPolicy = ref(normalizeAiPolicyDraft());

const toneOptions = Object.freeze([
  { label: "Encouraging", value: "encouraging" },
  { label: "Playful and cheeky", value: "playful" },
  { label: "Direct", value: "direct" },
  { label: "Crisp and military", value: "military" }
]);
const responseLengthOptions = Object.freeze([
  { label: "Very short", value: "very_short" },
  { label: "Concise", value: "concise" },
  { label: "Balanced", value: "balanced" },
  { label: "Detailed", value: "detailed" }
]);
const expertiseOptions = Object.freeze([
  { label: "Beginner", value: "beginner" },
  { label: "Comfortable", value: "comfortable" },
  { label: "Expert", value: "expert" }
]);
const rationaleOptions = Object.freeze([
  { label: "Conclusions only", value: "conclusions" },
  { label: "Concise rationale", value: "concise" },
  { label: "Teaching detail", value: "teaching" }
]);

const resource = useEndpointResource({
  fallbackLoadError: "Project settings could not load.",
  path: PROJECT_SETTINGS_ENDPOINT,
  queryKey: computed(() => projectSettingsQueryKey(
    VIBE64_SURFACE_ID,
    ROUTE_VISIBILITY_PUBLIC,
    projectSlug.value
  )),
  realtime: {
    event: VIBE64_PROJECT_CHANGED_EVENT
  },
  refreshOnPull: true,
  requestRecoveryLabel: "Project settings"
});

const databaseSaveCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_DEVELOPMENT_DATABASE_API_SUFFIX,
  buildCommandOptions: () => ({
    method: "PUT",
    path: DEVELOPMENT_DATABASE_ENDPOINT
  }),
  buildRawPayload: (_model, { context }) => ({
    scope: context.scope
  }),
  fallbackRunError: "Development database choice could not be saved.",
  messages: {
    error: "Development database choice could not be saved.",
    success: "Development database choice saved."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.development-database.scope.save",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PUT"
});

const aiPolicySaveCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_AI_POLICY_API_SUFFIX,
  buildCommandOptions: () => ({
    method: "PUT",
    path: AI_POLICY_ENDPOINT
  }),
  buildRawPayload: (_model, { context }) => ({
    ...context.aiPolicy
  }),
  fallbackRunError: "AI behaviour could not be saved.",
  messages: {
    error: "AI behaviour could not be saved.",
    success: "AI behaviour saved."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.ai-policy.save",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PUT"
});

const developmentDatabase = computed(() => resource.data.value?.developmentDatabase || {});
const managed = computed(() => developmentDatabase.value.managed === true);
const canChange = computed(() => developmentDatabase.value.canChange === true);
const disabledReason = computed(() => String(developmentDatabase.value.disabledReason || ""));
const aiPolicy = computed(() => resource.data.value?.aiPolicy || {});
const aiPolicyCanEdit = computed(() => resource.data.value?.aiPolicyCanEdit === true);
const loading = computed(() => resource.isLoading.value === true);
const loadError = computed(() => String(resource.loadError.value || ""));
const databaseSaving = computed(() => databaseSaveCommand.isRunning === true);
const aiPolicySaving = computed(() => aiPolicySaveCommand.isRunning === true);
const databaseChanged = computed(() => (
  managed.value && scopeDraft.value !== developmentDatabase.value.scope
));
const aiPolicyChanged = computed(() => (
  JSON.stringify(aiPolicyDraft.value) !== JSON.stringify(savedAiPolicy.value)
));
const aiPolicyCustomNoteLength = computed(() => (
  Array.from(String(aiPolicyDraft.value.customNote || "")).length
));
const aiPolicyCustomNoteError = computed(() => (
  aiPolicyCustomNoteLength.value > AI_POLICY_CUSTOM_NOTE_MAX_LENGTH
    ? `Use ${AI_POLICY_CUSTOM_NOTE_MAX_LENGTH} characters or fewer.`
    : ""
));

watch(() => developmentDatabase.value.scope, (scope) => {
  if (["project", "session"].includes(scope)) {
    scopeDraft.value = scope;
  }
}, {
  immediate: true
});

watch(aiPolicy, (value) => {
  const next = normalizeAiPolicyDraft(value);
  aiPolicyDraft.value = next;
  savedAiPolicy.value = normalizeAiPolicyDraft(next);
}, {
  immediate: true
});

useRealtimeEvent({
  event: VIBE64_SESSION_CHANGED_EVENT,
  matches: sessionListRealtimeShouldRefresh,
  onEvent() {
    void resource.reload();
  }
});

async function refresh() {
  await resource.reload();
}

function normalizeAiPolicyDraft(value = {}) {
  return {
    tone: String(value?.tone || "encouraging"),
    responseLength: String(value?.responseLength || "concise"),
    expertise: String(value?.expertise || "comfortable"),
    rationale: String(value?.rationale || "concise"),
    customNote: String(value?.customNote || ""),
    promptHints: value?.promptHints !== false
  };
}

async function saveDatabase() {
  if (!databaseChanged.value || !canChange.value || databaseSaving.value) {
    return;
  }
  await databaseSaveCommand.run({
    scope: scopeDraft.value
  });
  await resource.reload();
}

async function saveAiPolicy() {
  if (
    !aiPolicyChanged.value ||
    !aiPolicyCanEdit.value ||
    aiPolicySaving.value ||
    aiPolicyCustomNoteError.value
  ) {
    return;
  }
  await aiPolicySaveCommand.run({
    aiPolicy: normalizeAiPolicyDraft(aiPolicyDraft.value)
  });
  await resource.reload();
}

function openPersonalSettings() {
  requestVibe64AccountConnectionsDialog({
    refresh: false,
    section: "profile"
  });
}

function reloadPage() {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
</script>

<style scoped>
.project-settings {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.project-settings__header {
  align-items: start;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
}

.project-settings__header h1,
.project-settings__header p,
.project-settings__section-copy h2,
.project-settings__section-copy p,
.project-settings__scope,
.project-settings__action p {
  margin: 0;
}

.project-settings__header h1 {
  font-size: var(--generated-ui-screen-title-size, 1.35rem);
  line-height: 1.1;
}

.project-settings__header p,
.project-settings__section-copy p,
.project-settings__action p {
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.project-settings__header p {
  margin-top: 0.35rem;
}

.project-settings__section {
  align-items: start;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(13rem, 1fr) minmax(17rem, 1.25fr) minmax(14rem, 1fr);
  padding: 1rem;
}

.project-settings__section-copy,
.project-settings__action {
  display: grid;
  gap: 0.4rem;
  min-width: 0;
}

.project-settings__section-copy h2 {
  font-size: 1rem;
}

.project-settings__section-copy p,
.project-settings__action p {
  font-size: 0.875rem;
}

.project-settings__refresh {
  min-width: 6.5rem;
}

.project-settings__options {
  margin: -0.35rem 0;
}

.project-settings__scope {
  color: rgb(var(--v-theme-primary)) !important;
  font-size: 0.75rem !important;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.project-settings__account-link {
  justify-self: start;
  margin-inline-start: -0.75rem;
}

.project-settings__ai-fields {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-width: 0;
}

.project-settings__ai-note,
.project-settings__ai-hints {
  grid-column: 1 / -1;
}

.project-settings__ai-hints {
  margin: -0.35rem 0;
}

.project-settings__action {
  justify-items: end;
}

.project-settings__action p {
  text-align: right;
}

@media (max-width: 900px) {
  .project-settings__section {
    grid-template-columns: 1fr;
  }

  .project-settings__action {
    justify-items: start;
  }

  .project-settings__action p {
    text-align: left;
  }
}

@media (max-width: 540px) {
  .project-settings__ai-fields {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (pointer: coarse) {
  .project-settings :deep(.v-btn) {
    min-height: 3rem;
  }
}
</style>
