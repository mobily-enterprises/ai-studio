import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onBeforeUnmount() {}
  };
});

class FakeEventSource extends EventTarget {
  static instances = [];

  constructor(url, options) {
    super();
    this.closed = false;
    this.options = options;
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(type, payload = {}) {
    const event = new Event(type);
    Object.defineProperty(event, "data", {
      value: JSON.stringify(payload)
    });
    this.dispatchEvent(event);
  }
}

describe("useVibe64SourceEditorFileSync", () => {
  let originalEventSource;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = FakeEventSource;
    FakeEventSource.instances.length = 0;
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
    vi.resetModules();
  });

  it("observes only the selected file while the Files surface is active", async () => {
    const active = ref(true);
    const path = ref("");
    const onChange = vi.fn();
    const onError = vi.fn();
    const onReady = vi.fn();
    const {
      useVibe64SourceEditorFileSync
    } = await import("../../src/composables/useVibe64SourceEditorFileSync.js");

    useVibe64SourceEditorFileSync({
      active,
      onChange,
      onError,
      onReady,
      path,
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/sessions")
    });
    expect(FakeEventSource.instances).toHaveLength(0);

    path.value = "docs/missing.md";
    await nextTick();
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe(
      "/api/app/vibe64/sessions/session-1/source-editor/changes/stream?path=docs%2Fmissing.md"
    );
    expect(source.options).toEqual({
      withCredentials: true
    });

    source.emit("vibe64.source-editor.sync.ready", {
      path: "docs/missing.md"
    });
    source.emit("vibe64.source-editor.file.changed", {
      path: "docs/missing.md",
      sessionId: "session-1"
    });
    expect(onReady).toHaveBeenCalledWith({
      path: "docs/missing.md"
    });
    expect(onChange).toHaveBeenCalledWith({
      path: "docs/missing.md",
      sessionId: "session-1"
    });
    expect(onError).not.toHaveBeenCalled();

    source.emit("vibe64.source-editor.sync.error", {
      error: "File is no longer available.",
      fatal: true
    });
    expect(onError).toHaveBeenCalledWith({
      error: "File is no longer available.",
      fatal: true
    });
    expect(source.closed).toBe(true);

    active.value = false;
    await nextTick();
    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
