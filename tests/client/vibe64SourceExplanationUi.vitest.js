import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("source explanation Material interaction", () => {
  it("uses a stable pending action instead of a loading spinner", () => {
    const editor = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue",
      import.meta.url
    ), "utf8");
    const explainButton = editor.match(
      /<v-btn\s+class="vibe64-source-editor__explain-button"[\s\S]*?<\/v-btn>/u
    )?.[0] || "";

    expect(explainButton).toContain(":aria-busy=");
    expect(explainButton).toContain("!assistantAvailable");
    expect(explainButton).toContain("assistantUnavailableMessage");
    expect(explainButton).toContain("Working…");
    expect(explainButton).not.toContain(":loading=");
    expect(editor).toContain("min-inline-size: 6.25rem");
  });

  it("honors reduced-motion preferences for the thinking status", () => {
    const panel = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue",
      import.meta.url
    ), "utf8");

    expect(panel).toContain("@media (prefers-reduced-motion: reduce)");
    expect(panel).toContain("animation: none");
  });

  it("keeps every icon-only explanation action explicitly named", () => {
    const panel = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue",
      import.meta.url
    ), "utf8");

    expect(panel).toContain('aria-label="Close explanation"');
    expect(panel.match(/aria-label="Stop explanation"/gu)).toHaveLength(2);
    expect(panel).toContain('aria-label="Send follow-up"');
    expect(panel).toContain('aria-label="Collapse explanation"');
    expect(panel).toContain(".vibe64-source-explanation__action-target");
    expect(panel).toContain("min-block-size: 3rem");
    expect(panel).toContain("min-inline-size: 3rem");
  });

  it("keeps cancellation available throughout a busy follow-up", () => {
    const panel = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue",
      import.meta.url
    ), "utf8");
    const followupFooter = panel.match(
      /<div class="vibe64-source-explanation__followup-footer">[\s\S]*?<\/div>/u
    )?.[0] || "";

    expect(followupFooter).toContain('v-if="busy"');
    expect(followupFooter).toContain('aria-label="Stop explanation"');
    expect(followupFooter).toContain("!assistantAvailable");
    expect(followupFooter).not.toContain('v-if="thinking"');
  });

  it("keeps existing explanations readable while disabling new AI work", () => {
    const editor = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue",
      import.meta.url
    ), "utf8");
    const panel = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue",
      import.meta.url
    ), "utf8");

    expect(editor).toContain(':assistant-available="assistantAvailable"');
    expect(editor).toContain("if (!props.assistantAvailable)");
    expect(panel).toContain(':disabled="busy || !assistantAvailable"');
    expect(panel).toContain(':disabled="!followup.trim() || busy || !assistantAvailable"');
    expect(panel).not.toContain('v-if="assistantAvailable" class="vibe64-source-explanation__thread"');
  });

  it("restores focus when the explanation is collapsed, expanded, or closed", () => {
    const editor = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SessionSourceEditor.vue",
      import.meta.url
    ), "utf8");
    const panel = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SourceExplanationPanel.vue",
      import.meta.url
    ), "utf8");

    expect(editor).toContain('ref="sourceEditorElement"');
    expect(editor).toContain('@close="closeExplanationPanel"');
    expect(editor).toContain("explanationFocusTimer = setTimeout(() =>");
    expect(editor).toContain("clearTimeout(explanationFocusTimer)");
    expect(editor).toContain("sourceEditorUnmounted = true");
    expect(editor).toContain('focusAfterLayout(rootElement, ".vibe64-source-editor__side-rail--right")');
    expect(editor).toContain('focusAfterLayout(rootElement, ".vibe64-source-explanation__range")');
    expect(editor).toContain('focusAfterLayout(rootElement, ".vibe64-source-editor__explain-button")');
    expect(panel).toContain("emit('collapse', $event)");
    expect(panel).toContain("emit('close', $event)");
    expect(panel).toContain('tabindex="0"');
    expect(panel).toContain(".vibe64-source-explanation__thread:focus-visible");
  });
});
