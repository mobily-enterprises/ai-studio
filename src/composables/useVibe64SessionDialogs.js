import { computed, ref, unref } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useVibe64DiffDialog } from "@/composables/useVibe64DiffDialog.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";

function useVibe64SessionDialogs({
  clearSelectedSession = () => null,
  isSelectedSessionClosed,
  refreshSessionData = async () => null,
  selectedSessionId,
  selectedSessionTitle,
  sessionsApiPath
} = {}) {
  const abandonDialogOpen = ref(false);
  const abandonDialogSessionId = ref("");
  const abandonDialogSessionTitle = ref("");
  const abandonClosingSessionId = ref("");
  const resolvedSessionsApiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || ""));

  const {
    clearDiffDialog,
    closeDiffDialog,
    diffDialogOpen,
    diffError,
    diffLoading,
    diffPayload,
    loadDiff,
    loadFullDiff,
    openDiffDialog
  } = useVibe64DiffDialog({
    canOpen: () => Boolean(unref(selectedSessionId) && !unref(isSelectedSessionClosed)),
    selectedSessionId
  });

  const abandonCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildRawPayload: () => vibe64RealtimeOriginPayload(),
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64SessionPath(resolvedSessionsApiPath.value, context?.sessionId, "/abandon")
    }),
    fallbackRunError: "Vibe64 session could not be closed.",
    messages: {
      error: "Vibe64 session could not be closed.",
      success: "Vibe64 session closed."
    },
    onRunSuccess: async (response, { context } = {}) => {
      if (response?.ok !== true) {
        throw new Error(
          response?.errors?.[0]?.message ||
          response?.error ||
          "Vibe64 session could not be closed."
        );
      }
      if (!context?.sessionId || context.sessionId === unref(selectedSessionId)) {
        clearSelectedSession();
      }
      await refreshSessionData({
        includeList: true,
        reason: "close-session"
      });
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.sessions.abandon",
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  function clearAbandonDialog() {
    abandonDialogOpen.value = false;
    abandonDialogSessionId.value = "";
    abandonDialogSessionTitle.value = "";
  }

  function requestAbandonSelectedSession() {
    if (
      !unref(selectedSessionId) ||
      abandonClosingSessionId.value ||
      abandonCommand.isRunning ||
      unref(isSelectedSessionClosed)
    ) {
      return;
    }
    abandonDialogSessionId.value = unref(selectedSessionId);
    abandonDialogSessionTitle.value = unref(selectedSessionTitle);
    abandonDialogOpen.value = true;
  }

  function cancelAbandonSession() {
    if (!abandonCommand.isRunning) {
      clearAbandonDialog();
    }
  }

  async function confirmAbandonSession() {
    if (
      !abandonDialogSessionId.value ||
      abandonClosingSessionId.value ||
      abandonCommand.isRunning
    ) {
      return false;
    }
    const sessionId = abandonDialogSessionId.value;
    abandonClosingSessionId.value = sessionId;
    clearAbandonDialog();
    try {
      return await abandonCommand.run({ sessionId });
    } finally {
      if (abandonClosingSessionId.value === sessionId) {
        abandonClosingSessionId.value = "";
      }
    }
  }

  function clear() {
    clearAbandonDialog();
    clearDiffDialog();
  }

  return {
    abandon: {
      cancel: cancelAbandonSession,
      closing: computed(() => Boolean(abandonClosingSessionId.value)),
      closingSessionId: abandonClosingSessionId,
      command: abandonCommand,
      confirm: confirmAbandonSession,
      open: abandonDialogOpen,
      request: requestAbandonSelectedSession,
      sessionId: abandonDialogSessionId,
      sessionTitle: abandonDialogSessionTitle
    },
    busy: computed(() => Boolean(abandonClosingSessionId.value)),
    clear,
    diff: {
      close: closeDiffDialog,
      error: diffError,
      load: loadDiff,
      loadFull: loadFullDiff,
      loading: diffLoading,
      open: diffDialogOpen,
      openDialog: openDiffDialog,
      payload: diffPayload
    }
  };
}

export { useVibe64SessionDialogs };
