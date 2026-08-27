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
  reactive,
  ssrContextKey
} from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("vuetify/lib/components/VBtn/index.mjs", () => ({
  VBtn: defineComponent({ render: () => null })
}));

vi.mock("vuetify/lib/components/VIcon/index.mjs", () => ({
  VIcon: defineComponent({ render: () => null })
}));

import Vibe64PromptHints from "../../src/components/studio/vibe64-session/Vibe64PromptHints.vue";

const hintComponentPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64PromptHints.vue"
);
const autopilotPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64AutopilotView.vue"
);
const promptTextareaPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue"
);
const sessionPanelPath = path.resolve("src/components/studio/Vibe64SessionPanel.vue");
const sessionPanelComposablePath = path.resolve("src/composables/useVibe64SessionPanel.js");
const runtimeHostPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue"
);
const hintComponentSource = fs.readFileSync(hintComponentPath, "utf8");
const { descriptor: hintDescriptor } = parse(hintComponentSource, {
  filename: hintComponentPath
});
const hintScript = compileScript(hintDescriptor, { id: "vibe64-prompt-hints-test" });
const hintTemplate = compile(hintDescriptor.template.content, {
  bindingMetadata: hintScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
Vibe64PromptHints.render = new Function("Vue", hintTemplate.code)(VueRuntime);

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
    createComment: (text) => ({ text, type: "comment" }),
    createElement: (type) => ({ children: [], parent: null, props: {}, type }),
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
  return [node?.text, ...(node?.children || []).map(nodeText)]
    .filter(Boolean)
    .join("");
}

function mountPromptHints(input = {}) {
  const state = reactive({
    assistantLabel: "",
    loading: false,
    statusId: "prompt-hint-status",
    suggestions: [],
    ...input
  });
  const events = {
    dismiss: vi.fn(),
    focusout: vi.fn(),
    select: vi.fn()
  };
  const Root = defineComponent({
    setup() {
      return () => h(Vibe64PromptHints, {
        ...state,
        onDismiss: events.dismiss,
        onFocusout: events.focusout,
        onSelect: events.select
      });
    }
  });
  const container = { children: [], parent: null, type: "root" };
  const app = testRenderer().createApp(Root);
  app.component("VBtn", passthroughComponent("button"));
  app.component("VIcon", passthroughComponent("span"));
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(container);
  return { app, container, events, state };
}

describe("Vibe64 prompt hints UI", () => {
  it("uses one compact suggestion rail and removes its hidden footprint", () => {
    const component = hintComponentSource;

    expect(component).toContain("mdiLightbulbOnOutline");
    expect(component).toContain("Suggestions");
    expect(component).toContain('v-for="suggestion in suggestions"');
    expect(component).toContain(':aria-label="`Use suggestion: ${suggestion}`"');
    expect(component).toContain(':title="suggestion"');
    expect(component).toContain('aria-orientation="horizontal"');
    expect(component).toContain('rounded="xl"');
    expect(component).toContain('variant="tonal"');
    expect(component).not.toContain("\n          block\n");
    expect(component).toContain("height: 0;");
    expect(component).toContain("height: 3.5rem;");
    expect(component).toContain("display: flex;");
    expect(component).toContain("height: 100%;");
    expect(component).toContain("overflow-x: auto;");
    expect(component).toContain("flex: 0 0 auto;");
    expect(component).toContain("text-overflow: ellipsis;");
    expect(component).toContain("white-space: nowrap;");
    expect(component).toContain("@media (prefers-reduced-motion: reduce)");
    expect(component).not.toMatch(/v-progress|spinner|circular-progress/iu);
  });

  it("shows a stable pending label without creating a transcript message", () => {
    const component = hintComponentSource;
    const autopilot = fs.readFileSync(autopilotPath, "utf8");

    expect(component).toContain("Thinking of a few ideas");
    expect(component).toContain('aria-live="polite"');
    expect(component).not.toContain("vibe64-prompt-hints__typing");
    expect(autopilot).toContain("<Vibe64PromptHints");
    expect(autopilot.indexOf("<Vibe64PromptHints")).toBeGreaterThan(
      autopilot.indexOf("<Vibe64ConversationLog")
    );
    expect(autopilot.indexOf("<Vibe64PromptHints")).toBeLessThan(
      autopilot.indexOf('class="studio-autopilot__composer"')
    );
    expect(autopilot.indexOf("<Vibe64PromptHints")).toBeLessThan(
      autopilot.indexOf("<Vibe64TemporaryAiWorkspace")
    );
    expect(component).toContain("grid-row: 4;");
    expect(autopilot).toContain("grid-row: 5;");
    expect(autopilot).not.toContain("studio-autopilot__thinking-mark");
  });

  it("keeps static starters available without granting dynamic hints", () => {
    const autopilot = fs.readFileSync(autopilotPath, "utf8");
    const canRequestStart = autopilot.indexOf("const promptHintsCanRequest");
    const canRequestEnd = autopilot.indexOf(
      "const promptHintsConversationKey",
      canRequestStart
    );
    const canRequest = autopilot.slice(canRequestStart, canRequestEnd);

    expect(autopilot.indexOf("const promptHintsBlankConversation"))
      .toBeLessThan(canRequestStart);
    expect(canRequest).toMatch(
      /promptHintsBlankConversation\.value \|\| \(\s*props\.agentConnectionStatus === "connected" &&\s*assistantDirectAllowed\.value\s*\)/u
    );
  });

  it("reuses the support row for authenticated typing presence", () => {
    const autopilot = fs.readFileSync(autopilotPath, "utf8");
    const promptTextarea = fs.readFileSync(promptTextareaPath, "utf8");

    expect(autopilot).toContain("useVibe64SessionTypingPresence({");
    expect(autopilot).toContain(
      "thinkingVisible.value ? thinkingLabel.value : typingLabel.value"
    );
    expect(autopilot).toContain(':assistant-label="composerAssistantLabel"');
    expect(autopilot).toContain('@input-activity="noteTypingActivity"');
    expect(autopilot).toContain("stopTypingOnSubmit();");
    expect(autopilot).toContain("stopTypingOnBlur();");
    expect(promptTextarea).toContain('"input-activity"');
    expect(promptTextarea).toContain('emit("input-activity");');
  });

  it("fills and refocuses the editable composer rather than sending", () => {
    const component = hintComponentSource;
    const autopilot = fs.readFileSync(autopilotPath, "utf8");
    const promptTextarea = fs.readFileSync(promptTextareaPath, "utf8");

    expect(autopilot).toContain('@select="selectPromptHint"');
    expect(autopilot).toContain("composerDraft.value = suggestion;");
    expect(autopilot).toContain("composerInput.value?.focus?.({ preventScroll: true });");
    expect(autopilot).not.toMatch(/function applyPromptHint[\s\S]{0,500}submitComposerMessage/gu);
    expect(promptTextarea).toContain('"attachment-state-change"');
    expect(promptTextarea).toContain('"escape"');
    expect(promptTextarea).toContain('@focus="handleTextareaFocus"');
    expect(promptTextarea).toContain('@blur="handleTextareaBlur"');
    expect(promptTextarea).toContain("focus: focusTextarea");
    expect(autopilot).toContain('@blur="handleComposerBlur"');
    expect(autopilot).toContain('@focusout="handleComposerRegionFocusOut"');
    expect(autopilot).toContain('@dismiss="dismissPromptHintsAndFocus"');
    expect(autopilot).toContain("composerAssistantLabel.value || promptHintsVisible.value");
    expect(component).toContain('@keydown.esc.stop.prevent="$emit(\'dismiss\')"');
  });

  it("renders a persistent live status and a keyboard-operable suggestion group", async () => {
    const mounted = mountPromptHints({ loading: true });
    let statuses = findNodes(mounted.container, (node) => node.props?.role === "status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0].props["aria-live"]).toBe("polite");
    expect(statuses[0].props["aria-atomic"]).toBe("true");
    expect(nodeText(statuses[0])).toBe("Thinking of a few ideas.");

    mounted.state.loading = false;
    const maximumLengthSuggestion = "Review the latest changes and suggest the safest useful next improvement, including how we can verify it together today.";
    expect(maximumLengthSuggestion).toHaveLength(120);
    mounted.state.suggestions = [
      maximumLengthSuggestion,
      "Explain the current project in plain language before we decide what to change",
      "Help me plan one small improvement that we can verify together"
    ];
    await nextTick();

    statuses = findNodes(mounted.container, (node) => node.props?.role === "status");
    expect(statuses).toHaveLength(1);
    expect(nodeText(statuses[0])).toBe(
      "Three suggested prompts are available before the message controls."
    );
    const groups = findNodes(mounted.container, (node) => node.props?.role === "group");
    expect(groups).toHaveLength(1);
    expect(groups[0].props["aria-label"]).toBe("Suggested prompts");
    const buttons = findNodes(groups[0], (node) => node.type === "button");
    expect(buttons).toHaveLength(3);
    expect(buttons[0].props["aria-label"]).toContain(mounted.state.suggestions[0]);
    expect(nodeText(buttons[0])).toBe(maximumLengthSuggestion);
    buttons[0].props.onClick();
    expect(mounted.events.select).toHaveBeenCalledWith(mounted.state.suggestions[0]);

    const section = findNodes(mounted.container, (node) => node.type === "section")[0];
    const keyboardEvent = {
      key: "Escape",
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    };
    section.props.onKeydown(keyboardEvent);
    expect(keyboardEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(keyboardEvent.stopPropagation).toHaveBeenCalledTimes(1);
    expect(mounted.events.dismiss).toHaveBeenCalledTimes(1);

    const focusoutEvent = { relatedTarget: null };
    section.props.onFocusout(focusoutEvent);
    expect(mounted.events.focusout).toHaveBeenCalledWith(focusoutEvent);
    mounted.app.unmount();
  });

  it("hydrates one shared project policy and passes it through hidden runtime hosts", () => {
    const sessionPanel = fs.readFileSync(sessionPanelPath, "utf8");
    const sessionPanelComposable = fs.readFileSync(sessionPanelComposablePath, "utf8");
    const runtimeHost = fs.readFileSync(runtimeHostPath, "utf8");

    expect(sessionPanelComposable).toContain("const projectSettings = useEndpointResource({");
    expect(sessionPanelComposable).toContain("projectSettingsQueryKey(");
    expect(sessionPanel).toContain(':prompt-hint-policy="promptHintPolicy"');
    expect(runtimeHost).toContain(':prompt-hint-policy="props.promptHintPolicy"');
    expect(fs.readFileSync(autopilotPath, "utf8")).toContain(
      "sessionsApiPath: computed(() => readRefOrGetterValue(props.sessionsApiPath))"
    );
  });
});
