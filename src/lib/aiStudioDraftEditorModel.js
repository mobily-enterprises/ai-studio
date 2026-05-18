function normalizeDraftEditorField(field = {}) {
  const name = String(field?.name || "").trim();
  if (!name) {
    return null;
  }
  const kind = String(field.kind || "textarea").trim();
  return {
    kind: kind === "text" ? "text" : "textarea",
    label: String(field.label || name).trim(),
    name,
    required: field.required !== false,
    requiredMessage: String(field.requiredMessage || "").trim()
  };
}

function normalizeDraftEditorFields(fields = []) {
  return (Array.isArray(fields) ? fields : [])
    .map(normalizeDraftEditorField)
    .filter(Boolean);
}

function draftEditorValuesFromArtifacts(fields = [], artifacts = {}) {
  return Object.fromEntries(normalizeDraftEditorFields(fields).map((field) => [
    field.name,
    String(artifacts?.[field.name] || "")
  ]));
}

function artifactsFromDraftEditorValues(fields = [], values = {}) {
  return Object.fromEntries(normalizeDraftEditorFields(fields).map((field) => [
    field.name,
    String(values?.[field.name] || "")
  ]));
}

export {
  artifactsFromDraftEditorValues,
  draftEditorValuesFromArtifacts,
  normalizeDraftEditorFields
};
