import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT } from "../../src/lib/vibe64SessionRequestConfig.js";

const mocks = vi.hoisted(() => ({
  changes: null,
  changesHandler: null,
  diff: null,
  historyUpdateCheck: null,
  updateCheckHandler: null,
  updateCheck: null,
  versionFilesHandler: null,
  versionDiffHandler: null,
  realtimeEvents: [],
  requestCalls: []
}));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options = {}) {
    mocks.realtimeEvents.push(options);
  }
}));

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient() {
    return {
      async request(path, options = {}) {
        mocks.requestCalls.push({ options, path });
        if (typeof mocks.versionFilesHandler === "function" && /\/history\/[^/]+\/files(?:\?|$)/u.test(String(path))) {
          return mocks.versionFilesHandler(path, options);
        }
        if (typeof mocks.versionDiffHandler === "function" && /\/history\/[^/]+\/diff(?:\?|$)/u.test(String(path))) {
          return mocks.versionDiffHandler(path, options);
        }
        if (String(path).includes("/history")) {
          return {
            historySnapshotCommit: mocks.historyUpdateCheck?.canonicalCommit || "a".repeat(40),
            nextCursor: "",
            ok: true,
            ...(mocks.historyUpdateCheck ? { updateCheck: mocks.historyUpdateCheck } : {}),
            versions: []
          };
        }
        if (String(path).includes("/updates/check")) {
          if (typeof mocks.updateCheckHandler === "function") {
            return mocks.updateCheckHandler(path, options);
          }
          return {
            ahead: 0,
            behind: 0,
            canonicalCommit: "a".repeat(40),
            checkedAt: "2026-08-19T07:15:00.000Z",
            ok: true,
            relationship: "current",
            sessionHead: "a".repeat(40),
            updateAvailable: false,
            updateStrategy: "none",
            ...(mocks.updateCheck || mocks.historyUpdateCheck || {})
          };
        }
        if (String(path).includes("/changes/diff")) {
          return {
            diff: "",
            ok: true,
            path: "",
            ...(mocks.diff || {})
          };
        }
        if (typeof mocks.changesHandler === "function" && String(path).includes("/changes")) {
          return mocks.changesHandler(path, options);
        }
        return {
          canonicalCommit: "a".repeat(40),
          files: [],
          ok: true,
          totalCount: 0,
          unsaved: false,
          ...(mocks.changes || {})
        };
      }
    };
  }
}));

async function flushPromises() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe("useVibe64RepositoryWorkspace", () => {
  beforeEach(() => {
    mocks.changes = null;
    mocks.changesHandler = null;
    mocks.diff = null;
    mocks.historyUpdateCheck = null;
    mocks.updateCheckHandler = null;
    mocks.updateCheck = null;
    mocks.versionFilesHandler = null;
    mocks.versionDiffHandler = null;
    mocks.realtimeEvents.length = 0;
    mocks.requestCalls.length = 0;
  });

  it("does not enter AI-backed Save when direct assistant use is restricted", async () => {
    mocks.changes = { unsaved: true };
    const requestSaveWork = vi.fn(async () => ({ ok: true }));
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const workspace = useVibe64RepositoryWorkspace(ref({
      assistantDirectAllowed: false,
      requestSaveWork,
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();

    await expect(workspace.saveWork()).resolves.toBe(false);
    expect(requestSaveWork).not.toHaveBeenCalled();
  });

  it("unwraps the runtime's ref-backed session API path without cross-loading destinations", async () => {
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const sessionsApiPath = ref("/api/app/sample/vibe64/sessions");
    const dashboard = ref({
      sessionId: "session-1",
      sessionsApiPath
    });
    useVibe64RepositoryWorkspace(dashboard, { view: ref("changes") });

    await nextTick();
    await flushPromises();

    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    expect(mocks.requestCalls[1].options).toMatchObject({
      body: { force: false },
      method: "POST"
    });

    mocks.requestCalls.length = 0;
    useVibe64RepositoryWorkspace(dashboard, { view: ref("history") });
    await nextTick();
    await flushPromises();

    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/repository/history?sessionId=session-1",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    expect(mocks.requestCalls.some(({ path }) => String(path).includes("[object Object]"))).toBe(false);
  });

  it("reuses the Current Changes snapshot as the selected session work state", async () => {
    mocks.changes = {
      changedPaths: ["src/app.js"],
      initialDiff: { diff: "+change", path: "src/app.js" },
      sessionId: "session-1",
      unsaved: true
    };
    const refreshSessionWork = vi.fn(async (work) => work);
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    useVibe64RepositoryWorkspace(ref({
      refreshSessionWork,
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();

    expect(refreshSessionWork).toHaveBeenCalledTimes(1);
    expect(refreshSessionWork).toHaveBeenCalledWith(expect.objectContaining({
      changedPaths: ["src/app.js"],
      sessionId: "session-1",
      unsaved: true
    }));
    expect(refreshSessionWork.mock.calls[0][0]).not.toHaveProperty("initialDiff");
  });

  it("restores the last successful update check while loading repository history", async () => {
    mocks.historyUpdateCheck = {
      ahead: 2,
      behind: 3,
      canonicalCommit: "b".repeat(40),
      checkedAt: "2026-08-19T07:15:00.000Z",
      relationship: "diverged",
      sessionHead: "c".repeat(40),
      updateAvailable: true,
      updateStrategy: "rebase"
    };
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const workspace = useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") });

    await nextTick();
    await flushPromises();

    expect(workspace.updates.payload).toMatchObject(mocks.historyUpdateCheck);
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/repository/history?sessionId=session-1",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
  });

  it("accepts a cached history update check when no prior check exists", async () => {
    mocks.historyUpdateCheck = {
      behind: 1,
      canonicalCommit: "b".repeat(40),
      checkedAt: "2026-08-19T07:15:00.000Z",
      relationship: "behind",
      updateAvailable: true,
      updateStrategy: "rebase"
    };
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const workspace = useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") });

    expect(workspace.updates.payload).toBeNull();
    await nextTick();
    await flushPromises();

    expect(workspace.history.error).toBe("");
    expect(workspace.updates.payload).toMatchObject({
      behind: 1,
      updateAvailable: true
    });
  });

  it("waits for the selected session before requesting repository history", async () => {
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const dashboard = ref({
      sessionId: "",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    });
    useVibe64RepositoryWorkspace(dashboard, { view: ref("history") });

    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls).toEqual([]);

    dashboard.value = {
      ...dashboard.value,
      sessionId: "session-1"
    };
    await nextTick();
    await flushPromises();

    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/repository/history?sessionId=session-1",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
  });

  it("releases previous version paging state and preserves a newer pending page", async () => {
    const firstCommit = "a".repeat(40);
    const secondCommit = "b".repeat(40);
    const firstPage = Promise.withResolvers();
    const secondPage = Promise.withResolvers();
    const firstPageResult = { commit: firstCommit, files: [{ path: "a-next.txt" }], ok: true, truncated: false };
    const secondPageResult = { commit: secondCommit, files: [{ path: "b-next.txt" }], ok: true, truncated: false };
    const secondDiffResult = { commit: secondCommit, diff: "+current version B", ok: true, path: "b.txt" };
    mocks.versionFilesHandler = vi.fn()
      .mockResolvedValueOnce({ commit: firstCommit, files: [{ path: "a.txt" }], ok: true, truncated: true })
      .mockImplementationOnce(() => firstPage.promise)
      .mockResolvedValueOnce({ commit: secondCommit, files: [{ path: "b.txt" }], ok: true, truncated: true })
      .mockImplementationOnce(() => secondPage.promise);
    mocks.versionDiffHandler = vi.fn()
      .mockResolvedValueOnce({ commit: firstCommit, diff: "+version A", ok: true, path: "a.txt" })
      .mockResolvedValueOnce(secondDiffResult);
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const scope = effectScope();
    const workspace = scope.run(() => useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") }));
    let firstPaging;
    let secondPaging;
    try {
      await nextTick();
      await flushPromises();
      await workspace.selectVersion({ commit: firstCommit });
      firstPaging = workspace.loadMoreVersionFiles();
      expect(mocks.versionFilesHandler).toHaveBeenCalledTimes(2);
      expect(workspace.versionFiles.loadingMore).toBe(true);

      await workspace.selectVersion({ commit: secondCommit });
      expect(workspace.selectedVersion.value.commit).toBe(secondCommit);
      expect(workspace.versionFiles.loading).toBe(false);
      expect(workspace.versionFiles.loadingMore).toBe(false);
      expect(workspace.selectedVersionPath.value).toBe("b.txt");
      expect(workspace.versionDiff).toMatchObject({ error: "", loading: false, payload: secondDiffResult });

      secondPaging = workspace.loadMoreVersionFiles();
      expect(mocks.versionFilesHandler).toHaveBeenCalledTimes(4);
      const secondPageUrl = new URL(mocks.versionFilesHandler.mock.calls[3][0], "http://vibe64.test");
      expect(secondPageUrl.pathname).toBe(`/api/app/sample/vibe64/repository/history/${secondCommit}/files`);
      expect(Object.fromEntries(secondPageUrl.searchParams)).toEqual({
        historySnapshotCommit: firstCommit,
        offset: "1",
        sessionId: "session-1"
      });

      firstPage.resolve(firstPageResult);
      await firstPaging;
      expect(workspace.versionFiles.loadingMore).toBe(true);
      expect(workspace.versionFiles.payload.files).toEqual([{ path: "b.txt" }]);

      secondPage.resolve(secondPageResult);
      await secondPaging;
      expect(workspace.versionFiles.loadingMore).toBe(false);
      expect(workspace.versionFiles.payload).toMatchObject({
        commit: secondCommit,
        files: [{ path: "b.txt" }, { path: "b-next.txt" }],
        truncated: false
      });
      expect(workspace.versionDiff).toMatchObject({ error: "", loading: false, payload: secondDiffResult });
    } finally {
      firstPage.resolve(firstPageResult);
      secondPage.resolve(secondPageResult);
      await Promise.all([firstPaging, secondPaging]);
      scope.stop();
    }
  });

  it.each([
    ["a pending diff when opening another version", { commit: "b".repeat(40) }, false],
    ["a pending diff when clearing version selection", null, false],
    ["a failed diff when opening another version", { commit: "b".repeat(40) }, true]
  ])("retires %s", async (_scenario, nextVersion, settleFirst) => {
    const oldDiff = Promise.withResolvers();
    const oldFailure = { error: "The previous version diff failed.", ok: false };
    mocks.versionFilesHandler = vi.fn()
      .mockResolvedValueOnce({ files: [{ path: "a.txt" }], ok: true, truncated: false })
      .mockResolvedValue({ files: [], ok: true, truncated: false });
    mocks.versionDiffHandler = vi.fn(() => oldDiff.promise);
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const scope = effectScope();
    const workspace = scope.run(() => useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") }));
    let selectingFirst;
    try {
      await nextTick();
      await flushPromises();
      selectingFirst = workspace.selectVersion({ commit: "a".repeat(40) });
      await flushPromises();
      expect(mocks.versionDiffHandler).toHaveBeenCalledTimes(1);
      expect(workspace.versionDiff.loading).toBe(true);
      if (settleFirst) {
        oldDiff.resolve(oldFailure);
        await selectingFirst;
        expect(workspace.versionDiff.error).toBe(oldFailure.error);
      }

      await workspace.selectVersion(nextVersion);
      const afterSelection = {
        diffError: workspace.versionDiff.error,
        diffLoading: workspace.versionDiff.loading,
        filesLoading: workspace.versionFiles.loading
      };
      oldDiff.resolve(oldFailure);
      await selectingFirst;

      expect({
        afterSelection,
        diffErrorAfterSettlement: workspace.versionDiff.error,
        diffLoadingAfterSettlement: workspace.versionDiff.loading
      }).toEqual({
        afterSelection: { diffError: "", diffLoading: false, filesLoading: false },
        diffErrorAfterSettlement: "",
        diffLoadingAfterSettlement: false
      });
      expect(workspace.selectedVersion.value).toEqual(nextVersion);
      expect(workspace.selectedVersionPath.value).toBe("");
      expect(workspace.versionDiff.payload).toBeNull();
      expect(workspace.versionFiles.error).toBe("");
      expect(mocks.versionDiffHandler).toHaveBeenCalledTimes(1);
    } finally {
      oldDiff.resolve(oldFailure);
      await selectingFirst;
      scope.stop();
    }
  });

  it("shows the current version diff failure and accepts a successful retry", async () => {
    const firstCommit = "a".repeat(40);
    const secondCommit = "b".repeat(40);
    const currentDiff = Promise.withResolvers();
    const retryDiff = Promise.withResolvers();
    const currentFailure = { error: "The current version diff failed.", ok: false };
    const retryResult = { commit: secondCommit, diff: "+retried version B", ok: true, path: "b.txt" };
    mocks.versionFilesHandler = vi.fn()
      .mockResolvedValueOnce({ commit: firstCommit, files: [{ path: "a.txt" }], ok: true, truncated: false })
      .mockResolvedValueOnce({ commit: secondCommit, files: [{ path: "b.txt" }], ok: true, truncated: false });
    mocks.versionDiffHandler = vi.fn()
      .mockResolvedValueOnce({ commit: firstCommit, diff: "+version A", ok: true, path: "a.txt" })
      .mockImplementationOnce(() => currentDiff.promise)
      .mockImplementationOnce(() => retryDiff.promise);
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const scope = effectScope();
    const workspace = scope.run(() => useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("history") }));
    let selectingCurrent;
    let retrying;
    try {
      await nextTick();
      await flushPromises();
      await workspace.selectVersion({ commit: firstCommit });
      expect(workspace.versionDiff.payload).toMatchObject({ commit: firstCommit, path: "a.txt" });

      selectingCurrent = workspace.selectVersion({ commit: secondCommit });
      await flushPromises();
      expect(mocks.versionDiffHandler).toHaveBeenCalledTimes(2);
      expect(workspace.selectedVersion.value.commit).toBe(secondCommit);
      expect(workspace.selectedVersionPath.value).toBe("b.txt");
      expect(workspace.versionDiff).toMatchObject({ error: "", loading: true, payload: null });

      currentDiff.resolve(currentFailure);
      await selectingCurrent;
      expect(workspace.versionDiff).toMatchObject({ error: currentFailure.error, loading: false, payload: null });
      expect(workspace.versionFiles).toMatchObject({ error: "", loading: false });

      retrying = workspace.selectVersionFile({ path: "b.txt" });
      expect(mocks.versionDiffHandler).toHaveBeenCalledTimes(3);
      expect(workspace.versionDiff).toMatchObject({ error: "", loading: true, payload: null });
      const retryUrl = new URL(mocks.versionDiffHandler.mock.calls[2][0], "http://vibe64.test");
      expect(retryUrl.pathname).toBe(`/api/app/sample/vibe64/repository/history/${secondCommit}/diff`);
      expect(Object.fromEntries(retryUrl.searchParams)).toEqual({
        historySnapshotCommit: firstCommit,
        path: "b.txt",
        sessionId: "session-1"
      });

      retryDiff.resolve(retryResult);
      await retrying;
      expect(workspace.selectedVersion.value.commit).toBe(secondCommit);
      expect(workspace.selectedVersionPath.value).toBe("b.txt");
      expect(workspace.versionDiff).toMatchObject({ error: "", loading: false, payload: retryResult });
    } finally {
      currentDiff.resolve(currentFailure);
      retryDiff.resolve(retryResult);
      await Promise.all([selectingCurrent, retrying]);
      scope.stop();
    }
  });

  it("keeps cached repository state quiet while renewal owns the source and refreshes on release", async () => {
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const sourceOperationsSuspended = ref(true);
    const workspace = useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions",
      sourceOperationsSuspended
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls).toEqual([]);
    expect(workspace.updates.error).toBe("");

    sourceOperationsSuspended.value = false;
    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    const cachedUpdate = workspace.updates.payload;

    mocks.requestCalls.length = 0;
    sourceOperationsSuspended.value = true;
    await nextTick();
    await expect(workspace.checkForUpdates()).resolves.toBe(false);
    await expect(workspace.applyUpdates()).resolves.toBe(false);
    await expect(workspace.saveWork()).resolves.toBe(false);
    expect(mocks.requestCalls).toEqual([]);
    expect(workspace.updates.payload).toBe(cachedUpdate);
    expect(workspace.updates.error).toBe("");

    sourceOperationsSuspended.value = false;
    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
  });

  it("discards an in-flight write-boundary collision and performs one current check after renewal", async () => {
    let finishFirstCheck;
    mocks.updateCheckHandler = vi.fn(() => new Promise((resolve) => {
      finishFirstCheck = resolve;
    }));
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const sourceOperationsSuspended = ref(false);
    const workspace = useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions",
      sourceOperationsSuspended
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    sourceOperationsSuspended.value = true;
    await nextTick();
    finishFirstCheck({
      code: "vibe64_agent_write_mode_busy",
      error: "Session renewal is using this session source.",
      ok: false
    });
    await flushPromises();

    expect(workspace.updates.checking).toBe(false);
    expect(workspace.updates.error).toBe("");
    expect(workspace.updates.errorCode).toBe("");

    mocks.updateCheckHandler = null;
    sourceOperationsSuspended.value = false;
    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check",
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    expect(workspace.updates.error).toBe("");
    expect(workspace.updates.payload).toMatchObject({ relationship: "current" });
  });

  it("uses the shared runtime update command instead of issuing a second update request", async () => {
    mocks.updateCheck = {
      behind: 1,
      relationship: "behind",
      updateAvailable: true,
      updateStrategy: "rebase"
    };
    const requestUpdateWork = vi.fn(async () => ({
      behind: 0,
      canonicalCommit: "b".repeat(40),
      ok: true,
      relationship: "current",
      updateAvailable: false
    }));
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const workspace = useVibe64RepositoryWorkspace(ref({
      requestUpdateWork,
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();
    mocks.requestCalls.length = 0;

    await expect(workspace.applyUpdates()).resolves.toMatchObject({ ok: true });
    expect(requestUpdateWork).toHaveBeenCalledTimes(1);
    expect(mocks.requestCalls.some(({ path }) => String(path).includes("/updates/apply"))).toBe(false);
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes"
    ]);
  });

  it("renders the cached-canonical change list and initial diff before the authority check finishes", async () => {
    let finishUpdateCheck;
    mocks.changes = {
      changedPaths: ["src/app.js"],
      files: [{ added: 1, deleted: 1, path: "src/app.js", status: "M" }],
      initialDiff: {
        diff: "-old\n+new",
        ok: true,
        path: "src/app.js"
      },
      sessionId: "session-1",
      totalCount: 1,
      unsaved: true
    };
    mocks.updateCheckHandler = vi.fn(() => new Promise((resolve) => {
      finishUpdateCheck = resolve;
    }));
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    const workspace = useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("changes") });

    await nextTick();
    await flushPromises();

    expect(workspace.changes.loading).toBe(false);
    expect(workspace.changes.payload?.files).toHaveLength(1);
    expect(workspace.selectedCurrentPath.value).toBe("src/app.js");
    expect(workspace.currentDiff.payload).toMatchObject({
      diff: "-old\n+new",
      path: "src/app.js"
    });
    expect(mocks.requestCalls.map(({ path }) => path)).toEqual([
      "/api/app/sample/vibe64/sessions/session-1/changes",
      "/api/app/sample/vibe64/sessions/session-1/updates/check"
    ]);
    expect(mocks.requestCalls.some(({ path }) => String(path).includes("/changes/diff"))).toBe(false);

    finishUpdateCheck({
      ahead: 0,
      behind: 0,
      canonicalCommit: "a".repeat(40),
      checkedAt: "2026-08-19T07:15:00.000Z",
      ok: true,
      relationship: "current",
      sessionHead: "a".repeat(40),
      updateAvailable: false,
      updateStrategy: "none"
    });
    await flushPromises();
    expect(workspace.updates.checking).toBe(false);
    expect(mocks.requestCalls).toHaveLength(2);
  });

  it("collapses a burst of source change events into one bounded follow-up inspection", async () => {
    const { useVibe64RepositoryWorkspace } = await import(
      "../../src/composables/useVibe64RepositoryWorkspace.js"
    );
    useVibe64RepositoryWorkspace(ref({
      sessionId: "session-1",
      sessionsApiPath: "/api/app/sample/vibe64/sessions"
    }), { view: ref("changes") });
    await nextTick();
    await flushPromises();

    const pendingChanges = [];
    mocks.requestCalls.length = 0;
    mocks.changesHandler = vi.fn(() => new Promise((resolve) => {
      pendingChanges.push(resolve);
    }));
    const sourceChanged = mocks.realtimeEvents.find(({ event }) => (
      event === VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT
    ));
    expect(sourceChanged).toBeTruthy();

    sourceChanged.onEvent();
    sourceChanged.onEvent();
    sourceChanged.onEvent();
    await flushPromises();
    expect(mocks.changesHandler).toHaveBeenCalledTimes(1);

    pendingChanges.shift()({
      canonicalCommit: "a".repeat(40),
      files: [],
      ok: true,
      totalCount: 0,
      unsaved: false
    });
    await flushPromises();
    expect(mocks.changesHandler).toHaveBeenCalledTimes(2);

    pendingChanges.shift()({
      canonicalCommit: "a".repeat(40),
      files: [],
      ok: true,
      totalCount: 0,
      unsaved: false
    });
    await flushPromises();
    expect(mocks.changesHandler).toHaveBeenCalledTimes(2);
    expect(mocks.requestCalls).toHaveLength(2);
  });
});
