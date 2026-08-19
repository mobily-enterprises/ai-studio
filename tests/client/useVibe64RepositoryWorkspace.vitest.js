import { beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

const mocks = vi.hoisted(() => ({
  historyUpdateCheck: null,
  updateCheck: null,
  requestCalls: []
}));

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient() {
    return {
      async request(path, options = {}) {
        mocks.requestCalls.push({ options, path });
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
        return {
          files: [],
          ok: true,
          totalCount: 0,
          unsaved: false
        };
      }
    };
  }
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useVibe64RepositoryWorkspace", () => {
  beforeEach(() => {
    mocks.historyUpdateCheck = null;
    mocks.updateCheck = null;
    mocks.requestCalls.length = 0;
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
      "/api/app/sample/vibe64/sessions/session-1/updates/check",
      "/api/app/sample/vibe64/sessions/session-1/changes"
    ]);
    expect(mocks.requestCalls[0].options).toMatchObject({
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
});
