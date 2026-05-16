<template>
  <div class="project-type-gate">
    <StudioErrorNotice
      v-if="errorMessage"
      title="Project type could not load"
      :error="errorMessage"
      compact
    />

    <v-progress-linear
      v-if="loading && !currentApp"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <ProjectTypeSetup
      v-else-if="needsProjectType"
      :saving-type="savingType"
      :state="projectType"
      @select="saveProjectType"
    />

    <slot
      v-else-if="currentApp"
      :current-app="currentApp"
      :reload="loadCurrentApp"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import ProjectTypeSetup from "@/components/studio/ProjectTypeSetup.vue";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  readCurrentApp,
  saveCurrentAppProjectType
} from "@/lib/studioApi.js";

const emit = defineEmits(["ready", "missing", "error"]);

const currentApp = ref(null);
const errorMessage = ref("");
const loading = ref(false);
const savingType = ref("");

const projectType = computed(() => currentApp.value?.projectType || {});
const needsProjectType = computed(() => currentApp.value && projectType.value?.ready !== true);

async function loadCurrentApp() {
  loading.value = true;
  errorMessage.value = "";
  try {
    currentApp.value = await readCurrentApp();
    if (currentApp.value?.projectType?.ready === true) {
      emit("ready", currentApp.value);
    } else {
      emit("missing", currentApp.value);
    }
  } catch (error) {
    currentApp.value = null;
    errorMessage.value = String(error?.message || error || "Current app inspection failed.");
    emit("error", errorMessage.value);
  } finally {
    loading.value = false;
  }
}

async function saveProjectType(projectTypeId) {
  savingType.value = String(projectTypeId || "");
  errorMessage.value = "";
  try {
    await saveCurrentAppProjectType(projectTypeId);
    await loadCurrentApp();
  } catch (error) {
    errorMessage.value = String(error?.message || error || "Project type could not be saved.");
    emit("error", errorMessage.value);
  } finally {
    savingType.value = "";
  }
}

onMounted(() => {
  void loadCurrentApp();
});
</script>

<style scoped>
.project-type-gate {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}
</style>
