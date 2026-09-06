import fs from "node:fs";
import path from "node:path";
import { compile } from "@vue/compiler-dom";
import { compileScript, parse } from "@vue/compiler-sfc";
import * as Vue from "vue";
import { renderToString } from "@vue/server-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resource: null, query: null }));
vi.mock("vuetify/components/VBtn", () => ({ VBtn: passthroughComponent("button") }));
vi.mock("vuetify/components/VTextarea", () => ({ VTextarea: passthroughComponent("textarea") }));
vi.mock("vuetify/components/VSkeletonLoader", () => ({ VSkeletonLoader: passthroughComponent("div") }));

function passthroughComponent(element) {
  return Vue.defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs, slots }) { return () => Vue.h(element, attrs, slots.default?.()); }
  });
}
vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource(options) { mocks.query = options; return mocks.resource; }
}));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: () => ({ run: vi.fn() })
}));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug: () => Vue.ref("project-a")
}));
import Onboarding from "../../src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue";

const filename = path.resolve("src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue");
const { descriptor } = parse(fs.readFileSync(filename, "utf8"), { filename });
const script = compileScript(descriptor, { id: "onboarding-test" });
Onboarding.render = new Function("Vue", compile(descriptor.template.content, {
  bindingMetadata: script.bindings, mode: "function", prefixIdentifiers: true
}).code)(Vue);

async function render(state, props = {}) {
  mocks.resource.data.value = state === null ? null : {
    ok: true, available: true,
    inspection: { state, nextAction: "migrate", diagnostics: [{ message: "The project uses an older format." }] },
    // Deliberately retain stale offers: the presentation must still obey state.
    templates: [{ id: "official:jskit/public", technology: "jskit", name: "Public starter", description: "A public app." }]
  };
  const app = Vue.createSSRApp({
    render: () => Vue.h(Onboarding, { active: true, sessionId: "session-a", canAsk: true, sendMessage: async () => {}, ...props }, {
      default: () => Vue.h("div", "Normal outputs")
    })
  });
  for (const [name, element] of [["v-btn", "button"], ["v-textarea", "textarea"], ["v-skeleton-loader", "div"]]) {
    app.component(name, passthroughComponent(element));
  }
  return renderToString(app);
}

describe("Preview project onboarding", () => {
  beforeEach(() => {
    mocks.resource = { data: Vue.ref(null), loadError: Vue.ref(""), reload: vi.fn() };
  });
  it("offers a starter only for empty projects and disables choices during source work", async () => {
    expect(await render("new")).toContain("Public starter");
    const busy = await render("new", { busy: true });
    expect(busy).toMatch(/disabled[^>]*><strong[^>]*>Public starter/u);
    expect(mocks.query.readQuery.value).toEqual({ sessionId: "session-a" });
  });
  it("asks an existing project's purpose and never renders stale seed offers", async () => {
    const html = await render("adoption");
    expect(html).toContain("Set up this existing project");
    expect(html).toContain("What is this project?");
    expect(html).toContain("Inspect it for me");
    expect(html).not.toContain("Public starter");
    expect(html).not.toContain("Normal outputs");
  });
  it("shows a concrete repair issue and lets ready projects use normal outputs", async () => {
    const attention = await render("attention");
    expect(attention).toContain("The project uses an older format.");
    expect(attention).not.toContain("Public starter");
    expect(await render("ready")).toContain("Normal outputs");
  });
  it("does not offer templates before inspection or for archived sessions", async () => {
    expect(await render(null)).not.toContain("Public starter");
    expect(await render("new", { archived: true })).toContain("Normal outputs");
    expect(mocks.query.enabled.value).toBe(false);
  });
});
