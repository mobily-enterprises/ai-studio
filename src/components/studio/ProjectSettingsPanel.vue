<template>
  <section class="project-settings">
    <header class="project-settings__header">
      <div>
        <h1>Project settings</h1>
        <p>Vibe64 behavior for this project, stored outside its source repository.</p>
      </div>
      <v-btn
        :loading="loading"
        size="small"
        type="button"
        variant="tonal"
        @click="refresh"
      >
        Refresh
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

    <section v-else class="project-settings__section" aria-labelledby="development-database-title">
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
          :disabled="!canChange || saving"
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
            :disabled="!changed || !canChange"
            :loading="saving"
            color="primary"
            size="small"
            type="button"
            variant="flat"
            @click="save"
          >
            Save database choice
          </v-btn>
        </div>
      </template>
    </section>
  </section>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import Vibe64AsyncModuleState from "@/components/common/Vibe64AsyncModuleState.vue";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  DEVELOPMENT_DATABASE_ENDPOINT,
  PROJECT_SETTINGS_ENDPOINT,
  VIBE64_DEVELOPMENT_DATABASE_API_SUFFIX,
  VIBE64_PROJECT_CHANGED_EVENT,
  projectSettingsQueryKey
} from "@/lib/studioGateApi.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";

const projectSlug = useVibe64ProjectSlug();
const scopeDraft = ref("session");

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

const saveCommand = useCommand({
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

const developmentDatabase = computed(() => resource.data.value?.developmentDatabase || {});
const managed = computed(() => developmentDatabase.value.managed === true);
const canChange = computed(() => developmentDatabase.value.canChange === true);
const disabledReason = computed(() => String(developmentDatabase.value.disabledReason || ""));
const loading = computed(() => resource.isLoading.value === true);
const loadError = computed(() => String(resource.loadError.value || ""));
const saving = computed(() => saveCommand.isRunning === true);
const changed = computed(() => (
  managed.value && scopeDraft.value !== developmentDatabase.value.scope
));

watch(() => developmentDatabase.value.scope, (scope) => {
  if (["project", "session"].includes(scope)) {
    scopeDraft.value = scope;
  }
}, {
  immediate: true
});

async function refresh() {
  await resource.reload();
}

async function save() {
  if (!changed.value || !canChange.value) {
    return;
  }
  await saveCommand.run({
    scope: scopeDraft.value
  });
  await resource.reload();
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

.project-settings__options {
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
</style>
