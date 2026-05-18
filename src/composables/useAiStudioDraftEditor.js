import { ref, unref } from "vue";

import {
  artifactsFromDraftEditorValues,
  draftEditorValuesFromArtifacts,
  normalizeDraftEditorFields
} from "@/lib/aiStudioDraftEditorModel.js";
import {
  resolveResponseErrorMessage
} from "@/lib/aiStudioResponseErrors.js";

function useAiStudioDraftEditor({
  onSaved = null,
  refreshSessionData,
  selectedSessionId,
  sessionArtifacts
} = {}) {
  const action = ref(null);
  const error = ref("");
  const fields = ref([]);
  const loading = ref(false);
  const open = ref(false);
  const saving = ref(false);
  const title = ref("Edit draft");
  const values = ref({});
  const notifySaved = typeof onSaved === "function" ? onSaved : () => null;

  function clear() {
    action.value = null;
    error.value = "";
    fields.value = [];
    loading.value = false;
    open.value = false;
    saving.value = false;
    title.value = "Edit draft";
    values.value = {};
  }

  async function openDraftEditor(nextAction = {}) {
    const actionId = String(nextAction.id || "").trim();
    action.value = nextAction;
    error.value = "";
    fields.value = normalizeDraftEditorFields(nextAction.artifactFields);
    loading.value = true;
    open.value = true;
    title.value = String(nextAction.label || "Edit draft");
    values.value = {};
    try {
      const response = await sessionArtifacts.readArtifacts(unref(selectedSessionId), actionId);
      if (response?.ok === false) {
        error.value = resolveResponseErrorMessage(response, "Draft could not be loaded.");
        return;
      }
      const responseFields = normalizeDraftEditorFields(response.artifactFields);
      fields.value = responseFields.length ? responseFields : fields.value;
      values.value = draftEditorValuesFromArtifacts(fields.value, response.artifacts || {});
    } catch (loadError) {
      error.value = String(loadError?.message || loadError || "Draft could not be loaded.");
    } finally {
      loading.value = false;
    }
  }

  async function saveDraftEditor() {
    if (!unref(selectedSessionId) || saving.value) {
      return;
    }
    error.value = "";
    saving.value = true;
    try {
      const response = await sessionArtifacts.saveArtifacts(
        unref(selectedSessionId),
        action.value?.id || "",
        artifactsFromDraftEditorValues(fields.value, values.value)
      );
      if (response?.ok === false) {
        error.value = resolveResponseErrorMessage(response, "Draft could not be saved.");
        return;
      }
      notifySaved();
      await refreshSessionData();
    } catch (saveError) {
      error.value = String(saveError?.message || saveError || "Draft could not be saved.");
    } finally {
      saving.value = false;
    }
  }

  return {
    clear,
    draftEditorAction: action,
    draftEditorError: error,
    draftEditorFields: fields,
    draftEditorLoading: loading,
    draftEditorOpen: open,
    draftEditorSaving: saving,
    draftEditorTitle: title,
    draftEditorValues: values,
    openDraftEditor,
    saveDraftEditor
  };
}

export {
  useAiStudioDraftEditor
};
