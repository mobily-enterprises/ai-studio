import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const codexTerminalConsumerPath = path.resolve("src/components/studio/Vibe64CodexSession.vue");
const launchTerminalConsumerPath = path.resolve("src/components/studio/Vibe64LaunchControls.vue");
const launchTerminalStatePath = path.resolve("src/composables/useVibe64LaunchControls.js");
const providerTerminalConsumerPath = path.resolve(
  "packages/vibe64-accounts/src/client/studio/ProviderAccountsSetup.vue"
);

describe("Vibe64 terminal consumers", () => {
  it("keeps every visible PTY on the shared collapsed mobile-capable surface", () => {
    const codex = readFileSync(codexTerminalConsumerPath, "utf8");
    const launch = readFileSync(launchTerminalConsumerPath, "utf8");
    const launchState = readFileSync(launchTerminalStatePath, "utf8");
    const provider = readFileSync(providerTerminalConsumerPath, "utf8");

    expect(codex).toContain("const expanded = ref(false);");
    expect(codex).toContain("mobile-takeover");
    expect(codex).toContain(":stage=\"terminalSubtitle\"");
    expect(codex).toContain("show-copy");
    expect(codex).not.toContain(':loading="terminalStarting"');
    expect(codex).toContain(':aria-busy="terminalStarting ? \'true\' : undefined"');
    expect(codex).toContain('return "Starting Codex…";');
    expect(codex).toContain(":subtitle=\"expanded ? terminalSubtitle : ''\"");

    expect(launch).toContain('v-if="embeddedTerminalSurfaceVisible"');
    expect(launch).toContain('v-if="!embeddedPreview && terminalSurfaceVisible"');
    expect(launch.match(/<Vibe64Terminal/gu)).toHaveLength(2);
    expect(launch.match(/mobile-takeover/gu)).toHaveLength(2);
    expect(launch.match(/show-copy/gu)).toHaveLength(2);
    expect(launch.match(/@update:expanded="setTerminalExpanded"/gu)).toHaveLength(2);
    expect(launch).not.toContain("Show launch terminal");
    expect(launch.match(/:subtitle="terminalExpanded \? terminalSubtitle : ''"/gu)).toHaveLength(2);
    expect(launchState).toContain("terminalExpanded.value = false;");
    expect(launchState).not.toContain('launchTarget.defaultDisplay !== "minimized"');

    expect(provider).toContain(":expanded=\"authTerminalExpanded\"");
    expect(provider).toContain("mobile-takeover");
    expect(provider).toContain("show-copy");
    expect(provider).toContain(":stage=\"authTerminalStage\"");
    expect(provider).not.toContain(":loading=");
    expect(provider).not.toContain("<details");
    expect(provider).not.toContain("Show login output");
    expect(provider).not.toContain("View terminal");
    expect(provider).toContain('accountsLoading ? "Refreshing…" : "Refresh"');
    expect(provider).toContain('logoutAccountId === account.id ? "Logging out…" : "Logout"');
    expect(provider).toContain("logoutAccountId === account.id || !account.connected");
    expect(provider).toContain("Use this only if the login asks for terminal input.");
  });
});
