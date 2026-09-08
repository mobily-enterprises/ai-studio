import { denseErdSchema } from "../fixtures/denseErdSchema.js";
import { createServer } from "node:http";
import { once } from "node:events";
import { expect, test, type Page } from "@playwright/test";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { RealtimeProvider } from "@jskit-ai/realtime/server/RealtimeProvider";
import { createService } from "../../packages/vibe64-database-tools/src/server/service.js";
import { createDatabaseLayoutChangedPublisher } from "../../packages/vibe64-database-tools/src/server/events.js";
import { saveErdLayout } from "../../packages/vibe64-database-tools/src/server/sessionState.js";
import { mockDirectChatSession } from "./support/base-shell-mocks";
import { DASHBOARD_PATH, directChatSessionId, directChatSessionPayload } from "./support/base-shell-data";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

// Real database service, shared artifact operations, event provider and sockets.
// Only the schema/SQL data and unrelated Studio shell are controlled fixtures.
async function sharedDiagramServer(frontend: string, { largeTable = false, schemaOverride = null, savedLayout = null } = {}) {
  const schema = schemaOverride || {
    engine: "postgresql", database: "erd_test", refreshedAt: "2026-09-07T00:00:00Z",
    schemas: [{ name: "public" }], relationships: largeTable ? [{
      id: "orders_jobs", constraintName: "orders_jobs_fk", columns: ["job_id"],
      referencedColumns: ["id"], referencedTable: "public.Jobs", sourceTable: "public.orders"
    }] : [],
    tables: ["customers", "orders", ...(largeTable ? ["Jobs"] : [])].map((name) => ({
      name, schema: "public", qualifiedName: `public.${name}`, kind: "table",
      columns: [
        { name: "id", nativeType: "integer", nullable: false },
        ...(name === "Jobs" ? Array.from({ length: 314 }, (_, index) => ({ name: `field_${index + 1}`, nativeType: "text", nullable: true })) : []),
        ...(largeTable && name === "orders" ? [{ name: "job_id", nativeType: "integer", nullable: false }] : [])
      ],
      keys: [{ name: `${name}_pkey`, columns: ["id"], primary: true }]
    }))
  };
  const artifacts = new Map();
  const store = {
    readSession: async (sessionId: string) => ({ sessionId, projectSlug: "example-target-app" }),
    readArtifact: async (sessionId: string, path: string) => path === "database/schema.json"
      ? JSON.stringify(schema) : artifacts.get(`${sessionId}:${path}`) || "",
    writeJsonArtifact: async (sessionId: string, path: string, value: unknown) => {
      artifacts.set(`${sessionId}:${path}`, JSON.stringify(value));
    }
  };
  await saveErdLayout(store, directChatSessionId, savedLayout || {
    nodes: [
      { table: "public.customers", x: 50, y: largeTable ? 350 : 50 }, { table: "public.orders", x: 450, y: 50 },
      ...(largeTable ? [{ table: "public.Jobs", x: 50, y: 50 }] : [])
    ],
    viewport: { x: 20, y: 20, zoom: 0.7 }
  });
  let service;
  const saves: { actor: string; layout: unknown }[] = [];
  const reads: string[] = [];
  const http = createServer(async (request, response) => {
    try {
      const url = new URL(request.url!, frontend);
      const match = url.pathname.match(/\/database\/sessions\/([^/]+)(.*)$/u);
      if (match) {
        const actor = String(request.headers["x-erd-user"] || "alice");
        const input = { sessionId: match[1], vibe64User: { username: actor, role: "owner" } };
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        let result;
        if (request.method === "PUT" && match[2] === "/layout") {
          result = await service.saveLayout({ ...input, ...body });
          saves.push({ actor, layout: result.layout });
        } else if (request.method === "GET" && !match[2]) {
          reads.push(actor);
          result = await service.readState(input);
        } else if (match[2] === "/queries") {
          result = { ok: true, kind: "result-set", columns: [], rows: [], cellMeta: [], durationMs: 0 };
        } else {
          throw new Error(`Unexpected database request: ${request.method} ${url.pathname}`);
        }
        response.writeHead(result.ok === false ? 400 : 200, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
        return;
      }
      const upstream = await fetch(url);
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "text/plain" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: String(error) }));
    }
  });
  let realtime;
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.config": {}, "runtime.env": {}, "runtime.fastify": { server: http },
      "runtime.logger": { debug() {}, warn() {}, info() {}, error() {} }
    },
    providers: [EventProvider, RealtimeProvider, defineProvider({
      id: "test.database", requires: { events: "runtime.events", realtime: "runtime.realtime" },
      setup(values) {
        realtime = values.realtime;
        service = createService({
          projectService: {
            createSessionStore: async () => store,
            sessionDatabaseEnvironment: async () => ({ databaseToolEnvironment: {
              contract: "vibe64.database-tool-environment.v1", kind: schema.engine,
              read: { host: "127.0.0.1", port: 5432, database: schema.database, username: "reader" },
              write: { host: "127.0.0.1", port: 5432, database: schema.database, username: "writer" }
            } })
          },
          publishLayoutChanged: createDatabaseLayoutChangedPublisher(values.events),
          withKnex: () => { throw new Error("Layout synchronization must not execute SQL"); }
        });
        return {};
      }
    })]
  });
  await runtime.start();
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`, saves, reads,
    clients: () => realtime.diagnostics().connectedClients,
    close: () => runtime.shutdown()
  };
}

async function openDiagram(page: Page, url: string, { waitForReady = true } = {}) {
  await mockDirectChatSession(page);
  const sourcePath = `/workspace/managed/example-target-app/sessions/active/${directChatSessionId}/source`;
  const session = { ...directChatSessionPayload, sourcePath, metadata: {
    source_kind: "session_clone", source_path: sourcePath,
    source_path_authority: "managed_session_source"
  } };
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}`, (route) => fulfillJson(route, session));
  await routeApiEndpoint(page, "/vibe64/sessions", (route) => fulfillJson(route, { ok: true, sessions: [session] }));
  await routeApiEndpoint(page, "/vibe64/sessions/current", (route) => fulfillJson(route, { ok: true, sessionId: directChatSessionId }));
  await page.goto(`${url}${DASHBOARD_PATH}/database?sessionId=${directChatSessionId}`);
  await page.getByRole("button", { name: "ERD", exact: true }).click({ timeout: 15_000 });
  if (!waitForReady) return;
  await expect(page.locator('.vue-flow__node[data-id="public.customers"]')).toBeVisible();
  await expect(page.getByText("Arranging tables…", { exact: true })).toHaveCount(0);
}

async function dragTable(page: Page, name: string, dx: number, dy: number) {
  const card = page.locator(`.vue-flow__node[data-id="public.${name}"]`);
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 18);
  await page.mouse.down();
  await page.mouse.move(box.x + 80 + dx, box.y + 18 + dy, { steps: 8 });
  await page.mouse.up();
}

test("shared ERD moves reach another browser without reloads or echo saves", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!);
  const alice = await browser.newContext({ viewport: { width: 1600, height: 1000 }, extraHTTPHeaders: { "x-erd-user": "alice" } });
  const bob = await browser.newContext({ viewport: { width: 1600, height: 1000 }, extraHTTPHeaders: { "x-erd-user": "bob" } });
  try {
    const first = await alice.newPage();
    const second = await bob.newPage();
    await openDiagram(first, server.url);
    await openDiagram(second, server.url);
    await expect.poll(server.clients).toBe(2);
    const customers = '.vue-flow__node[data-id="public.customers"]';
    const orders = '.vue-flow__node[data-id="public.orders"]';
    const position = (page: Page, selector: string) => page.locator(selector).evaluate((node: HTMLElement) => node.style.transform);
    const original = await position(second, customers);
    const camera = await second.locator(".vue-flow__transformationpane").getAttribute("style");
    const startSaves = server.saves.length;
    await dragTable(first, "customers", 100, 90);
    await expect.poll(() => server.saves.length).toBe(startSaves + 1);
    await expect.poll(() => position(second, customers)).not.toBe(original);
    await expect.poll(() => position(second, customers)).toBe(await position(first, customers));
    expect(await second.locator(".vue-flow__transformationpane").getAttribute("style")).toBe(camera);
    expect(server.saves.at(-1)!.actor).toBe("alice");

    await dragTable(second, "orders", -70, 130);
    await expect.poll(() => server.saves.length).toBe(startSaves + 2);
    await expect.poll(() => position(first, orders)).toBe(await position(second, orders));
    expect(server.saves.at(-1)!.actor).toBe("bob");
    const saved = await position(first, orders);
    await second.reload();
    await second.getByRole("button", { name: "ERD", exact: true }).click();
    await expect.poll(() => position(second, orders)).toBe(saved);
    expect(server.saves).toHaveLength(startSaves + 2);

    await first.getByRole("tab", { name: "Preview", exact: true }).click();
    const hiddenReads = server.reads.filter((actor) => actor === "alice").length;
    await dragTable(second, "customers", 40, 35);
    await expect.poll(() => server.saves.length).toBe(startSaves + 3);
    expect(server.reads.filter((actor) => actor === "alice")).toHaveLength(hiddenReads);
    await first.getByRole("tab", { name: "Dashboard", exact: true }).click();
    await expect.poll(() => position(first, customers)).toBe(await position(second, customers));
    expect(server.saves).toHaveLength(startSaves + 3);

    await second.getByRole("button", { name: "Reset positions", exact: true }).click();
    await expect.poll(() => server.saves.length).toBe(startSaves + 4);
    await expect.poll(() => position(first, customers)).toBe(await position(second, customers));
    await expect.poll(() => position(first, orders)).toBe(await position(second, orders));
    const card = (await first.locator(customers).boundingBox())!;
    await first.mouse.move(card.x + 80, card.y + 18);
    await first.mouse.down();
    await first.mouse.move(card.x + 120, card.y + 65, { steps: 6 });
    const remoteRead = first.waitForResponse((response) => response.request().method() === "GET" &&
      response.url().endsWith(`/database/sessions/${directChatSessionId}`), { timeout: 10_000 });
    await dragTable(second, "orders", 60, 25);
    await (await remoteRead).json();
    await first.evaluate(() => new Promise(requestAnimationFrame));
    await first.mouse.up();
    await expect.poll(() => server.saves.length).toBe(startSaves + 6);
    await expect.poll(() => position(first, orders)).toBe(await position(second, orders));
    await expect.poll(() => position(second, customers)).toBe(await position(first, customers));
  } finally {
    await Promise.allSettled([alice.close(), bob.close()]);
    await server.close();
  }
});

for (const width of [390, 960, 1600]) {
  test(`showing 315 fields preserves every table position and the camera at ${width}px`, async ({ browser, baseURL }) => {
    const server = await sharedDiagramServer(baseURL!, { largeTable: true });
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      await openDiagram(page, server.url);
      const jobs = page.locator('.vue-flow__node[data-id="public.Jobs"]');
      const positions = () => page.locator(".vue-flow__node").evaluateAll((nodes: HTMLElement[]) =>
        nodes.map((node) => ({ id: node.dataset.id, position: node.style.transform })));
      const initialPositions = await positions();
      const camera = page.locator(".vue-flow__transformationpane");
      const initialCamera = await camera.getAttribute("style");
      const initialSaves = server.saves.length;
      await expect(jobs.locator("[data-column]")).toHaveCount(1);

      await page.getByRole("button", { name: "All columns", exact: true }).click();
      await expect(jobs.locator("[data-column]")).toHaveCount(315);
      await expect.poll(() => server.saves.length).toBe(initialSaves + 1);
      expect(await positions()).toEqual(initialPositions);
      expect(await camera.getAttribute("style")).toBe(initialCamera);

      await page.getByRole("button", { name: "Keys only", exact: true }).first().click();
      await expect(jobs.locator("[data-column]")).toHaveCount(1);
      await jobs.getByRole("button", { name: "Show all 315", exact: true }).click();
      await expect(jobs.locator("[data-column]")).toHaveCount(315);
      await expect.poll(() => server.saves.length).toBe(initialSaves + 3);
      expect(await positions()).toEqual(initialPositions);
      expect(await camera.getAttribute("style")).toBe(initialCamera);

      await jobs.getByRole("button", { name: "Collapse table", exact: true }).click();
      await expect(jobs.locator("[data-column]")).toHaveCount(0);
      await jobs.getByRole("button", { name: "Expand table", exact: true }).click();
      await expect(jobs.locator("[data-column]")).toHaveCount(315);
      await expect.poll(() => server.saves.length).toBe(initialSaves + 5);
      expect(await positions()).toEqual(initialPositions);
      expect(await camera.getAttribute("style")).toBe(initialCamera);

      await page.getByRole("button", { name: "Reset positions", exact: true }).click();
      await expect.poll(() => server.saves.length).toBe(initialSaves + 6);
      expect(await positions()).not.toEqual(initialPositions);
      await expect(jobs.locator("[data-column]")).toHaveCount(315);
    } finally {
      await context.close();
      await server.close();
    }
  });
}


for (const saved of [false, true]) {
  test(`@erd-dense 130 tables and 479 links remain usable with ${saved ? "saved" : "new"} positions`, async ({ browser, baseURL }) => {
    const schema = denseErdSchema();
    const savedNodes = saved ? schema.tables.slice(0, 126).map((table, index) => ({
      table: table.qualifiedName, x: index % 10 * 420, y: Math.floor(index / 10) * 360
    })) : [];
    const server = await sharedDiagramServer(baseURL!, { schemaOverride: schema, savedLayout: {
      nodes: savedNodes, viewport: { x: 20, y: 20, zoom: 0.3 }
    } });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        (window as any).erdRoutingRequests = 0;
        window.Worker = class extends NativeWorker {
          postMessage(message: any, ...args: any[]) {
            if (message?.kind === "routes") (window as any).erdRoutingRequests += 1;
            super.postMessage(message, ...args);
          }
        };
      });
      await openDiagram(page, server.url, { waitForReady: false });
      await expect.poll(() => page.evaluate(() => (window as any).erdRoutingRequests)).toBeGreaterThan(0);
      const started = Date.now();
      const search = page.getByRole("combobox", { name: "Find table or column" });
      await search.fill("table_1");
      expect(Date.now() - started).toBeLessThan(1500);
      await search.press("Escape");
      await expect(page.locator(".vue-flow__node")).toHaveCount(130, { timeout: 15_000 });
      await expect(page.locator(".vue-flow__edge")).toHaveCount(479, { timeout: 15_000 });
      const reset = page.getByRole("button", { name: "Reset positions", exact: true });
      await expect(reset).toBeEnabled({ timeout: 15_000 });
      await expect.poll(() => server.saves.length).toBe(1);
      const positions = () => page.locator(".vue-flow__node").evaluateAll((nodes: HTMLElement[]) => nodes.map(node => ({ id: node.dataset.id, position: node.style.transform })));
      const initial = await positions();
      if (saved) {
        const persisted = new Map((server.saves[0].layout as any).nodes.map(node => [node.table, node]));
        for (const node of savedNodes) expect(persisted.get(node.table)).toMatchObject({ x: node.x, y: node.y });
      }
      await page.getByRole("button", { name: "All columns", exact: true }).click();
      await expect.poll(() => server.saves.length).toBe(2);
      expect(await positions()).toEqual(initial);
      await expect(page.locator(".vue-flow__edge")).toHaveCount(479);
      await page.getByRole("button", { name: "Keys only", exact: true }).first().click();
      await expect.poll(() => server.saves.length).toBe(3);
      await reset.click();
      // Leave while the worker is active, then return using the warm workspace.
      await page.getByRole("button", { name: "Data", exact: true }).click();
      await page.getByRole("button", { name: "ERD", exact: true }).click();
      await expect(reset).toBeEnabled({ timeout: 15_000 });
      await expect(page.locator(".vue-flow__edge")).toHaveCount(479);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await server.close();
    }
  });
}

test("@erd-dense routing worker errors leave an actionable retry and recover", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      let failed = false;
      window.Worker = class extends NativeWorker {
        postMessage(message: any, ...args: any[]) {
          if (message?.kind === "routes" && !failed) {
            failed = true;
            setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: { id: message.id, ok: false, error: "Routing worker unavailable" } })), 30);
            return;
          }
          super.postMessage(message, ...args);
        }
      };
    });
    await openDiagram(page, server.url, { waitForReady: false });
    await expect(page.locator('.database-erd__notice[role="alert"]')).toContainText("Routing worker unavailable");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator('.database-erd__notice[role="alert"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reset positions", exact: true })).toBeEnabled();
    await expect(page.locator(".vue-flow__node")).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await server.close();
  }
});
