<template>
  <v-menu
    v-model="menuOpen"
    :close-on-content-click="false"
    location="top start"
    transition="scale-transition"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        aria-label="Choose AI"
        class="vibe64-session-assistant-menu__button"
        density="comfortable"
        :disabled="disabled"
        :icon="mdiCogOutline"
        size="small"
        :title="buttonTitle"
        type="button"
        variant="flat"
      />
    </template>

    <v-sheet
      aria-label="AI session selector"
      class="vibe64-session-assistant-menu"
      rounded="lg"
    >
      <header class="vibe64-session-assistant-menu__header">
        <v-icon :icon="mdiBrain" size="20" />
        <div>
          <strong>AI Controls</strong>
          <span>{{ selectionSummary }}</span>
        </div>
      </header>

      <div
        v-if="catalogLoading"
        aria-label="Loading available AIs"
        class="vibe64-session-assistant-menu__loading"
      >
        <v-skeleton-loader type="text, chip@4, text, chip@4" />
      </div>

      <div
        v-else-if="catalogError"
        class="vibe64-session-assistant-menu__state"
        role="alert"
      >
        <span>{{ catalogError }}</span>
        <v-btn size="small" variant="text" @click="catalog.reload()">Try again</v-btn>
      </div>

      <div
        v-else-if="!providerRows.length"
        class="vibe64-session-assistant-menu__state"
        role="status"
      >
        No configured AIs are available for this session.
      </div>

      <div v-else class="vibe64-session-assistant-menu__choices">
        <section
          v-if="providerRows.length > 1"
          aria-label="Provider"
          class="vibe64-session-assistant-menu__section"
        >
          <div class="vibe64-session-assistant-menu__label">Provider</div>
          <div class="vibe64-session-assistant-menu__options">
            <button
              v-for="provider in providerRows"
              :key="provider.id"
              :aria-pressed="modelProviderId === provider.id"
              class="vibe64-session-assistant-menu__option"
              :class="{ 'vibe64-session-assistant-menu__option--active': modelProviderId === provider.id }"
              type="button"
              @click="selectProvider(provider.id)"
            >
              <span>{{ provider.label }}</span>
              <v-icon v-if="modelProviderId === provider.id" :icon="mdiCheck" size="15" />
            </button>
          </div>
        </section>

        <section aria-label="Model" class="vibe64-session-assistant-menu__section">
          <div class="vibe64-session-assistant-menu__label">Model</div>
          <div v-if="modelRows.length" class="vibe64-session-assistant-menu__options">
            <button
              v-for="model in modelRows"
              :key="model.id"
              :aria-pressed="modelId === model.id"
              class="vibe64-session-assistant-menu__option"
              :class="{
                'vibe64-session-assistant-menu__option--active': modelId === model.id,
                'vibe64-session-assistant-menu__option--locked': model.status !== 'available'
              }"
              :disabled="model.status !== 'available'"
              :title="model.status === 'available' ? model.label : model.lockMessage || 'This model is not available.'"
              type="button"
              @click="selectModel(model.id)"
            >
              <span>{{ model.label }}</span>
              <v-icon
                v-if="model.status !== 'available'"
                :icon="mdiLockOutline"
                size="15"
              />
              <v-icon v-else-if="modelId === model.id" :icon="mdiCheck" size="15" />
            </button>
          </div>
          <span v-else class="vibe64-session-assistant-menu__empty">No available models.</span>
        </section>

        <v-btn
          v-if="canRestoreRecommendedModel"
          block
          color="primary"
          :disabled="saving || modelAccessUpdating"
          size="small"
          type="button"
          variant="tonal"
          @click="restoreRecommendedModel"
        >
          {{ saving ? `Switching to ${recommendedModel.label}…` : `Use ${recommendedModel.label}` }}
        </v-btn>

        <section
          v-if="modelAccess.configurable"
          aria-label="Provider model access"
          class="vibe64-session-assistant-menu__section"
        >
          <div class="vibe64-session-assistant-menu__label">Model access</div>
          <div class="vibe64-session-assistant-menu__access">
            <v-switch
              color="primary"
              density="compact"
              :disabled="!canConfigure || modelAccessUpdating || saving"
              hide-details
              :label="modelAccessUpdating ? modelAccessPendingLabel : modelAccess.label"
              :model-value="modelAccessUnlocked"
              @update:model-value="requestModelAccessChange"
            />
            <small>
              {{ modelAccessUnlocked
                ? "Paid Z.AI models are selectable and can consume API credit."
                : `${recommendedModel?.label || "The recommended model"} stays available without paid-model access.` }}
            </small>
          </div>
        </section>

        <section
          v-if="variantRows.length > 1"
          aria-label="Thinking"
          class="vibe64-session-assistant-menu__section"
        >
          <div class="vibe64-session-assistant-menu__label">Thinking</div>
          <div class="vibe64-session-assistant-menu__options">
            <button
              v-for="variant in variantRows"
              :key="variant.id || 'automatic'"
              :aria-pressed="variantId === variant.id"
              class="vibe64-session-assistant-menu__option"
              :class="{ 'vibe64-session-assistant-menu__option--active': variantId === variant.id }"
              type="button"
              @click="selectVariant(variant.id)"
            >
              <span>{{ variant.label }}</span>
              <v-icon v-if="variantId === variant.id" :icon="mdiCheck" size="15" />
            </button>
          </div>
        </section>
      </div>

      <footer class="vibe64-session-assistant-menu__actions">
        <v-btn
          v-if="canConfigure"
          size="small"
          variant="text"
          @click="openConnectionSettings"
        >
          Configure more AIs
        </v-btn>
        <span />
        <v-btn
          color="primary"
          :disabled="!canSave || saving"
          size="small"
          variant="flat"
          @click="save"
        >
          {{ saving ? "Applying…" : "Apply" }}
        </v-btn>
      </footer>
    </v-sheet>

    <v-dialog v-model="unlockConfirmOpen" max-width="31rem" persistent>
      <v-card rounded="xl">
        <v-card-title>{{ modelAccess.label || "Unlock provider models" }}?</v-card-title>
        <v-card-text>
          {{ modelAccess.warning || "These models may consume paid provider credit." }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="modelAccessUpdating" type="button" variant="text" @click="unlockConfirmOpen = false">
            Keep free only
          </v-btn>
          <v-btn
            color="warning"
            :disabled="modelAccessUpdating"
            type="button"
            variant="flat"
            @click="confirmUnlockModelAccess"
          >
            Unlock paid models
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-menu>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { mdiBrain, mdiCheck, mdiCogOutline, mdiLockOutline } from "@mdi/js";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";

import { useVibe64AssistantCatalog } from "@/composables/useVibe64AssistantCatalog.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_ASSISTANT_MODEL_ACCESS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64AssistantModelAccessPath,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";

const props = defineProps({
  accessLoading: {
    default: false,
    type: Boolean
  },
  accessLabel: {
    default: "",
    type: String
  },
  canConfigure: {
    default: false,
    type: Boolean
  },
  disabled: {
    default: false,
    type: Boolean
  },
  session: {
    default: null,
    type: Object
  },
  sessionsApiPath: {
    default: "",
    type: [Function, Object, String]
  }
});

const menuOpen = ref(false);
const saving = ref(false);
const modelAccessUpdating = ref(false);
const unlockConfirmOpen = ref(false);
const modelProviderId = ref("");
const modelId = ref("");
const agentId = ref("");
const variantId = ref("");
const emptyText = ref("");
const assistantSelection = computed(() => props.session?.assistantSelection || null);
const engineId = computed(() => String(assistantSelection.value?.engineId || ""));
const accessLabel = computed(() => String(props.accessLabel || "").trim());
const catalogActive = computed(() => Boolean(props.session?.sessionId && engineId.value));
const catalog = useVibe64AssistantCatalog({
  active: catalogActive,
  engineId,
  modelProviderId,
  modelSearch: emptyText,
  providerConnectedOnly: true,
  providerCursor: emptyText,
  providerSearch: emptyText
});
const overviewLoading = computed(() => Boolean(
  catalog.overview.isInitialLoading.value || catalog.overview.isLoading.value
));
const providerLoading = computed(() => engineId.value === "opencode" && Boolean(
  catalog.providerPage.isInitialLoading.value || catalog.providerPage.isLoading.value
));
const modelLoading = computed(() => Boolean(modelProviderId.value) && Boolean(
  catalog.modelPage.isInitialLoading.value || catalog.modelPage.isLoading.value
));
const catalogLoading = computed(() => overviewLoading.value || providerLoading.value || modelLoading.value);
const catalogError = computed(() => String(
  catalog.overview.loadError.value ||
  catalog.providerPage.loadError.value ||
  catalog.modelPage.loadError.value ||
  ""
));
const selectedOverviewEngine = catalog.selectedOverviewEngine;
const providerRows = computed(() => (
  engineId.value === "opencode"
    ? catalog.providerEngine.value?.modelProviders || []
    : selectedOverviewEngine.value?.modelProviders || []
).filter((provider) => provider.connected === true));
const selectedProvider = computed(() => providerRows.value.find((provider) => (
  provider.id === modelProviderId.value
)) || null);
const modelProvider = computed(() => (
  catalog.modelEngine.value?.modelProviders?.find((provider) => (
    provider.id === modelProviderId.value && provider.connected === true
  )) || null
));
const modelRows = computed(() => modelProvider.value?.models || []);
const availableModels = computed(() => (
  modelRows.value.filter((model) => model.status === "available")
));
const modelAccess = computed(() => (
  modelProvider.value?.modelAccess || selectedProvider.value?.modelAccess || {}
));
const modelAccessUnlocked = computed(() => modelAccess.value.mode === "all");
const recommendedModel = computed(() => modelRows.value.find((model) => (
  model.id === modelAccess.value.recommendedModelId && model.status === "available"
)) || null);
const canRestoreRecommendedModel = computed(() => Boolean(
  recommendedModel.value && modelId.value !== recommendedModel.value.id
));
const modelAccessPendingLabel = computed(() => modelAccessUnlocked.value
  ? `Returning to ${recommendedModel.value?.label || "the recommended model"}…`
  : "Unlocking paid models…"
);
const selectedModel = computed(() => availableModels.value.find((model) => (
  model.id === modelId.value
)) || null);
const compatibleAgents = computed(() => (
  (catalog.modelEngine.value?.agents || []).filter((agent) => (
    ["all", "primary"].includes(agent.mode) &&
    (!agent.modelProviderId || agent.modelProviderId === modelProviderId.value) &&
    (!agent.modelId || agent.modelId === modelId.value)
  ))
));
const selectedAgent = computed(() => compatibleAgents.value.find((agent) => (
  agent.id === agentId.value
)) || null);
const variantRows = computed(() => [
  { id: "", label: "Automatic" },
  ...(selectedModel.value?.variants || [])
]);
const selectedVariant = computed(() => variantRows.value.find((variant) => (
  variant.id === variantId.value
)) || null);
const selectionRevision = computed(() => String(catalog.modelEngine.value?.revision || ""));
const draftSelection = computed(() => ({
  agentId: agentId.value,
  catalogRevision: selectionRevision.value,
  engineId: engineId.value,
  modelId: modelId.value,
  modelProviderId: modelProviderId.value,
  variantId: variantId.value
}));
const selectionChanged = computed(() => {
  const current = assistantSelection.value || {};
  return ["agentId", "engineId", "modelId", "modelProviderId", "variantId"].some((field) => (
    String(current[field] || "") !== String(draftSelection.value[field] || "")
  ));
});
const canSave = computed(() => Boolean(
  selectionChanged.value &&
  selectedProvider.value &&
  selectedModel.value &&
  selectedAgent.value &&
  selectionRevision.value &&
  !catalogLoading.value &&
  !catalogError.value &&
  !modelAccessUpdating.value
));
const selectionSummary = computed(() => {
  const engineLabel = selectedOverviewEngine.value?.label || engineId.value;
  const choices = [
    ...(providerRows.value.length > 1
      ? [selectedProvider.value?.label || assistantSelection.value?.modelProviderId]
      : []),
    selectedModel.value?.label || assistantSelection.value?.modelId,
    selectedVariant.value?.label
  ].filter(Boolean).join(" / ");
  return [engineLabel, choices].filter(Boolean).join(" · ") || "Choose an available AI";
});
const buttonTitle = computed(() => (
  `Choose AI${selectionSummary.value ? `: ${selectionSummary.value}` : ""}${
    !props.accessLoading && accessLabel.value ? ` · ${accessLabel.value}` : ""
  }`
));
const updateCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
  buildCommandOptions: (_model, { context }) => ({
    method: "PATCH",
    path: String(context?.path || "")
  }),
  buildRawPayload: (_model, { context }) => vibe64RealtimeOriginPayload({
    assistantSelection: context?.assistantSelection || {}
  }),
  fallbackRunError: "AI session choices could not be updated.",
  messages: {
    error: "AI session choices could not be updated.",
    success: "AI session choices updated."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.sessions.assistant-selection.update",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PATCH"
});
const modelAccessCommand = useCommand({
  access: "never",
  apiSuffix: VIBE64_ASSISTANT_MODEL_ACCESS_API_SUFFIX,
  buildCommandOptions: (_model, { context }) => ({
    method: "PATCH",
    path: String(context?.path || "")
  }),
  buildRawPayload: (_model, { context }) => ({
    engineId: String(context?.engineId || ""),
    modelProviderId: String(context?.modelProviderId || ""),
    unlocked: context?.unlocked === true
  }),
  fallbackRunError: "Provider model access could not be changed.",
  messages: {
    error: "Provider model access could not be changed.",
    success: "Provider model access updated."
  },
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
  placementSource: "vibe64.assistants.model-access.update",
  surfaceId: VIBE64_SURFACE_ID,
  writeMethod: "PATCH"
});

function hydrateSelection() {
  const selection = assistantSelection.value || {};
  modelProviderId.value = String(selection.modelProviderId || "");
  modelId.value = String(selection.modelId || "");
  agentId.value = String(selection.agentId || "");
  variantId.value = String(selection.variantId || "");
}

function selectProvider(value = "") {
  modelProviderId.value = String(value || "");
  modelId.value = "";
  agentId.value = "";
  variantId.value = "";
}

function selectModel(value = "") {
  modelId.value = String(value || "");
  agentId.value = "";
  variantId.value = "";
}

function selectVariant(value = "") {
  variantId.value = String(value || "");
}

function selectionForModel(model = null) {
  if (!model || model.status !== "available" || !selectionRevision.value) {
    return null;
  }
  const agents = (catalog.modelEngine.value?.agents || []).filter((agent) => (
    ["all", "primary"].includes(agent.mode) &&
    (!agent.modelProviderId || agent.modelProviderId === modelProviderId.value) &&
    (!agent.modelId || agent.modelId === model.id)
  ));
  const agent = agents.find((candidate) => (
    candidate.id === selectedOverviewEngine.value?.defaults?.agentId
  )) || agents[0] || null;
  if (!agent) {
    return null;
  }
  const requestedVariantId = String(agent.variantId || "");
  const variants = Array.isArray(model.variants) ? model.variants : [];
  return {
    agentId: agent.id,
    catalogRevision: selectionRevision.value,
    engineId: engineId.value,
    modelId: model.id,
    modelProviderId: modelProviderId.value,
    variantId: variants.some((variant) => variant.id === requestedVariantId)
      ? requestedVariantId
      : ""
  };
}

function openConnectionSettings() {
  menuOpen.value = false;
  requestVibe64AccountConnectionsDialog({ section: "ai" });
}

async function applySelection(selection, { closeMenu = true } = {}) {
  const sessionId = String(props.session?.sessionId || "").trim();
  const sessionsPath = String(readRefOrGetterValue(props.sessionsApiPath) || "").trim();
  if (!selection || !sessionId || !sessionsPath || saving.value) {
    return null;
  }
  saving.value = true;
  try {
    const response = await updateCommand.run({
      assistantSelection: selection,
      path: vibe64SessionPath(sessionsPath, sessionId, "/assistant-selection")
    });
    if (response?.ok !== false) {
      modelId.value = selection.modelId;
      agentId.value = selection.agentId;
      variantId.value = selection.variantId;
      if (closeMenu) menuOpen.value = false;
    }
    return response;
  } finally {
    saving.value = false;
  }
}

async function save() {
  if (!canSave.value) return;
  await applySelection(draftSelection.value);
}

async function restoreRecommendedModel({ closeMenu = true } = {}) {
  const selection = selectionForModel(recommendedModel.value);
  return applySelection(selection, { closeMenu });
}

function requestModelAccessChange(unlocked) {
  if (!props.canConfigure || modelAccessUpdating.value || saving.value) return;
  if (unlocked === true) {
    unlockConfirmOpen.value = true;
    return;
  }
  void updateModelAccess(false);
}

async function confirmUnlockModelAccess() {
  unlockConfirmOpen.value = false;
  await updateModelAccess(true);
}

async function updateModelAccess(unlocked) {
  const providerId = String(modelProviderId.value || "").trim();
  const path = vibe64AssistantModelAccessPath(catalog.apiPath.value);
  if (
    !props.canConfigure ||
    !providerId ||
    !path ||
    !modelAccess.value.configurable ||
    modelAccessUpdating.value
  ) {
    return null;
  }
  modelAccessUpdating.value = true;
  try {
    const current = assistantSelection.value || {};
    if (
      unlocked !== true &&
      current.modelProviderId === providerId &&
      recommendedModel.value &&
      current.modelId !== recommendedModel.value.id
    ) {
      const recovery = await restoreRecommendedModel({ closeMenu: false });
      if (recovery?.ok === false || !recovery) return recovery;
      await nextTick();
    }
    const response = await modelAccessCommand.run({
      engineId: engineId.value,
      modelProviderId: providerId,
      path,
      unlocked: unlocked === true
    });
    if (response?.ok !== false) {
      await catalog.reload();
    }
    return response;
  } finally {
    modelAccessUpdating.value = false;
  }
}

watch(assistantSelection, hydrateSelection, { immediate: true });

watch(menuOpen, (open) => {
  if (open) {
    hydrateSelection();
    void catalog.reload().catch(() => null);
  }
});

watch([modelProvider, availableModels, modelRows], ([provider, models, allModels]) => {
  if (!menuOpen.value || !provider) {
    return;
  }
  if (allModels.some((model) => model.id === modelId.value)) {
    return;
  }
  if (!models.some((model) => model.id === modelId.value)) {
    modelId.value = models.find((model) => (
      model.id === selectedOverviewEngine.value?.defaults?.modelId
    ))?.id || models[0]?.id || "";
  }
}, { immediate: true });

watch([compatibleAgents, modelId], ([agents]) => {
  if (!menuOpen.value) {
    return;
  }
  if (!agents.some((agent) => agent.id === agentId.value)) {
    agentId.value = agents.find((agent) => (
      agent.id === selectedOverviewEngine.value?.defaults?.agentId
    ))?.id || agents[0]?.id || "";
  }
}, { immediate: true });

watch([selectedModel, selectedAgent], ([model, agent]) => {
  if (!menuOpen.value || !model) {
    return;
  }
  const fixedVariant = String(agent?.variantId || "");
  if (fixedVariant) {
    variantId.value = fixedVariant;
  } else if (variantId.value && !model.variants.some((variant) => variant.id === variantId.value)) {
    variantId.value = "";
  }
}, { immediate: true });
</script>

<style scoped>
.vibe64-session-assistant-menu__button {
  background: var(--studio-control-bg, #fff) !important;
  border: 1px solid var(--studio-control-border, rgba(17, 24, 39, 0.12));
  border-radius: 7px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08) !important;
  color: var(--studio-control-text, #202124) !important;
  flex: 0 0 2rem;
  height: 2rem;
  min-height: 2rem;
  min-width: 2rem;
  width: 2rem;
}

.vibe64-session-assistant-menu {
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.16);
  display: grid;
  gap: 0.65rem;
  max-width: calc(100vw - 2rem);
  min-width: min(22rem, calc(100vw - 2rem));
  padding: 0.7rem;
}

.vibe64-session-assistant-menu__header {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  display: flex;
  gap: 0.55rem;
  padding: 0.1rem 0.1rem 0.6rem;
}

.vibe64-session-assistant-menu__header > div {
  display: grid;
  min-width: 0;
}

.vibe64-session-assistant-menu__header strong {
  font-size: 0.9rem;
  line-height: 1.25;
}

.vibe64-session-assistant-menu__header span {
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 0.78rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-session-assistant-menu__choices,
.vibe64-session-assistant-menu__loading {
  display: grid;
  gap: 0.55rem;
}

.vibe64-session-assistant-menu__section {
  display: grid;
  gap: 0.32rem;
}

.vibe64-session-assistant-menu__label {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.72rem;
  font-weight: 650;
  line-height: 1.2;
  padding-inline: 0.12rem;
  text-transform: uppercase;
}

.vibe64-session-assistant-menu__options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.28rem;
}

.vibe64-session-assistant-menu__option {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.16);
  border-radius: 7px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 0.82rem;
  gap: 0.34rem;
  letter-spacing: 0;
  line-height: 1.2;
  min-height: 2rem;
  padding: 0.34rem 0.52rem;
  text-align: left;
}

.vibe64-session-assistant-menu__option:hover {
  background: rgba(var(--v-theme-primary), 0.06);
}

.vibe64-session-assistant-menu__option--locked,
.vibe64-session-assistant-menu__option:disabled {
  background: rgba(var(--v-theme-on-surface), 0.035);
  color: rgba(var(--v-theme-on-surface), 0.46);
  cursor: not-allowed;
}

.vibe64-session-assistant-menu__option:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.vibe64-session-assistant-menu__option--active {
  background: rgba(var(--v-theme-primary), 0.09);
  border-color: rgba(var(--v-theme-primary), 0.36);
  color: rgb(var(--v-theme-primary));
  font-weight: 650;
}

.vibe64-session-assistant-menu__empty {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.82rem;
  padding: 0.35rem 0.12rem;
}

.vibe64-session-assistant-menu__access {
  background: rgba(var(--v-theme-primary), 0.045);
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 8px;
  display: grid;
  gap: 0.15rem;
  padding: 0.35rem 0.55rem 0.5rem;
}

.vibe64-session-assistant-menu__access small {
  color: rgba(var(--v-theme-on-surface), 0.65);
  line-height: 1.35;
}

.vibe64-session-assistant-menu__state {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: flex;
  font-size: 0.84rem;
  gap: 0.5rem;
  justify-content: space-between;
  min-height: 4rem;
  padding: 0.5rem 0.25rem;
}

.vibe64-session-assistant-menu__actions {
  align-items: center;
  display: grid;
  gap: 0.4rem;
  grid-template-columns: auto 1fr auto;
  min-height: 2.5rem;
}

@media (pointer: coarse) {
  .vibe64-session-assistant-menu__button {
    flex-basis: 3rem;
    height: 3rem;
    min-height: 3rem;
    min-width: 3rem;
    width: 3rem;
  }

  .vibe64-session-assistant-menu__option {
    min-height: 3rem;
  }
}
</style>
