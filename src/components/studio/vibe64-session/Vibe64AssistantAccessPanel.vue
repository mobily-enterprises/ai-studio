<template>
  <section
    v-if="accessError || suggestionsRelevant"
    class="vibe64-assistant-access"
    aria-label="AI attention required"
  >
    <v-btn
      v-if="accessError"
      :aria-label="accessError"
      color="warning"
      :icon="mdiAlertCircleOutline"
      size="small"
      :title="accessError"
      type="button"
      variant="text"
      @click="$emit('reload')"
    />

    <v-badge
      v-if="suggestionsRelevant"
      :color="suggestionsError || pendingSuggestions.length ? 'warning' : undefined"
      :content="suggestionsError ? '!' : pendingSuggestions.length"
      inline
    >
      <v-btn
        :aria-label="queueButtonAriaLabel"
        :color="suggestionsError || pendingSuggestions.length ? 'warning' : undefined"
        :icon="suggestionsError ? mdiAlertCircleOutline : mdiMessageAlertOutline"
        size="small"
        :title="queueButtonAriaLabel"
        type="button"
        variant="text"
        @click="queueOpen = true"
      />
    </v-badge>

    <v-dialog v-model="queueOpen" max-width="40rem" scrollable>
      <v-card rounded="xl">
        <v-card-title>{{ canManage ? "Message requests awaiting review" : "Your message requests" }}</v-card-title>
        <v-card-subtitle>
          {{ canManage ? "Approve a message before it enters the AI conversation." : "The owner decides whether these messages enter the AI conversation." }}
        </v-card-subtitle>
        <v-card-text class="vibe64-assistant-access__queue">
          <div v-if="suggestionsError" class="vibe64-assistant-access__queue-error">
            <span class="text-body-small">{{ suggestionsError }}</span>
            <v-btn size="small" type="button" variant="text" @click="$emit('reload')">
              Try again
            </v-btn>
          </div>
          <p v-else-if="!pendingSuggestions.length" class="vibe64-assistant-access__empty text-body-small text-medium-emphasis">
            No pending message requests.
          </p>
          <div v-else class="vibe64-assistant-access__items">
            <article
              v-for="suggestion in pendingSuggestions"
              :key="suggestion.id"
              class="vibe64-assistant-access__item"
            >
              <div class="vibe64-assistant-access__message">
                <strong class="text-label-large">{{ suggestion.author?.displayName || suggestion.author?.username || "Member" }}</strong>
                <p class="text-body-medium">{{ suggestion.displayMessage || suggestion.message }}</p>
                <span v-if="suggestion.attachmentIds?.length" class="text-label-small text-medium-emphasis">
                  {{ suggestion.attachmentIds.length }} attachment{{ suggestion.attachmentIds.length === 1 ? "" : "s" }} retained
                </span>
                <span v-if="suggestion.lastDeliveryError" class="text-label-small text-error">
                  Delivery failed: {{ suggestion.lastDeliveryError }}
                </span>
              </div>
              <div class="vibe64-assistant-access__actions">
                <template v-if="canManage">
                  <v-btn
                    :aria-busy="actionIsPending('discard', suggestion.id) ? 'true' : undefined"
                    :disabled="Boolean(pendingAction)"
                    size="small"
                    type="button"
                    variant="text"
                    @click="$emit('discard', suggestion.id)"
                  >
                    Discard
                  </v-btn>
                  <v-btn
                    :aria-busy="actionIsPending('approve', suggestion.id) ? 'true' : undefined"
                    color="primary"
                    :disabled="Boolean(pendingAction)"
                    size="small"
                    type="button"
                    variant="tonal"
                    @click="$emit('approve', suggestion.id)"
                  >
                    Approve
                  </v-btn>
                </template>
                <v-btn
                  v-else
                  :aria-busy="actionIsPending('withdraw', suggestion.id) ? 'true' : undefined"
                  :disabled="Boolean(pendingAction)"
                  size="small"
                  type="button"
                  variant="text"
                  @click="$emit('withdraw', suggestion.id)"
                >
                  Withdraw
                </v-btn>
              </div>
            </article>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn type="button" variant="text" @click="queueOpen = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";
import {
  mdiAlertCircleOutline,
  mdiMessageAlertOutline
} from "@mdi/js";

const props = defineProps({
  accessError: {
    default: "",
    type: String
  },
  actionIsPending: {
    default: () => false,
    type: Function
  },
  canManage: {
    default: false,
    type: Boolean
  },
  pendingAction: {
    default: null,
    type: Object
  },
  pendingSuggestions: {
    default: () => [],
    type: Array
  },
  suggestionsError: {
    default: "",
    type: String
  }
});

defineEmits([
  "approve",
  "discard",
  "reload",
  "withdraw"
]);
const queueOpen = ref(false);

const suggestionsRelevant = computed(() => Boolean(
  props.suggestionsError ||
  props.pendingSuggestions.length
));
const queueButtonAriaLabel = computed(() => {
  if (props.suggestionsError) {
    return "Message requests need attention";
  }
  return `Open ${props.pendingSuggestions.length} pending message request${
    props.pendingSuggestions.length === 1 ? "" : "s"
  }`;
});
</script>

<style scoped>
.vibe64-assistant-access {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.2rem;
  min-width: 0;
}

.vibe64-assistant-access__queue {
  display: grid;
  gap: 0.75rem;
}

.vibe64-assistant-access__items {
  display: grid;
  gap: 0.5rem;
}

.vibe64-assistant-access__message {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.vibe64-assistant-access__item {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.16);
  border-radius: 0.75rem;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-height: 4.5rem;
  padding: 0.6rem 0.7rem;
}

.vibe64-assistant-access__message p,
.vibe64-assistant-access__empty {
  margin: 0;
  overflow-wrap: anywhere;
}

.vibe64-assistant-access__actions,
.vibe64-assistant-access__queue-error {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.vibe64-assistant-access__empty,
.vibe64-assistant-access__queue-error {
  min-height: 3rem;
}

@media (max-width: 600px), (pointer: coarse) {
  .vibe64-assistant-access__item {
    align-items: stretch;
    flex-direction: column;
  }

  .vibe64-assistant-access__actions .v-btn {
    min-height: 3rem;
  }

  .vibe64-assistant-access > :deep(.v-btn) {
    min-height: 3rem;
  }
}
</style>
