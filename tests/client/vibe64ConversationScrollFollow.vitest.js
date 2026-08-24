import fs from "node:fs";
import path from "node:path";

import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  ref,
  ssrContextKey
} from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/studio/LongTextPreviewBlocks.vue", () => ({
  default: defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs }) {
      return () => h("span", attrs);
    }
  })
}));

vi.mock("vuetify/components/VAlert", () => ({
  VAlert: passthroughComponent()
}));

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button")
}));

vi.mock("vuetify/components/VIcon", () => ({
  VIcon: passthroughComponent("span")
}));

vi.mock("vuetify/components/VSkeletonLoader", () => ({
  VSkeletonLoader: passthroughComponent()
}));

import Vibe64ConversationLog from "../../src/components/studio/vibe64-session/Vibe64ConversationLog.vue";

const componentPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64ConversationLog.vue"
);
const componentSource = fs.readFileSync(componentPath, "utf8");
const { descriptor } = parse(componentSource, {
  filename: componentPath
});
const componentScript = compileScript(descriptor, {
  id: "vibe64-conversation-scroll-follow-test"
});
const componentTemplate = compile(descriptor.template.content, {
  bindingMetadata: componentScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
Vibe64ConversationLog.render = new Function("Vue", componentTemplate.code)(VueRuntime);

function passthroughComponent(element = "div") {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

function createHostElement(type) {
  let scrollTop = 0;
  const element = {
    children: [],
    clientHeight: 240,
    focus: vi.fn(),
    parent: null,
    props: {},
    scrollHeight: 1_200,
    scrollWrites: [],
    type
  };
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get() {
      return scrollTop;
    },
    set(value) {
      scrollTop = Number(value);
      element.scrollWrites.push(scrollTop);
    }
  });
  return element;
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ children: [], props: {}, text, type: "comment" }),
    createElement: createHostElement,
    createText: (text) => ({ children: [], props: {}, text, type: "text" }),
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

function nodeText(node) {
  return [node.text || "", ...(node.children || []).map(nodeText)].join("");
}

function userTurn(id, text = `User ${id}`) {
  return {
    turnId: id,
    user: {
      at: "2026-08-24T10:00:00.000Z",
      messageId: `${id}-user`,
      role: "user",
      text
    }
  };
}

function agentTurn(id, text = `Assistant ${id}`) {
  return {
    ...userTurn(id),
    messages: [{
      at: "2026-08-24T10:00:01.000Z",
      messageId: `${id}-assistant`,
      role: "assistant",
      text
    }]
  };
}

function mountConversation({
  error = "",
  followLatestKey = 0,
  hasMoreBefore = false,
  turns = [agentTurn("turn-1")]
} = {}) {
  const loadMoreRequests = [];
  const state = {
    error: ref(error),
    followLatestKey: ref(followLatestKey),
    hasMoreBefore: ref(hasMoreBefore),
    scrollKey: ref("session-1"),
    visible: ref(true),
    turns: ref(turns)
  };
  const Root = defineComponent({
    setup() {
      return () => h(Vibe64ConversationLog, {
        error: state.error.value,
        followLatestKey: state.followLatestKey.value,
        hasMoreBefore: state.hasMoreBefore.value,
        onLoadMore: (request) => loadMoreRequests.push(request),
        scrollKey: state.scrollKey.value,
        turns: state.turns.value,
        visible: state.visible.value
      });
    }
  });
  const container = { children: [], parent: null, props: {}, type: "root" };
  const app = testRenderer().createApp(Root);
  app.component("VAlert", passthroughComponent());
  app.component("VBtn", passthroughComponent("button"));
  app.component("VIcon", passthroughComponent("span"));
  app.component("VSkeletonLoader", passthroughComponent());
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(container);
  return { app, container, loadMoreRequests, state };
}

function conversationBody(container) {
  return findNode(container, (node) => String(node.props?.class || "")
    .split(" ")
    .includes("studio-conversation-log__body"));
}

function loadOlderButton(container) {
  return findNode(container, (node) => (
    node.type === "button" && nodeText(node).includes("Load older messages")
  ));
}

describe("Vibe64 conversation scroll following", () => {
  let animationFrames;
  let nextAnimationFrameId;
  let originalWindowDescriptor;

  beforeEach(() => {
    vi.useFakeTimers();
    animationFrames = new Map();
    nextAnimationFrameId = 1;
    originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        cancelAnimationFrame(id) {
          animationFrames.delete(id);
        },
        clearTimeout,
        requestAnimationFrame(callback) {
          const id = nextAnimationFrameId;
          nextAnimationFrameId += 1;
          animationFrames.set(id, callback);
          return id;
        },
        setTimeout
      }
    });
  });

  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, "window", originalWindowDescriptor);
    } else {
      delete globalThis.window;
    }
    vi.useRealTimers();
  });

  async function flushScrollWork() {
    await nextTick();
    await Promise.resolve();
    const frames = [...animationFrames.values()];
    animationFrames.clear();
    frames.forEach((callback) => callback());
    await Promise.resolve();
    vi.runAllTimers();
    await nextTick();
  }

  it("follows only while at the bottom and lets an accepted local send resume follow", async () => {
    const { app, container, state } = mountConversation();
    await flushScrollWork();
    const body = conversationBody(container);

    expect(body.props.tabindex).toBe("0");
    expect(body.props["aria-label"]).toBe("Conversation messages");
    expect(body.scrollTop).toBe(1_200);

    body.scrollWrites.length = 0;
    body.props.onPointerdown({
      currentTarget: body,
      target: body
    });
    body.scrollHeight = 1_300;
    state.turns.value = [...state.turns.value, agentTurn("after-background-click")];
    await flushScrollWork();
    await flushScrollWork();
    expect(body.scrollTop).toBe(1_300);

    body.scrollWrites.length = 0;
    body.props.onWheelPassive({});
    body.scrollTop = 320;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    body.scrollHeight = 1_400;
    state.turns.value = [...state.turns.value, userTurn("remote-user")];
    await flushScrollWork();
    expect(body.scrollWrites).toEqual([]);

    body.scrollTop = 1_160;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    body.scrollHeight = 1_600;
    state.turns.value = [...state.turns.value, {
      system: {
        messageId: "system-1",
        role: "system",
        text: "The session state changed."
      },
      turnId: "system-1"
    }];
    await flushScrollWork();
    expect(body.scrollTop).toBe(1_600);

    body.scrollWrites.length = 0;
    body.props.onKeydownCapture({
      defaultPrevented: false,
      key: "PageUp",
      target: body
    });
    body.scrollTop = 500;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    body.scrollHeight = 1_800;
    state.turns.value = [...state.turns.value, agentTurn("agent-after-keyboard")];
    await flushScrollWork();
    expect(body.scrollWrites).toEqual([]);

    state.followLatestKey.value += 1;
    await flushScrollWork();
    expect(body.scrollTop).toBe(1_800);

    app.unmount();
  });

  it("preserves the history anchor after a slow older-page load and stays detached", async () => {
    const { app, container, loadMoreRequests, state } = mountConversation({
      hasMoreBefore: true,
      turns: [agentTurn("turn-2"), agentTurn("turn-3")]
    });
    await flushScrollWork();
    const body = conversationBody(container);

    body.props.onWheelPassive({});
    body.scrollTop = 400;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    loadOlderButton(container).props.onClick();
    vi.advanceTimersByTime(700);

    body.scrollHeight = 1_500;
    state.turns.value = [agentTurn("turn-1"), ...state.turns.value];
    loadMoreRequests[0].complete({ changed: true, loaded: true });
    await flushScrollWork();
    expect(body.scrollTop).toBe(700);

    body.scrollWrites.length = 0;
    body.scrollHeight = 1_700;
    state.turns.value = [...state.turns.value, agentTurn("turn-4")];
    await flushScrollWork();
    expect(body.scrollWrites).toEqual([]);

    app.unmount();
  });

  it("disarms a failed or empty older-page request before later realtime trimming", async () => {
    const { app, container, loadMoreRequests, state } = mountConversation({
      hasMoreBefore: true,
      turns: [agentTurn("turn-1"), agentTurn("turn-2")]
    });
    await flushScrollWork();
    const body = conversationBody(container);

    body.props.onWheelPassive({});
    body.scrollTop = 300;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    loadOlderButton(container).props.onClick();
    loadMoreRequests[0].complete({ changed: false, loaded: false });
    await flushScrollWork();

    body.scrollHeight = 1_400;
    state.turns.value = [agentTurn("turn-2"), agentTurn("turn-3")];
    await flushScrollWork();
    expect(body.scrollWrites).toEqual([]);

    app.unmount();
  });

  it("bottoms a newly visible or newly selected session", async () => {
    const { app, container, state } = mountConversation();
    await flushScrollWork();
    let body = conversationBody(container);

    body.props.onWheelPassive({});
    body.scrollTop = 260;
    body.props.onScrollPassive({ currentTarget: body });
    body.scrollWrites.length = 0;
    state.scrollKey.value = "session-2";
    state.turns.value = [agentTurn("other-session")];
    await flushScrollWork();
    expect(body.scrollTop).toBe(1_200);

    state.visible.value = false;
    await flushScrollWork();
    expect(conversationBody(container)).toBeNull();
    state.visible.value = true;
    await flushScrollWork();
    body = conversationBody(container);
    expect(body.scrollTop).toBe(1_200);

    app.unmount();
  });

  it("initializes a remounted scroll body after an error recovers from warm data", async () => {
    const { app, container, state } = mountConversation({ error: "Conversation failed." });
    await flushScrollWork();
    expect(conversationBody(container)).toBeNull();

    state.error.value = "";
    await flushScrollWork();
    expect(conversationBody(container).scrollTop).toBe(1_200);

    app.unmount();
  });
});
