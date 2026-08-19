<template>
  <Vibe64SessionAbandonDialog
    :abandon="dialogs.abandon"
    :short-session-id="shortSessionId"
  />
</template>

<script setup>
import Vibe64SessionAbandonDialog from "@/components/studio/vibe64-session/Vibe64SessionAbandonDialog.vue";
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
