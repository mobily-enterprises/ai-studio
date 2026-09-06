import { createApp, effectScope, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = reactive({
  path: "/app/project/chat-test/dashboard/files"
});
const router = {
  push: vi.fn(),
  replace: vi.fn()
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
vi.mock("@local/vibe64-accounts/client", () => ({
  useVibe64Accounts: () => ({
    status: {
      value: null
    }
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
    sessionArchive: {},
    sessionSelectionArchived: false,
    sessionsApiPath: "/api/sessions",
    sessionToolbar: {}
  });
}

describe("useVibe64AutopilotView route hydration", () => {
  let app;
  let scope;
  beforeEach(() => {
    app = createApp({});
    scope = effectScope();
    route.path = "/app/project/chat-test/dashboard/files";
    router.push.mockReset();
    router.replace.mockReset();
  });
  afterEach(() => scope.stop());

  it("projects retained session activity without hiding the shared dashboard route", async () => {
    route.path = "/app/project/chat-test/dashboard/repository";
    const props = viewProps();
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, vi.fn())));
    const requestSaveWork = view.dashboardSessionContext.value.requestSaveWork;

    expect(view.dashboardSessionContext.value.active).toBe(true);
    props.active = false;
    await nextTick();
    expect(view.dashboardSessionContext.value).toMatchObject({
      active: false, requestSaveWork, sessionId: "session-1"
    });
    expect(view.dashboardRouteVisible.value).toBe(true);

    props.active = true;
    await nextTick();
    expect(view.dashboardSessionContext.value).toMatchObject({
      active: true, requestSaveWork, sessionId: "session-1"
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("opens a directly routed source tool when the selected source arrives", async () => {
    const props = viewProps();
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, vi.fn())));

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

  it("rehydrates the session Database route when warm source state is already available", async () => {
    route.path = "/app/project/chat-test/dashboard/database";
    const props = viewProps();
    props.session = {
      ...props.session,
      metadata: {
        source_kind: "session_clone",
        source_path: "/tmp/sessions/active/session-1/source",
        source_path_authority: "managed_session_source"
      },
      source: "/tmp/sessions/active/session-1/source"
    };
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, vi.fn())));

    expect(view.rightPaneTab.value).toBe("database");

    route.path = "/app/project/chat-test/dashboard";
    await nextTick();
    expect(view.rightPaneTab.value).toBe("dashboard");

    route.path = "/app/project/chat-test/dashboard/database";
    await nextTick();
    expect(view.rightPaneTab.value).toBe("database");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("keeps a directly routed AI terminal open while assistant access hydrates", async () => {
    route.path = "/app/project/chat-test/dashboard/ai-terminal";
    const accessLoading = ref(true);
    const canUseAi = ref(false);
    const props = viewProps();
    const { useVibe64AutopilotView } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, vi.fn(), {
      assistantAccessLoading: accessLoading,
      assistantCanUseAi: canUseAi
    })));

    expect(view.rightPaneTab.value).toBe("ai-terminal");
    expect(router.replace).not.toHaveBeenCalled();

    canUseAi.value = true;
    accessLoading.value = false;
    await nextTick();

    expect(view.rightPaneTab.value).toBe("ai-terminal");
    expect(router.replace).not.toHaveBeenCalled();
  });
});
