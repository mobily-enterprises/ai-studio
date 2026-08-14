import { describe, expect, it } from "vitest";
import { effectScope, reactive } from "vue";
import { mdiFileOutline, mdiRocketLaunchOutline, mdiWeb } from "@mdi/js";

import {
  useProjectTemplateSetup
} from "../../src/composables/useProjectTemplateSetup.js";

describe("useProjectTemplateSetup", () => {
  it("selects one template, emits apply, and disables changes while applying", () => {
    const props = reactive({
      applyingTemplateId: "",
      templates: [
        {
          icon: "blank",
          id: "genesis-blank",
          kind: "blank",
          name: "Blank project"
        },
        {
          icon: "web",
          id: "jskit-public",
          name: "Public"
        },
        {
          icon: "unknown",
          id: "jskit-example",
          name: "Example"
        }
      ]
    });
    const emitted = [];
    const scope = effectScope();
    let setup;
    scope.run(() => {
      setup = useProjectTemplateSetup(props, (event, payload) => emitted.push({
        event,
        payload
      }));
    });

    expect(setup.selectedTemplate.value).toBeNull();
    expect(setup.selectionHeading.value).toBe("Choose a starting point");
    expect(setup.templateIcon(props.templates[0])).toBe(mdiFileOutline);
    expect(setup.templateIcon(props.templates[1])).toBe(mdiWeb);
    expect(setup.templateIcon(props.templates[2])).toBe(mdiRocketLaunchOutline);

    setup.selectTemplate(props.templates[0]);
    expect(setup.selectedTemplate.value?.id).toBe("genesis-blank");
    expect(setup.selectionDescription.value).toContain("empty Git project");
    setup.applySelectedTemplate();
    expect(emitted).toEqual([
      {
        event: "apply",
        payload: "genesis-blank"
      }
    ]);

    props.applyingTemplateId = "genesis-blank";
    setup.selectTemplate(props.templates[1]);
    expect(setup.selectedTemplate.value?.id).toBe("genesis-blank");
    expect(setup.selectionHeading.value).toBe("Preparing Blank project…");
    expect(emitted).toHaveLength(1);

    scope.stop();
  });
});
