import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requests: [],
  responses: []
}));

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onBeforeUnmount() {},
    onMounted() {}
  };
});

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient() {
    return {
      async request(...args) {
        mocks.requests.push(args);
        const response = mocks.responses.shift();
        return typeof response === "function" ? response(...args) : response;
      }
    };
  }
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function temporaryAiWithDraft() {
  const { useVibe64TemporaryAi } = await import(
    "../../src/composables/useVibe64TemporaryAi.js"
  );
  const temporary = useVibe64TemporaryAi({
    sessionId: () => "session-1",
    sessionsApiPath: () => "/api/vibe64/sessions"
  });
  const task = temporary.openTask();
  temporary.updateDraft(task.id, "Explain this conflict.");
  return { task, temporary };
}

describe("useVibe64TemporaryAi", () => {
  beforeEach(() => {
    mocks.requests.length = 0;
    mocks.responses.length = 0;
    vi.useFakeTimers();
  });

  it("shows live progress and settles with the final answer", async () => {
    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: "conversation-1",
        ok: true,
        progressUpdates: [{ id: "progress:1", text: "Inspecting the conflict." }],
        runId: "turn-1",
        status: "inProgress"
      },
      {
        conversationId: "conversation-1",
        message: "The conflict can be resolved safely.",
        ok: true,
        progressUpdates: [{ id: "progress:1", text: "Inspecting the conflict." }],
        runId: "turn-1",
        status: "completed"
      }
    );
    const { task, temporary } = await temporaryAiWithDraft();

    await temporary.send(task.id);
    await flushPromises();
    expect(temporary.activeTask.value.messages.at(-1)).toMatchObject({
      progressUpdates: [{ id: "progress:1", text: "Inspecting the conflict." }],
      status: "inProgress"
    });

    await vi.advanceTimersByTimeAsync(650);
    await flushPromises();
    expect(temporary.activeTask.value).toMatchObject({
      busy: false,
      status: "completed"
    });
    expect(temporary.activeTask.value.messages.at(-1)).toMatchObject({
      status: "completed",
      text: "The conflict can be resolved safely."
    });
  });

  it("turns a poll failure into a visible finished state", async () => {
    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        code: "vibe64_temporary_conversation_expired",
        conversationExpired: true,
        error: "This Temporary AI task ended when Vibe64 restarted.",
        ok: false
      }
    );
    const { task, temporary } = await temporaryAiWithDraft();

    await temporary.send(task.id);
    await flushPromises();

    expect(temporary.activeTask.value).toMatchObject({
      busy: false,
      conversationId: "",
      error: "This Temporary AI task ended when Vibe64 restarted.",
      runId: "",
      status: "failed"
    });
    expect(temporary.activeTask.value.messages.at(-1).status).toBe("failed");
  });
});
