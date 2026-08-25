import { describe, expect, it } from "vitest";
import * as sessionRequestConfig from "../../src/lib/vibe64SessionRequestConfig.js";

import {
  VIBE64_SESSION_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  SELECTED_SESSION_STORAGE_KEY,
  selectedSessionStorageKey,
  vibe64AgentAttachmentPath,
  vibe64ConversationLogPath,
  vibe64ConversationLogQueryKey,
  vibe64RepositoryHistoryPath,
  vibe64RepositoryVersionFilesPath,
  vibe64SessionChangesPath,
  vibe64SessionQueryKey,
  vibe64SessionPath,
  vibe64SessionPreviewStatePath,
  vibe64SessionsQueryKey,
  vibe64SourceEditorCreateFilePath,
  vibe64SourceEditorExplanationFollowupsPath,
  vibe64SourceEditorExplanationFollowupsStreamPath,
  vibe64SourceEditorExplanationPath,
  vibe64SourceEditorExplanationStopPath,
  vibe64SourceEditorExplanationsPath,
  vibe64SourceEditorExplanationsStreamPath
} from "../../src/lib/vibe64SessionRequestConfig.js";

describe("Vibe64 session request config", () => {
  it("uses current Vibe64 storage and route names", () => {
    expect(SELECTED_SESSION_STORAGE_KEY).toBe("vibe64:selected-session-id");
    expect(VIBE64_SESSION_CHANGED_EVENT).toBe("vibe64.session.changed");
    expect(VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT).toBe("vibe64.source-editor.file.changed");
    expect(sessionRequestConfig).not.toHaveProperty("VIBE64_SESSION_VIEW_CHANGED_EVENT");
    expect(sessionRequestConfig).not.toHaveProperty("VIBE64_SOURCE_EDITOR_FILE_OPENED_EVENT");
    expect(sessionRequestConfig).not.toHaveProperty("vibe64SessionViewStatePath");
    expect(sessionRequestConfig).not.toHaveProperty("vibe64SourceEditorOpenFilePath");
    expect(vibe64SessionsQueryKey("home", "public")).toEqual([
      "vibe64",
      "project",
      "unscoped",
      "home",
      "public",
      "sessions"
    ]);
    expect(vibe64SessionQueryKey("home", "public")).toEqual([
      "vibe64",
      "project",
      "unscoped",
      "home",
      "public",
      "session"
    ]);
    expect(vibe64ConversationLogQueryKey("home", "public", "2026-05-16_01:two")).toEqual([
      "vibe64",
      "project",
      "unscoped",
      "home",
      "public",
      "conversation-log",
      "2026-05-16_01%3Atwo"
    ]);
    expect(vibe64SessionsQueryKey("app", "public", "alpha_1")).toEqual([
      "vibe64",
      "project",
      "alpha_1",
      "app",
      "public",
      "sessions"
    ]);
    expect(selectedSessionStorageKey("alpha_1")).toBe("vibe64:selected-session-id:project:alpha_1");
    expect(selectedSessionStorageKey("beta_2")).not.toBe(selectedSessionStorageKey("alpha_1"));
  });

  it("builds encoded session action and terminal support paths", () => {
    const apiPath = "/api/studio/vibe64/sessions";
    const sessionId = "2026-05-16_01:two";

    expect(vibe64SessionPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo`);
    expect(vibe64AgentAttachmentPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/agent-attachments`);
    expect(vibe64ConversationLogPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/conversation-log`);
    expect(vibe64SessionPreviewStatePath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/preview-state`);
    expect(vibe64SourceEditorCreateFilePath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/source-editor/file`);
    expect(vibe64SourceEditorExplanationsPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/source-editor/explanations`);
    expect(vibe64SourceEditorExplanationsStreamPath(apiPath, sessionId)).toBe(`${apiPath}/2026-05-16_01%3Atwo/source-editor/explanations/stream`);
    expect(vibe64SourceEditorExplanationPath(apiPath, sessionId, "exp one")).toBe(`${apiPath}/2026-05-16_01%3Atwo/source-editor/explanations/exp%20one`);
    expect(vibe64SourceEditorExplanationStopPath(apiPath, sessionId, "exp one")).toBe(`${apiPath}/2026-05-16_01%3Atwo/source-editor/explanations/exp%20one/stop`);
    expect(vibe64SourceEditorExplanationFollowupsPath(apiPath, sessionId, "exp one")).toBe(`${apiPath}/2026-05-16_01%3Atwo/source-editor/explanations/exp%20one/followups`);
    expect(vibe64SourceEditorExplanationFollowupsStreamPath(apiPath, sessionId, "exp one")).toBe(`${apiPath}/2026-05-16_01%3Atwo/source-editor/explanations/exp%20one/followups/stream`);
    expect(vibe64SessionChangesPath(apiPath, sessionId, { limit: 50, offset: 200 })).toBe(
      `${apiPath}/2026-05-16_01%3Atwo/changes?offset=200&limit=50`
    );
    expect(vibe64RepositoryHistoryPath(apiPath, { sessionId, cursor: "page two" })).toBe(
      "/api/studio/vibe64/repository/history?sessionId=2026-05-16_01%3Atwo&cursor=page+two"
    );
    expect(vibe64RepositoryVersionFilesPath(apiPath, "abc", {
      historySnapshotCommit: "def",
      limit: 25,
      offset: 50,
      sessionId
    })).toBe(
      "/api/studio/vibe64/repository/history/abc/files?sessionId=2026-05-16_01%3Atwo&historySnapshotCommit=def&offset=50&limit=25"
    );
  });

});
