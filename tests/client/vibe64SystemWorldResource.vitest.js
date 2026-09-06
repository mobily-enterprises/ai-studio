import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed, effectScope, nextTick, reactive, ref, unref } from "vue";

const endpointMocks = vi.hoisted(() => ({
  calls: [],
  resources: [],
  useEndpointResource: vi.fn()
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: () => ({ isRunning: false, run: vi.fn() })
}));

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({
    api: (suffix = "") => `/api${suffix}`
  })
}));

import {
  useVibe64SystemGraph
} from "../../packages/vibe64-system-graph/src/client/composables/useVibe64SystemGraph.js";
import {
  useVibe64DatabaseTools
} from "../../packages/vibe64-database-tools/src/client/composables/useVibe64DatabaseTools.js";

function endpointResource(data = null) {
  return {
    data: ref(data),
    isLoading: ref(false),
    isSaving: ref(false),
    loadError: ref(""),
    reload: vi.fn(async () => ({ data })),
    save: vi.fn(async () => ({ ok: true })),
    saveError: ref("")
  };
}

describe("Genesis City client resources", () => {
  beforeEach(() => {
    endpointMocks.calls.length = 0;
    endpointMocks.resources = [
      endpointResource({
        cities: {
          machine: { available: true },
          program: { available: false }
        },
        status: "partial"
      }),
      endpointResource({ city: { schema: "genesis.machine-city.v1" } }),
      endpointResource(null),
      endpointResource(null)
    ];
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockImplementation((options) => {
      endpointMocks.calls.push(options);
      return endpointMocks.resources[endpointMocks.calls.length - 1];
    });
  });

  it.each([
    { component: "Vibe64DatabaseWorkspace", pane: "database", useTool: useVibe64DatabaseTools, resources: 1 },
    { component: "Vibe64SystemWorldView", pane: "system", useTool: useVibe64SystemGraph, resources: 4 }
  ])("pauses $component resource admission through the actual retained-session binding", async ({ component, pane, useTool, resources }) => {
    const autopilot = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64AutopilotView.vue", import.meta.url
    ), "utf8");
    const tag = autopilot.match(new RegExp(`<${component}\\b[\\s\\S]*?/>`, "u"))?.[0];
    const binding = tag?.match(/:active="([^"]+)"/u)?.[1];
    expect(binding).toBeDefined();
    const childActive = new Function("props", "rightPaneTab", `return (${binding});`);
    const props = reactive({ active: true, projectPane: "dashboard" });
    const rightPaneTab = ref(pane);
    const sessionId = ref("session/a");
    const scope = effectScope();
    try {
      scope.run(() => useTool({
        active: computed(() => childActive(props, rightPaneTab.value)),
        sessionId
      }));
      expect(endpointMocks.calls).toHaveLength(resources);
      expect(endpointMocks.calls[0].enabled.value).toBe(true);
      const paths = endpointMocks.calls.map((call) => call.path.value);
      const keys = endpointMocks.calls.map((call) => call.queryKey.value);
      expect(paths[0]).toContain("/sessions/session%2Fa");

      props.active = false;
      await nextTick();
      expect(endpointMocks.calls.every((call) => unref(call.enabled) === false)).toBe(true);
      expect(endpointMocks.calls.map((call) => call.path.value)).toEqual(Array(resources).fill(""));

      props.active = true;
      await nextTick();
      expect(endpointMocks.calls.map((call) => call.path.value)).toEqual(paths);
      expect(endpointMocks.calls.map((call) => call.queryKey.value)).toEqual(keys);
      expect(endpointMocks.calls).toHaveLength(resources);
      expect(sessionId.value).toBe("session/a");

      rightPaneTab.value = "editor";
      await nextTick();
      expect(endpointMocks.calls.every((call) => unref(call.enabled) === false)).toBe(true);
      rightPaneTab.value = pane;
      props.projectPane = "preview";
      await nextTick();
      expect(endpointMocks.calls.every((call) => unref(call.enabled) === false)).toBe(true);
      props.projectPane = "dashboard";
      await nextTick();
      expect(endpointMocks.calls.map((call) => call.path.value)).toEqual(paths);
    } finally {
      scope.stop();
    }
  });

  it("reads status and native Cities, then refreshes synchronously", async () => {
    const scope = effectScope();
    let graph;
    scope.run(() => {
      graph = useVibe64SystemGraph({
        active: ref(true),
        sessionId: ref("session/a")
      });
    });

    expect(endpointMocks.calls).toHaveLength(4);
    expect(endpointMocks.calls.map((call) => call.path.value)).toEqual([
      "/api/vibe64/system-graph/sessions/session%2Fa/status",
      "/api/vibe64/system-graph/sessions/session%2Fa/cities/machine",
      "",
      "/api/vibe64/system-graph/sessions/session%2Fa/refresh"
    ]);
    expect(endpointMocks.calls[1].enabled.value).toBe(true);
    expect(endpointMocks.calls[2].enabled.value).toBe(false);
    expect(endpointMocks.calls[3].enabled).toBe(false);
    expect(graph.machineCity.value).toEqual({ schema: "genesis.machine-city.v1" });
    expect(graph.programCity.value).toBeNull();

    await graph.refresh();

    expect(endpointMocks.resources[3].save).toHaveBeenCalledOnce();
    expect(endpointMocks.resources[3].save).toHaveBeenCalledWith({}, { method: "POST" });
    expect(endpointMocks.resources[0].reload).toHaveBeenCalledOnce();
    expect(endpointMocks.resources[1].reload).toHaveBeenCalledOnce();
    expect(endpointMocks.resources[2].reload).not.toHaveBeenCalled();
    scope.stop();
  });
});
