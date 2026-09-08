import { createRenderer } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient: () => http
}));

import { useVibe64TemporaryAi } from "../../src/composables/useVibe64TemporaryAi.js";

const SESSION_PATH = "/api/app/project-a/vibe64/sessions/session-1";
const CONVERSATION_PATH = `${SESSION_PATH}/temporary-conversations/conversation-1`;
const mountedApps = new Set();

function mountTemporaryAi() {
  let temporary;
  const onTaskFinished = vi.fn();
  const app = createRenderer({
    createComment: () => ({}),
    insert() {},
    nextSibling: () => null,
    parentNode: () => null,
    remove() {}
  }).createApp({
    setup() {
      temporary = useVibe64TemporaryAi({
        onTaskFinished,
        sessionId: () => "session-1",
        sessionsApiPath: () => "/api/app/project-a/vibe64/sessions"
      });
      return () => null;
    }
  });
  app.mount({});
  mountedApps.add(app);
  const task = temporary.openTask({ draft: "Repair this conflict.", recoveryOperation: "update" });
  return {
    onTaskFinished,
    task,
    temporary,
    unmount() {
      app.unmount();
      mountedApps.delete(app);
    }
  };
}

describe("temporary AI mounted lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    http.request.mockReset();
    http.request.mockResolvedValue({ ok: true, status: "inProgress" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: { origin: "http://vibe64.local", pathname: "/app/project/project-a/development" }
    });
  });

  afterEach(() => {
    for (const app of mountedApps) app.unmount();
    mountedApps.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    { ok: true, status: "inProgress" },
    { ok: true, status: "completed", outcome: { kind: "complete" }, text: "Repaired." },
    { ok: false, error: "The provider connection was lost." }
  ])("retires an in-flight poll on unmount: $status $error", async (response) => {
    const poll = Promise.withResolvers();
    const { onTaskFinished, task, temporary, unmount } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockResolvedValueOnce({ ok: true, runId: "turn-1", status: "inProgress" })
      .mockReturnValueOnce(poll.promise);
    await temporary.send(task.id);
    expect(http.request).toHaveBeenLastCalledWith(CONVERSATION_PATH, { method: "GET" });
    const stateBefore = temporary.activeTask.value;
    unmount();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(CONVERSATION_PATH, {
      credentials: "same-origin", keepalive: true, method: "DELETE"
    });
    poll.resolve(response);
    await vi.advanceTimersByTimeAsync(1950);
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(http.request).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(temporary.activeTask.value).toBe(stateBefore);
  });

  it("deletes a conversation created after unmount without starting an AI turn", async () => {
    const creating = Promise.withResolvers();
    const { onTaskFinished, task, temporary, unmount } = mountTemporaryAi();
    http.request.mockReturnValueOnce(creating.promise);
    const sending = temporary.send(task.id);
    unmount();
    expect(fetch).not.toHaveBeenCalled();
    creating.resolve({ ok: true, conversationId: "conversation-1" });
    await expect(sending).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(1950);
    expect(http.request.mock.calls).toEqual([
      [expect.stringContaining("/temporary-conversations"), expect.objectContaining({ method: "POST" })],
      [CONVERSATION_PATH, { method: "DELETE" }]
    ]);
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { ok: true, runId: "turn-1", status: "inProgress" },
    { ok: false, error: "The turn could not start." }
  ])("retires a turn-start response on unmount: $ok", async (response) => {
    const starting = Promise.withResolvers();
    const { onTaskFinished, task, temporary, unmount } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockReturnValueOnce(starting.promise);
    const sending = temporary.send(task.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(http.request).toHaveBeenCalledTimes(2);
    unmount();
    const stateBefore = temporary.activeTask.value;
    starting.resolve(response);
    await expect(sending).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(1950);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(CONVERSATION_PATH, {
      credentials: "same-origin", keepalive: true, method: "DELETE"
    });
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(http.request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(temporary.activeTask.value).toBe(stateBefore);
  });

  it("does not restart polling when an in-flight Stop fails after unmount", async () => {
    const stopping = Promise.withResolvers();
    const { onTaskFinished, task, temporary, unmount } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockResolvedValueOnce({ ok: true, runId: "turn-1", status: "inProgress" });
    await temporary.send(task.id);
    await vi.advanceTimersByTimeAsync(0);
    http.request.mockReturnValueOnce(stopping.promise);
    const stop = temporary.stopTask(task.id);
    const rejected = expect(stop).rejects.toThrow("Could not stop the AI.");
    unmount();
    stopping.resolve({ ok: false, error: "Could not stop the AI." });
    await rejected;
    await vi.advanceTimersByTimeAsync(1950);
    expect(http.request).toHaveBeenCalledTimes(4);
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["stopTask", "closeTask"])("retires a successful in-flight %s on unmount", async (operation) => {
    const stopping = Promise.withResolvers();
    const { onTaskFinished, task, temporary, unmount } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockResolvedValueOnce({ ok: true, runId: "turn-1", status: "inProgress" });
    await temporary.send(task.id);
    await vi.advanceTimersByTimeAsync(0);
    http.request.mockReturnValueOnce(stopping.promise);
    const closing = temporary[operation](task.id);
    unmount();
    const stateBefore = temporary.activeTask.value;
    stopping.resolve({ ok: true });
    await closing;
    await vi.advanceTimersByTimeAsync(1950);
    expect(http.request).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(CONVERSATION_PATH, {
      credentials: "same-origin", keepalive: true, method: "DELETE"
    });
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(temporary.activeTask.value).toBe(stateBefore);
  });

  it("keeps a hidden but mounted task polling and reports its completion", async () => {
    const { onTaskFinished, task, temporary } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockResolvedValueOnce({ ok: true, runId: "turn-1", status: "inProgress" });
    await temporary.send(task.id);
    await vi.advanceTimersByTimeAsync(0);
    temporary.closeWorkspace();
    http.request.mockResolvedValueOnce({
      ok: true, status: "completed", outcome: { kind: "complete" }, text: "Repaired."
    });
    await vi.advanceTimersByTimeAsync(650);
    expect(onTaskFinished).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: task.id, status: "completed", outcomeKind: "complete", recoveryOperation: "update"
    }));
    expect(http.request).toHaveBeenCalledTimes(4);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
