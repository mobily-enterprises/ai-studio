<template>
  <section class="project-settings">
    <header class="project-settings__header">
      <div>
        <h1>Project settings</h1>
        <p>Project-wide Vibe64 behavior and source-owned engineering choices.</p>
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
      v-if="initialLoading || loadError"
      label="Project settings"
      :loading="loading"
      :message="loadError || 'Loading project settings.'"
      min-height="12rem"
      @reload="reloadPage"
      @retry="refresh"
    />

    <template v-else>
      <section class="project-settings__section" aria-labelledby="engineering-approach-title">
        <div class="project-settings__section-copy">
          <p v-if="engineeringAvailable" class="project-settings__scope">
            {{ engineeringSourceLabel }}
          </p>
          <h2 id="engineering-approach-title">Engineering approach</h2>
          <p>
            Choose how cautiously the AI changes this software. Every profile still requires
            simple, targeted code and a question before necessary complexity is added.
          </p>
        </div>

        <template v-if="engineeringAvailable">
          <div class="project-settings__engineering-field">
            <v-select
              v-model="engineeringProfileDraft"
              :disabled="engineeringSaving"
              density="comfortable"
              hide-details="auto"
              :hint="selectedEngineeringDescription"
              item-title="name"
              item-value="id"
              :items="engineeringProfiles"
              label="Engineering profile"
              persistent-hint
              variant="outlined"
            />
          </div>

          <div class="project-settings__action">
            <p>{{ engineeringStatusText }}</p>
            <v-btn
              :disabled="!engineeringChanged || engineeringSaving"
              color="primary"
              size="small"
              type="button"
              variant="flat"
              @click="saveEngineeringProfile"
            >
              {{ engineeringSaving ? "Saving…" : "Save engineering approach" }}
            </v-btn>
          </div>
        </template>

        <div v-else class="project-settings__action">
          <p>{{ engineeringUnavailableReason }}</p>
        </div>
      </section>

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
            aria-labelledby="development-database-title"
            class="project-settings__options"
            :disabled="databaseSaving"
            hide-details
          >
            <div class="project-settings__option">
              <v-radio
                :aria-describedby="sessionScopeReason ? 'development-database-session-reason' : undefined"
                :disabled="!sessionScopeAvailable"
                label="A separate database for each session"
                value="session"
              />
              <p
                v-if="sessionScopeReason"
                id="development-database-session-reason"
                class="project-settings__option-support"
              >
                {{ sessionScopeReason }}
              </p>
            </div>
            <div class="project-settings__option">
              <v-radio
                :aria-describedby="projectScopeReason ? 'development-database-project-reason' : undefined"
                :disabled="!projectScopeAvailable"
                label="One database shared by this project"
                value="project"
              />
              <p
                v-if="projectScopeReason"
                id="development-database-project-reason"
                class="project-settings__option-support"
              >
                {{ projectScopeReason }}
              </p>
            </div>
          </v-radio-group>

          <div class="project-settings__action">
            <p v-if="disabledReason">{{ disabledReason }}</p>
            <p v-else-if="scopeDraft === 'project'">
              Data and schema changes will be visible to every project session and remain
              after a session is closed.
            </p>
            <v-btn
              :disabled="!databaseChanged || !canChange || !scopeDraftAvailable || databaseSaving"
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
import { useRoute, useRouter } from "vue-router";
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
  ENGINEERING_ENDPOINT,
  PROJECT_SETTINGS_ENDPOINT,
  VIBE64_AI_POLICY_API_SUFFIX,
  VIBE64_DEVELOPMENT_DATABASE_API_SUFFIX,
  VIBE64_ENGINEERING_API_SUFFIX,
  VIBE64_PROJECT_CHANGED_EVENT,
  engineeringSettingsQueryKey,
  projectSettingsQueryKey
} from "@/lib/studioGateApi.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  VIBE64_SESSION_CHANGED_EVENT
} from "@/lib/vibe64SessionRequestConfig.js";

const projectSlug = useVibe64ProjectSlug();
const route = useRoute();
const router = useRouter();
const AI_POLICY_CUSTOM_NOTE_MAX_LENGTH = 500;
const scopeDraft = ref("session");
const aiPolicyDraft = ref(normalizeAiPolicyDraft());
const savedAiPolicy = ref(normalizeAiPolicyDraft());
const engineeringProfileDraft = ref("");
const savedEngineeringProfile = ref("");
const routeSessionId = computed(() => String(route.query.sessionId || "").trim());

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

const engineeringResource = useEndpointResource({
  fallbackLoadError: "Engineering approach could not load.",
  path: ENGINEERING_ENDPOINT,
  queryKey: computed(() => engineeringSettingsQueryKey(
    VIBE64_SURFACE_ID,
    ROUTE_VISIBILITY_PUBLIC,
    projectSlug.value,
    routeSessionId.value
  )),
  readQuery: computed(() => (
    routeSessionId.value ? { sessionId: routeSessionId.value } : {}
  )),
  realtime: {
    event: VIBE64_PROJECT_CHANGED_EVENT
  },
  refreshOnPull: true,
  requestRecoveryLabel: "Engineering approach"
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

const engineeringSaveCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_ENGINEERING_API_SUFFIX,
  buildCommandOptions: () => ({
    method: "PUT",
    path: ENGINEERING_ENDPOINT
  }),
  buildRawPayload: (_model, { context }) => ({
    profile: context.profile,
    ...(context.sessionId ? { sessionId: context.sessionId } : {})
  }),
  fallbackRunError: "Engineering approach could not be saved.",
  messages: {
    error: "Engineering approach could not be saved.",
    success: "Engineering approach saved."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.engineering.profile.save",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PUT"
});

const developmentDatabase = computed(() => resource.data.value?.developmentDatabase || {});
const managed = computed(() => developmentDatabase.value.managed === true);
const canChange = computed(() => developmentDatabase.value.canChange === true);
const disabledReason = computed(() => String(developmentDatabase.value.disabledReason || ""));
const sessionScopeOption = computed(() => developmentDatabase.value.options?.session || {});
const projectScopeOption = computed(() => developmentDatabase.value.options?.project || {});
const sessionScopeAvailable = computed(() => sessionScopeOption.value.available === true);
const projectScopeAvailable = computed(() => projectScopeOption.value.available === true);
const sessionScopeReason = computed(() => String(sessionScopeOption.value.disabledReason || ""));
const projectScopeReason = computed(() => String(projectScopeOption.value.disabledReason || ""));
const scopeDraftAvailable = computed(() => (
  scopeDraft.value === "project" ? projectScopeAvailable.value : sessionScopeAvailable.value
));
const aiPolicy = computed(() => resource.data.value?.aiPolicy || {});
const aiPolicyCanEdit = computed(() => resource.data.value?.aiPolicyCanEdit === true);
const engineering = computed(() => engineeringResource.data.value?.engineering || {});
const engineeringAvailable = computed(() => engineering.value.available === true);
const engineeringProfiles = computed(() => (
  Array.isArray(engineering.value.profiles) ? engineering.value.profiles : []
));
const engineeringSourceLabel = computed(() => (
  engineering.value.source?.rootKind === "session-source"
    ? "This session's project source"
    : "This project source"
));
const engineeringUnavailableReason = computed(() => String(
  engineering.value.unavailableReason || "An engineering profile is not available for this source."
));
const selectedEngineeringDescription = computed(() => String(
  engineeringProfiles.value.find((profile) => profile.id === engineeringProfileDraft.value)?.description || ""
));
const engineeringStatusText = computed(() => (
  engineering.value.status === "defaulted"
    ? "The focused default is active. Saving records the choice in genesis/engineering.md."
    : "This choice is stored in genesis/engineering.md and follows the source."
));
const loading = computed(() => (
  resource.isLoading.value === true || engineeringResource.isLoading.value === true
));
const initialLoading = computed(() => loading.value && (
  !resource.data.value || !engineeringResource.data.value
));
const loadError = computed(() => String(
  resource.loadError.value || engineeringResource.loadError.value || ""
));
const databaseSaving = computed(() => databaseSaveCommand.isRunning === true);
const aiPolicySaving = computed(() => aiPolicySaveCommand.isRunning === true);
const engineeringSaving = computed(() => engineeringSaveCommand.isRunning === true);
const databaseChanged = computed(() => (
  managed.value && scopeDraft.value !== developmentDatabase.value.scope
));
const aiPolicyChanged = computed(() => (
  JSON.stringify(aiPolicyDraft.value) !== JSON.stringify(savedAiPolicy.value)
));
const engineeringChanged = computed(() => (
  engineeringAvailable.value &&
  Boolean(engineeringProfileDraft.value) &&
  engineeringProfileDraft.value !== savedEngineeringProfile.value
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

watch(engineering, (value) => {
  const profile = String(value.profile?.id || "").trim();
  engineeringProfileDraft.value = profile;
  savedEngineeringProfile.value = profile;
  const sourceSessionId = String(value.source?.sessionId || "").trim();
  if (!routeSessionId.value && sourceSessionId) {
    void router.replace({
      query: {
        ...route.query,
        sessionId: sourceSessionId
      }
    });
  }
}, {
  immediate: true
});

useRealtimeEvent({
  event: VIBE64_SESSION_CHANGED_EVENT,
  matches: sessionListRealtimeShouldRefresh,
  onEvent() {
    void resource.reload();
    void engineeringResource.reload();
  }
});

async function refresh() {
  await Promise.all([
    resource.reload(),
    engineeringResource.reload()
  ]);
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
  if (
    !databaseChanged.value ||
    !canChange.value ||
    !scopeDraftAvailable.value ||
    databaseSaving.value
  ) {
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

async function saveEngineeringProfile() {
  if (!engineeringChanged.value || engineeringSaving.value) {
    return;
  }
  await engineeringSaveCommand.run({
    profile: engineeringProfileDraft.value,
    sessionId: routeSessionId.value || String(engineering.value.source?.sessionId || "").trim()
  });
  await engineeringResource.reload();
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
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
  padding: 1rem;
}

.project-settings__section-copy,
.project-settings__engineering-field,
.project-settings__action {
  display: grid;
  gap: 0.4rem;
  min-width: 0;
}

.project-settings__section-copy h2 {
  font-size: 1rem;
}

.project-settings__section-copy p,
.project-settings__engineering-field p,
.project-settings__action p {
  font-size: 0.875rem;
}

.project-settings__refresh {
  min-width: 6.5rem;
}

.project-settings :deep(.v-btn),
.project-settings__options :deep(.v-selection-control) {
  min-height: 3rem;
}

.project-settings__options {
  margin: -0.35rem 0;
}

.project-settings__option {
  min-width: 0;
}

.project-settings__option-support {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.75rem;
  line-height: 1.3;
  margin: -0.2rem 0 0 2.5rem;
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

.project-settings__engineering-field {
  align-self: center;
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

</style>
