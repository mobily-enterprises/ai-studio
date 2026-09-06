import { readFileSync } from "node:fs";

import { compile } from "@vue/compiler-dom";
import { parse } from "@vue/compiler-sfc";
import { describe, expect, it } from "vitest";

const componentPath = new URL(
  "../../packages/vibe64-database-tools/src/client/components/DatabaseErd.vue",
  import.meta.url
);
const nodePath = new URL(
  "../../packages/vibe64-database-tools/src/client/components/DatabaseErdNode.vue",
  import.meta.url
);
const componentSource = readFileSync(componentPath, "utf8");
const nodeSource = readFileSync(nodePath, "utf8");
const { descriptor } = parse(componentSource, { filename: componentPath.pathname });

describe("Database ERD fullscreen controls", () => {
  it("keeps one compact action row without explanatory copy", () => {
    const template = descriptor.template.content;

    expect(() => compile(template, { mode: "module" })).not.toThrow();
    expect(template).not.toContain("Entity relationship diagram");
    expect(template).not.toContain("Arrows run 1 → N");
    expect(template).toContain('class="database-erd__toolbar-actions"');
    expect(template.indexOf("Fit")).toBeLessThan(template.indexOf("Reset positions"));
    expect(template.indexOf("Reset positions")).toBeLessThan(template.indexOf("Full screen"));
  });

  it("uses native fullscreen and removes controls from the fullscreen diagram", () => {
    expect(componentSource).toContain("requestFullscreen()");
    expect(componentSource).toContain('addEventListener("fullscreenchange", onFullscreenChange)');
    expect(componentSource).toContain('removeEventListener("fullscreenchange", onFullscreenChange)');
    expect(componentSource).toContain("globalThis.requestAnimationFrame(fitDiagram)");
    expect(componentSource).toContain('v-if="!fullscreen"');
    expect(componentSource).toContain(':controls-visible="!fullscreen"');
    expect(nodeSource).toContain('v-if="controlsVisible"');
    expect(nodeSource).toContain(':position="port.position"');
    expect(nodeSource).toContain(':type="port.type"');
  });
});

describe("Database ERD dragging", () => {
  it("re-routes relationship lines while a table moves", () => {
    expect(componentSource).toContain('@node-drag="onNodeDrag"');
    expect(componentSource).toMatch(
      /function onNodeDrag\(\)[\s\S]*requestAnimationFrame[\s\S]*relationshipGraph\(nodes\.value\)[\s\S]*edges\.value = graph\.edges/u
    );
    expect(componentSource).toMatch(
      /function onNodeDragStop\(\)[\s\S]*cancelAnimationFrame[\s\S]*relationshipGraph\(nodes\.value\)[\s\S]*persistPositions\(\)/u
    );
  });
});
