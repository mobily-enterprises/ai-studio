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
        :icon="mdiCogOutline"
        rounded="lg"
        size="small"
        :title="buttonTitle"
        type="button"
        variant="tonal"
      />
    </template>

    <v-sheet
      aria-label="AI session selector"
      border
      class="vibe64-session-assistant-menu"
      :elevation="3"
      rounded="xl"
    >
      <header class="vibe64-session-assistant-menu__header">
        <v-avatar color="primary" size="36" variant="tonal">
          <v-icon :icon="mdiBrain" size="20" />
        </v-avatar>
        <div>
          <strong class="text-title-small">AI controls</strong>
          <span class="text-body-small">{{ selectionSummary }}</span>
        </div>
      </header>

      <v-sheet
        v-if="changesDisabled"
        class="vibe64-session-assistant-menu__view-only"
        rounded="lg"
        role="status"
      >
        <v-icon :icon="mdiClockOutline" size="18" />
        <span>AI choices are view-only while the assistant is working.</span>
      </v-sheet>

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
            <v-btn
              v-for="provider in providerRows"
              :key="provider.id"
              :active="modelProviderId === provider.id"
              :aria-pressed="modelProviderId === provider.id"
              class="vibe64-session-assistant-menu__option"
              :color="modelProviderId === provider.id ? 'primary' : undefined"
              :disabled="changesDisabled"
              rounded="lg"
              size="small"
              type="button"
              :variant="modelProviderId === provider.id ? 'tonal' : 'outlined'"
              @click="selectProvider(provider.id)"
            >
              <span>{{ provider.label }}</span>
              <v-icon v-if="modelProviderId === provider.id" :icon="mdiCheck" size="15" />
            </v-btn>
          </div>
        </section>

        <section aria-label="Model" class="vibe64-session-assistant-menu__section">
          <div class="vibe64-session-assistant-menu__label">Model</div>
          <div v-if="modelRows.length" class="vibe64-session-assistant-menu__options">
            <v-btn
              v-for="model in modelRows"
              :key="model.id"
              :active="modelId === model.id && model.status === 'available'"
              :aria-label="model.status === 'available'
                ? model.label
                : `${model.label}. Locked. ${model.lockMessage || 'This model is not available.'}`"
              :aria-pressed="modelId === model.id"
              class="vibe64-session-assistant-menu__option"
              :class="{ 'vibe64-session-assistant-menu__option--locked': model.status !== 'available' }"
              :color="modelId === model.id && model.status === 'available' ? 'primary' : undefined"
              :disabled="changesDisabled || model.status !== 'available'"
              rounded="lg"
              size="small"
              :title="changesDisabled ? 'Wait for the active turn to finish before changing models.' : (model.status === 'available' ? model.label : model.lockMessage || 'This model is not available.')"
              type="button"
              :variant="modelId === model.id && model.status === 'available' ? 'tonal' : 'outlined'"
              @click="selectModel(model.id)"
            >
              <span>{{ model.label }}</span>
              <v-icon
                v-if="model.status !== 'available'"
                :icon="mdiLockOutline"
                size="15"
              />
              <v-icon v-else-if="modelId === model.id" :icon="mdiCheck" size="15" />
            </v-btn>
          </div>
          <span v-else class="vibe64-session-assistant-menu__empty">No available models.</span>
          <small
            v-if="modelAccess.configurable && !modelAccessUnlocked"
            class="vibe64-session-assistant-menu__locked-note"
          >
            <v-icon :icon="mdiLockOutline" size="14" />
            Paid models stay visible but locked in free-only mode.
          </small>
        </section>

        <section
          v-if="modelAccess.configurable"
          aria-label="Provider model access"
          class="vibe64-session-assistant-menu__section"
        >
          <div class="vibe64-session-assistant-menu__label">Z.AI access</div>
          <v-sheet
            class="vibe64-session-assistant-menu__access"
            :class="{ 'vibe64-session-assistant-menu__access--paid': modelAccessUnlocked }"
            rounded="lg"
          >
            <div class="vibe64-session-assistant-menu__access-summary">
              <v-avatar :color="modelAccessUnlocked ? 'warning' : 'success'" size="36" variant="tonal">
                <v-icon :icon="modelAccessUnlocked ? mdiCreditCardOutline : mdiShieldCheckOutline" size="19" />
              </v-avatar>
              <span>
                <strong>{{ modelAccessUnlocked ? "Paid models unlocked" : "Free-only mode" }}</strong>
                <small>
                  {{ modelAccessUnlocked
                    ? "Other Z.AI models can consume API credit."
                    : `${recommendedModel?.label || "The recommended model"} stays available without paid credit.` }}
                </small>
              </span>
            </div>
            <v-switch
              color="primary"
              :disabled="changesDisabled || !canConfigure || modelAccessUpdating || saving"
              hide-details
              inset
              :label="modelAccessUpdating ? modelAccessPendingLabel : modelAccess.label"
              :model-value="modelAccessUnlocked"
              @click.prevent="requestModelAccessChange(!modelAccessUnlocked)"
            />
            <v-btn
              v-if="canRestoreRecommendedModel"
              block
              color="primary"
              :disabled="changesDisabled || saving || modelAccessUpdating"
              size="small"
              type="button"
              variant="tonal"
              @click="restoreRecommendedModel"
            >
              {{ saving ? `Switching to ${recommendedModel.label}…` : `Use ${recommendedModel.label}` }}
            </v-btn>
          </v-sheet>
        </section>

        <section
          v-if="variantRows.length > 1"
          aria-label="Thinking"
          class="vibe64-session-assistant-menu__section"
        >
          <div class="vibe64-session-assistant-menu__label">Thinking</div>
          <div class="vibe64-session-assistant-menu__options">
            <v-btn
              v-for="variant in variantRows"
              :key="variant.id || 'automatic'"
              :active="variantId === variant.id"
              :aria-pressed="variantId === variant.id"
              class="vibe64-session-assistant-menu__option"
              :color="variantId === variant.id ? 'primary' : undefined"
              :disabled="changesDisabled"
              rounded="lg"
              size="small"
              type="button"
              :variant="variantId === variant.id ? 'tonal' : 'outlined'"
              @click="selectVariant(variant.id)"
            >
              <span>{{ variant.label }}</span>
              <v-icon v-if="variantId === variant.id" :icon="mdiCheck" size="15" />
            </v-btn>
          </div>
        </section>
      </div>

      <footer class="vibe64-session-assistant-menu__actions">
        <v-btn
          v-if="canConfigure"
          :disabled="changesDisabled"
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
        <v-card-item class="vibe64-session-assistant-menu__confirm-header">
          <template #prepend>
            <v-avatar color="warning" size="44" variant="tonal">
              <v-icon :icon="mdiCreditCardOutline" size="23" />
            </v-avatar>
          </template>
          <v-card-title>{{ modelAccess.label || "Unlock provider models" }}?</v-card-title>
          <v-card-subtitle class="vibe64-session-assistant-menu__confirm-subtitle">
            GLM-4.7 Flash stays available either way.
          </v-card-subtitle>
        </v-card-item>
        <v-card-text class="text-body-medium">
          {{ modelAccess.warning || "These models may consume paid provider credit." }}
        </v-card-text>
        <v-card-actions class="vibe64-session-assistant-menu__confirm-actions">
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
import {
  mdiBrain,
  mdiCheck,
  mdiClockOutline,
  mdiCogOutline,
  mdiCreditCardOutline,
  mdiLockOutline,
  mdiShieldCheckOutline
} from "@mdi/js";
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
  changesDisabled: {
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
  !props.changesDisabled &&
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
  }${props.changesDisabled ? " · Changes available after the current turn" : ""}`
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
  if (props.changesDisabled) return;
  modelProviderId.value = String(value || "");
  modelId.value = "";
  agentId.value = "";
  variantId.value = "";
}

function selectModel(value = "") {
  if (props.changesDisabled) return;
  modelId.value = String(value || "");
  agentId.value = "";
  variantId.value = "";
}

function selectVariant(value = "") {
  if (props.changesDisabled) return;
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
  if (props.changesDisabled) return;
  menuOpen.value = false;
  requestVibe64AccountConnectionsDialog({ section: "ai" });
}

async function applySelection(selection, { closeMenu = true } = {}) {
  const sessionId = String(props.session?.sessionId || "").trim();
  const sessionsPath = String(readRefOrGetterValue(props.sessionsApiPath) || "").trim();
  if (props.changesDisabled || !selection || !sessionId || !sessionsPath || saving.value) {
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
  if (props.changesDisabled || !props.canConfigure || modelAccessUpdating.value || saving.value) return;
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
    props.changesDisabled ||
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
  flex: 0 0 2rem;
  height: 2rem;
  min-height: 2rem;
  min-width: 2rem;
  width: 2rem;
}

.vibe64-session-assistant-menu {
  display: grid;
  gap: 0.75rem;
  max-height: calc(100vh - 2rem);
  max-width: calc(100vw - 2rem);
  min-width: min(24rem, calc(100vw - 2rem));
  overflow-y: auto;
  padding: 0.75rem;
  width: min(24rem, calc(100vw - 2rem));
}

.vibe64-session-assistant-menu__header {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.12);
  display: flex;
  gap: 0.65rem;
  padding: 0.1rem 0.1rem 0.7rem;
}

.vibe64-session-assistant-menu__header > div {
  display: grid;
  min-width: 0;
}

.vibe64-session-assistant-menu__header span {
  color: rgba(var(--v-theme-on-surface), 0.65);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-session-assistant-menu__view-only {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.78);
  display: flex;
  font-size: 0.78rem;
  gap: 0.5rem;
  line-height: 1.35;
  padding: 0.6rem 0.7rem;
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
  letter-spacing: 0;
  min-height: 2.5rem;
  text-transform: none;
}

.vibe64-session-assistant-menu__option--locked {
  opacity: 0.62;
}

.vibe64-session-assistant-menu__empty,
.vibe64-session-assistant-menu__locked-note {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.82rem;
  padding: 0.35rem 0.12rem;
}

.vibe64-session-assistant-menu__locked-note {
  align-items: center;
  display: flex;
  gap: 0.35rem;
  padding-block: 0.1rem;
}

.vibe64-session-assistant-menu__access {
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  gap: 0.65rem;
  padding: 0.7rem;
}

.vibe64-session-assistant-menu__access--paid {
  background: rgba(var(--v-theme-warning), 0.1);
  border-color: rgba(var(--v-theme-warning), 0.2);
}

.vibe64-session-assistant-menu__access-summary {
  align-items: center;
  display: flex;
  gap: 0.65rem;
}

.vibe64-session-assistant-menu__access-summary > span:last-child {
  display: grid;
  gap: 0.1rem;
  min-width: 0;
}

.vibe64-session-assistant-menu__access-summary small {
  color: rgba(var(--v-theme-on-surface), 0.72);
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
  border-top: 1px solid rgba(var(--v-theme-outline), 0.12);
  display: grid;
  gap: 0.4rem;
  grid-template-columns: auto 1fr auto;
  min-height: 2.5rem;
  padding-top: 0.4rem;
}

.vibe64-session-assistant-menu__confirm-header {
  padding: 1.25rem 1.25rem 0.5rem;
}

.vibe64-session-assistant-menu__confirm-actions {
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0.75rem 1.25rem 1.25rem;
}

.vibe64-session-assistant-menu__confirm-subtitle {
  overflow: visible;
  text-overflow: initial;
  white-space: normal;
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

@media (max-width: 600px) {
  .vibe64-session-assistant-menu__confirm-actions {
    align-items: stretch;
    flex-direction: column-reverse;
  }

  .vibe64-session-assistant-menu__confirm-actions .v-btn {
    width: 100%;
  }
}
</style>
