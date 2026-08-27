import { expect, test } from "@playwright/test";

import {
  DEVELOPMENT_PATH,
  directChatSessionId,
  directChatSessionPayload
} from "./support/base-shell-data";
import {
  mockDirectChatSession
} from "./support/base-shell-mocks";
import {
  apiEndpointPattern,
  fulfillJson,
  routeApiEndpoint
} from "./support/base-shell/http";

const sessionApi = `/vibe64/system-graph/sessions/${directChatSessionId}`;
const systemWorldSourcePath = `/var/lib/vibe64/test/projects/example/sessions/active/${directChatSessionId}/source`;
const systemWorldSessionPayload = {
  ...directChatSessionPayload,
  agentSession: {
    ...directChatSessionPayload.agentSession,
    workdir: systemWorldSourcePath
  },
  metadata: {
    ...directChatSessionPayload.metadata,
    source_kind: "session_clone",
    source_path: systemWorldSourcePath,
    source_path_authority: "managed_session_source"
  },
  sourcePath: systemWorldSourcePath,
  sourceReady: true
};

const machineCity = {
  schema: "genesis.machine-city.v1",
  schemaVersion: 1,
  status: "current",
  codeHash: "machine-hash",
  stackComponents: ["nodejs"],
  indexers: ["javascript"],
  diagnostics: [],
  districts: [{
    id: "directory:.",
    path: "",
    title: "Project",
    parentId: null
  }, {
    id: "directory:src",
    path: "src",
    title: "src",
    parentId: "directory:."
  }],
  buildings: [{
    id: "file:src/catalog.js",
    path: "src/catalog.js",
    title: "catalog.js",
    districtId: "directory:src",
    language: "javascript",
    role: "source",
    mode: 0o100644,
    bytes: 72_000,
    lines: 1_800,
    hash: "catalog-hash",
    extractors: ["javascript"],
    functionIds: ["function:catalog:listBooks"],
    publicFunctionCount: 1,
    internalFunctionCount: 0
  }],
  functions: [{
    id: "function:catalog:listBooks",
    name: "listBooks",
    qualifiedName: "listBooks",
    kind: "function",
    visibility: "public",
    container: null,
    path: "src/catalog.js",
    fileId: "file:src/catalog.js",
    line: 12,
    column: 1,
    parameters: [],
    async: false,
    generator: false,
    static: false,
    role: "source",
    language: "javascript",
    extractor: "javascript"
  }]
};

const programCity = {
  schema: "genesis.program-city.v1",
  schemaVersion: 1,
  status: "valid",
  programHash: "program-hash",
  diagnostics: [],
  districts: [{
    id: "subsystem:catalog",
    path: "catalog",
    title: "catalog",
    parentId: null
  }],
  buildings: [{
    id: "operation:catalog/list-books",
    name: "list-books",
    title: "List books",
    description: "Lists the current book catalogue.",
    publicContract: "Returns every current book in catalogue order.",
    implementationMap: "- `listBooks()` reads and returns the records.",
    path: "genesis/program/catalog/list-books.md",
    subsystem: "catalog",
    districtId: "subsystem:catalog",
    sources: ["src/catalog.js"],
    sourceFileIds: ["file:src/catalog.js"]
  }],
  links: [{
    kind: "implemented-by",
    fromId: "operation:catalog/list-books",
    toId: "file:src/catalog.js"
  }]
};

test("System switches between native Genesis Machine and Program Cities", async ({ page }) => {
  test.setTimeout(60_000);
  await mockDirectChatSession(page);
  await page.unroute(apiEndpointPattern("/vibe64/sessions"));
  await page.unroute(apiEndpointPattern(`/vibe64/sessions/${directChatSessionId}`));
  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    await fulfillJson(route, {
      creation: {
        canCreate: true,
        mode: "direct"
      },
      limits: {
        openSessionCount: 1
      },
      ok: true,
      sessions: [systemWorldSessionPayload]
    });
  });
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}`, async (route) => {
    await fulfillJson(route, systemWorldSessionPayload);
  });

  let refreshCount = 0;
  await routeApiEndpoint(page, `${sessionApi}/status`, async (route) => {
    await fulfillJson(route, {
      cities: {
        machine: {
          available: true,
          error: null,
          path: ".genesis/machine-city.json",
          schema: machineCity.schema,
          schemaVersion: 1,
          state: "ready",
          status: machineCity.status
        },
        program: {
          available: true,
          error: null,
          path: ".genesis/program-city.json",
          schema: programCity.schema,
          schemaVersion: 1,
          state: "ready",
          status: programCity.status
        }
      },
      ok: true,
      status: "ready"
    });
  });
  await routeApiEndpoint(page, `${sessionApi}/cities/machine`, async (route) => {
    await fulfillJson(route, {
      city: machineCity,
      kind: "machine",
      ok: true,
      path: ".genesis/machine-city.json"
    });
  });
  await routeApiEndpoint(page, `${sessionApi}/cities/program`, async (route) => {
    await fulfillJson(route, {
      city: programCity,
      kind: "program",
      ok: true,
      path: ".genesis/program-city.json"
    });
  });
  await routeApiEndpoint(page, `${sessionApi}/refresh`, async (route) => {
    refreshCount += 1;
    await fulfillJson(route, {
      changedFiles: [],
      cities: {
        machine: machineCity,
        program: programCity
      },
      diagnostics: [],
      ok: true,
      status: "ready",
      summary: "Indexed one function and one Program operation."
    });
  });

  await page.goto(DEVELOPMENT_PATH);
  await expect(page.getByRole("region", { name: "Session chat" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Dashboard" }).click();
  await page.getByRole("link", { exact: true, name: "Cities" }).click();

  await expect(page.getByText(/Genesis City · \d+/u)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { exact: true, name: "Machine" })).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Program" })).toBeVisible();
  await expect(page.locator("canvas[aria-label^='Interactive 3D Genesis City']")).toBeVisible();
  await expect(page.getByText("Moving around the City", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.getByRole("navigation", { name: "Machine City explorer" })).toBeVisible();

  await page.getByRole("button", { name: /catalog.*1 operation.*1 file/iu }).click();
  await expect(page.getByRole("heading", { level: 2, name: "catalog" })).toBeVisible();
  await expect(page.getByText("1 exact files", { exact: true })).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Program" }).click();
  await expect(page.getByRole("navigation", { name: "Program City explorer" })).toBeVisible();
  await page.getByRole("button", { name: /List books.*catalog/iu }).click();
  await expect(page.getByRole("heading", { level: 2, name: "List books" })).toBeVisible();
  await expect(page.getByText("Returns every current book in catalogue order.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "src/catalog.js" })).toBeVisible();

  await page.getByRole("button", { name: "Refresh Cities" }).click();
  await expect.poll(() => refreshCount).toBe(1);
});
