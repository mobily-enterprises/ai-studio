<template>
  <Vibe64SessionAbandonDialog
    :abandon="dialogs.abandon"
    :short-session-id="shortSessionId"
  />
  <Vibe64SessionRenewalDialog :renewal="dialogs.renewal" />
</template>

<script setup>
import Vibe64SessionAbandonDialog from "@/components/studio/vibe64-session/Vibe64SessionAbandonDialog.vue";
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
