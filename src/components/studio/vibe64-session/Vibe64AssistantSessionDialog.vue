<template>
  <v-dialog
    :model-value="modelValue"
    max-width="52rem"
    scrollable
    @update:model-value="emit('update:model-value', $event)"
  >
    <v-card class="vibe64-assistant-dialog" rounded="xl">
      <v-card-title class="vibe64-assistant-dialog__title">
        <span>{{ editing ? "AI session settings" : "Start an AI session" }}</span>
        <v-btn
          aria-label="Close AI session dialog"
          :disabled="submitting"
          :icon="mdiClose"
          title="Close"
          variant="text"
          @click="close"
        />
      </v-card-title>

      <v-card-text class="vibe64-assistant-dialog__body">
        <p class="vibe64-assistant-dialog__intro">
          <template v-if="editing">
            This session’s {{ selectedOverviewEngine?.label || "AI" }} engine is locked to preserve its native
            history. You can change provider, model, agent, and thinking choices between turns.
          </template>
          <template v-else>
            Choose the engine that will own this session’s native history. You can change its
            provider, model, agent, and thinking variant later, but not the engine.
          </template>
        </p>

        <div v-if="overviewLoading" class="vibe64-assistant-dialog__engine-grid" aria-label="Loading AI engines">
          <v-skeleton-loader
            v-for="index in 2"
            :key="index"
            class="vibe64-assistant-dialog__engine-skeleton"
            type="list-item-avatar-two-line, chip"
          />
        </div>

        <div v-else-if="overviewError" class="vibe64-assistant-dialog__resource-state" role="alert">
          <span>{{ overviewError }}</span>
          <v-btn size="small" variant="tonal" @click="catalog.overview.reload()">Try again</v-btn>
        </div>

        <div v-else class="vibe64-assistant-dialog__engine-grid" role="radiogroup" aria-label="AI engine">
          <button
            v-for="engine in catalog.engines.value"
            :key="engine.engineId"
            class="vibe64-assistant-dialog__engine"
            :class="{ 'vibe64-assistant-dialog__engine--selected': engine.engineId === engineId }"
            :disabled="engineLocked && engine.engineId !== engineId"
            type="button"
            role="radio"
            :aria-checked="engine.engineId === engineId"
            @click="selectEngine(engine)"
          >
            <span class="vibe64-assistant-dialog__engine-heading">
              <v-icon :icon="engine.engineId === 'codex' ? mdiCreationOutline : mdiCodeBraces" />
              <strong>{{ engine.label }}</strong>
              <v-chip
                :color="engine.health?.status === 'ready' ? 'success' : undefined"
                size="x-small"
                variant="tonal"
              >
                {{ engine.health?.status === "ready" ? "Ready" : "Setup needed" }}
              </v-chip>
            </span>
            <span class="vibe64-assistant-dialog__engine-copy">
              {{ engineDescription(engine) }}
            </span>
          </button>
        </div>

        <template v-if="selectedOverviewEngine">
          <div class="vibe64-assistant-dialog__selection-heading">
            <div>
              <strong>{{ selectionSummary }}</strong>
              <span>{{ authenticationSummary }}</span>
            </div>
            <v-btn
              :prepend-icon="customizing ? mdiChevronUp : mdiTuneVariant"
              size="small"
              variant="text"
              @click="customizing = !customizing"
            >
              {{ customizing ? "Hide choices" : editing ? "Change choices" : "Customize" }}
            </v-btn>
          </div>

          <div v-if="customizing" class="vibe64-assistant-dialog__customization">
            <section class="vibe64-assistant-dialog__section" aria-labelledby="assistant-provider-heading">
              <div class="vibe64-assistant-dialog__section-heading">
                <strong id="assistant-provider-heading">Provider</strong>
                <span v-if="engineId === 'codex'">Codex uses OpenAI only.</span>
                <span v-else>OpenCode providers use API keys only.</span>
              </div>

              <template v-if="engineId === 'codex'">
                <button
                  v-if="selectedProvider"
                  class="vibe64-assistant-dialog__provider vibe64-assistant-dialog__provider--selected"
                  type="button"
                >
                  <span><strong>{{ selectedProvider.label }}</strong><small>{{ selectedProvider.description }}</small></span>
                  <v-icon :icon="mdiCheckCircleOutline" color="primary" />
                </button>
              </template>

              <template v-else>
                <v-text-field
                  v-model="providerSearchInput"
                  autocomplete="off"
                  clearable
                  density="compact"
                  hide-details
                  label="Search providers"
                  :prepend-inner-icon="mdiMagnify"
                  variant="outlined"
                />

                <div v-if="providerLoading" class="vibe64-assistant-dialog__provider-list" aria-label="Loading OpenCode providers">
                  <v-skeleton-loader
                    v-for="index in 4"
                    :key="index"
                    type="list-item-two-line"
                  />
                </div>
                <div v-else-if="providerError" class="vibe64-assistant-dialog__resource-state" role="alert">
                  <span>{{ providerError }}</span>
                  <v-btn size="small" variant="tonal" @click="catalog.providerPage.reload()">Try again</v-btn>
                </div>
                <div v-else class="vibe64-assistant-dialog__provider-list">
                  <button
                    v-for="provider in providerRows"
                    :key="provider.id"
                    class="vibe64-assistant-dialog__provider"
                    :class="{ 'vibe64-assistant-dialog__provider--selected': provider.id === modelProviderId }"
                    type="button"
                    @click="selectProvider(provider)"
                  >
                    <span>
                      <strong>{{ provider.label }}</strong>
                      <small>{{ providerConnectionLabel(provider) }}</small>
                    </span>
                    <v-icon
                      :color="provider.connected ? 'success' : undefined"
                      :icon="provider.id === modelProviderId ? mdiCheckCircleOutline : provider.connected ? mdiCheck : mdiKeyOutline"
                    />
                  </button>
                  <p v-if="!providerRows.length" class="vibe64-assistant-dialog__empty">
                    No providers match that search.
                  </p>
                </div>
                <div v-if="providerPage" class="vibe64-assistant-dialog__paging">
                  <span>{{ providerPage.total }} provider{{ providerPage.total === 1 ? "" : "s" }}</span>
                  <span />
                  <v-btn
                    :disabled="providerCursorHistory.length === 0"
                    size="small"
                    variant="text"
                    @click="previousProviderPage"
                  >
                    Previous
                  </v-btn>
                  <v-btn
                    :disabled="!providerPage.hasMore"
                    size="small"
                    variant="text"
                    @click="nextProviderPage"
                  >
                    Next
                  </v-btn>
                </div>
              </template>

              <div v-if="selectedProvider && !selectedProvider.connected" class="vibe64-assistant-dialog__connection" role="status">
                <span>{{ selectedProvider.connectionMessage || `Connect ${selectedProvider.label} before creating this session.` }}</span>
                <v-btn
                  :prepend-icon="mdiKeyOutline"
                  size="small"
                  variant="tonal"
                  @click="openConnectionSettings"
                >
                  {{ selectedProvider.connectionStatus === "reconfirmation-required" ? "Reconfirm key" : "Connect provider" }}
                </v-btn>
              </div>
            </section>

            <section v-if="modelProviderId" class="vibe64-assistant-dialog__section" aria-labelledby="assistant-model-heading">
              <div class="vibe64-assistant-dialog__section-heading">
                <strong id="assistant-model-heading">Model</strong>
                <span>Models come from the live {{ selectedProvider?.label || "provider" }} catalog.</span>
              </div>
              <v-skeleton-loader
                v-if="modelLoading"
                :type="engineId === 'opencode' ? 'text, list-item-two-line' : 'list-item-two-line'"
              />
              <div v-else-if="modelError" class="vibe64-assistant-dialog__resource-state" role="alert">
                <span>{{ modelError }}</span>
                <v-btn size="small" variant="tonal" @click="catalog.modelPage.reload()">Try again</v-btn>
              </div>
              <template v-else>
                <v-text-field
                  v-if="engineId === 'opencode'"
                  v-model="modelSearchInput"
                  autocomplete="off"
                  clearable
                  density="compact"
                  hide-details
                  label="Search model catalog"
                  :prepend-inner-icon="mdiMagnify"
                  variant="outlined"
                />
                <v-select
                  v-model="modelId"
                  clearable
                  density="compact"
                  hide-details="auto"
                  item-title="label"
                  item-value="id"
                  :items="availableModels"
                  label="Model"
                  no-data-text="No models match that search"
                  variant="outlined"
                />
              </template>
              <span
                v-if="modelPage && modelPage.total > availableModels.length"
                class="vibe64-assistant-dialog__catalog-note"
              >
                Search across {{ modelPage.total }} live models; up to {{ modelPage.limit }} matches are shown.
              </span>
            </section>

            <section v-if="modelId" class="vibe64-assistant-dialog__field-grid" aria-label="Agent and thinking">
              <v-select
                v-model="agentId"
                density="compact"
                hide-details="auto"
                item-title="label"
                item-value="id"
                :items="compatibleAgents"
                label="Agent"
                variant="outlined"
              />
              <v-select
                v-model="variantId"
                density="compact"
                hide-details="auto"
                item-title="label"
                item-value="id"
                :items="variantRows"
                label="Thinking"
                variant="outlined"
              />
            </section>
          </div>
        </template>
      </v-card-text>

      <v-card-actions class="vibe64-assistant-dialog__actions">
        <span class="vibe64-assistant-dialog__validation">{{ validationMessage }}</span>
        <v-btn :disabled="submitting" variant="text" @click="close">Cancel</v-btn>
        <v-btn
          ref="submitButton"
          :aria-busy="submitting ? 'true' : undefined"
          color="primary"
          :disabled="!canSubmit || submitting"
          variant="flat"
          @click="submit"
        >
          {{ submitting ? (editing ? "Saving choices…" : "Creating session…") : (editing ? "Save choices" : "Create session") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, nextTick, onScopeDispose, ref, watch } from "vue";
import {
  mdiCheck,
  mdiCheckCircleOutline,
  mdiChevronUp,
  mdiClose,
  mdiCodeBraces,
  mdiCreationOutline,
  mdiKeyOutline,
  mdiMagnify,
  mdiTuneVariant
} from "@mdi/js";

import { useVibe64AssistantCatalog } from "@/composables/useVibe64AssistantCatalog.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";

const props = defineProps({
  engineLocked: {
    default: false,
    type: Boolean
  },
  initialSelection: {
    default: null,
    type: Object
  },
  mode: {
    default: "create",
    type: String
  },
  modelValue: {
    default: false,
    type: Boolean
  },
  toolbar: {
    default: () => ({}),
    type: Object
  },
  submitRunning: {
    default: false,
    type: Boolean
  },
  submitSelection: {
    default: null,
    type: Function
  }
});

const emit = defineEmits(["created", "saved", "update:model-value"]);
const engineId = ref("");
const modelProviderId = ref("");
const modelId = ref("");
const agentId = ref("");
const variantId = ref("");
const customizing = ref(false);
const providerSearchInput = ref("");
const providerSearch = ref("");
const providerCursor = ref("");
const providerCursorHistory = ref([]);
const modelSearchInput = ref("");
const modelSearch = ref("");
const submitButton = ref(null);
let providerSearchTimer = null;
let modelSearchTimer = null;
let initialHydratedForOpen = false;

const catalog = useVibe64AssistantCatalog({
  active: computed(() => props.modelValue),
  engineId,
  modelProviderId,
  modelSearch,
  providerCursor,
  providerSearch
});

const overviewLoading = computed(() => Boolean(
  catalog.overview.isInitialLoading.value || catalog.overview.isLoading.value
));
const overviewError = computed(() => String(catalog.overview.loadError.value || ""));
const providerLoading = computed(() => Boolean(
  catalog.providerPage.isInitialLoading.value || catalog.providerPage.isLoading.value
));
const providerError = computed(() => String(catalog.providerPage.loadError.value || ""));
const modelLoading = computed(() => Boolean(
  catalog.modelPage.isInitialLoading.value || catalog.modelPage.isLoading.value
));
const modelError = computed(() => String(catalog.modelPage.loadError.value || ""));
const modelPage = computed(() => catalog.modelEngine.value?.page || null);
const selectedOverviewEngine = catalog.selectedOverviewEngine;
const selectedProvider = catalog.selectedProvider;
const providerRows = computed(() => catalog.providerEngine.value?.modelProviders || []);
const providerPage = computed(() => catalog.providerEngine.value?.page || null);
const availableModels = computed(() => (
  (selectedProvider.value?.models || []).filter((model) => model.status === "available")
));
const selectedModel = computed(() => availableModels.value.find((model) => (
  model.id === modelId.value
)) || null);
const compatibleAgents = computed(() => (
  (catalog.selectedEngine.value?.agents || []).filter((agent) => (
    ["all", "primary"].includes(agent.mode) &&
    (!agent.modelProviderId || agent.modelProviderId === modelProviderId.value) &&
    (!agent.modelId || agent.modelId === modelId.value)
  ))
));
const variantRows = computed(() => [
  { id: "", label: "Provider default" },
  ...(selectedModel.value?.variants || [])
]);
const selectionRevision = computed(() => String(
  catalog.modelEngine.value?.revision ||
  catalog.providerEngine.value?.revision ||
  selectedOverviewEngine.value?.revision ||
  ""
));
const editing = computed(() => props.mode === "edit");
const engineLocked = computed(() => props.engineLocked === true || editing.value);
const selectedAgent = computed(() => compatibleAgents.value.find((agent) => (
  agent.id === agentId.value
)) || null);
const canSubmit = computed(() => Boolean(
  engineId.value &&
  selectedProvider.value?.connected === true &&
  selectedModel.value &&
  selectedAgent.value &&
  selectionRevision.value &&
  !overviewError.value &&
  !providerError.value &&
  !modelError.value
));
const submitting = computed(() => (
  props.submitRunning === true || props.toolbar.createSessionRunning === true
));
const selectionSummary = computed(() => [
  selectedOverviewEngine.value?.label,
  selectedProvider.value?.label,
  selectedModel.value?.label,
  selectedAgent.value?.label,
  variantId.value
].filter(Boolean).join(" · ") || "Choose an engine");
const authenticationSummary = computed(() => (
  engineId.value === "opencode"
    ? "API-key providers · native OpenCode history"
    : "OpenAI account · native Codex history"
));
const validationMessage = computed(() => {
  if (!selectedOverviewEngine.value || overviewLoading.value) {
    return "";
  }
  if (!selectedProvider.value) {
    return "Choose a provider.";
  }
  if (!selectedProvider.value.connected) {
    return `${selectedProvider.value.label} needs an account-owner connection.`;
  }
  if (!selectedModel.value) {
    return "Choose an available model.";
  }
  if (!selectedAgent.value) {
    return "Choose an agent compatible with this model.";
  }
  return "";
});

function engineDescription(engine = {}) {
  return engine.engineId === "opencode"
    ? "Use OpenCode’s native agent loop with any connected API-key provider."
    : "Use the Codex app server with OpenAI web sign-in or an OpenAI API key.";
}

function providerConnectionLabel(provider = {}) {
  if (provider.connected) {
    return "Connected";
  }
  return provider.connectionStatus === "reconfirmation-required"
    ? "Key reconfirmation required"
    : "API key required";
}

function selectEngine(engine = {}) {
  if (engineLocked.value && engineId.value && engine.engineId !== engineId.value) {
    return;
  }
  engineId.value = String(engine.engineId || "");
  modelProviderId.value = String(engine.defaults?.modelProviderId || "");
  modelId.value = String(engine.defaults?.modelId || "");
  agentId.value = String(engine.defaults?.agentId || "");
  variantId.value = String(engine.defaults?.variantId || "");
  providerSearchInput.value = "";
  providerSearch.value = "";
  providerCursor.value = "";
  providerCursorHistory.value = [];
  modelSearchInput.value = "";
  modelSearch.value = "";
  customizing.value = engine.health?.status !== "ready" || !modelProviderId.value;
}

function selectProvider(provider = {}) {
  modelProviderId.value = String(provider.id || "");
  modelId.value = "";
  agentId.value = "";
  variantId.value = "";
  modelSearchInput.value = "";
  modelSearch.value = "";
}

function openConnectionSettings() {
  const provider = selectedProvider.value;
  if (!provider) {
    return;
  }
  requestVibe64AccountConnectionsDialog({
    codexReconnectRequired: engineId.value === "codex",
    providerId: provider.id,
    providerLabel: provider.label,
    providerRevision: provider.definitionRevision,
    section: engineId.value === "codex" ? "codex" : "ai"
  });
}

function nextProviderPage() {
  const nextCursor = String(providerPage.value?.nextCursor || "");
  if (!nextCursor) {
    return;
  }
  providerCursorHistory.value = [...providerCursorHistory.value, providerCursor.value];
  providerCursor.value = nextCursor;
}

function previousProviderPage() {
  const history = [...providerCursorHistory.value];
  providerCursor.value = history.pop() || "";
  providerCursorHistory.value = history;
}

function close() {
  if (!submitting.value) {
    emit("update:model-value", false);
  }
}

async function submit() {
  if (!canSubmit.value || submitting.value) {
    return;
  }
  let response = null;
  const selection = {
    agentId: agentId.value,
    catalogRevision: selectionRevision.value,
    engineId: engineId.value,
    modelId: modelId.value,
    modelProviderId: modelProviderId.value,
    variantId: variantId.value
  };
  try {
    response = typeof props.submitSelection === "function"
      ? await props.submitSelection(selection)
      : await props.toolbar.createSession?.(selection);
  } catch {
    // The shared command feedback seam owns transient creation failures.
    return;
  }
  if (response?.ok !== false && (editing.value || response?.sessionId)) {
    emit(editing.value ? "saved" : "created", response);
    emit("update:model-value", false);
  }
}

function hydrateOpenSelection(engines = catalog.engines.value) {
  if (!props.modelValue || initialHydratedForOpen || !engines.length) {
    return;
  }
  const initial = props.initialSelection || {};
  const initialEngine = engines.find((engine) => engine.engineId === initial.engineId);
  if (initialEngine) {
    engineId.value = String(initial.engineId || "");
    modelProviderId.value = String(initial.modelProviderId || "");
    modelId.value = String(initial.modelId || "");
    agentId.value = String(initial.agentId || "");
    variantId.value = String(initial.variantId || "");
    customizing.value = editing.value;
  } else {
    selectEngine(
      engines.find((engine) => engine.engineId === "codex" && engine.health?.status === "ready") ||
      engines.find((engine) => engine.health?.status === "ready") ||
      engines[0]
    );
  }
  initialHydratedForOpen = true;
}

watch(() => props.modelValue, (open) => {
  if (!open) {
    initialHydratedForOpen = false;
    return;
  }
  hydrateOpenSelection();
}, { immediate: true });

watch(submitting, async (running, wasRunning) => {
  if (running || !wasRunning || !props.modelValue) {
    return;
  }
  await nextTick();
  if (!props.modelValue) {
    return;
  }
  const target = submitButton.value?.$el || submitButton.value;
  if (target?.isConnected === true && typeof target.focus === "function") {
    target.focus({ preventScroll: true });
  }
});

watch(catalog.engines, (engines) => {
  hydrateOpenSelection(engines);
}, { immediate: true });

watch(selectedProvider, (provider) => {
  if (!provider || provider.id !== modelProviderId.value) {
    return;
  }
  const models = (provider.models || []).filter((model) => model.status === "available");
  if (
    !models.some((model) => model.id === modelId.value) &&
    (!modelId.value || !modelSearch.value)
  ) {
    const preferred = models.find((model) => (
      model.id === selectedOverviewEngine.value?.defaults?.modelId
    )) || models[0];
    modelId.value = preferred?.id || "";
  }
}, { immediate: true });

watch([compatibleAgents, modelId], ([agents]) => {
  if (!agents.some((agent) => agent.id === agentId.value)) {
    agentId.value = agents.find((agent) => (
      agent.id === selectedOverviewEngine.value?.defaults?.agentId
    ))?.id || agents[0]?.id || "";
  }
}, { immediate: true });

watch([selectedModel, selectedAgent], ([model, agent]) => {
  const variants = model?.variants || [];
  const fixedVariant = String(agent?.variantId || "");
  if (fixedVariant) {
    variantId.value = fixedVariant;
  } else if (variantId.value && !variants.some((variant) => variant.id === variantId.value)) {
    variantId.value = "";
  }
}, { immediate: true });

watch(providerSearchInput, (search) => {
  clearTimeout(providerSearchTimer);
  providerSearchTimer = setTimeout(() => {
    providerSearch.value = String(search || "").trim();
    providerCursor.value = "";
    providerCursorHistory.value = [];
  }, 250);
});

watch(modelSearchInput, (search) => {
  clearTimeout(modelSearchTimer);
  modelSearchTimer = setTimeout(() => {
    modelSearch.value = String(search || "").trim();
  }, 250);
});

onScopeDispose(() => {
  clearTimeout(modelSearchTimer);
  clearTimeout(providerSearchTimer);
});
</script>

<style scoped>
.vibe64-assistant-dialog {
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
}

.vibe64-assistant-dialog__title {
  align-items: center;
  display: flex;
  justify-content: space-between;
  padding: 1rem 1.25rem 0.75rem;
}

.vibe64-assistant-dialog__body {
  display: grid;
  gap: 1rem;
  padding: 0.25rem 1.25rem 1rem !important;
}

.vibe64-assistant-dialog__intro {
  color: rgba(var(--v-theme-on-surface), 0.7);
  line-height: 1.45;
  margin: 0;
}

.vibe64-assistant-dialog__engine-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.vibe64-assistant-dialog__engine,
.vibe64-assistant-dialog__provider {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.22);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.vibe64-assistant-dialog__engine {
  border-radius: 1rem;
  display: grid;
  gap: 0.55rem;
  min-height: 7.5rem;
  padding: 1rem;
}

.vibe64-assistant-dialog__engine:hover,
.vibe64-assistant-dialog__provider:hover {
  background: rgba(var(--v-theme-primary), 0.05);
}

.vibe64-assistant-dialog__engine:disabled {
  cursor: not-allowed;
  opacity: var(--v-disabled-opacity, 0.38);
}

.vibe64-assistant-dialog__engine--selected,
.vibe64-assistant-dialog__provider--selected {
  background: rgba(var(--v-theme-primary), 0.08);
  border-color: rgba(var(--v-theme-primary), 0.6);
}

.vibe64-assistant-dialog__engine-heading {
  align-items: center;
  display: flex;
  gap: 0.55rem;
}

.vibe64-assistant-dialog__engine-heading .v-chip {
  margin-inline-start: auto;
}

.vibe64-assistant-dialog__engine-copy,
.vibe64-assistant-dialog__section-heading span,
.vibe64-assistant-dialog__selection-heading span {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.84rem;
  line-height: 1.4;
}

.vibe64-assistant-dialog__engine-skeleton {
  border: 1px solid rgba(var(--v-theme-outline), 0.12);
  border-radius: 1rem;
  min-height: 7.5rem;
}

.vibe64-assistant-dialog__selection-heading {
  align-items: center;
  background: rgba(var(--v-theme-secondary), 0.08);
  border-radius: 0.85rem;
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  padding: 0.75rem 0.9rem;
}

.vibe64-assistant-dialog__selection-heading > div,
.vibe64-assistant-dialog__section-heading {
  display: grid;
  gap: 0.15rem;
}

.vibe64-assistant-dialog__customization {
  display: grid;
  gap: 1rem;
}

.vibe64-assistant-dialog__section {
  display: grid;
  gap: 0.65rem;
}

.vibe64-assistant-dialog__provider-list {
  border: 1px solid rgba(var(--v-theme-outline), 0.16);
  border-radius: 0.75rem;
  max-height: 15rem;
  overflow-y: auto;
}

.vibe64-assistant-dialog__provider {
  align-items: center;
  border-width: 0 0 1px;
  display: flex;
  justify-content: space-between;
  min-height: 3.75rem;
  padding: 0.65rem 0.75rem;
  width: 100%;
}

.vibe64-assistant-dialog__provider:first-child {
  border-radius: 0.75rem 0.75rem 0 0;
}

.vibe64-assistant-dialog__provider:last-child {
  border-bottom-width: 0;
  border-radius: 0 0 0.75rem 0.75rem;
}

.vibe64-assistant-dialog__provider > span {
  display: grid;
  gap: 0.1rem;
}

.vibe64-assistant-dialog__provider small,
.vibe64-assistant-dialog__catalog-note,
.vibe64-assistant-dialog__empty,
.vibe64-assistant-dialog__paging,
.vibe64-assistant-dialog__validation {
  color: rgba(var(--v-theme-on-surface), 0.64);
  font-size: 0.78rem;
}

.vibe64-assistant-dialog__empty {
  margin: 0;
  padding: 1rem;
  text-align: center;
}

.vibe64-assistant-dialog__paging {
  align-items: center;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
}

.vibe64-assistant-dialog__connection,
.vibe64-assistant-dialog__resource-state {
  align-items: center;
  background: rgba(var(--v-theme-error), 0.06);
  border-radius: 0.75rem;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  padding: 0.75rem;
}

.vibe64-assistant-dialog__field-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.vibe64-assistant-dialog__actions {
  border-top: 1px solid rgba(var(--v-theme-outline), 0.14);
  gap: 0.5rem;
  padding: 0.75rem 1.25rem;
}

.vibe64-assistant-dialog__validation {
  margin-inline-end: auto;
}

@media (max-width: 600px) {
  .vibe64-assistant-dialog__engine-grid,
  .vibe64-assistant-dialog__field-grid {
    grid-template-columns: 1fr;
  }

  .vibe64-assistant-dialog__actions {
    flex-wrap: wrap;
  }

  .vibe64-assistant-dialog__validation {
    flex-basis: 100%;
  }
}
</style>
