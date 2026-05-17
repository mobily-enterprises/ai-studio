import { computed, nextTick, ref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useView } from "@jskit-ai/users-web/client/composables/useView";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  aiStudioArtifactsPath,
  aiStudioArtifactsQueryKey
} from "@/lib/aiStudioSessionRequestConfig.js";

function normalizeSessionId(sessionId = "") {
  return String(sessionId || "").trim();
}

function normalizeArtifacts(value = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function useAiStudioSessionArtifacts() {
  const paths = usePaths();
  const artifactSessionId = ref("");
  const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));

  const artifactsView = useView({
    access: "never",
    apiSuffix: computed(() => artifactSessionId.value
      ? aiStudioArtifactsPath(AI_STUDIO_SESSIONS_API_SUFFIX, artifactSessionId.value)
      : ""),
    fallbackLoadError: "Draft could not be loaded.",
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.session-artifacts.view",
    queryKeyFactory: (surfaceId, ownershipFilter) => {
      return aiStudioArtifactsQueryKey(surfaceId, ownershipFilter, artifactSessionId.value);
    },
    readEnabled: false,
    surfaceId: AI_STUDIO_SURFACE_ID
  });

  const saveArtifactsCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "PUT",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioArtifactsPath(sessionsApiPath.value, context.sessionId)
    }),
    buildRawPayload: (_model, { context }) => ({
      artifacts: normalizeArtifacts(context.artifacts)
    }),
    fallbackRunError: "Draft could not be saved.",
    messages: {
      error: "Draft could not be saved.",
      success: "Draft saved."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.session-artifacts.save",
    suppressSuccessMessage: true,
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "PUT"
  });

  async function readArtifacts(sessionId = "") {
    const normalizedSessionId = normalizeSessionId(sessionId);
    artifactSessionId.value = normalizedSessionId;
    if (!artifactSessionId.value) {
      return {
        error: "AI Studio session id is required.",
        ok: false
      };
    }

    await nextTick();
    const result = await artifactsView.refresh();
    return result?.data || artifactsView.record || {};
  }

  async function saveArtifacts(sessionId = "", artifacts = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return {
        error: "AI Studio session id is required.",
        ok: false
      };
    }

    const response = await saveArtifactsCommand.run({
      artifacts,
      sessionId: normalizedSessionId
    });
    if (artifactSessionId.value === normalizedSessionId) {
      await artifactsView.refresh().catch(() => null);
    }
    return response;
  }

  return {
    artifactsLoadError: artifactsView.loadError,
    artifactsLoading: artifactsView.isLoading,
    readArtifacts,
    saveArtifacts,
    saveArtifactsCommand
  };
}

export {
  useAiStudioSessionArtifacts
};
