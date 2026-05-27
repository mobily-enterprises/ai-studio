<template>
  <v-btn
    color="primary"
    :variant="variant"
    :disabled="busy || action.enabled !== true"
    :loading="actions.runActionCommand.isRunning && actions.activeActionId === action.id"
    :prepend-icon="actions.actionIcon(action)"
    :title="action.disabledReason || action.label"
    @click="actions.runAction(action)"
  >
    {{ action.label }}
  </v-btn>
</template>

<script setup>
defineProps({
  action: {
    default: () => ({}),
    type: Object
  },
  actions: {
    default: () => ({}),
    type: Object
  },
  busy: {
    default: false,
    type: Boolean
  },
  variant: {
    default: "flat",
    type: String
  }
});
</script>
