import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PROMPT_HINT_DEBOUNCE_MS,
  PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT,
  promptHintConversationFingerprint,
  useVibe64PromptHints
} from "../../src/composables/useVibe64PromptHints.js";

function deferredResult() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createHints(overrides = {}, dependencies = {}) {
  const state = {
    active: ref(true),
    blankConversation: ref(false),
    canRequest: ref(true),
    conversationKey: ref("conversation-1"),
    draft: ref(""),
    existingProject: ref(false),
    onSelect: vi.fn(() => true),
    policy: ref({
      enabled: true,
      ready: true,
      revision: 1,
      version: 1
    }),
    sessionId: ref("session-1"),
    sessionsApiPath: ref("/api/vibe64/sessions"),
    ...overrides
  };
  const scope = effectScope();
  const hints = scope.run(() => useVibe64PromptHints(state, dependencies));
  return { hints, scope, state };
}

describe("useVibe64PromptHints", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows project-aware static starters immediately without a model request", () => {
    const request = vi.fn();
    const greenfield = createHints({ blankConversation: ref(true) }, { request });

    greenfield.hints.focusComposer();

    expect(greenfield.hints.status.value).toBe("static");
    expect(greenfield.hints.suggestions.value).toEqual([
      "Help me shape my app idea",
      "Show me the simplest useful first version",
      "What should we decide first?"
    ]);
    expect(greenfield.hints.visible.value).toBe(true);
    expect(request).not.toHaveBeenCalled();
    greenfield.scope.stop();

    const existing = createHints({
      blankConversation: ref(true),
      existingProject: ref(true)
    }, { request });
    existing.hints.focusComposer();
    expect(existing.hints.suggestions.value).toEqual([
      "Give me a quick tour of this project",
      "What should I improve first?",
      "Help me plan a small safe change"
    ]);
    expect(request).not.toHaveBeenCalled();
    existing.scope.stop();
  });

  it("waits for the enabled project policy and every composer gate", () => {
    const request = vi.fn();
    const policy = ref({ enabled: true, ready: false, revision: 0, version: 1 });
    const canRequest = ref(true);
    const { hints, scope } = createHints({ canRequest, policy }, { request });

    hints.focusComposer();
    expect(hints.visible.value).toBe(false);

    policy.value = { enabled: false, ready: true, revision: 1, version: 1 };
    expect(hints.visible.value).toBe(false);

    policy.value = { enabled: true, ready: true, revision: 2, version: 1 };
    expect(hints.loading.value).toBe(true);
    canRequest.value = false;
    expect(hints.visible.value).toBe(false);
    expect(hints.loading.value).toBe(false);

    vi.advanceTimersByTime(PROMPT_HINT_DEBOUNCE_MS + 1);
    expect(request).not.toHaveBeenCalled();
    scope.stop();
  });

  it("debounces generation and accepts only exactly three valid suggestions", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      status: "ready",
      suggestions: ["Inspect the failing test", "Plan the smallest fix", "Review recent changes"]
    }));
    const { hints, scope } = createHints({}, { request });

    hints.focusComposer();
    expect(hints.loading.value).toBe(true);
    expect(request).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("/api/vibe64/sessions/session-1/prompt-hints");
    expect(request.mock.calls[0][1]).toMatchObject({
      body: {
        operationId: expect.stringMatching(/^hint:/u),
        originId: expect.stringMatching(/^tab:/u)
      },
      method: "POST",
      signal: expect.any(AbortSignal)
    });
    expect(hints.loading.value).toBe(false);
    expect(hints.status.value).toBe("ready");
    expect(hints.suggestions.value).toHaveLength(3);

    hints.blurComposer();
    expect(hints.visible.value).toBe(false);
    hints.focusComposer();
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(request).toHaveBeenCalledTimes(2);
    scope.stop();
  });

  it("cancels and ignores an in-flight result as soon as the person types", async () => {
    const generated = deferredResult();
    const request = vi.fn((path) => (
      path.endsWith("/cancel")
        ? Promise.resolve({ ok: true, status: "cancelled" })
        : generated.promise
    ));
    const draft = ref("");
    const { hints, scope } = createHints({ draft }, { request });

    hints.focusComposer();
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(request).toHaveBeenCalledTimes(1);

    draft.value = "I already know what to ask";
    await nextTick();

    expect(hints.visible.value).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toBe("/api/vibe64/sessions/session-1/prompt-hints/cancel");
    expect(request.mock.calls[1][1].body.operationId).toBe(
      request.mock.calls[0][1].body.operationId
    );

    generated.resolve({
      ok: true,
      status: "ready",
      suggestions: ["Stale one", "Stale two", "Stale three"]
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(hints.suggestions.value).toEqual([]);

    draft.value = "";
    await nextTick();
    vi.advanceTimersByTime(PROMPT_HINT_DEBOUNCE_MS + 1);
    expect(request).toHaveBeenCalledTimes(2);

    hints.blurComposer();
    hints.focusComposer();
    expect(hints.loading.value).toBe(true);
    scope.stop();
  });

  it("fills without sending and keeps the current focus cycle dismissed", () => {
    const draft = ref("");
    const onSelect = vi.fn((text) => {
      draft.value = text;
      return true;
    });
    const { hints, scope } = createHints({
      blankConversation: ref(true),
      draft,
      onSelect
    });

    hints.focusComposer();
    const selected = hints.suggestions.value[1];
    expect(hints.selectPromptHint(selected)).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(selected);
    expect(draft.value).toBe(selected);
    expect(hints.suggestions.value).toEqual([]);
    expect(hints.visible.value).toBe(false);
    scope.stop();
  });

  it("dismisses on Escape and refreshes only after blur and a new focus", () => {
    const { hints, scope } = createHints({ blankConversation: ref(true) });

    hints.focusComposer();
    expect(hints.visible.value).toBe(true);
    hints.dismissPromptHints();
    expect(hints.visible.value).toBe(false);

    hints.focusComposer();
    expect(hints.visible.value).toBe(false);
    hints.blurComposer();
    hints.focusComposer();
    expect(hints.visible.value).toBe(true);
    scope.stop();
  });

  it("ends an inactive session's focus cycle and accepts cached hints after a fresh focus", async () => {
    const active = ref(true);
    const request = vi.fn(async () => ({
      cached: true,
      ok: true,
      status: "ready",
      suggestions: ["First", "Second", "Third"]
    }));
    const { hints, scope } = createHints({ active }, { request });

    hints.focusComposer();
    expect(hints.composerFocused.value).toBe(true);
    active.value = false;
    await nextTick();
    expect(hints.composerFocused.value).toBe(false);
    expect(hints.visible.value).toBe(false);

    active.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS + 1);
    expect(request).not.toHaveBeenCalled();

    hints.focusComposer();
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(request).toHaveBeenCalledTimes(1);
    expect(hints.status.value).toBe("ready");
    expect(hints.suggestions.value).toEqual(["First", "Second", "Third"]);
    scope.stop();
  });

  it("fingerprints visible user and final assistant text, not object identity", () => {
    expect(promptHintConversationFingerprint([{
      assistant: { text: "Answer" },
      progressUpdates: [{ text: "Private progress" }],
      turnId: "turn-1",
      user: { text: "Question" }
    }])).toBe(JSON.stringify([{
      assistant: "Answer",
      turnId: "turn-1",
      user: "Question"
    }]));
  });

  it("fingerprints only the same recent visible-turn window used by the server", () => {
    const recentTurns = Array.from({ length: PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT }, (_, index) => ({
      assistant: { text: `Recent answer ${index}` },
      turnId: `recent-${index}`,
      user: { text: `Recent question ${index}` }
    }));
    const firstHistory = [
      { assistant: { text: "Old answer A" }, turnId: "old-a", user: { text: "Old A" } },
      ...recentTurns
    ];
    const secondHistory = [
      { assistant: { text: "Old answer B" }, turnId: "old-b", user: { text: "Old B" } },
      ...recentTurns
    ];

    const fingerprint = promptHintConversationFingerprint(firstHistory);
    expect(promptHintConversationFingerprint(secondHistory)).toBe(fingerprint);
    expect(JSON.parse(fingerprint)).toHaveLength(PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT);
    expect(fingerprint).not.toContain("Old answer");
  });
});
