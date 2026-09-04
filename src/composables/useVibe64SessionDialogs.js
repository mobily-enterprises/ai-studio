import { computed, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";

function useVibe64SessionDialogs({
  clearSelectedSession = () => null,
  isSelectedSessionArchived,
  refreshSessionData = async () => null,
  selectedSessionId,
  selectedSessionTitle,
  sessionsApiPath
} = {}) {
  const archiveDialogOpen = ref(false);
  const archiveDialogSessionId = ref("");
  const archiveDialogSessionTitle = ref("");
  const archivingSessionId = ref("");
  const resolvedSessionsApiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || ""));

  const archiveCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildRawPayload: () => vibe64RealtimeOriginPayload(),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64SessionPath(resolvedSessionsApiPath.value, context?.sessionId, "/archive")
    }),
    fallbackRunError: "Vibe64 session could not be archived.",
    messages: {
      error: "Vibe64 session could not be archived.",
      success: "Vibe64 session archived."
    },
    onRunSuccess: async (response, { context } = {}) => {
      if (response?.ok !== true) {
        throw new Error(
          response?.errors?.[0]?.message ||
          response?.error ||
          "Vibe64 session could not be archived."
        );
      }
      if (!context?.sessionId || context.sessionId === unref(selectedSessionId)) {
        clearSelectedSession();
      }
      await refreshSessionData({
        includeList: true,
        reason: "archive-session"
      });
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.archive",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  function clearArchiveDialog() {
    archiveDialogOpen.value = false;
    archiveDialogSessionId.value = "";
    archiveDialogSessionTitle.value = "";
  }

  function requestArchiveSelectedSession() {
    if (
      !unref(selectedSessionId) ||
      archivingSessionId.value ||
      archiveCommand.isRunning ||
      unref(isSelectedSessionArchived)
    ) {
      return;
    }
    archiveDialogSessionId.value = unref(selectedSessionId);
    archiveDialogSessionTitle.value = unref(selectedSessionTitle);
    archiveDialogOpen.value = true;
  }

  function cancelArchiveSession() {
    if (!archiveCommand.isRunning) {
      clearArchiveDialog();
    }
  }

  async function confirmArchiveSession() {
    if (
      !archiveDialogSessionId.value ||
      archivingSessionId.value ||
      archiveCommand.isRunning
    ) {
      return false;
    }
    const sessionId = archiveDialogSessionId.value;
    archivingSessionId.value = sessionId;
    clearArchiveDialog();
    try {
      return await archiveCommand.run({ sessionId });
    } finally {
      if (archivingSessionId.value === sessionId) {
        archivingSessionId.value = "";
      }
    }
  }

  function clear() {
    clearArchiveDialog();
  }

  return {
    archive: {
      archiving: computed(() => Boolean(archivingSessionId.value)),
      archivingSessionId,
      cancel: cancelArchiveSession,
      command: archiveCommand,
      confirm: confirmArchiveSession,
      open: archiveDialogOpen,
      request: requestArchiveSelectedSession,
      sessionId: archiveDialogSessionId,
      sessionTitle: archiveDialogSessionTitle
    },
    busy: computed(() => Boolean(archivingSessionId.value)),
    clear
  };
}

export { useVibe64SessionDialogs };
