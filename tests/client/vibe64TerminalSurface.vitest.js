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
import { describe, expect, it, vi } from "vitest";

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button")
}));

vi.mock("vuetify/components/VChip", () => ({
  VChip: passthroughComponent("span")
}));

vi.mock("vuetify/components/VSheet", () => ({
  VSheet: passthroughComponent("section")
}));

vi.mock("@/components/studio/StudioErrorNotice.vue", () => ({
  default: defineComponent({ render: () => null })
}));

import Vibe64TerminalSurface from "../../src/components/studio/Vibe64TerminalSurface.vue";

const surfacePath = path.resolve("src/components/studio/Vibe64TerminalSurface.vue");
const { descriptor } = parse(fs.readFileSync(surfacePath, "utf8"), {
  filename: surfacePath
});
const surfaceScript = compileScript(descriptor, { id: "vibe64-terminal-surface-test" });
const surfaceTemplate = compile(descriptor.template.content, {
  bindingMetadata: surfaceScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
Vibe64TerminalSurface.render = new Function("Vue", surfaceTemplate.code)(VueRuntime);

function passthroughComponent(element) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ style: {}, text, type: "comment" }),
    createElement: (type) => ({
      children: [],
      focus: vi.fn(),
      parent: null,
      props: {},
      style: {},
      type
    }),
    createText: (text) => ({ style: {}, text, type: "text" }),
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

function mountSurface(component, container) {
  const app = testRenderer().createApp(component);
  app.component("VBtn", passthroughComponent("button"));
  app.component("VChip", passthroughComponent("span"));
  app.component("VSheet", passthroughComponent("section"));
  app.provide(ssrContextKey, { modules: new Set() });
  return { app, surface: app.mount(container) };
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

function findNodes(root, predicate, matches = []) {
  if (predicate(root)) {
    matches.push(root);
  }
  for (const child of root.children || []) {
    findNodes(child, predicate, matches);
  }
  return matches;
}

function nodeText(node) {
  return [node.text || "", ...(node.children || []).map(nodeText)].join("");
}

describe("Vibe64TerminalSurface", () => {
  it("renders a compact stage, status, and projected output line by default", () => {
    const container = { children: [], parent: null, type: "root" };
    const Root = defineComponent({
      render: () => h(Vibe64TerminalSurface, {
        output: "Preparing\nDownloaded 10%\rDownloaded 90%\r",
        stage: "Installing",
        status: "running",
        title: "Preview terminal"
      })
    });
    const { app } = mountSurface(Root, container);

    const summary = findNode(container, (node) => (
      String(node.props?.class || "").includes("vibe64-terminal-surface__summary")
    ));
    const toggle = findNode(container, (node) => node.type === "button" && nodeText(node) === "Expand");

    expect(summary).toBeTruthy();
    expect(nodeText(summary)).toContain("Installing");
    expect(nodeText(summary)).toContain("Downloaded 90%");
    expect(nodeText(container)).toContain("running");
    expect(toggle.props["aria-expanded"]).toBe("false");
    app.unmount();
  });

  it("keeps its body mounted and restores toggle focus when collapsed", async () => {
    const expanded = ref(true);
    const container = { children: [], parent: null, type: "root" };
    const Root = defineComponent({
      setup() {
        return () => h(Vibe64TerminalSurface, {
          expanded: expanded.value,
          onToggleExpanded: () => {
            expanded.value = !expanded.value;
          },
          output: "Ready",
          title: "Codex terminal"
        });
      }
    });
    const { app } = mountSurface(Root, container);
    const body = findNode(container, (node) => (
      String(node.props?.class || "").includes("vibe64-terminal-surface__body")
    ));
    const toggle = findNode(container, (node) => node.type === "button" && nodeText(node) === "Collapse");

    toggle.props.onClick();
    await nextTick();
    await nextTick();

    const collapsedBody = findNode(container, (node) => node.props?.id === body.props.id);
    expect(collapsedBody).toBe(body);
    expect(body.style.display).toBe("none");
    expect(toggle.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(nodeText(toggle)).toBe("Expand");
    app.unmount();
  });

  it("keeps a non-collapsible log visible without an unavailable Expand action", () => {
    const container = { children: [], parent: null, type: "root" };
    const Root = defineComponent({
      render: () => h(Vibe64TerminalSurface, {
        bodyMode: "log",
        collapsible: false,
        expanded: false,
        output: "Recorded output",
        status: "Recorded",
        title: "Release logs"
      })
    });
    const { app } = mountSurface(Root, container);

    const body = findNode(container, (node) => (
      String(node.props?.class || "").includes("vibe64-terminal-surface__body")
    ));
    const expand = findNode(container, (node) => node.type === "button" && nodeText(node) === "Expand");

    expect(body).toBeTruthy();
    expect(body.style.display).not.toBe("none");
    expect(nodeText(body)).toContain("Recorded output");
    expect(expand).toBeNull();
    app.unmount();
  });

  it("shows expanded terminal status once in the footer", () => {
    const container = { children: [], parent: null, type: "root" };
    const Root = defineComponent({
      render: () => h(Vibe64TerminalSurface, {
        bodyMode: "terminal",
        expanded: true,
        output: "Ready",
        status: "running",
        title: "Preview terminal"
      })
    });
    const { app } = mountSurface(Root, container);

    const statusNodes = findNodes(container, (node) => node.text === "running");
    expect(statusNodes).toHaveLength(1);
    app.unmount();
  });

  it("forwards owner placement attributes through its Teleport root", () => {
    const container = { children: [], parent: null, type: "root" };
    const Root = defineComponent({
      render: () => h(Vibe64TerminalSurface, {
        class: "owner-terminal-dock",
        style: { marginTop: "12px" },
        title: "Preview terminal"
      })
    });
    const { app } = mountSurface(Root, container);
    const surface = findNode(container, (node) => (
      String(node.props?.class || "").includes("vibe64-terminal-surface")
    ));

    expect(String(surface.props.class)).toContain("owner-terminal-dock");
    expect(surface.props.style).toMatchObject({ marginTop: "12px" });
    app.unmount();
  });
});
