import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as VueRuntime from "vue";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "@vue/server-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("vuetify/components/VBtn", () => ({
  VBtn: passthroughComponent("button")
}));

vi.mock("vuetify/components/VIcon", () => ({
  VIcon: passthroughComponent("span")
}));

import Vibe64CreateSessionButton from "../../src/components/studio/vibe64-session/Vibe64CreateSessionButton.vue";

const buttonPath = path.resolve(
  "src/components/studio/vibe64-session/Vibe64CreateSessionButton.vue"
);
const buttonSource = fs.readFileSync(buttonPath, "utf8");
const { descriptor } = parse(buttonSource, { filename: buttonPath });
const componentScript = compileScript(descriptor, {
  id: "vibe64-session-create-ui-test"
});
const componentTemplate = compile(descriptor.template.content, {
  bindingMetadata: componentScript.bindings,
  mode: "function",
  prefixIdentifiers: true
});
Vibe64CreateSessionButton.render = new Function(
  "Vue",
  componentTemplate.code
)(VueRuntime);

function passthroughComponent(element) {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) {
      return () => h(element, attrs, slots.default?.());
    }
  });
}

async function renderCreateButton({
  iconOnly = false,
  running = false
} = {}) {
  const createSession = vi.fn();
  const app = createSSRApp(Vibe64CreateSessionButton, {
    ariaLabel: iconOnly ? "New session" : "Create session",
    buttonClass: iconOnly
      ? "studio-ai-sessions__create-button"
      : "studio-ai-sessions__preview-create-button",
    iconOnly,
    label: "Create session",
    toolbar: {
      canCreateSession: true,
      createSession,
      createSessionRunning: running,
      createSessionTitle: "Create a new Vibe64 session"
    }
  });
  app.component("VBtn", passthroughComponent("button"));
  app.component("VIcon", passthroughComponent("span"));
  return {
    createSession,
    html: await renderToString(app)
  };
}

describe("session creation controls", () => {
  it("uses stable accessible pending feedback without a circular loader", async () => {
    const toolbar = await renderCreateButton({ iconOnly: true, running: true });
    const preview = await renderCreateButton({ running: true });

    for (const { html } of [toolbar, preview]) {
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('aria-label="Creating session…"');
      expect(html).toContain('title="Creating session…"');
      expect(html).toContain("disabled");
      expect(html).not.toContain("progressbar");
      expect(html).not.toContain("v-progress-circular");
    }
    expect(preview.html).toContain("Creating session…");
    expect(buttonSource).not.toContain(":loading=");
  });

  it("retains ordinary action names while idle", async () => {
    const toolbar = await renderCreateButton({ iconOnly: true });
    const preview = await renderCreateButton();

    expect(toolbar.html).toContain('aria-label="New session"');
    expect(toolbar.html).toContain('title="Create a new Vibe64 session"');
    expect(toolbar.html).not.toContain("aria-busy");
    expect(toolbar.html).not.toContain("disabled");
    expect(preview.html).toContain('aria-label="Create session"');
    expect(preview.html).toContain("Create session");
  });

  it("keeps every entry point mounted and connected to the same pending state", () => {
    const panelSource = fs.readFileSync(path.resolve(
      "src/components/studio/Vibe64SessionPanel.vue"
    ), "utf8");
    const runtimeHostSource = fs.readFileSync(path.resolve(
      "src/composables/useVibe64SessionRuntimeHost.js"
    ), "utf8");

    expect(panelSource).toContain(':create-visible="!emptyStateInitialLoading"');
    expect(panelSource).toContain('v-if="emptyStateInitialLoading"');
    expect(runtimeHostSource).toContain(
      "createSessionRunning: props.sessionData.createSessionRunning"
    );
    expect(buttonSource).toContain("min-height: 3rem");
    expect(buttonSource).toContain("min-width: 3rem");
  });
});
