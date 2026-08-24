import { effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const creationHarness = vi.hoisted(() => ({
  createRun: null,
  endpointResource: null,
  projectSlug: null,
  refetch: null,
  selectedId: null,
  select: null,
  selectAvailableId: null,
  updateRun: null
}));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand(options = {}) {
    const run = options.apiSuffix === "/vibe64/sessions"
      ? creationHarness.createRun
      : creationHarness.updateRun;
    return {
      isRunning: false,
      run: (...args) => run(...args)
    };
  }
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: () => creationHarness.endpointResource
}));

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({
    api: (suffix = "") => `/api/${creationHarness.projectSlug.value}${suffix}`
  })
}));

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug: () => creationHarness.projectSlug
}));

vi.mock("@/composables/useVibe64SessionSelection.js", () => ({
  useVibe64SessionSelection: () => ({
    clear() {
      creationHarness.selectedId.value = "";
    },
    select: creationHarness.select,
    selectAvailableId: creationHarness.selectAvailableId,
    selectedId: creationHarness.selectedId
  })
}));

import {
  useVibe64SessionData
} from "../../src/composables/useVibe64SessionData.js";

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((settle, fail) => {
    reject = fail;
    resolve = settle;
  });
  return { promise, reject, resolve };
}

function mountSessionData() {
  const scope = effectScope();
  const sessionData = scope.run(() => useVibe64SessionData());
  return { scope, sessionData };
}

beforeEach(() => {
  creationHarness.projectSlug = ref("project-a");
  creationHarness.selectedId = ref("");
  creationHarness.createRun = vi.fn();
  creationHarness.updateRun = vi.fn(async () => ({ ok: true }));
  creationHarness.refetch = vi.fn(async () => ({ data: { sessions: [] } }));
  creationHarness.select = vi.fn((sessionId = "") => {
    creationHarness.selectedId.value = sessionId;
  });
  creationHarness.selectAvailableId = vi.fn();
  creationHarness.endpointResource = {
    data: ref({
      creation: { canCreate: true },
      limits: { maxOpenSessions: 3, openSessionCount: 0 },
      sessions: []
    }),
    isInitialLoading: ref(false),
    isLoading: ref(false),
    loadError: ref(""),
    query: {
      refetch: creationHarness.refetch
    },
    reload: creationHarness.refetch
  };
});

describe("Vibe64 session creation", () => {
  it("sets pending synchronously and coalesces rapid requests into one command", async () => {
    const pending = deferred();
    creationHarness.createRun.mockImplementation(() => pending.promise);
    const { scope, sessionData } = mountSessionData();

    const first = sessionData.createSession();
    expect(sessionData.createSessionRunning.value).toBe(true);
    const second = sessionData.createSession();

    expect(creationHarness.createRun).toHaveBeenCalledTimes(1);
    pending.resolve({ ok: true, sessionId: "session-created" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, sessionId: "session-created" },
      { ok: true, sessionId: "session-created" }
    ]);
    await nextTick();

    expect(sessionData.createSessionRunning.value).toBe(false);
    expect(creationHarness.select).toHaveBeenCalledTimes(1);
    expect(creationHarness.select).toHaveBeenCalledWith("session-created");
    expect(creationHarness.refetch).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("clears pending after rejection and permits a later retry", async () => {
    const pending = deferred();
    creationHarness.createRun.mockImplementationOnce(() => pending.promise);
    const { scope, sessionData } = mountSessionData();

    const first = sessionData.createSession();
    const second = sessionData.createSession();
    pending.reject(new Error("Creation failed."));
    const settled = await Promise.allSettled([first, second]);

    expect(settled.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(creationHarness.createRun).toHaveBeenCalledTimes(1);
    expect(sessionData.createSessionRunning.value).toBe(false);

    creationHarness.createRun.mockResolvedValueOnce({
      ok: true,
      sessionId: "session-retry"
    });
    await expect(sessionData.createSession()).resolves.toMatchObject({
      sessionId: "session-retry"
    });
    expect(creationHarness.createRun).toHaveBeenCalledTimes(2);
    expect(sessionData.createSessionRunning.value).toBe(false);
    scope.stop();
  });

  it("does not apply a completed request to a different project or disposed panel", async () => {
    const routePending = deferred();
    creationHarness.createRun.mockImplementationOnce(() => routePending.promise);
    const routeMount = mountSessionData();
    const routeRequest = routeMount.sessionData.createSession();

    creationHarness.projectSlug.value = "project-b";
    routePending.resolve({ ok: true, sessionId: "session-project-a" });
    await routeRequest;
    await nextTick();

    expect(creationHarness.select).not.toHaveBeenCalled();
    expect(creationHarness.refetch).not.toHaveBeenCalled();
    routeMount.scope.stop();

    creationHarness.projectSlug.value = "project-a";
    const disposedPending = deferred();
    creationHarness.createRun.mockImplementationOnce(() => disposedPending.promise);
    const disposedMount = mountSessionData();
    const disposedRequest = disposedMount.sessionData.createSession();
    disposedMount.scope.stop();
    disposedPending.resolve({ ok: true, sessionId: "session-after-unmount" });
    await disposedRequest;
    await nextTick();

    expect(creationHarness.select).not.toHaveBeenCalled();
    expect(creationHarness.refetch).not.toHaveBeenCalled();
  });
});
