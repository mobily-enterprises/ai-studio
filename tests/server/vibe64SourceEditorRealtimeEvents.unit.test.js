import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT,
  sourceEditorFileOpenRealtimePayload,
  sourceEditorFileRealtimePayload
} from "@local/vibe64-core/server/sourceEditorRealtimeEvents";

test("Vibe64 source editor payload describes a saved file change", () => {
  const result = {
    fileChange: {
      hash: "hash-2",
      mtimeMs: 123.4,
      originId: "tab-1",
      path: "src/app.js",
      projectSlug: "beepollen",
      sessionId: "session-1",
      size: 42,
      updatedAt: "2026-07-02T08:00:00.000Z"
    },
    ok: true
  };

  assert.equal(VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT, "vibe64.source-editor.file.changed");
  assert.deepEqual(sourceEditorFileRealtimePayload({ result }), {
    hash: "hash-2",
    mtimeMs: 123.4,
    originId: "tab-1",
    path: "src/app.js",
    projectSlug: "beepollen",
    sessionId: "session-1",
    size: 42,
    updatedAt: "2026-07-02T08:00:00.000Z"
  });
});

test("Vibe64 source editor payload ignores incomplete file changes", () => {
  assert.deepEqual(sourceEditorFileRealtimePayload({
    result: {
      fileChange: {
        hash: "hash-2",
        path: "src/app.js",
        sessionId: "session-1"
      },
      ok: true
    }
  }), {});
  assert.deepEqual(sourceEditorFileRealtimePayload({
    result: {
      error: "Save failed.",
      ok: false
    }
  }), {});
});

test("Vibe64 source editor payload describes an opened file", () => {
  const result = {
    fileOpen: {
      originId: "tab-1",
      path: "src/app.js",
      projectSlug: "beepollen",
      sessionId: "session-1",
      updatedAt: "2026-07-02T08:00:00.000Z"
    },
    ok: true
  };

  assert.equal(VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT, "vibe64.source-editor.file.opened");
  assert.deepEqual(sourceEditorFileOpenRealtimePayload({ result }), {
    originId: "tab-1",
    path: "src/app.js",
    projectSlug: "beepollen",
    sessionId: "session-1",
    updatedAt: "2026-07-02T08:00:00.000Z"
  });
});

test("Vibe64 source editor payload ignores incomplete open results", () => {
  assert.deepEqual(sourceEditorFileOpenRealtimePayload({
    result: {
      fileOpen: {
        path: "src/app.js",
        sessionId: "session-1"
      },
      ok: true
    }
  }), {});
  assert.deepEqual(sourceEditorFileOpenRealtimePayload({
    result: {
      error: "Open failed.",
      ok: false
    }
  }), {});
});
