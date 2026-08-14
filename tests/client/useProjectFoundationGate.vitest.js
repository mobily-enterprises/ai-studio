import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

const commandMocks = vi.hoisted(() => ({
  run: vi.fn(),
  useCommand: vi.fn()
}));

const endpointMocks = vi.hoisted(() => ({
  calls: [],
  foundationData: null,
  foundationInitialLoading: null,
  foundationReload: vi.fn(),
  templatesData: null,
  templatesReload: vi.fn(),
  useEndpointResource: vi.fn()
}));

const projectScopeMocks = vi.hoisted(() => ({
  projectSlug: null
}));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

vi.mock("../../src/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug: () => projectScopeMocks.projectSlug
}));

import {
  useProjectFoundationGate
} from "../../src/composables/useProjectFoundationGate.js";

describe("useProjectFoundationGate", () => {
  beforeEach(() => {
    endpointMocks.calls.length = 0;
    endpointMocks.foundationData = ref({
      applicationMode: "new",
      foundationCommit: "",
      ok: true,
      ready: false,
      status: "pending"
    });
    endpointMocks.foundationInitialLoading = ref(false);
    endpointMocks.foundationReload.mockReset();
    endpointMocks.templatesData = ref({
      eligibility: {
        eligible: true
      },
      ok: true,
      templates: [
        {
          id: "genesis-blank",
          kind: "blank",
          name: "Blank project"
        },
        {
          id: "jskit-public",
          name: "Public"
        }
      ]
    });
    endpointMocks.templatesReload.mockReset();
    projectScopeMocks.projectSlug = ref("foundation-pending");
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockImplementation((options) => {
      endpointMocks.calls.push(options);
      if (options.requestRecoveryLabel === "Project foundation") {
        return endpointResource({
          data: endpointMocks.foundationData,
          initialLoading: endpointMocks.foundationInitialLoading,
          reload: endpointMocks.foundationReload
        });
      }
      if (options.requestRecoveryLabel === "Project templates") {
        return endpointResource({
          data: endpointMocks.templatesData,
          reload: endpointMocks.templatesReload
        });
      }
      throw new Error(`Unexpected endpoint resource: ${options.requestRecoveryLabel}`);
    });
    commandMocks.run.mockReset();
    commandMocks.useCommand.mockReset();
    commandMocks.run.mockImplementation(async (options) => {
      await options.onRunSuccess?.();
      return {
        ok: true
      };
    });
    commandMocks.useCommand.mockImplementation((options) => ({
      get message() {
        return "";
      },
      get messageType() {
        return "";
      },
      run: (context) => commandMocks.run(options, context)
    }));
  });

  it("loads the neutral foundation and applies blank or precooked templates", async () => {
    const emitted = [];
    const scope = effectScope();
    let gate;
    scope.run(() => {
      gate = useProjectFoundationGate((event, payload) => emitted.push({
        event,
        payload
      }));
    });
    await nextTick();

    const foundationRequest = endpointMocks.calls.find((call) => (
      call.requestRecoveryLabel === "Project foundation"
    ));
    const templatesRequest = endpointMocks.calls.find((call) => (
      call.requestRecoveryLabel === "Project templates"
    ));
    expect(foundationRequest.path).toMatch(/\/project-foundation$/u);
    expect(foundationRequest.queryKey.value).toContain("project-foundation");
    expect(templatesRequest.enabled.value).toBe(true);
    expect(endpointMocks.calls.some((call) => call.requestRecoveryLabel === "Project type")).toBe(false);
    expect(endpointMocks.calls.some((call) => call.requestRecoveryLabel === "Project config")).toBe(false);
    expect(gate.foundationSetupVisible.value).toBe(true);
    expect(gate.projectTemplates.value.map((template) => template.id)).toEqual([
      "genesis-blank",
      "jskit-public"
    ]);
    expect(emitted.at(-1)).toEqual({
      event: "missing",
      payload: {
        foundation: endpointMocks.foundationData.value
      }
    });

    await gate.applyProjectTemplate("genesis-blank");

    const templateCommandCall = commandMocks.run.mock.calls.find(([options]) => (
      options.placementSource === "vibe64.project-templates.apply"
    ));
    expect(templateCommandCall?.[1]).toEqual({
      templateId: "genesis-blank"
    });
    expect(templateCommandCall?.[0].buildCommandOptions({}, {
      context: templateCommandCall[1]
    }).path).toMatch(/\/project-templates\/genesis-blank\/apply$/u);
    expect(endpointMocks.foundationReload).toHaveBeenCalledOnce();
    expect(endpointMocks.templatesReload).not.toHaveBeenCalled();
    expect(gate.applyingTemplateId.value).toBe("");

    scope.stop();
  });

  it("opens the project as soon as its foundation becomes ready", async () => {
    projectScopeMocks.projectSlug.value = "foundation-ready";
    endpointMocks.foundationData.value = {
      applicationMode: "new",
      foundationCommit: "foundation-commit",
      ok: true,
      ready: true,
      status: "complete"
    };
    const emitted = [];
    const scope = effectScope();
    let gate;
    scope.run(() => {
      gate = useProjectFoundationGate((event, payload) => emitted.push({
        event,
        payload
      }));
    });
    await nextTick();

    const templatesRequest = endpointMocks.calls.find((call) => (
      call.requestRecoveryLabel === "Project templates"
    ));
    expect(gate.foundationReady.value).toBe(true);
    expect(gate.foundationSetupVisible.value).toBe(false);
    expect(templatesRequest.enabled.value).toBe(false);
    expect(emitted.at(-1)).toEqual({
      event: "ready",
      payload: {
        foundation: endpointMocks.foundationData.value
      }
    });

    scope.stop();
  });

  it("shows loading only until the first foundation response arrives", async () => {
    projectScopeMocks.projectSlug.value = "foundation-loading";
    endpointMocks.foundationData.value = null;
    endpointMocks.foundationInitialLoading.value = true;
    const scope = effectScope();
    let gate;
    scope.run(() => {
      gate = useProjectFoundationGate(() => undefined);
    });

    expect(gate.foundationInitialLoading.value).toBe(true);

    endpointMocks.foundationData.value = {
      ok: true,
      ready: false,
      status: "pending"
    };
    endpointMocks.foundationInitialLoading.value = false;
    await nextTick();

    expect(gate.foundationInitialLoading.value).toBe(false);
    expect(gate.foundationSetupVisible.value).toBe(true);

    scope.stop();
  });
});

function endpointResource({
  data,
  initialLoading = ref(false),
  reload
}) {
  return {
    data,
    isInitialLoading: initialLoading,
    isLoading: ref(false),
    loadError: ref(""),
    reload
  };
}
