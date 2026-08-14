import { computed, ref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { useEndpointResource } from "@jskit-ai/http-web/client/composables/useEndpointResource";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import {
  PROJECT_FOUNDATION_ENDPOINT,
  PROJECT_TEMPLATES_ENDPOINT,
  VIBE64_PROJECT_CHANGED_EVENT,
  VIBE64_PROJECT_TEMPLATES_API_SUFFIX,
  projectFoundationQueryKey,
  projectTemplatesQueryKey
} from "@/lib/studioGateApi.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";

const cachedProjectFoundations = new Map();

function useProjectFoundationGate(emit = () => undefined) {
  const applyingTemplateId = ref("");
  const projectSlug = useVibe64ProjectSlug();
  const foundationResource = useEndpointResource({
    fallbackLoadError: "Project foundation could not load.",
    path: PROJECT_FOUNDATION_ENDPOINT,
    queryKey: computed(() => projectFoundationQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value
    )),
    refreshOnPull: true,
    requestRecoveryLabel: "Project foundation",
    realtime: {
      event: VIBE64_PROJECT_CHANGED_EVENT
    }
  });
  const cachedFoundation = computed(() => cachedProjectFoundations.get(projectSlug.value) || null);
  const projectFoundation = computed(() => foundationResource.data.value || cachedFoundation.value || {});
  const foundationLoaded = computed(() => projectFoundation.value?.ok === true);
  const foundationReady = computed(() => foundationLoaded.value && projectFoundation.value.ready === true);
  const foundationSetupVisible = computed(() => foundationLoaded.value && !foundationReady.value);

  const templatesResource = useEndpointResource({
    enabled: foundationSetupVisible,
    fallbackLoadError: "Project foundations could not load.",
    path: PROJECT_TEMPLATES_ENDPOINT,
    queryKey: computed(() => projectTemplatesQueryKey(
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      projectSlug.value
    )),
    refreshOnPull: true,
    requestRecoveryLabel: "Project templates",
    realtime: {
      event: VIBE64_PROJECT_CHANGED_EVENT
    }
  });
  const projectTemplateEligibility = computed(() => templatesResource.data.value?.eligibility || {});
  const projectTemplatesEligible = computed(() => projectTemplateEligibility.value.eligible === true);
  const projectTemplates = computed(() => {
    if (!projectTemplatesEligible.value) {
      return [];
    }
    return Array.isArray(templatesResource.data.value?.templates) ? templatesResource.data.value.templates : [];
  });
  const projectTemplatesLoaded = computed(() => Array.isArray(templatesResource.data.value?.templates));
  const projectTemplatesLoading = computed(() => Boolean(
    foundationSetupVisible.value && (
      templatesResource.isInitialLoading.value ||
      templatesResource.isLoading.value ||
      (!projectTemplatesLoaded.value && !templatesResource.loadError.value)
    )
  ));

  const applyProjectTemplateCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_PROJECT_TEMPLATES_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: `${PROJECT_TEMPLATES_ENDPOINT}/${encodeURIComponent(context.templateId || "")}/apply`
    }),
    buildRawPayload: () => ({}),
    fallbackRunError: "The project foundation could not be applied.",
    messages: {
      error: "The project foundation could not be applied."
    },
    onRunSuccess: loadProjectFoundation,
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.project-templates.apply",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const foundationInitialLoading = computed(() => Boolean(
    !foundationLoaded.value && foundationResource.isInitialLoading.value
  ));
  const applyTemplateError = computed(() => (
    applyProjectTemplateCommand.messageType === "error"
      ? String(applyProjectTemplateCommand.message || "")
      : ""
  ));
  const eligibilityError = computed(() => {
    if (!foundationSetupVisible.value || !projectTemplatesLoaded.value || projectTemplatesEligible.value) {
      return "";
    }
    return String(
      projectTemplateEligibility.value.message ||
      "This project cannot use a project foundation right now."
    );
  });
  const foundationStateError = computed(() => {
    if (!foundationLoaded.value || foundationReady.value || projectFoundation.value.status === "pending") {
      return "";
    }
    return String(
      projectFoundation.value.message ||
      projectFoundation.value.errorCode ||
      "Project foundation state could not be read."
    );
  });
  const errorMessage = computed(() => String(
    foundationResource.loadError.value ||
    templatesResource.loadError.value ||
    eligibilityError.value ||
    foundationStateError.value ||
    applyTemplateError.value ||
    ""
  ));
  const projectState = computed(() => ({
    foundation: projectFoundation.value
  }));

  watch(() => foundationResource.data.value, (record) => {
    if (record?.ok === true) {
      cachedProjectFoundations.set(projectSlug.value, record);
    }
  }, {
    immediate: true
  });

  watch(projectState, (state) => {
    if (!foundationLoaded.value) {
      return;
    }
    emit(foundationReady.value ? "ready" : "missing", state);
  }, {
    immediate: true
  });

  watch(errorMessage, (message) => {
    if (message) {
      emit("error", message);
    }
  });

  return {
    applyProjectTemplate,
    applyingTemplateId,
    errorMessage,
    foundationInitialLoading,
    foundationReady,
    foundationSetupVisible,
    loadProjectFoundation,
    projectFoundation,
    projectState,
    projectTemplates,
    projectTemplatesLoading
  };

  async function loadProjectFoundation() {
    await foundationResource.reload();
  }

  async function applyProjectTemplate(templateId = "") {
    const normalizedTemplateId = String(templateId || "").trim();
    if (!normalizedTemplateId || applyingTemplateId.value || !projectTemplatesEligible.value) {
      return;
    }
    applyingTemplateId.value = normalizedTemplateId;
    try {
      await applyProjectTemplateCommand.run({
        templateId: normalizedTemplateId
      });
    } finally {
      applyingTemplateId.value = "";
    }
  }
}

export {
  useProjectFoundationGate
};
