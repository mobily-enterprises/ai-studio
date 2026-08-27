<template>
  <v-btn
    aria-label="AI session settings"
    class="vibe64-session-assistant-menu__button"
    density="comfortable"
    :disabled="disabled"
    :icon="mdiCogOutline"
    size="small"
    :title="buttonTitle"
    type="button"
    variant="flat"
    @click="open = true"
  />

  <Vibe64AssistantSessionDialog
    v-model="open"
    :access-label="accessLabel"
    :access-loading="accessLoading"
    engine-locked
    :initial-selection="assistantSelection"
    mode="edit"
    :submit-running="saving"
    :submit-selection="saveSelection"
  />
</template>

<script setup>
import { computed, ref } from "vue";
import { mdiCogOutline } from "@mdi/js";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";

import Vibe64AssistantSessionDialog from "@/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue";
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
  disabled: {
    default: false,
    type: Boolean
  },
  disabledReason: {
    default: "",
    type: String
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

const open = ref(false);
const saving = ref(false);
const assistantSelection = computed(() => props.session?.assistantSelection || null);
const accessLabel = computed(() => String(props.accessLabel || "").trim());
const buttonTitle = computed(() => {
  const disabledReason = String(props.disabledReason || "").trim();
  if (props.disabled && disabledReason) {
    return disabledReason;
  }
  const selection = assistantSelection.value || {};
  return [
    "AI session settings",
    selection.engineId,
    selection.modelProviderId,
    selection.modelId,
    selection.variantId
  ].filter(Boolean).join(": ") + (accessLabel.value ? ` · ${accessLabel.value}` : "");
});
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

async function saveSelection(selection = {}) {
  const sessionId = String(props.session?.sessionId || "").trim();
  const sessionsPath = String(readRefOrGetterValue(props.sessionsApiPath) || "").trim();
  if (!sessionId || !sessionsPath || saving.value) {
    return { ok: false };
  }
  saving.value = true;
  try {
    return await updateCommand.run({
      assistantSelection: selection,
      path: vibe64SessionPath(sessionsPath, sessionId, "/assistant-selection")
    });
  } finally {
    saving.value = false;
  }
}
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
