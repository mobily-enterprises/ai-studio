import { beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
const mocks = vi.hoisted(() => ({ request: vi.fn(), error: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({ getHttpWebClient: () => ({ request: mocks.request }) }));
vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({ useUiFeedback: () => ({ error: mocks.error }) }));
import { useVibe64StarredFiles } from "../../src/composables/useVibe64StarredFiles.js";

async function flush() { for (let i = 0; i < 8; i += 1) await nextTick(); }
function setup() {
  const scope = effectScope();
  const sessionId = ref("one");
  const bookmarks = scope.run(() => useVibe64StarredFiles({ sessionId, sessionsApiPath: "/api/vibe64/sessions", projectSlug: "project" }));
  return { bookmarks, sessionId, scope };
}
describe("personal starred files", () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it("loads saved ordering and toggles optimistically without success toasts", async () => {
    mocks.request.mockResolvedValueOnce({ ok: true, files: [{ path: "src/a.js", available: true }] });
    const { bookmarks, scope } = setup();
    await flush();
    let finish;
    mocks.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = bookmarks.toggle("src/b.js");
    expect(bookmarks.paths.value).toEqual(["src/a.js", "src/b.js"]);
    expect(bookmarks.pendingPaths.value).toEqual(["src/b.js"]);
    expect(mocks.request.mock.calls.at(-1)).toEqual(["/api/vibe64/sessions/one/source-editor/stars", { method: "POST", body: { path: "src/b.js", starred: true } }]);
    finish({ ok: true });
    await pending;
    expect(bookmarks.pendingPaths.value).toEqual([]);
    expect(mocks.error).not.toHaveBeenCalled();
    scope.stop();
  });
  it("rolls back one failed star without undoing another update", async () => {
    mocks.request.mockResolvedValueOnce({ ok: true, files: [] });
    const { bookmarks, scope } = setup();
    await flush();
    mocks.request.mockResolvedValueOnce({ ok: false, error: "Cannot star this file" }).mockResolvedValueOnce({ ok: true });
    await Promise.all([bookmarks.toggle("bad.js"), bookmarks.toggle("good.js")]);
    expect(bookmarks.paths.value).toEqual(["good.js"]);
    expect(mocks.error).toHaveBeenCalled();
    scope.stop();
  });
  it("ignores old session reads and failed writes after switching sessions", async () => {
    let rejectOld;
    mocks.request.mockResolvedValueOnce({ ok: true, files: [] });
    const { bookmarks, sessionId, scope } = setup();
    await flush();
    mocks.request.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }));
    const pending = bookmarks.toggle("old.js");
    mocks.request.mockResolvedValueOnce({ ok: true, files: [{ path: "new.js", available: false, reason: "Not found in this session" }] });
    sessionId.value = "two";
    await flush();
    rejectOld(new Error("old failure"));
    await pending;
    expect(bookmarks.paths.value).toEqual(["new.js"]);
    expect(bookmarks.files.value[0].available).toBe(false);
    expect(mocks.error).not.toHaveBeenCalled();
    scope.stop();
  });
});
