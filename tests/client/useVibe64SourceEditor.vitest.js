import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const mocks = vi.hoisted(() => ({
  beforeUnmount: [],
  fileSyncOptions: [],
  realtimeOptions: [],
  requestCalls: [],
  requestResults: [],
  streamCalls: [],
  streamEvents: []
}));

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onBeforeUnmount(callback) {
      mocks.beforeUnmount.push(callback);
    }
  };
});

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    mocks.realtimeOptions.push(options);
  }
}));

vi.mock("@/composables/useVibe64SourceEditorFileSync.js", () => ({
  useVibe64SourceEditorFileSync(options) {
    mocks.fileSyncOptions.push(options);
  }
}));

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient() {
    return {
      async request(...args) {
        mocks.requestCalls.push(args);
        return mocks.requestResults.shift() || {};
      },
      async requestStream(...args) {
        mocks.streamCalls.push(args.slice(0, 2));
        for (const event of mocks.streamEvents.shift() || []) {
          args[2]?.onEvent?.(event);
        }
      }
    };
  }
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function treeResponse() {
  return {
    ok: true,
    policy: {},
    tree: {
      children: [],
      name: "",
      path: "",
      type: "directory"
    }
  };
}

function fileResponse({
  hash = "hash-1",
  path = "src/app.js",
  revealTree = null,
  text = "console.log('one');\n"
} = {}) {
  return {
    file: {
      hash,
      mtimeMs: 1,
      path,
      size: text.length,
      text
    },
    ...(revealTree ? { revealTree } : {}),
    ok: true
  };
}

function revealTreeForNestedFile(filePath = "src/pages/admin/index.jsx") {
  const segments = String(filePath || "").split("/").filter(Boolean);
  let node = {
    language: "javascript",
    name: segments.at(-1) || filePath,
    path: filePath,
    size: 20,
    type: "file"
  };
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const directoryPath = segments.slice(0, index).join("/");
    node = {
      children: [node],
      name: segments[index - 1],
      path: directoryPath,
      type: "directory"
    };
  }
  return {
    children: node ? [node] : [],
    name: "",
    path: "",
    type: "directory"
  };
}

function realtimeForEvent(event) {
  return mocks.realtimeOptions.find((options) => options.event === event);
}

async function createLoadedEditor({
  currentText,
  navigateReferencedSource = null,
  projectSlug = "beepollen",
  sessionId = "session-1"
} = {}) {
  const {
    useVibe64SourceEditor
  } = await import("../../src/composables/useVibe64SourceEditor.js");
  mocks.requestResults.push(treeResponse());
  const editor = useVibe64SourceEditor({
    navigateReferencedSource,
    projectSlug: ref(projectSlug),
    readCurrentText: () => currentText.value,
    sessionId: ref(sessionId),
    sessionsApiPath: ref("/api/app/vibe64/sessions")
  });
  await flushPromises();
  mocks.requestResults.push(fileResponse());
  await editor.openFile("src/app.js");
  currentText.value = editor.text.value;
  await flushPromises();
  return editor;
}

describe("useVibe64SourceEditor", () => {
  beforeEach(() => {
    mocks.beforeUnmount.length = 0;
    mocks.fileSyncOptions.length = 0;
    mocks.realtimeOptions.length = 0;
    mocks.requestCalls.length = 0;
    mocks.requestResults.length = 0;
    mocks.streamCalls.length = 0;
    mocks.streamEvents.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("saves source editor files with origin and project scope", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    currentText.value = "console.log('two');\n";
    editor.updateText();
    mocks.requestResults.push(fileResponse({
      hash: "hash-2",
      text: ""
    }));

    await editor.saveNow();

    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/file",
      {
        body: {
          baseHash: "hash-1",
          originId: expect.stringMatching(/^tab:/u),
          path: "src/app.js",
          projectSlug: "beepollen",
          text: "console.log('two');\n"
        },
        method: "PUT"
      }
    ]);
    expect(editor.savedHash.value).toBe("hash-2");
    expect(editor.dirty.value).toBe(false);
  });

  it("coalesces concurrent saves and persists edits made during a save", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    let finishFirstSave;
    mocks.requestResults.push(new Promise((resolve) => {
      finishFirstSave = resolve;
    }));
    currentText.value = "console.log('two');\n";
    editor.updateText();
    const saving = editor.saveNow();
    await flushPromises();

    currentText.value = "console.log('three');\n";
    editor.updateText();
    mocks.requestResults.push(fileResponse({
      hash: "hash-3",
      text: ""
    }));
    finishFirstSave(fileResponse({
      hash: "hash-2",
      text: ""
    }));
    await saving;

    const saveBodies = mocks.requestCalls
      .filter(([, options]) => options?.method === "PUT")
      .map(([, options]) => options.body);
    expect(saveBodies.map((body) => body.text)).toEqual([
      "console.log('two');\n",
      "console.log('three');\n"
    ]);
    expect(saveBodies[1].baseHash).toBe("hash-2");
    expect(editor.savedHash.value).toBe("hash-3");
    expect(editor.dirty.value).toBe(false);
  });

  it("preserves the last draft when unmount starts its save", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    let finishSave;
    mocks.requestResults.push(new Promise((resolve) => {
      finishSave = resolve;
    }));
    currentText.value = "console.log('leaving');\n";
    editor.updateText();

    for (const beforeUnmount of mocks.beforeUnmount) {
      beforeUnmount();
    }
    const saving = editor.saveNow();
    // The component destroys CodeMirror after the composable's cleanup hook.
    currentText.value = "";
    finishSave(fileResponse({ hash: "hash-leaving", text: "" }));
    await saving;

    const saveBodies = mocks.requestCalls
      .filter(([, options]) => options?.method === "PUT")
      .map(([, options]) => options.body);
    expect(saveBodies.map((body) => body.text)).toEqual(["console.log('leaving');\n"]);
    expect(editor.savedHash.value).toBe("hash-leaving");
    expect(editor.dirty.value).toBe(false);
  });

  it.each([
    { finalText: "console.log('last edit');\n", label: "a newer draft" },
    { finalText: "", label: "an intentionally empty draft" }
  ])("preserves $label on unmount while a save is in flight", async ({ finalText }) => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    let finishFirstSave;
    mocks.requestResults.push(new Promise((resolve) => {
      finishFirstSave = resolve;
    }));
    currentText.value = "console.log('saving');\n";
    editor.updateText();
    const saving = editor.saveNow();
    await flushPromises();

    currentText.value = finalText;
    editor.updateText();
    for (const beforeUnmount of mocks.beforeUnmount) {
      beforeUnmount();
    }
    currentText.value = "";
    mocks.requestResults.push(fileResponse({ hash: "hash-final", text: "" }));
    finishFirstSave(fileResponse({ hash: "hash-first", text: "" }));
    await saving;

    const saveBodies = mocks.requestCalls
      .filter(([, options]) => options?.method === "PUT")
      .map(([, options]) => options.body);
    expect(saveBodies.map((body) => body.text)).toEqual([
      "console.log('saving');\n",
      finalText
    ]);
    expect(saveBodies[1].baseHash).toBe("hash-first");
    expect(editor.savedHash.value).toBe("hash-final");
    expect(editor.dirty.value).toBe(false);
  });

  it("allows an immersive surface to intercept a resolved source reference", async () => {
    const currentText = ref("");
    const navigateReferencedSource = vi.fn(async () => true);
    const editor = await createLoadedEditor({
      currentText,
      navigateReferencedSource
    });
    const requestCount = mocks.requestCalls.length;
    mocks.requestResults.push({
      path: "src/other.js",
      resolved: true,
      target: "./other.js"
    });

    await expect(editor.openReferencedSourcePath({
      fromPath: "src/app.js",
      target: "./other.js"
    })).resolves.toBe(true);

    expect(navigateReferencedSource).toHaveBeenCalledWith({
      fromPath: "src/app.js",
      path: "src/other.js",
      target: "./other.js"
    });
    expect(mocks.requestCalls).toHaveLength(requestCount + 1);
    expect(editor.selectedPath.value).toBe("src/app.js");
  });

  it("exposes the requested path while a different file is loading", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    let resolveFile;
    mocks.requestResults.push(new Promise((resolve) => {
      resolveFile = resolve;
    }));

    const opening = editor.openFile("src/other.js");
    await flushPromises();

    expect(editor.loadingFile.value).toBe(true);
    expect(editor.loadingPath.value).toBe("src/other.js");
    expect(editor.selectedPath.value).toBe("src/app.js");
    expect(editor.text.value).toBe("console.log('one');\n");
    expect(editor.statusLabel.value).toBe("Opening...");

    resolveFile(fileResponse({
      hash: "other-hash",
      path: "src/other.js",
      text: "console.log('other');\n"
    }));
    await opening;

    expect(editor.loadingFile.value).toBe(false);
    expect(editor.loadingPath.value).toBe("");
    expect(editor.selectedPath.value).toBe("src/other.js");
    expect(editor.text.value).toBe("console.log('other');\n");
  });

  it("creates a new source file and opens it", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    mocks.requestResults.push(fileResponse({
      hash: "hash-new",
      path: "src/pages/new-view.jsx",
      revealTree: revealTreeForNestedFile("src/pages/new-view.jsx"),
      text: ""
    }));

    const created = await editor.createFile("src/pages/new-view.jsx");
    await flushPromises();

    expect(created).toBe(true);
    expect(mocks.requestCalls.find(([url, options]) => (
      url === "/api/app/vibe64/sessions/session-1/source-editor/file" &&
      options?.method === "POST"
    ))).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/file",
      {
        body: {
          originId: expect.stringMatching(/^tab:/u),
          path: "src/pages/new-view.jsx",
          projectSlug: "beepollen"
        },
        method: "POST"
      }
    ]);
    expect(editor.selectedPath.value).toBe("src/pages/new-view.jsx");
    expect(editor.text.value).toBe("");
    expect(editor.savedHash.value).toBe("hash-new");
    expect(editor.dirty.value).toBe(false);
    expect(editor.revealedDirectoryPaths.value).toEqual([
      "src",
      "src/pages"
    ]);
    expect(mocks.requestCalls.some(([url]) => url.endsWith("/source-editor/open-file"))).toBe(false);
  });

  it("reloads the source tree after another tab creates a file", async () => {
    const currentText = ref("");
    await createLoadedEditor({ currentText });
    const payload = {
      operation: "created",
      originId: "other-tab",
      path: "src/new.js",
      projectSlug: "beepollen",
      sessionId: "session-1"
    };
    const realtime = realtimeForEvent("vibe64.source-editor.file.changed");
    const requestCount = mocks.requestCalls.length;
    mocks.requestResults.push(treeResponse());

    expect(realtime.matches({ payload })).toBe(true);
    realtime.onEvent({ payload });
    await flushPromises();

    expect(mocks.requestCalls.slice(requestCount)).toEqual([[
      "/api/app/vibe64/sessions/session-1/source-editor/tree?limit=20",
      {}
    ]]);
  });

  it("requests abandoned explanation cleanup after startup", async () => {
    const currentText = ref("");
    const {
      useVibe64SourceEditor
    } = await import("../../src/composables/useVibe64SourceEditor.js");
    mocks.requestResults.push(treeResponse());

    useVibe64SourceEditor({
      projectSlug: ref("beepollen"),
      readCurrentText: () => currentText.value,
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/sessions")
    });
    await flushPromises();

    const cleanupCall = mocks.requestCalls.find(([url]) => url.endsWith("/source-editor/explanations/cleanup"));
    expect(cleanupCall).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/explanations/cleanup",
      {
        body: {
          activeExplanationIds: [],
          originId: expect.stringMatching(/^tab:/u)
        },
        method: "POST"
      }
    ]);
  });

  it("requests source explanations without exposing raw model settings", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    const executionProfile = {
      limits: {
        maxInputCharacters: 100_000,
        maxOutputCharacters: 32_000,
        timeoutMs: 180_000
      },
      model: "gpt-5.6-luna",
      policy: {
        environmentAccess: false,
        networkAccess: false,
        repositoryWrite: false,
        tools: "none"
      },
      profileId: "economy",
      providerId: "codex",
      request: {
        allowProviderModelFallback: false,
        reasoning: true,
        summary: false
      },
      revision: "codex-economy-v1",
      thinking: "low",
      workloadId: "source_explanation"
    };
    mocks.streamEvents.push([{
      explanation: {
        agentSettings: {
          model: "legacy-source-explainer",
          providerId: "codex",
          thinking: "high"
        },
        agentThreadId: "thread-1",
        executionProfile,
        id: "exp-1",
        messages: [{
          id: "assistant-1",
          role: "assistant",
          status: "complete",
          text: "This handles startup."
        }],
        model: "gpt-5.6-luna",
        sourceRange: {
          endColumn: 12,
          endLine: 1,
          path: "src/app.js",
          scope: "selection",
          startColumn: 1,
          startLine: 1
        },
        status: "ready"
      },
      type: "source-explanation.finished"
    }]);

    await editor.explainSelection({
      endColumn: 12,
      endLine: 1,
      scope: "selection",
      startColumn: 1,
      startLine: 1
    });

    expect(mocks.streamCalls).toHaveLength(1);
    const [url, options] = mocks.streamCalls[0];
    expect(url).toBe("/api/app/vibe64/sessions/session-1/source-editor/explanations/stream");
    expect(options.body).not.toHaveProperty("agentSettings");
    expect(editor).not.toHaveProperty("explanationAgentSettings");
    expect(editor).not.toHaveProperty("updateExplanationAgentSetting");
    expect(editor.activeExplanation.value.agentSettings).toBeNull();
    expect(editor.activeExplanation.value.executionProfile).toEqual(expect.objectContaining(executionProfile));
  });

  it("sends follow-ups for a cached explanation without an agent thread", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    const cachedExplanation = {
      agentThreadId: "",
      body: "This handles startup.",
      engine: "agent-cache",
      id: "exp-cache",
      sourceRange: {
        endColumn: 12,
        endLine: 1,
        path: "src/app.js",
        scope: "selection",
        startColumn: 1,
        startLine: 1
      },
      status: "ready"
    };
    mocks.streamEvents.push([{
      cacheHit: true,
      explanation: cachedExplanation,
      type: "source-explanation.finished"
    }]);
    await editor.explainSelection(cachedExplanation.sourceRange);
    expect(editor.activeExplanation.value.agentThreadId).toBe("");

    editor.updateExplanationFollowup("   ");
    await editor.sendExplanationFollowup();
    expect(mocks.streamCalls).toHaveLength(1);

    editor.updateExplanationFollowup("  Why does startup need this?  ");
    editor.explanationBusy.value = true;
    await editor.sendExplanationFollowup();
    expect(mocks.streamCalls).toHaveLength(1);
    editor.explanationBusy.value = false;

    const continuedExplanation = {
      ...cachedExplanation,
      agentThreadId: "thread-cache-followup",
      messages: [{
        id: "assistant-followup",
        role: "assistant",
        status: "complete",
        text: "It prepares the application before startup."
      }]
    };
    mocks.streamEvents.push([{
      threadId: continuedExplanation.agentThreadId,
      type: "source-explanation.thread"
    }, {
      explanation: continuedExplanation,
      type: "source-explanation.finished"
    }]);
    await editor.sendExplanationFollowup();

    expect(mocks.streamCalls).toHaveLength(2);
    const followupPath = "/api/app/vibe64/sessions/session-1/source-editor/explanations/exp-cache/followups/stream";
    const [url, options] = mocks.streamCalls[1];
    expect(url).toBe(followupPath);
    expect(options.method).toBe("POST");
    expect(options.body).toEqual({
      assistantMessageId: expect.stringMatching(/^msg/u),
      message: "Why does startup need this?",
      userMessageId: expect.stringMatching(/^msg/u)
    });
    expect(editor.activeExplanation.value).toEqual(expect.objectContaining({
      agentThreadId: continuedExplanation.agentThreadId,
      id: cachedExplanation.id,
      messages: [expect.objectContaining(continuedExplanation.messages[0])]
    }));
    expect(editor.explanationBusy.value).toBe(false);
    expect(editor.explanationFollowup.value).toBe("");

    editor.updateExplanationFollowup("What happens next?");
    mocks.streamEvents.push([{
      explanation: continuedExplanation,
      type: "source-explanation.finished"
    }]);
    await editor.sendExplanationFollowup();
    expect(mocks.streamCalls).toHaveLength(3);
    expect(mocks.streamCalls[2][0]).toBe(followupPath);
    expect(mocks.streamCalls[2][1].body).toEqual({
      assistantMessageId: expect.stringMatching(/^msg/u),
      message: "What happens next?",
      userMessageId: expect.stringMatching(/^msg/u)
    });

    editor.closeExplanation();
    await flushPromises();
    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/explanations/exp-cache",
      { method: "DELETE" }
    ]);
    expect(editor.activeExplanation.value).toBeNull();
  });

  it("retains the cached answer and reports a rejected follow-up", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    editor.activeExplanation.value = {
      agentThreadId: "",
      body: "This handles startup.",
      engine: "agent-cache",
      id: "exp-cache",
      messages: [{
        id: "assistant-cache",
        role: "assistant",
        status: "complete",
        text: "This handles startup."
      }],
      status: "ready"
    };
    mocks.streamEvents.push([{
      error: "The selected AI connection is unavailable for this account.",
      ok: false,
      type: "source-explanation.error"
    }]);
    editor.updateExplanationFollowup("Why?");

    await editor.sendExplanationFollowup();

    expect(mocks.streamCalls).toHaveLength(1);
    expect(editor.explanationBusy.value).toBe(false);
    expect(editor.explanationError.value).toBe("The selected AI connection is unavailable for this account.");
    expect(editor.activeExplanation.value.body).toBe("This handles startup.");
    expect(editor.activeExplanation.value.status).toBe("failed");
    expect(editor.activeExplanation.value.messages.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      status: "failed",
      text: editor.explanationError.value
    }));
  });

  it("reloads a clean open file after a matching remote save", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const realtime = realtimeForEvent("vibe64.source-editor.file.changed");

    expect(realtime.matches({
      payload: {
        hash: "hash-2",
        originId: "other-tab",
        path: "src/app.js",
        projectSlug: "beepollen",
        sessionId: "session-1"
      }
    })).toBe(true);
    expect(realtime.matches({
      payload: {
        hash: "hash-2",
        originId: "other-tab",
        path: "src/app.js",
        projectSlug: "other",
        sessionId: "session-1"
      }
    })).toBe(false);

    mocks.requestResults.push(fileResponse({
      hash: "hash-2",
      text: "console.log('remote');\n"
    }));
    realtime.onEvent({
      payload: {
        hash: "hash-2",
        originId: "other-tab",
        path: "src/app.js",
        projectSlug: "beepollen",
        sessionId: "session-1"
      }
    });
    await flushPromises();

    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/file?path=src%2Fapp.js",
      {}
    ]);
    expect(editor.text.value).toBe("console.log('remote');\n");
    expect(editor.savedHash.value).toBe("hash-2");
    expect(editor.dirty.value).toBe(false);
  });

  it("keeps selected files independent between editors without publishing open state", async () => {
    const firstEditor = await createLoadedEditor({
      currentText: ref("")
    });
    const secondEditor = await createLoadedEditor({
      currentText: ref("")
    });

    mocks.requestResults.push(fileResponse({
      hash: "hash-other",
      path: "src/other.js",
      text: "console.log('other');\n"
    }));
    await firstEditor.openFile("src/other.js");

    expect(firstEditor.selectedPath.value).toBe("src/other.js");
    expect(firstEditor.text.value).toBe("console.log('other');\n");
    expect(secondEditor.selectedPath.value).toBe("src/app.js");
    expect(realtimeForEvent("vibe64.source-editor.file.opened")).toBeUndefined();
    expect(mocks.requestCalls.some(([url]) => url.endsWith("/source-editor/open-file"))).toBe(false);
  });

  it("warns instead of overwriting a dirty file after a matching remote save", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const requestCount = mocks.requestCalls.length;
    const realtime = realtimeForEvent("vibe64.source-editor.file.changed");
    const {
      SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE
    } = await import("../../src/composables/useVibe64SourceEditor.js");

    currentText.value = "console.log('local');\n";
    editor.updateText();
    realtime.onEvent({
      payload: {
        hash: "hash-2",
        originId: "other-tab",
        path: "src/app.js",
        projectSlug: "beepollen",
        sessionId: "session-1"
      }
    });
    await flushPromises();

    expect(mocks.requestCalls).toHaveLength(requestCount);
    expect(editor.saveError.value).toBe(SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE);
    expect(editor.dirty.value).toBe(true);
  });

  it("reloads the clean open file after a direct filesystem change", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const fileSync = mocks.fileSyncOptions[0];
    mocks.requestResults.push(fileResponse({
      hash: "hash-2",
      text: "console.log('filesystem');\n"
    }));

    fileSync.onChange({
      path: "src/app.js",
      sessionId: "session-1"
    });
    await flushPromises();

    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/file?path=src%2Fapp.js",
      {}
    ]);
    expect(editor.text.value).toBe("console.log('filesystem');\n");
    expect(editor.savedHash.value).toBe("hash-2");
    expect(editor.dirty.value).toBe(false);
  });

  it("refreshes both the file tree and a clean open file", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const requestCount = mocks.requestCalls.length;
    mocks.requestResults.push(
      treeResponse(),
      fileResponse({
        hash: "hash-2",
        text: "console.log('refreshed');\n"
      })
    );

    await editor.refresh();

    expect(mocks.requestCalls.slice(requestCount).map(([url]) => url)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/tree?limit=20",
      "/api/app/vibe64/sessions/session-1/source-editor/file?path=src%2Fapp.js"
    ]);
    expect(editor.text.value).toBe("console.log('refreshed');\n");
    expect(editor.savedHash.value).toBe("hash-2");
  });

  it("preserves edits made while a file revalidation is in flight", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const {
      SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE
    } = await import("../../src/composables/useVibe64SourceEditor.js");
    const fileSync = mocks.fileSyncOptions[0];
    let resolveRefresh;
    mocks.requestResults.push(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));

    fileSync.onReady();
    await flushPromises();
    currentText.value = "console.log('local');\n";
    editor.updateText();
    resolveRefresh(fileResponse({
      hash: "hash-2",
      text: "console.log('filesystem');\n"
    }));
    await flushPromises();

    expect(currentText.value).toBe("console.log('local');\n");
    expect(editor.text.value).toBe("console.log('one');\n");
    expect(editor.savedHash.value).toBe("hash-1");
    expect(editor.dirty.value).toBe(true);
    expect(editor.saveError.value).toBe(SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE);
  });

  it("does not navigate away when saving the current file conflicts", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    currentText.value = "console.log('local');\n";
    editor.updateText();
    mocks.requestResults.push({
      error: "This file changed on disk. Reload it before saving.",
      ok: false
    });
    const requestCount = mocks.requestCalls.length;

    await expect(editor.openFile("src/other.js")).resolves.toBe(false);

    expect(mocks.requestCalls).toHaveLength(requestCount + 1);
    expect(mocks.requestCalls.at(-1)[1]?.method).toBe("PUT");
    expect(editor.selectedPath.value).toBe("src/app.js");
    expect(editor.dirty.value).toBe(true);
    expect(editor.saveError.value).toBe("This file changed on disk. Reload it before saving.");
  });
});
