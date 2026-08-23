import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  PREVIEW_IDENTITIES_ENDPOINT,
  VIBE64_PREVIEW_IDENTITIES_API_SUFFIX,
  previewIdentitiesQueryKey
} from "../../src/lib/studioGateApi.js";

describe("managed app identity settings", () => {
  it("uses a project-scoped Vibe64 API rather than Env or Genesis", () => {
    expect(PREVIEW_IDENTITIES_ENDPOINT).toBe("/api/vibe64/preview-identities");
    expect(VIBE64_PREVIEW_IDENTITIES_API_SUFFIX).toBe("/vibe64/preview-identities");
    expect(previewIdentitiesQueryKey("app", "public", "books")).toEqual([
      "vibe64",
      "project",
      "books",
      "app",
      "public",
      "preview-identities"
    ]);
  });

  it("stores identities in the selected repository source through compact shared feedback", () => {
    const component = readFileSync(new URL(
      "../../src/components/studio/PreviewIdentitySettings.vue",
      import.meta.url
    ), "utf8");
    const page = readFileSync(new URL(
      "../../src/pages/app/project/[slug]/dashboard/access/index.vue",
      import.meta.url
    ), "utf8");

    expect(component).toContain("Managed app identities");
    expect(component).toContain("Add identity");
    expect(component).toContain("Make default");
    expect(component).toContain("Remove");
    expect(component).toContain("label=\"App identifier\"");
    expect(component).toContain("label=\"Application value\"");
    expect(component).toContain("PREVIEW_IDENTITIES_ENDPOINT");
    expect(component).toContain("useVibe64SessionSelection");
    expect(component).toContain("selectedSessionId.value || \"baseline\"");
    expect(component).toContain("{ sessionId: selectedSessionId.value }");
    expect(component).toContain(".vibe64/preview-identities.json");
    expect(component).toContain("not passwords or authentication secrets");
    expect(component).toContain("saving ? \"Saving…\" : \"Save\"");
    for (const button of component.matchAll(/<v-btn[\s\S]*?<\/v-btn>/gu)) {
      expect(button[0]).not.toContain(":loading=");
    }
    expect(component).not.toContain("v-if=\"saveError\"");
    expect(component).not.toContain("only in Vibe64 project state");
    expect(component).not.toContain("ENV_");
    expect(component).not.toContain("genesis");
    expect(page).toContain("<PreviewIdentitySettings />");
  });
});
