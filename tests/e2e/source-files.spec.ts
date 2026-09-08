import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { BASE_URL, DASHBOARD_PATH, directChatSessionId, directChatSessionPayload } from "./support/base-shell-data";
import { mockDirectChatSession } from "./support/base-shell-mocks";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

async function mockFiles(page) {
  const messages: object[] = [];
  await mockDirectChatSession(page);
  const session = {
    ...directChatSessionPayload,
    sourcePath: `/managed-source/sessions/active/${directChatSessionId}/source`,
    metadata: {
      source_path: `/managed-source/sessions/active/${directChatSessionId}/source`,
      source_kind: "session_clone",
      source_path_authority: "managed_session_source"
    }
  };
  await routeApiEndpoint(page, "/vibe64/sessions", (route) => fulfillJson(route, { ok: true, sessions: [session] }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}`, (route) => fulfillJson(route, session));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/agent-session`, (route) => fulfillJson(route, { ok: true, agentSession: session.agentSession }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/assistant-access`, (route) => fulfillJson(route, { ok: true, available: true, canUse: true }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/message-suggestions`, (route) => fulfillJson(route, { ok: true, suggestions: [] }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/update-check`, (route) => fulfillJson(route, { ok: true, status: "up-to-date" }));
  await routeApiEndpoint(page, "/vibe64/sessions/current", (route) => fulfillJson(route, { ok: true, sessionId: directChatSessionId }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/agent-message`, async (route) => {
    const body = route.request().postDataJSON();
    messages.push(body);
    return fulfillJson(route, { ok: true, delivered: true, messageId: body.messageId, sessionId: directChatSessionId });
  });
  const base = `/vibe64/sessions/${directChatSessionId}/source-editor`;
  const files = { "README.md": "# Hello\n", "notes.bin": Buffer.from([0, 255, 3]), "src/app.js": "export const ready = true;\n" };
  let stars = ["src/app.js", "deleted.md"];
  await routeApiEndpoint(page, base, async (route) => {
    const url = new URL(route.request().url());
    const operation = url.pathname.split("/").at(-1);
    if (operation === "stars") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        stars = body.starred ? [...new Set([...stars, body.path])] : stars.filter((file) => file !== body.path);
        return fulfillJson(route, { ok: true, paths: stars });
      }
      return fulfillJson(route, { ok: true, files: stars.map((path) => ({ path, available: path in files, reason: "Not found in this session" })) });
    }
    if (operation === "tree") {
      const directory = url.searchParams.get("path") || "";
      const entries = directory === "src" ? ["src/app.js"] : ["README.md", "notes.bin"];
      const children: object[] = entries.map((path) => ({ type: "file", name: path.split("/").at(-1), path }));
      if (!directory) children.push({ type: "directory", name: "src", path: "src", loaded: false, children: [] });
      return fulfillJson(route, { ok: true, policy: {}, tree: { type: "directory", name: directory, path: directory, loaded: true, children } });
    }
    if (operation === "file") {
      const path = url.searchParams.get("path") || "";
      if (route.request().method() !== "GET") {
        const body = route.request().postDataJSON();
        files[body.path] = body.text;
        return fulfillJson(route, { ok: true, file: { path: body.path, text: body.text, hash: `hash:${body.text}` } });
      }
      return fulfillJson(route, { ok: true, file: { path, text: String(files[path] || ""), hash: `hash:${files[path]}`, language: "javascript" } });
    }
    if (operation === "download") {
      const path = url.searchParams.get("path") || "";
      return route.fulfill({ body: Buffer.from(files[path]), contentType: "application/octet-stream", headers: { "content-disposition": "attachment; filename=notes.bin" } });
    }
    if (url.pathname.endsWith("changes/stream")) return route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
    return fulfillJson(route, { ok: true, files: [], results: [] });
  }, { children: true });
  return { messages };
}

test("download offers an explicit save choice and waits for that save", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await mockFiles(page);
  const saved = Promise.withResolvers<void>();
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/source-editor/file`, async (route) => {
    if (route.request().method() !== "GET") await saved.promise;
    return route.fallback();
  });
  try {
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/files`);
    const editor = page.getByLabel("Session source editor");
    await editor.locator(".vibe64-source-tree__button").filter({ hasText: "README.md" }).click();
    await expect(editor.locator(".cm-content")).toContainText("# Hello");
    await editor.locator(".cm-content").fill("# My draft\n");
    await editor.getByRole("button", { name: "Download file", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Download this file?", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Download saved file", exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Save & download", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
    saved.resolve();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("README.md");
    expect(await readFile((await download.path())!, "utf8")).toBe("# My draft\n");
  } finally { saved.resolve(); }
});

for (const width of [390, 900, 1600]) {
  test(`starred files open from chat and downloads preserve bytes at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const { messages } = await mockFiles(page);
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/files`);
    const editor = page.getByLabel("Session source editor");
    await expect(editor).toBeVisible();
    await editor.locator(".vibe64-source-tree__button").filter({ hasText: "README.md" }).click();
    await expect(editor.locator(".cm-content")).toContainText("# Hello");
    await editor.getByRole("button", { name: "Star file", exact: true }).click();
    await expect(editor.getByRole("button", { name: "Unstar file", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(editor.getByRole("list", { name: "Starred files" }).getByText("README.md", { exact: true })).toHaveCount(1);

    await editor.getByRole("button", { name: "Actions for notes.bin", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByText("Download file", { exact: true }).last().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("notes.bin");
    expect(await readFile((await download.path())!)).toEqual(Buffer.from([0, 255, 3]));

    // Compact screens retain chat behind the project pane; use the shell's back control.
    const showChat = page.getByRole("button", { name: "Show chat", exact: true });
    if (await showChat.isVisible()) await showChat.click();
    const picker = page.getByRole("button", { name: "Starred files (3)", exact: true });
    const composer = page.getByLabel("Message AI assistant");
    await composer.fill("Keep this draft while browsing files.");
    await picker.click();
    await expect(page.getByRole("textbox", { name: "Find a starred file", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Find a starred file", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(picker).toBeFocused();
    await picker.click();
    await expect(page.locator(".starred-files-menu").getByText("Not found in this session")).toBeVisible();
    await page.getByRole("textbox", { name: "Find a starred file", exact: true }).fill("app.js");
    await page.screenshot({ path: testInfo.outputPath(`starred-files-${width}.png`), animations: "disabled" });
    await page.getByRole("textbox", { name: "Find a starred file", exact: true }).press("Enter");
    await expect(editor).toBeVisible();
    await expect(editor.locator(".cm-content")).toContainText("export const ready = true;");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (await showChat.isVisible()) await showChat.click();
    await expect(composer).toHaveValue("Keep this draft while browsing files.");
    await composer.focus();
    await composer.press("Tab");
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(() => messages.length).toBe(1);
    await expect(composer).toHaveValue("");
    await page.reload();
    await expect(editor).toBeVisible();
    await expect(editor.locator(".vibe64-source-editor__starred").getByRole("button", { name: "Unstar README.md", exact: true })).toBeVisible();
  });
}
