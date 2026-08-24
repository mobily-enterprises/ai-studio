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
import { beforeEach, describe, expect, it, vi } from "vitest";

const projectSettingsMocks = vi.hoisted(() => ({
  commandOptions: [],
  commands: [],
  dialog: vi.fn(),
  endpointOptions: null,
  realtimeOptions: [],
  resource: null,
  sessionEventMatches: vi.fn(() => true)
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource(options) {
    projectSettingsMocks.endpointOptions = options;
    return projectSettingsMocks.resource;
  }
}));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand(options) {
    const index = projectSettingsMocks.commandOptions.length;
    projectSettingsMocks.commandOptions.push(options);
    return projectSettingsMocks.commands[index];
  }
}));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    projectSettingsMocks.realtimeOptions.push(options);
  }
}));

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug() {
    return ref("project-a");
  }
}));

vi.mock("@/composables/useVibe64SessionData.js", () => ({
  sessionListRealtimeShouldRefresh: projectSettingsMocks.sessionEventMatches
}));

vi.mock("@/lib/vibe64AccountConnectionsDialog.js", () => ({
  requestVibe64AccountConnectionsDialog: projectSettingsMocks.dialog
}));

vi.mock("@/components/common/Vibe64AsyncModuleState.vue", () => ({
  default: passthroughComponent("aside")
}));

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button")
}));

vi.mock("vuetify/components/VRadio", () => ({
  VRadio: passthroughComponent("input")
}));

vi.mock("vuetify/components/VRadioGroup", () => ({
  VRadioGroup: passthroughComponent("fieldset")
}));

vi.mock("vuetify/components/VSelect", () => ({
  VSelect: passthroughComponent("select")
}));

vi.mock("vuetify/components/VSwitch", () => ({
  VSwitch: passthroughComponent("input")
}));

vi.mock("vuetify/components/VTextarea", () => ({
  VTextarea: passthroughComponent("textarea")
}));

import ProjectSettingsPanel from "../../src/components/studio/ProjectSettingsPanel.vue";

const componentPath = path.resolve("src/components/studio/ProjectSettingsPanel.vue");
const componentSource = fs.readFileSync(componentPath, "utf8");
const { descriptor } = parse(componentSource, {
  filename: componentPath
});
const componentScript = compileScript(descriptor, {
  id: "project-settings-ai-policy-test"
});
const componentTemplate = compile(descriptor.template.content, {
  bindingMetadata: componentScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
ProjectSettingsPanel.render = new Function("Vue", componentTemplate.code)(VueRuntime);

function passthroughComponent(element) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

function createCommand({ pending = null } = {}) {
  const running = ref(false);
  const run = vi.fn(async () => {
    running.value = true;
    try {
      await pending?.promise;
      return { ok: true };
    } finally {
      running.value = false;
    }
  });
  return {
    get isRunning() {
      return running.value;
    },
    run,
    running
  };
}

function createDeferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createResource({
  canEdit = true,
  developmentDatabase = {},
  policy = {}
} = {}) {
  const databaseOptions = developmentDatabase.options || {};
  const data = ref({
    aiPolicy: {
      customNote: "Use Australian English.",
      expertise: "expert",
      promptHints: false,
      rationale: "teaching",
      responseLength: "detailed",
      tone: "military",
      ...policy
    },
    aiPolicyCanEdit: canEdit,
    developmentDatabase: {
      canChange: true,
      managed: true,
      openSessionCount: 0,
      scope: "session",
      ...developmentDatabase,
      options: {
        project: {
          available: true,
          ...databaseOptions.project
        },
        session: {
          available: true,
          ...databaseOptions.session
        }
      }
    }
  });
  return {
    data,
    isLoading: ref(false),
    loadError: ref(""),
    reload: vi.fn(async () => ({ data: data.value }))
  };
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ children: [], props: {}, text, type: "comment" }),
    createElement: (type) => ({
      children: [],
      focus: vi.fn(),
      parent: null,
      props: {},
      style: {},
      type
    }),
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

function mountPanel() {
  const container = { children: [], parent: null, props: {}, type: "root" };
  const app = testRenderer().createApp(ProjectSettingsPanel);
  app.component("VBtn", passthroughComponent("button"));
  app.component("VRadio", passthroughComponent("input"));
  app.component("VRadioGroup", passthroughComponent("fieldset"));
  app.component("VSelect", passthroughComponent("select"));
  app.component("VSwitch", passthroughComponent("input"));
  app.component("VTextarea", passthroughComponent("textarea"));
  app.provide(ssrContextKey, { modules: new Set() });
  app.mount(container);
  return { app, container };
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

function findField(root, label) {
  return findNode(root, (node) => node.props?.label === label);
}

function findNodeById(root, id) {
  return findNode(root, (node) => node.props?.id === id);
}

function findRadioGroup(root) {
  return findNode(root, (node) => node.type === "fieldset");
}

function findButton(root, label) {
  return findNode(root, (node) => (
    node.type === "button" && nodeText(node).includes(label)
  ));
}

function nodeText(node) {
  return [node.text || "", ...(node.children || []).map(nodeText)].join("");
}

describe("ProjectSettingsPanel AI behaviour", () => {
  beforeEach(() => {
    projectSettingsMocks.commandOptions.length = 0;
    projectSettingsMocks.commands = [createCommand(), createCommand()];
    projectSettingsMocks.dialog.mockReset();
    projectSettingsMocks.endpointOptions = null;
    projectSettingsMocks.realtimeOptions.length = 0;
    projectSettingsMocks.resource = createResource();
    projectSettingsMocks.sessionEventMatches.mockClear();
  });

  it("hydrates every writable field synchronously from warm cached project data", () => {
    const { app, container } = mountPanel();

    expect(findRadioGroup(container).props.modelValue).toBe("session");
    expect(findRadioGroup(container).props["aria-labelledby"])
      .toBe("development-database-title");
    expect(findField(container, "A separate database for each session").props.disabled)
      .toBe(false);
    expect(findField(container, "One database shared by this project").props.disabled)
      .toBe(false);
    expect(findField(container, "Tone").props.modelValue).toBe("military");
    expect(findField(container, "Tone").props.density).toBe("comfortable");
    expect(findField(container, "Response length").props.modelValue).toBe("detailed");
    expect(findField(container, "Response length").props.density).toBe("comfortable");
    expect(findField(container, "Experience level").props.modelValue).toBe("expert");
    expect(findField(container, "Experience level").props.density).toBe("comfortable");
    expect(findField(container, "Explanation style").props.modelValue).toBe("teaching");
    expect(findField(container, "Explanation style").props.density).toBe("comfortable");
    expect(findField(container, "Anything else (optional)").props.modelValue)
      .toBe("Use Australian English.");
    expect(findField(container, "Suggest useful next prompts").props.modelValue).toBe(false);
    expect(findButton(container, "Save AI behaviour").props.disabled).toBe(true);

    app.unmount();
  });

  it("keeps warm settings visible during refresh and preserves an unsaved database draft", async () => {
    projectSettingsMocks.resource = createResource({
      developmentDatabase: {
        scope: "project"
      }
    });
    projectSettingsMocks.resource.isLoading.value = true;
    const { app, container } = mountPanel();

    const group = findRadioGroup(container);
    expect(group.props.modelValue).toBe("project");
    expect(findField(container, "Tone")).toBeTruthy();
    expect(findNode(container, (node) => node.type === "aside")).toBeNull();

    group.props["onUpdate:modelValue"]("session");
    await nextTick();
    projectSettingsMocks.resource.data.value = {
      ...projectSettingsMocks.resource.data.value,
      developmentDatabase: {
        canChange: false,
        disabledReason: "Close both open sessions before changing the development database.",
        managed: true,
        openSessionCount: 2,
        options: {
          project: {
            available: false,
            disabledReason: "A shared database allows one open session, but this project has 2."
          },
          session: {
            available: true
          }
        },
        scope: "project"
      }
    };
    projectSettingsMocks.realtimeOptions[0].onEvent();
    await nextTick();

    expect(findRadioGroup(container).props.modelValue).toBe("session");
    expect(findField(container, "One database shared by this project").props.disabled)
      .toBe(true);
    expect(projectSettingsMocks.resource.reload).toHaveBeenCalledOnce();

    app.unmount();
  });

  it("disables and describes only the unavailable shared-database choice", () => {
    const projectReason = "A shared database allows one open session, but this project has 2.";
    projectSettingsMocks.resource = createResource({
      developmentDatabase: {
        canChange: false,
        disabledReason: "Close both open sessions before changing the development database.",
        openSessionCount: 2,
        options: {
          project: {
            available: false,
            disabledReason: projectReason
          },
          session: {
            available: true
          }
        },
        scope: "project"
      }
    });
    const { app, container } = mountPanel();

    const sessionChoice = findField(container, "A separate database for each session");
    const projectChoice = findField(container, "One database shared by this project");
    expect(findRadioGroup(container).props.modelValue).toBe("project");
    expect(sessionChoice.props.disabled).toBe(false);
    expect(sessionChoice.props["aria-describedby"]).toBeUndefined();
    expect(projectChoice.props.disabled).toBe(true);
    expect(projectChoice.props["aria-describedby"])
      .toBe("development-database-project-reason");
    expect(nodeText(findNodeById(container, "development-database-project-reason")))
      .toContain(projectReason);
    expect(findButton(container, "Save database choice").props.disabled).toBe(true);

    app.unmount();
  });

  it("guards the database command when the selected scope is unavailable", async () => {
    projectSettingsMocks.resource = createResource({
      developmentDatabase: {
        options: {
          project: {
            available: false,
            disabledReason: "A shared database is unavailable."
          },
          session: {
            available: true
          }
        }
      }
    });
    const { app, container } = mountPanel();

    findRadioGroup(container).props["onUpdate:modelValue"]("project");
    await nextTick();
    const save = findButton(container, "Save database choice");
    expect(save.props.disabled).toBe(true);
    await save.props.onClick();
    expect(projectSettingsMocks.commands[0].run).not.toHaveBeenCalled();
    expect(projectSettingsMocks.resource.reload).not.toHaveBeenCalled();

    app.unmount();
  });

  it("keeps the database controls compact, adaptive, and touch accessible", () => {
    expect(componentSource).toContain('aria-labelledby="development-database-title"');
    expect(componentSource).toContain("development-database-project-reason");
    expect(componentSource).toContain(
      "grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));"
    );
    expect(componentSource).toContain("@media (max-width: 900px)");
    expect(componentSource).toContain("@media (max-width: 540px)");
    expect(componentSource).not.toContain("@media (pointer: coarse)");
    expect(componentSource).toContain("min-height: 3rem;");
  });

  it("lets an owner edit but keeps a member read-only even if an event is invoked", async () => {
    let mounted = mountPanel();
    const ownerTone = findField(mounted.container, "Tone");
    expect(ownerTone.props.disabled).toBe(false);

    ownerTone.props["onUpdate:modelValue"]("playful");
    await nextTick();
    expect(findButton(mounted.container, "Save AI behaviour").props.disabled).toBe(false);
    mounted.app.unmount();

    projectSettingsMocks.commandOptions.length = 0;
    projectSettingsMocks.commands = [createCommand(), createCommand()];
    projectSettingsMocks.realtimeOptions.length = 0;
    projectSettingsMocks.resource = createResource({ canEdit: false });
    mounted = mountPanel();

    const memberTone = findField(mounted.container, "Tone");
    expect(memberTone.props.disabled).toBe(true);
    expect(findField(mounted.container, "Anything else (optional)").props.disabled).toBe(true);
    memberTone.props["onUpdate:modelValue"]("playful");
    await nextTick();
    const save = findButton(mounted.container, "Save AI behaviour");
    expect(save.props.disabled).toBe(true);
    await save.props.onClick();
    expect(projectSettingsMocks.commands[1].run).not.toHaveBeenCalled();

    mounted.app.unmount();
  });

  it("uses a stable pending label and blocks a duplicate owner submission", async () => {
    const pending = createDeferred();
    const aiCommand = createCommand({ pending });
    projectSettingsMocks.commands = [createCommand(), aiCommand];
    const { app, container } = mountPanel();

    findField(container, "Tone").props["onUpdate:modelValue"]("encouraging");
    await nextTick();
    let save = findButton(container, "Save AI behaviour");
    const firstSubmission = save.props.onClick();
    const duplicateSubmission = save.props.onClick();
    await nextTick();

    save = findButton(container, "Saving…");
    expect(save.props.disabled).toBe(true);
    expect(aiCommand.run).toHaveBeenCalledOnce();
    expect(projectSettingsMocks.commandOptions[1].buildRawPayload(null, {
      context: aiCommand.run.mock.calls[0][0]
    })).toMatchObject({
      customNote: "Use Australian English.",
      expertise: "expert",
      promptHints: false,
      rationale: "teaching",
      responseLength: "detailed",
      tone: "encouraging"
    });

    pending.resolve();
    await Promise.all([firstSubmission, duplicateSubmission]);
    await nextTick();
    expect(projectSettingsMocks.resource.reload).toHaveBeenCalledOnce();
    expect(findButton(container, "Save AI behaviour")).toBeTruthy();

    app.unmount();
  });

  it("counts custom-note characters by Unicode code point at the shared 500-character boundary", async () => {
    const { app, container } = mountPanel();
    const note = findField(container, "Anything else (optional)");

    note.props["onUpdate:modelValue"]("🌱".repeat(500));
    await nextTick();
    expect(findField(container, "Anything else (optional)").props.errorMessages).toBeFalsy();
    expect(findField(container, "Anything else (optional)").props.hint)
      .toBe("500 of 500 characters");
    expect(findButton(container, "Save AI behaviour").props.disabled).toBe(false);

    note.props["onUpdate:modelValue"]("🌱".repeat(501));
    await nextTick();
    expect(findField(container, "Anything else (optional)").props.hint)
      .toBe("501 of 500 characters");
    expect(findButton(container, "Save AI behaviour").props.disabled).toBe(true);

    app.unmount();
  });

  it("refreshes manually and through both declared realtime paths", async () => {
    const { app, container } = mountPanel();

    expect(projectSettingsMocks.endpointOptions.realtime).toEqual({
      event: "vibe64.project.changed"
    });
    const sessionRealtime = projectSettingsMocks.realtimeOptions[0];
    expect(sessionRealtime.event).toBe("vibe64.session.changed");
    expect(sessionRealtime.matches).toBe(projectSettingsMocks.sessionEventMatches);

    await findButton(container, "Refresh").props.onClick();
    sessionRealtime.onEvent();
    await nextTick();
    expect(projectSettingsMocks.resource.reload).toHaveBeenCalledTimes(2);

    projectSettingsMocks.resource.isLoading.value = true;
    await nextTick();
    const pendingRefresh = findButton(container, "Refreshing…");
    expect(pendingRefresh.props.disabled).toBe(true);

    app.unmount();
  });

  it("opens the personal profile section from the project-owned settings screen", async () => {
    const { app, container } = mountPanel();

    await findButton(container, "Set what the assistant calls you").props.onClick();
    expect(projectSettingsMocks.dialog).toHaveBeenCalledWith({
      refresh: false,
      section: "profile"
    });

    app.unmount();
  });
});
