const directChatSessionId = "2026-05-12_01-02-39";
const createdAt = "2026-05-12T01:02:39.000Z";
const sessionRoot = `/workspace/vibe64-local-editor/state/projects/example-target-app-test/sessions/active/${directChatSessionId}`;
const sourcePath = `${sessionRoot}/source`;

const directChatSessionPayload = {
  agentRuns: [],
  agentSession: {
    identity: null,
    providerId: "codex",
    terminal: null,
    thread: {
      id: "thread-system-world"
    },
    transportId: "codex_app_server",
    turn: {
      active: false
    },
    workdir: sourcePath
  },
  backgroundTasks: [],
  companion: {
    id: "genesis",
    label: "Genesis"
  },
  conversationLogRoot: `${sessionRoot}/conversation-log`,
  manifest: {
    createdAt,
    product: "vibe64",
    revision: 1,
    schemaVersion: 1,
    sessionId: directChatSessionId,
    updatedAt: createdAt
  },
  metadata: {},
  ok: true,
  revision: 1,
  sessionId: directChatSessionId,
  sessionName: "Genesis Cities",
  sessionRoot,
  sourcePath,
  sourceReady: true,
  stateRoot: `${sessionRoot}/state`,
  status: "active",
  targetRoot: "/workspace/example-target-app",
  updatedAt: createdAt
};

export {
  directChatSessionId,
  directChatSessionPayload
};
