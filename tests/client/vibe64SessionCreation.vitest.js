import { computed, effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const creationHarness = vi.hoisted(() => ({
  createRun: null,
  endpointResource: null,
  projectSlug: null,
  queryData: null,
  querySetData: null,
  refetch: null,
  selectedId: null,
  select: null,
  selectAvailableId: null,
  updateRun: null
}));

vi.mock("@tanstack/vue-query", () => ({
  useQueryClient: () => ({
    getQueryData: () => creationHarness.queryData.value,
    setQueryData: creationHarness.querySetData
  })
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
  creationHarness.queryData = ref({
    creation: { canCreate: true, showCreateAction: true },
    limits: { maxOpenSessions: 3, openSessionCount: 0 },
    sessions: []
  });
  creationHarness.querySetData = vi.fn((_key, update) => {
    creationHarness.queryData.value = typeof update === "function"
      ? update(creationHarness.queryData.value)
      : update;
  });
  creationHarness.select = vi.fn((sessionId = "") => {
    creationHarness.selectedId.value = sessionId;
  });
  creationHarness.selectAvailableId = vi.fn();
  creationHarness.endpointResource = {
    data: computed(() => creationHarness.queryData.value),
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
  it("fails closed until the server projects both creation permissions", () => {
    creationHarness.queryData.value = {
      limits: { maxOpenSessions: 3, openSessionCount: 0 },
      sessions: []
    };
    const { scope, sessionData } = mountSessionData();

    expect(sessionData.canCreateSession.value).toBe(false);
    expect(sessionData.createSessionVisible.value).toBe(false);
    expect(sessionData.createSessionTitle.value).toBe("Session creation is unavailable.");

    scope.stop();
  });

  it("keeps a regular cap visible but hides creation for an occupied shared database", async () => {
    creationHarness.queryData.value = {
      creation: {
        canCreate: false,
        disabledReason: "Studio allows up to 3 open sessions. Close one before creating another.",
        showCreateAction: true
      },
      limits: { maxOpenSessions: 3, openSessionCount: 3 },
      sessions: []
    };
    const { scope, sessionData } = mountSessionData();

    expect(sessionData.canCreateSession.value).toBe(false);
    expect(sessionData.createSessionVisible.value).toBe(true);
    expect(sessionData.createSessionTitle.value).toContain("up to 3 open sessions");

    creationHarness.queryData.value = {
      creation: {
        canCreate: false,
        disabledReason: "This project shares one development database.",
        showCreateAction: false
      },
      limits: { maxOpenSessions: 1, openSessionCount: 1 },
      sessions: []
    };
    await nextTick();

    expect(sessionData.canCreateSession.value).toBe(false);
    expect(sessionData.createSessionVisible.value).toBe(false);
    expect(sessionData.createSessionTitle.value).toContain("shares one development database");

    scope.stop();
  });

  it("applies the successful creation projection before its background refresh completes", async () => {
    const refreshPending = deferred();
    const backgroundRefetch = vi.fn(() => refreshPending.promise);
    creationHarness.endpointResource.query.refetch = backgroundRefetch;
    creationHarness.endpointResource.reload = backgroundRefetch;
    creationHarness.createRun.mockResolvedValue({
      creation: {
        canCreate: false,
        disabledReason: "This project shares one development database.",
        showCreateAction: false
      },
      limits: { maxOpenSessions: 1, openSessionCount: 1 },
      ok: true,
      sessionId: "session-created"
    });
    const { scope, sessionData } = mountSessionData();

    await expect(sessionData.createSession()).resolves.toMatchObject({
      sessionId: "session-created"
    });
    await nextTick();

    expect(backgroundRefetch).toHaveBeenCalledOnce();
    expect(creationHarness.querySetData).toHaveBeenCalledOnce();
    expect(sessionData.canCreateSession.value).toBe(false);
    expect(sessionData.createSessionVisible.value).toBe(false);
    expect(creationHarness.endpointResource.data.value).toMatchObject({
      creation: { canCreate: false, showCreateAction: false },
      limits: { maxOpenSessions: 1, openSessionCount: 1 },
      sessions: [
        { sessionId: "session-created" }
      ]
    });

    refreshPending.resolve({ data: creationHarness.endpointResource.data.value });
    await nextTick();
    scope.stop();
  });

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
