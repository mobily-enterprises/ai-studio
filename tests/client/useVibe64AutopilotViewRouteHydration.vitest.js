import { nextTick, reactive } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const route = reactive({
  path: "/app/project/chat-test/dashboard/files"
});
const router = {
  push: vi.fn()
};

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => router
}));
vi.mock("@/composables/useVibe64ProjectScope.js", async () => {
  const { ref } = await import("vue");
  return {
    useVibe64ProjectSlug: () => ref("chat-test")
  };
});
vi.mock("@/composables/useVibe64AgentSettings.js", async () => {
  const { ref } = await import("vue");
  return {
    useVibe64AgentSettings: () => ({
      settings: ref({
        model: "",
        providerId: "codex",
        thinking: ""
      }),
      update: vi.fn()
    })
  };
});
vi.mock("@/lib/vibe64AsyncComponent.js", () => ({
  defineVibe64AsyncComponent: ({ label = "Async component" } = {}) => ({
    name: label.replaceAll(" ", "")
  })
}));

function viewProps() {
  return reactive({
    active: true,
    agentConnectionStatus: "connected",
    cancelAgentMessage: vi.fn(async () => true),
    chatCollapsed: false,
    conversationLog: {
      turns: []
    },
    interruptAgentTurn: vi.fn(async () => true),
    page: {},
    projectContext: {},
    projectPane: "dashboard",
    refreshSessionData: vi.fn(async () => null),
    retryWorkspaceSetup: vi.fn(async () => true),
    saveSessionWork: vi.fn(async () => ({ ok: true, status: "saved" })),
    sendAgentMessage: vi.fn(async () => true),
    session: {
      agentSession: {
        turn: {}
      },
      metadata: {},
      sessionId: "session-1",
      sessionRoot: "/tmp/state/session-1"
    },
    sessionAbandon: {},
    sessionSelectionClosed: false,
    sessionsApiPath: "/api/sessions",
    sessionToolbar: {}
  });
}

describe("useVibe64AutopilotView route hydration", () => {
  beforeEach(() => {
    route.path = "/app/project/chat-test/dashboard/files";
    router.push.mockReset();
  });

  it("opens a directly routed source tool when the selected source arrives", async () => {
    const props = viewProps();
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = useVibe64AutopilotView(props, vi.fn());

    expect(view.sessionSourceRoot.value).toBe("");
    expect(view.rightPaneTab.value).not.toBe("editor");

    props.session = {
      ...props.session,
      metadata: {
        source_kind: "session_clone",
        source_path: "/tmp/sessions/active/session-1/source",
        source_path_authority: "managed_session_source"
      },
      source: "/tmp/sessions/active/session-1/source"
    };
    await nextTick();

    expect(view.sessionSourceRoot.value).toBe("/tmp/sessions/active/session-1/source");
    expect(view.rightPaneTab.value).toBe("editor");
    expect(router.push).not.toHaveBeenCalled();

    route.path = "/app/project/chat-test/dashboard/env";
    await nextTick();
    expect(view.rightPaneTab.value).toBe("dashboard");

    route.path = "/app/project/chat-test/dashboard/files";
    await nextTick();
    expect(view.rightPaneTab.value).toBe("editor");
  });
});
