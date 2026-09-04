import { readFile } from "node:fs/promises";

import { html as renderDiffHtml } from "diff2html";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

describe("Vibe64 Repository workspace", () => {
  it("renders hostile Git patch text as text instead of executable markup", () => {
    const patch = [
      "diff --git a/evil.txt b/evil.txt",
      "index 1111111..2222222 100644",
      "--- a/evil.txt",
      "+++ b/evil.txt",
      "@@ -1 +1 @@",
      "-safe",
      "+<script>globalThis.pwned=true</script>",
      ""
    ].join("\n");
    const rendered = renderDiffHtml(patch, { drawFileList: false });

    expect(rendered).not.toContain("<script>");
    expect(rendered).toContain("&lt;script&gt;");
  });

  it("owns separate session routes for Current changes and Repository history", async () => {
    const [placement, changesPage, repositoryPage, toolDefinitions, autopilotView] = await Promise.all([
      source("src/placement.js"),
      source("src/pages/app/project/[slug]/dashboard/changes/index.vue"),
      source("src/pages/app/project/[slug]/dashboard/repository/index.vue"),
      source("src/lib/vibe64SessionToolDefinitions.js"),
      source("src/components/studio/vibe64-session/Vibe64AutopilotView.vue")
    ]);
    const production = [placement, changesPage, repositoryPage, toolDefinitions, autopilotView].join("\n");

    expect(production.match(/label:\s*"Repository"/gu)).toHaveLength(1);
    expect(production.match(/label:\s*"Current changes"/gu)).toHaveLength(1);
    expect(changesPage).toContain('view="changes"');
    expect(repositoryPage).toContain("Vibe64RepositoryWorkspace");
    expect(repositoryPage).toContain('view="history"');
    expect(production).not.toMatch(/dashboard\/diff|Vibe64SessionDiff|useVibe64DiffDialog/u);
  });

  it("exposes repository conflict recovery only through the existing Temporary AI workspace", async () => {
    const [repositoryWorkspace, autopilotView] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/components/studio/vibe64-session/Vibe64AutopilotView.vue")
    ]);

    expect(repositoryWorkspace).toContain("Vibe64TemporaryAiFixAction");
    expect(repositoryWorkspace).toContain(':disabled="resolvingUpdateProblem || dashboard.assistantDirectAllowed === false"');
    expect(repositoryWorkspace).toContain("dashboard.assistantRestrictionMessage");
    expect(repositoryWorkspace).not.toMatch(/resolve conflict manually|accept incoming|accept current/iu);
    expect(autopilotView).toContain("requestTemporaryAi: fixRepositoryError");
    expect(autopilotView).toContain("workspace.startTask(options)");
    expect(autopilotView).toContain('emit("chat-attention")');
  });

  it("disables AI-backed Save for restricted members without restricting native Update", async () => {
    const [repositoryWorkspace, repositoryComposable] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/composables/useVibe64RepositoryWorkspace.js")
    ]);

    expect(repositoryWorkspace).toContain("dashboard.value.assistantDirectAllowed === false");
    expect(repositoryWorkspace).toContain("return dashboard.value.assistantRestrictionMessage");
    expect(repositoryComposable).toContain("context.value.assistantDirectAllowed === false");
    expect(repositoryWorkspace).toContain(':disabled="repositoryOperationBusy"');
    expect(repositoryWorkspace).not.toContain('assistantDirectAllowed === false || repositoryOperationBusy');
  });

  it("renders current changes and version history as separate session destinations", async () => {
    const repositoryWorkspace = await source(
      "src/components/studio/repository/Vibe64RepositoryWorkspace.vue"
    );

    expect(repositoryWorkspace).toContain("view === 'changes'");
    expect(repositoryWorkspace).toContain("view === 'history'");
    expect(repositoryWorkspace).not.toContain("<v-tabs");
    expect(repositoryWorkspace).not.toContain('<slot name="settings"');
    expect(repositoryWorkspace).not.toContain('<slot name="access"');
    expect(repositoryWorkspace).not.toContain('value="settings"');
    expect(repositoryWorkspace).not.toContain('value="access"');
  });

  it("states the exact saved update count instead of relying on an enabled action", async () => {
    const [repositoryWorkspace, repositoryComposable] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/composables/useVibe64RepositoryWorkspace.js")
    ]);

    expect(repositoryWorkspace).toContain("repositoryUpdateTitle");
    expect(repositoryWorkspace).toContain('behind === 1 ? "update" : "updates"');
    expect(repositoryWorkspace).toContain("saved ${behind === 1 ? \"version\" : \"versions\"} behind");
    expect(repositoryWorkspace).toContain("This session and the saved project have both changed");
    expect(repositoryWorkspace).toContain("Someone saved new project work after this session started");
    expect(repositoryWorkspace).toContain("Saved versions this session needs");
    expect(repositoryWorkspace).toContain("repositoryIncomingVersions");
    expect(repositoryWorkspace.match(/Update this session \(rebase\)/gu)).toHaveLength(7);
    expect(repositoryWorkspace).toContain("replay its unsaved work on the latest saved version");
    expect(repositoryWorkspace).toContain("will move it to the latest saved version");
    expect(repositoryWorkspace).toContain('changes.payload?.unsaved === true');
    expect(repositoryWorkspace).not.toContain("Your current work is preserved when you update");
    expect(repositoryWorkspace).toContain("Last checked");
    expect(repositoryComposable).toContain("result.updateCheck");
    expect(repositoryComposable).toContain("cached: true");
    expect(repositoryWorkspace).toContain('aria-live="polite"');
    expect(repositoryWorkspace).toContain('role="status"');
    expect(repositoryWorkspace.match(/Check for updates/gu)).toHaveLength(3);
    expect(repositoryWorkspace).not.toContain(">\n          Refresh\n");
    expect(repositoryWorkspace).not.toContain("mdiRefresh");
  });

  it("renders saved versions as an accessible Git log and opens details in a full-screen dialog", async () => {
    const [repositoryWorkspace, repositoryComposable] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/composables/useVibe64RepositoryWorkspace.js")
    ]);

    expect(repositoryWorkspace).toContain("Saved versions");
    expect(repositoryWorkspace).toContain("vibe64-repository-workspace__commit-marker");
    expect(repositoryWorkspace).toContain("version.isMerge ? mdiSourceMerge : mdiSourceCommit");
    expect(repositoryWorkspace).toContain("Latest");
    expect(repositoryWorkspace).toContain(":aria-label=\"versionButtonLabel(version, index)\"");
    expect(repositoryWorkspace).toContain("@click=\"openVersion(version)\"");
    expect(repositoryWorkspace).toContain("dialog-bottom-transition");
    expect(repositoryWorkspace).toContain("Close version details");
    expect(repositoryWorkspace).toContain("fullscreen");
    expect(repositoryWorkspace).not.toContain("location=\"right\"");
    expect(repositoryWorkspace).not.toContain("max-width=\"70rem\"");
    expect(repositoryWorkspace).toContain("versionFileCountLabel");
    expect(repositoryWorkspace).toContain("vibe64-repository-version-dialog__eyebrow");
    expect(repositoryWorkspace).not.toContain("vibe64-repository-workspace__version-detail");
    expect(repositoryComposable).not.toContain("await selectVersion(history.versions[0])");
  });

  it("uses the available width for file lists and their selected difference", async () => {
    const [repositoryWorkspace, fileBrowser] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/components/studio/repository/Vibe64RepositoryFileBrowser.vue")
    ]);

    expect(repositoryWorkspace.match(/<Vibe64RepositoryFileBrowser/gu)).toHaveLength(2);
    expect(fileBrowser).toMatch(
      /\.vibe64-repository-file-browser \{[\s\S]*?grid-template-columns: minmax\(16rem, 21rem\) minmax\(0, 1fr\);/u
    );
    expect(fileBrowser).toContain("vibe64-repository-file-browser--embedded");
    expect(repositoryWorkspace).toContain("width: 100vw;");
    expect(repositoryWorkspace).toContain("height: 100dvh;");
    expect(fileBrowser).toContain("height: 100%;");
  });

  it("uses one file-browser implementation for current and historical changes", async () => {
    const [repositoryWorkspace, repositoryComposable, fileBrowser] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/composables/useVibe64RepositoryWorkspace.js"),
      source("src/components/studio/repository/Vibe64RepositoryFileBrowser.vue")
    ]);

    expect(repositoryWorkspace.match(/<Vibe64RepositoryFileBrowser/gu)).toHaveLength(2);
    expect(repositoryWorkspace).not.toContain("repositoryFileStatusLabel");
    expect(repositoryComposable).not.toContain("repositoryFileStatusLabel");
    expect(fileBrowser.match(/function fileStatusLabel/gu)).toHaveLength(1);
  });

  it("does not describe a clean but outdated session as matching the saved project", async () => {
    const [repositoryWorkspace, repositoryComposable, autopilotView, runtimeHost] = await Promise.all([
      source("src/components/studio/repository/Vibe64RepositoryWorkspace.vue"),
      source("src/composables/useVibe64RepositoryWorkspace.js"),
      source("src/composables/useVibe64AutopilotView.js"),
      source("src/components/studio/vibe64-session/Vibe64SessionRuntimeHost.vue")
    ]);

    expect(repositoryWorkspace).toContain("No unsaved file changes");
    expect(repositoryWorkspace).toContain("no file changes waiting to be saved");
    expect(repositoryWorkspace).not.toContain("This session matches the project’s saved version");
    expect(repositoryComposable).toContain('typeof context.value.refreshSessionWork === "function"');
    expect(repositoryComposable).toContain("delete observedWork.initialDiff");
    expect(repositoryComposable).toContain("await context.value.refreshSessionWork(observedWork)");
    expect(autopilotView).toContain("refreshSessionWork: props.refreshSessionWork");
    expect(runtimeHost).toContain(':refresh-session-work="refreshWorkState"');
  });

  it("uses mutually exclusive full-width panes on mobile", async () => {
    const autopilotView = await source(
      "src/components/studio/vibe64-session/Vibe64AutopilotView.vue"
    );

    expect(autopilotView).toContain("@media (max-width: 980px)");
    expect(autopilotView).toMatch(
      /\.studio-autopilot:not\(\.studio-autopilot--chat-collapsed\) \{\s*grid-template-columns: minmax\(0, 1fr\) 0;/u
    );
    expect(autopilotView).toMatch(
      /\.studio-autopilot:not\(\.studio-autopilot--chat-collapsed\) \.studio-autopilot__project-panel \{\s*visibility: hidden;/u
    );
  });
});
