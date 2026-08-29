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
          <strong>AI for this session</strong>
          <span>{{ selectionSummary }}</span>
        </div>
      </header>

      <div
        v-if="catalogLoading"
        aria-label="Loading available AIs"
        class="vibe64-session-assistant-menu__loading"
      >
        <v-skeleton-loader
          v-for="index in 3"
          :key="index"
          type="list-item"
        />
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

      <div v-else class="vibe64-session-assistant-menu__fields">
        <v-select
          :model-value="modelProviderId"
          density="comfortable"
          hide-details="auto"
          item-title="label"
          item-value="id"
          :items="providerRows"
          label="Provider"
          variant="outlined"
          @update:model-value="selectProvider"
        />
        <v-select
          v-model="modelId"
          density="comfortable"
          hide-details="auto"
          item-title="label"
          item-value="id"
          :items="availableModels"
          label="Model"
          no-data-text="No available models"
          variant="outlined"
        />
        <v-select
          v-if="variantRows.length > 1"
          v-model="variantId"
          density="comfortable"
          hide-details="auto"
          item-title="label"
          item-value="id"
          :items="variantRows"
          label="Thinking"
          variant="outlined"
        />
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
  </v-menu>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import { mdiBrain, mdiCogOutline } from "@mdi/js";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";

import { useVibe64AssistantCatalog } from "@/composables/useVibe64AssistantCatalog.js";
import { requestVibe64AccountConnectionsDialog } from "@/lib/vibe64AccountConnectionsDialog.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
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
const modelProviderId = ref("");
const modelId = ref("");
const agentId = ref("");
const variantId = ref("");
const emptyText = ref("");
const assistantSelection = computed(() => props.session?.assistantSelection || null);
const engineId = computed(() => String(assistantSelection.value?.engineId || ""));
const accessLabel = computed(() => String(props.accessLabel || "").trim());
const catalog = useVibe64AssistantCatalog({
  active: menuOpen,
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
const availableModels = computed(() => (
  (modelProvider.value?.models || []).filter((model) => model.status === "available")
));
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
  { id: "", label: "Provider default" },
  ...(selectedModel.value?.variants || [])
]);
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
  !catalogError.value
));
const selectionSummary = computed(() => [
  selectedOverviewEngine.value?.label || engineId.value,
  selectedProvider.value?.label || assistantSelection.value?.modelProviderId,
  selectedModel.value?.label || assistantSelection.value?.modelId
].filter(Boolean).join(" · ") || "Choose an available AI");
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

function openConnectionSettings() {
  menuOpen.value = false;
  requestVibe64AccountConnectionsDialog({ section: "ai" });
}

async function save() {
  const sessionId = String(props.session?.sessionId || "").trim();
  const sessionsPath = String(readRefOrGetterValue(props.sessionsApiPath) || "").trim();
  if (!canSave.value || !sessionId || !sessionsPath || saving.value) {
    return;
  }
  saving.value = true;
  try {
    const response = await updateCommand.run({
      assistantSelection: draftSelection.value,
      path: vibe64SessionPath(sessionsPath, sessionId, "/assistant-selection")
    });
    if (response?.ok !== false) {
      menuOpen.value = false;
    }
  } finally {
    saving.value = false;
  }
}

watch([menuOpen, assistantSelection], ([open]) => {
  if (open) {
    hydrateSelection();
  }
}, { immediate: true });

watch([modelProvider, availableModels], ([provider, models]) => {
  if (!menuOpen.value || !provider) {
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

.vibe64-session-assistant-menu__fields,
.vibe64-session-assistant-menu__loading {
  display: grid;
  gap: 0.5rem;
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
}
</style>
