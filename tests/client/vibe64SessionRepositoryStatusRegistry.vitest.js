import { describe, expect, it } from "vitest";

import {
  createVibe64SessionRepositoryStatusQueue
} from "../../src/composables/useVibe64SessionRepositoryStatusRegistry.js";
import {
  repositoryStatusRealtimeShouldRefresh,
  repositoryStatusSessionId
} from "../../src/lib/vibe64RepositoryRealtime.js";
import {
  visibleVibe64ToolbarSessions
} from "../../src/lib/vibe64SessionToolbarVisibility.js";

describe("session repository status registry", () => {
  it("inspects only the session chips the toolbar can actually display", () => {
    const sessions = Array.from({ length: 10 }, (_, index) => ({
      sessionId: `session-${index + 1}`
    }));

    expect(visibleVibe64ToolbarSessions({
      limit: 3,
      selectedSessionId: "session-8",
      sessions
    }).map((session) => session.sessionId)).toEqual([
      "session-1",
      "session-2",
      "session-8"
    ]);
  });

  it("bounds concurrent Git inspections and deduplicates queued sessions", async () => {
    let active = 0;
    let maximumActive = 0;
    const calls = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      maxConcurrency: 2,
      async requestWork(sessionId) {
        calls.push(sessionId);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return {
          changedPaths: [],
          ok: true,
          unsaved: false
        };
      }
    });

    const sessionIds = Array.from({ length: 10 }, (_, index) => `session-${index + 1}`);
    queue.enqueue(sessionIds);
    queue.enqueue(sessionIds);
    await queue.waitForIdle();

    expect(maximumActive).toBe(2);
    expect(calls).toHaveLength(10);
    expect(new Set(calls).size).toBe(10);
    queue.dispose();
  });

  it("coalesces repeated forced invalidations while an inspection is active", async () => {
    let release;
    const calls = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      requestWork(sessionId) {
        calls.push(sessionId);
        return new Promise((resolve) => {
          release = () => resolve({ ok: true, unsaved: false });
        });
      }
    });

    queue.enqueue(["session-a"], { force: true });
    queue.enqueue(["session-a"], { force: true });
    queue.enqueue(["session-a"], { force: true });
    expect(calls).toEqual(["session-a"]);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual(["session-a", "session-a"]);
    release();
    await queue.waitForIdle();
    expect(calls).toHaveLength(2);
    queue.dispose();
  });

  it("fails closed when a repository inspection cannot be completed", async () => {
    const states = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: (state) => states.push(state),
      async requestWork() {
        throw new Error("Git is unavailable");
      }
    });

    queue.enqueue(["session-a"]);
    await queue.waitForIdle();

    expect(states.at(-1)).toMatchObject({
      sessionId: "session-a",
      workState: {
        error: "Git is unavailable",
        loading: false,
        unsaved: null
      }
    });
    queue.dispose();
  });

  it("keeps Save blocked while a canonical update check is pending", async () => {
    const states = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: ({ workState }) => states.push(workState),
      async requestWork() {
        return { ok: true, unsaved: false, updateAvailable: false };
      }
    });

    queue.markUpdatePending("session-a");
    queue.enqueue(["session-a"], { force: true });
    await queue.waitForIdle();

    expect(states.at(-1)).toMatchObject({
      unsaved: false,
      updateAvailable: true,
      updateStatusPending: true
    });
    queue.dispose();
  });

  it("fails closed when canonical freshness cannot be checked", () => {
    const states = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: ({ workState }) => states.push(workState),
      async requestWork() {
        return { ok: true, unsaved: true };
      }
    });

    queue.observe("session-a", { error: "", unsaved: true });
    queue.markCanonicalCheckUnavailable("session-a", "GitHub is unavailable");

    expect(states.at(-1)).toMatchObject({
      error: "GitHub is unavailable",
      loading: false,
      unsaved: true
    });
    queue.dispose();
  });

  it("does not publish a late repository result after disposal", async () => {
    let release;
    const states = [];
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: (state) => states.push(state),
      requestWork() {
        return new Promise((resolve) => {
          release = resolve;
        });
      }
    });

    queue.enqueue(["session-a"]);
    expect(states).toHaveLength(1);
    queue.dispose();
    release({ ok: true, unsaved: false });
    await queue.waitForIdle();

    expect(states).toHaveLength(1);
    expect(states[0].workState.loading).toBe(true);
  });

  it("invalidates only meaningful work events for their exact session", () => {
    expect(repositoryStatusSessionId({ session: { sessionId: "session-a" } })).toBe("session-a");
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "codex-turn-checkpoint-updated" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "session-save-completed" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "repository-canonical-changed" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "session-repository-checked" })).toBe(true);
    expect(repositoryStatusRealtimeShouldRefresh({ reason: "codex-app-server-live-progress" })).toBe(false);
  });
});
