import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "@vue/compiler-sfc";

function componentSource(file) {
  const source = readFileSync(file, "utf8");
  const parsed = parse(source, { filename: file });
  expect(parsed.errors).toEqual([]);
  return source;
}

describe("Env panel", () => {
  it("confirms before removing a user-owned Env value", () => {
    const source = componentSource("src/components/studio/EnvPanel.vue");

    expect(source).toContain("Remove Env value?");
    expect(source).toContain('@remove-record="requestRemoveRecord"');
    expect(source).toContain("async function confirmRemoveRecord()");
    expect(source).toMatch(/\[record\.key\]:\s*\{\s*remove:\s*true/u);
  });

  it("keeps Online database lifetime separate from application Env", () => {
    const envSource = componentSource("src/components/studio/EnvPanel.vue");
    const settingsSource = componentSource("src/components/studio/ProjectSettingsPanel.vue");

    expect(envSource).not.toContain("Development database");
    expect(settingsSource).toContain("A separate database for each session");
    expect(settingsSource).toContain("One database shared by this project");
    expect(settingsSource).toContain("not supplied to the application as an environment value");
    expect(settingsSource).not.toContain("NO_WORKTREE_DB");
  });

  it("uses a compact table without redundant source and status columns", () => {
    const source = componentSource("src/components/studio/RuntimeConfigRecordsTable.vue");

    expect(source).not.toContain("<th>Source</th>");
    expect(source).not.toContain("<th>Status</th>");
    expect(source).toMatch(/table-layout:\s*fixed/u);
    expect(source).toMatch(/grid-template-columns:\s*minmax\(7rem, 1fr\) auto auto/u);
  });

  it("keeps the dashboard rail compact", () => {
    const source = componentSource("src/components/SectionContainerShell.vue");

    expect(source).toContain("grid-template-columns: minmax(10rem, 11.5rem) minmax(0, 1fr)");
    expect(source).toContain("padding-left: 0.75rem");
  });
});
