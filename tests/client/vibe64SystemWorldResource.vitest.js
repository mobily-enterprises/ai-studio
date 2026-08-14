import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";

const endpointMocks = vi.hoisted(() => ({
  calls: [],
  resources: [],
  useEndpointResource: vi.fn()
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({
    api: (suffix = "") => `/api${suffix}`
  })
}));

import {
  useVibe64SystemGraph
} from "../../packages/vibe64-system-graph/src/client/composables/useVibe64SystemGraph.js";

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
