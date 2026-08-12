<template>
  <section class="runtime-config-records">
    <section class="runtime-config-records__section">
      <div class="runtime-config-records__heading">
        <h2>{{ editableTitle }}</h2>
        <v-chip size="x-small" variant="tonal">
          {{ editableRecords.length }}
        </v-chip>
      </div>

      <RuntimeConfigRecordsTable
        v-if="editableRecords.length"
        :environment-label="environmentLabel"
        :public-env-prefixes="publicEnvPrefixes"
        :records="editableRecords"
        :revealed-secrets="revealedSecrets"
        :save-busy="saveBusy"
        :secret-reveal-busy-key="secretRevealBusyKey"
        :secret-reveal-enabled="secretRevealEnabled"
        show-actions
        @hide-secret="$emit('hide-secret', $event)"
        @remove-record="$emit('remove-record', $event)"
        @reveal-secret="$emit('reveal-secret', $event)"
        @save-record="$emit('save-record', $event)"
      />
      <p v-else class="runtime-config-records__empty">
        {{ editableEmptyText }}
      </p>
    </section>

    <v-expansion-panels
      v-if="systemRecords.length"
      class="runtime-config-records__system"
      variant="accordion"
    >
      <v-expansion-panel>
        <v-expansion-panel-title>
          <span class="runtime-config-records__system-title">
            {{ systemTitle }}
            <v-chip size="x-small" variant="tonal">
              {{ systemRecords.length }}
            </v-chip>
          </span>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <RuntimeConfigRecordsTable
            :environment-label="environmentLabel"
            :public-env-prefixes="publicEnvPrefixes"
            :records="systemRecords"
            :revealed-secrets="revealedSecrets"
            :secret-reveal-busy-key="secretRevealBusyKey"
            :secret-reveal-enabled="secretRevealEnabled"
            @hide-secret="$emit('hide-secret', $event)"
            @reveal-secret="$emit('reveal-secret', $event)"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </section>
</template>

<script setup>
import { computed } from "vue";
import RuntimeConfigRecordsTable from "@/components/studio/RuntimeConfigRecordsTable.vue";

defineEmits([
  "hide-secret",
  "remove-record",
  "reveal-secret",
  "save-record"
]);

const props = defineProps({
  editableEmptyText: {
    default: "No user Env values.",
    type: String
  },
  editableTitle: {
    default: "User values",
    type: String
  },
  environmentLabel: {
    default: "environment",
    type: String
  },
  publicEnvPrefixes: {
    default: () => [],
    type: Array
  },
  records: {
    default: () => [],
    type: Array
  },
  revealedSecrets: {
    default: () => ({}),
    type: Object
  },
  saveBusy: {
    default: false,
    type: Boolean
  },
  secretRevealBusyKey: {
    default: "",
    type: String
  },
  secretRevealEnabled: {
    default: false,
    type: Boolean
  },
  systemTitle: {
    default: "System values",
    type: String
  }
});

const records = computed(() => Array.isArray(props.records) ? props.records : []);
const editableRecords = computed(() => records.value.filter(recordEditable));
const systemRecords = computed(() => records.value.filter((record) => !recordEditable(record)));

function recordEditable(record = {}) {
  return record.editable === true;
}
</script>

<style scoped>
.runtime-config-records {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.runtime-config-records__section {
  display: grid;
  gap: 0.5rem;
  min-width: 0;
}

.runtime-config-records__heading {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: flex-start;
}

.runtime-config-records__heading h2 {
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0;
}

.runtime-config-records__empty {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.86rem;
  margin: 0;
}

.runtime-config-records__system-title {
  align-items: center;
  display: inline-flex;
  gap: 0.5rem;
  min-width: 0;
}
</style>
