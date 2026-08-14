import {
  computed,
  ref,
  watch
} from "vue";
import {
  mdiAccountCircleOutline,
  mdiAccountGroupOutline,
  mdiArrowRight,
  mdiCheckCircle,
  mdiCreationOutline,
  mdiDatabaseOutline,
  mdiFileOutline,
  mdiRocketLaunchOutline,
  mdiWeb
} from "@mdi/js";

const TEMPLATE_ICONS = Object.freeze({
  account: mdiAccountCircleOutline,
  blank: mdiFileOutline,
  database: mdiDatabaseOutline,
  web: mdiWeb,
  workspaces: mdiAccountGroupOutline
});

function useProjectTemplateSetup(props, emit) {
  const selectedTemplateId = ref("");
  const templates = computed(() => (
    Array.isArray(props.templates) ? props.templates : []
  ));
  const selectedTemplate = computed(() => templates.value
    .find((template) => template.id === selectedTemplateId.value) || null);
  const applying = computed(() => Boolean(props.applyingTemplateId));
  const selectionDescription = computed(() => {
    if (!selectedTemplate.value) {
      return "Select a blank or precooked starting point above to continue.";
    }
    if (applying.value) {
      return "Preparing the project and recording its foundation.";
    }
    if (selectedTemplate.value.kind === "blank") {
      return "Vibe64 will create an empty Git project prepared by Genesis.";
    }
    return "Vibe64 will install this precooked project and its Genesis foundation.";
  });
  const selectionHeading = computed(() => {
    if (!selectedTemplate.value) {
      return "Choose a starting point";
    }
    if (applying.value) {
      return `Preparing ${selectedTemplate.value.name}…`;
    }
    return `${selectedTemplate.value.name} is ready to go`;
  });

  watch(templates, (availableTemplates) => {
    if (
      selectedTemplateId.value &&
      !availableTemplates.some((template) => template.id === selectedTemplateId.value)
    ) {
      selectedTemplateId.value = "";
    }
  });

  function templateIcon(template = {}) {
    return TEMPLATE_ICONS[template.icon] || mdiRocketLaunchOutline;
  }

  function selectTemplate(template = {}) {
    if (!applying.value) {
      selectedTemplateId.value = String(template.id || "");
    }
  }

  function applySelectedTemplate() {
    if (selectedTemplate.value && !applying.value) {
      emit("apply", selectedTemplate.value.id);
    }
  }

  return {
    applySelectedTemplate,
    applying,
    mdiArrowRight,
    mdiCheckCircle,
    mdiCreationOutline,
    mdiRocketLaunchOutline,
    selectionDescription,
    selectionHeading,
    selectedTemplate,
    selectedTemplateId,
    selectTemplate,
    templateIcon,
    templates
  };
}

export {
  TEMPLATE_ICONS,
  useProjectTemplateSetup
};
