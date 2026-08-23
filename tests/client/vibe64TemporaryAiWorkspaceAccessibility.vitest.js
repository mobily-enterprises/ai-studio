import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import {
  computed,
  createRenderer,
  defineComponent,
  h,
  nextTick,
  ref,
  ssrContextKey
} from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const temporaryProvider = vi.hoisted(() => ({ value: null }));

vi.mock("@/composables/useVibe64TemporaryAi.js", () => ({
  TEMPORARY_AI_WORKSPACE_WRITE_POLICY: "workspace_write",
  useVibe64TemporaryAi: () => temporaryProvider.value
}));

vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({
  useUiFeedback: () => ({
    error: vi.fn(),
    success: vi.fn()
  })
}));

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("button", attrs, slots.default?.());
    }
  })
}));

vi.mock("@/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue", () => ({
  default: defineComponent({ render: () => null })
}));

vi.mock("@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue", () => ({
  default: defineComponent({ render: () => null })
}));

import Vibe64TemporaryAiWorkspace from "../../src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue";

const workspaceComponentPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64TemporaryAiWorkspace.vue"
);
const workspaceComponentSource = fs.readFileSync(workspaceComponentPath, "utf8");
const { descriptor: workspaceDescriptor } = parse(workspaceComponentSource, {
  filename: workspaceComponentPath
});
const workspaceScript = compileScript(workspaceDescriptor, { id: "temporary-ai-workspace-test" });
const workspaceTemplate = compile(workspaceDescriptor.template.content, {
  bindingMetadata: workspaceScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
Vibe64TemporaryAiWorkspace.render = new Function("Vue", workspaceTemplate.code)(VueRuntime);

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function temporaryAiTestState(startResult) {
  const tasks = ref([]);
  const activeTaskId = ref("");
  const open = ref(false);
  return {
    activeTask: computed(() => tasks.value.find((task) => task.id === activeTaskId.value) || null),
    activeTaskId,
    closeTask: vi.fn(),
    closeWorkspace: vi.fn(),
    open,
    openTask: vi.fn(),
    selectTask: vi.fn((taskId) => {
      activeTaskId.value = taskId;
      open.value = true;
    }),
    send: vi.fn(),
    showWorkspace: vi.fn(),
    startTask: vi.fn(() => {
      const task = {
        agentSettings: {},
        busy: true,
        draft: "",
        error: "",
        id: "recovery-task",
        messages: [],
        policy: "workspace_write",
        title: "Fix preview"
      };
      tasks.value = [task];
      activeTaskId.value = task.id;
      open.value = true;
      return startResult.promise;
    }),
    stopTask: vi.fn(),
    tasks,
    updateAgentSetting: vi.fn(),
    updateAttachments: vi.fn(),
    updateDraft: vi.fn(),
    updatePolicy: vi.fn()
  };
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ text, type: "comment" }),
    createElement: (type) => ({
      children: [],
      focus: vi.fn(),
      parent: null,
      props: {},
      scrollIntoView: vi.fn(),
      type
    }),
    createText: (text) => ({ text, type: "text" }),
    insert(child, parent, anchor = null) {
      child.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) {
        parent.children.push(child);
      } else {
        parent.children.splice(index, 0, child);
      }
    },
    nextSibling(node) {
      const index = node.parent?.children?.indexOf(node) ?? -1;
      return index >= 0 ? node.parent.children[index + 1] || null : null;
    },
    parentNode: (node) => node.parent,
    patchProp(element, key, _previous, value) {
      element.props[key] = value;
    },
    remove(child) {
      const index = child.parent?.children?.indexOf(child) ?? -1;
      if (index >= 0) {
        child.parent.children.splice(index, 1);
      }
    },
    setElementText(element, text) {
      element.text = text;
    },
    setText(node, text) {
      node.text = text;
    }
  });
}

function mountWorkspace(container, props) {
  const app = testRenderer().createApp(Vibe64TemporaryAiWorkspace, props);
  app.component("VBtn", defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h("button", attrs, slots.default?.());
    }
  }));
  app.provide(ssrContextKey, { modules: new Set() });
  return { app, workspace: app.mount(container) };
}

function findNode(root, predicate) {
  if (predicate(root)) {
    return root;
  }
  for (const child of root.children || []) {
    const match = findNode(child, predicate);
    if (match) {
      return match;
    }
  }
  return null;
}

async function flushWorkspaceReveal() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe("Temporary AI recovery workspace accessibility", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      callback();
      return 1;
    });
  });

  afterEach(() => {
    temporaryProvider.value = null;
    vi.unstubAllGlobals();
  });

  it("reveals and focuses the recovery task before its request finishes", async () => {
    const startResult = deferred();
    temporaryProvider.value = temporaryAiTestState(startResult);
    const container = { children: [], parent: null, type: "root" };
    const { app, workspace } = mountWorkspace(container, {
      sessionId: "session-1",
      sessionsApiPath: "/api/vibe64/sessions"
    });

    const started = workspace.startTask({ draft: "Fix the preview" });
    await flushWorkspaceReveal();

    const taskButton = findNode(container, (node) => (
      node.props?.["data-temporary-ai-task-id"] === "recovery-task"
    ));
    expect(taskButton).toBeTruthy();
    expect(taskButton.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest"
    });
    expect(taskButton.focus).toHaveBeenCalledWith({ preventScroll: true });

    startResult.resolve({ ok: true, started: true, taskId: "recovery-task" });
    await expect(started).resolves.toMatchObject({ started: true });
    app.unmount();
  });

  it("scrolls an ordinary newly active task into view without stealing focus", async () => {
    const startResult = deferred();
    const temporary = temporaryAiTestState(startResult);
    temporary.tasks.value = [
      {
        agentSettings: {}, busy: false, draft: "", error: "", id: "first",
        messages: [], policy: "read", title: "First"
      },
      {
        agentSettings: {}, busy: false, draft: "", error: "", id: "second",
        messages: [], policy: "read", title: "Second"
      }
    ];
    temporary.activeTaskId.value = "first";
    temporary.open.value = true;
    temporaryProvider.value = temporary;
    const container = { children: [], parent: null, type: "root" };
    const { app, workspace } = mountWorkspace(container, {
      sessionId: "session-1",
      sessionsApiPath: "/api/vibe64/sessions"
    });
    await flushWorkspaceReveal();

    const secondTaskButton = findNode(container, (node) => (
      node.props?.["data-temporary-ai-task-id"] === "second"
    ));
    secondTaskButton.focus.mockClear();
    secondTaskButton.scrollIntoView.mockClear();

    workspace.showWorkspace();
    await flushWorkspaceReveal();
    const firstTaskButton = findNode(container, (node) => (
      node.props?.["data-temporary-ai-task-id"] === "first"
    ));
    expect(firstTaskButton.scrollIntoView).toHaveBeenCalled();
    expect(firstTaskButton.focus).not.toHaveBeenCalled();

    temporary.activeTaskId.value = "second";
    await flushWorkspaceReveal();

    expect(secondTaskButton.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest"
    });
    expect(secondTaskButton.focus).not.toHaveBeenCalled();
    app.unmount();
  });

  it("offers Main chat first without closing or changing temporary tasks", async () => {
    const startResult = deferred();
    const temporary = temporaryAiTestState(startResult);
    temporary.tasks.value = [
      {
        agentSettings: {}, busy: true, draft: "", error: "", id: "first",
        messages: [], policy: "read", title: "First"
      },
      {
        agentSettings: {}, busy: false, draft: "", error: "", id: "second",
        messages: [], policy: "read", title: "Second"
      }
    ];
    temporary.activeTaskId.value = "first";
    temporary.open.value = true;
    temporaryProvider.value = temporary;
    const selectMainChat = vi.fn();
    const container = { children: [], parent: null, type: "root" };
    const { app } = mountWorkspace(container, {
      onSelectMainChat: selectMainChat,
      sessionId: "session-1",
      sessionsApiPath: "/api/vibe64/sessions"
    });
    await flushWorkspaceReveal();

    const conversationNavigation = findNode(container, (node) => (
      node.props?.["aria-label"] === "Main and temporary conversations"
    ));
    const mainChatButton = findNode(container, (node) => (
      node.props?.["data-temporary-ai-main-chat"] === ""
    ));
    const currentTaskButton = findNode(container, (node) => (
      node.props?.["data-temporary-ai-task-id"] === "first"
    ));

    expect(conversationNavigation).toBeTruthy();
    expect(mainChatButton).toBeTruthy();
    expect(currentTaskButton.props["aria-current"]).toBe("page");
    mainChatButton.props.onClick();

    expect(selectMainChat).toHaveBeenCalledTimes(1);
    expect(temporary.closeTask).not.toHaveBeenCalled();
    expect(temporary.tasks.value).toHaveLength(2);
    expect(temporary.activeTaskId.value).toBe("first");
    expect(workspaceComponentSource).toContain("position: sticky");
    app.unmount();
  });
});
