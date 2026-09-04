<template>
  <Vibe64SessionArchiveDialog
    :archive="dialogs.archive"
    :short-session-id="shortSessionId"
  />
  <Vibe64SessionRenewalDialog :renewal="dialogs.renewal" />
</template>

<script setup>
import Vibe64SessionArchiveDialog from "@/components/studio/vibe64-session/Vibe64SessionArchiveDialog.vue";
import Vibe64SessionRenewalDialog from "@/components/studio/vibe64-session/Vibe64SessionRenewalDialog.vue";
defineProps({
  dialogs: {
    default: () => ({}),
    type: Object
  },
  shortSessionId: {
    default: (sessionId) => String(sessionId || ""),
    type: Function
  }
});

</script>
