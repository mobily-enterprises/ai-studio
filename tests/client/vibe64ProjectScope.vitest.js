import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureHttpWebClient,
  getHttpWebClient,
  resetHttpWebClientForTests
} from "@jskit-ai/http-web/client/lib/httpClient";

import {
  PROJECT_SELECTION_ENDPOINT,
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  projectSelectionQueryKey
} from "../../src/lib/studioGateApi.js";
import {
  projectSelectionGateEndpoint,
  projectSelectionGateQueryKey
} from "../../src/composables/useProjectSelectionGate.js";
import {
  resolveWebSocketUrl,
  resolveStudioRequestUrl,
  scopedDevelopmentApiUrl,
  scopedDevelopmentApiPathname
} from "../../src/lib/studioUrls.js";
import {
  vibe64AgentTerminalWebSocketUrl
} from "../../src/lib/vibe64SessionApi.js";
import {
  vibe64ProjectScopedStorageKey,
  vibe64ProjectQueryScope,
  normalizeProjectRoutePath,
  projectAppPath,
  projectSlugFromPathname
} from "../../src/lib/vibe64ProjectScope.js";

describe("Vibe64 project client scope", () => {
  afterEach(() => {
    resetHttpWebClientForTests();
    vi.unstubAllGlobals();
  });

  it("derives project scope from development paths", () => {
    expect(projectAppPath("alpha_1")).toBe("/app/project/alpha_1");
    expect(projectAppPath("beta-2", "/dashboard/history")).toBe("/app/project/beta-2/dashboard/history");
    expect(normalizeProjectRoutePath("app/project/beta-2/dashboard/history/")).toBe("/app/project/beta-2/dashboard/history");
    expect(normalizeProjectRoutePath("//app//project//beta-2//dashboard//history//")).toBe("/app/project/beta-2/dashboard/history");
    expect(normalizeProjectRoutePath("/")).toBe("/");
    expect(projectSlugFromPathname("/app/project/alpha_1")).toBe("alpha_1");
    expect(projectSlugFromPathname("/app/project/beta-2/dashboard/history")).toBe("beta-2");
    expect(projectSlugFromPathname("/app")).toBe("");
    expect(projectSlugFromPathname("/app/alpha_1")).toBe("");
  });

  it("adds project scope to query and storage keys", () => {
    expect(VIBE64_CONNECTIONS_CHANGED_EVENT).toBe("vibe64.connections.changed");
    expect(vibe64ProjectQueryScope("alpha_1")).toEqual(["project", "alpha_1"]);
    expect(vibe64ProjectQueryScope()).toEqual(["project", "unscoped"]);
    expect(vibe64ProjectScopedStorageKey("vibe64:selected-session-id", "alpha_1"))
      .toBe("vibe64:selected-session-id:project:alpha_1");

  });

  it("does not rewrite global Studio and owner API paths into project API paths", () => {
    expect(scopedDevelopmentApiPathname("/api/studio/health", "alpha_1"))
      .toBe("/api/studio/health");
    expect(scopedDevelopmentApiPathname("/api/studio/browser-lifecycle/ws", "alpha_1"))
      .toBe("/api/studio/browser-lifecycle/ws");
    expect(scopedDevelopmentApiPathname("/api/vibe64/projects", "alpha_1"))
      .toBe("/api/vibe64/projects");
    expect(scopedDevelopmentApiPathname("/api/vibe64/projects/alpha_1/repository/github", "alpha_1"))
      .toBe("/api/vibe64/projects/alpha_1/repository/github");
    expect(scopedDevelopmentApiPathname("/api/vibe64/github/repositories/search", "alpha_1"))
      .toBe("/api/vibe64/github/repositories/search");
  });

  it("resolves direct browser transport URLs through the current project scope", () => {
    vi.stubGlobal("window", {
      location: {
        host: "127.0.0.1:5173",
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/alpha_1/dashboard/health"
      }
    });

    expect(resolveStudioRequestUrl("/api/studio/health"))
      .toBe("/api/studio/health");
    expect(resolveWebSocketUrl("/api/studio/browser-lifecycle/ws"))
      .toBe("ws://127.0.0.1:5173/api/studio/browser-lifecycle/ws");
  });

  it("adds the tab origin to session assistant terminal WebSocket URLs", () => {
    vi.stubGlobal("window", {
      location: {
        host: "127.0.0.1:5173",
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/alpha_1"
      }
    });

    const url = vibe64AgentTerminalWebSocketUrl("session 1", "terminal 1");
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/app/alpha_1/vibe64/sessions/session%201/agent-terminal/terminal%201/ws");
    expect(parsed.searchParams.get("originId")).toMatch(/^tab:/u);
  });

  it("scopes direct command URLs through the current project scope", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/beepollen"
      }
    });

    expect(scopedDevelopmentApiUrl("/api/vibe64/sessions/session-1/launch-terminal"))
      .toBe("/api/app/beepollen/vibe64/sessions/session-1/launch-terminal");
  });

  it("keeps JSKIT HTTP client project catalog requests global on project pages", async () => {
    const requestedUrls = [];
    configureHttpWebClient({
      csrf: {
        enabled: false
      },
      resolveRequestUrl(url) {
        return resolveStudioRequestUrl(url);
      }
    });
    vi.stubGlobal("window", {
      location: {
        origin: "http://127.0.0.1:5173",
        pathname: "/app/project/beepollen"
      }
    });
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      requestedUrls.push(url);
      return {
        headers: {
          get: () => "application/json"
        },
        json: async () => ({
          ok: true,
          projects: []
        }),
        ok: true,
        status: 200
      };
    }));

    await getHttpWebClient().get(PROJECT_SELECTION_ENDPOINT);

    expect(requestedUrls).toEqual([
      "/api/vibe64/projects"
    ]);
  });

  it("scopes the project selection gate endpoint on project pages without changing catalog defaults", () => {
    expect(projectSelectionGateEndpoint({
      projectSlug: "alpha_1"
    })).toBe(PROJECT_SELECTION_ENDPOINT);
    expect(projectSelectionGateQueryKey({
      ownershipFilter: "public",
      projectSlug: "alpha_1",
      surfaceId: "app"
    })).toEqual(projectSelectionQueryKey("app", "public", "alpha_1"));

    expect(projectSelectionGateEndpoint({
      projectSlug: "alpha_1",
      scopeSelectionToCurrentProject: true
    })).toBe("/api/app/alpha_1/vibe64/projects");
    expect(projectSelectionGateQueryKey({
      ownershipFilter: "public",
      projectSlug: "alpha_1",
      scopeSelectionToCurrentProject: true,
      surfaceId: "app"
    })).toEqual([
      ...projectSelectionQueryKey("app", "public", "alpha_1"),
      "route-selection"
    ]);
  });

  it("routes created and selected projects to their project pages", () => {
    const source = readFileSync(new URL("../../src/components/studio/ProjectSelectionGate.vue", import.meta.url), "utf8");

    expect(projectAppPath("beepollen")).toBe("/app/project/beepollen");
    expect(source).toContain("const selected = await createProject();");
    expect(source).toContain("const selected = await selectProject(slug);");
    expect(source).toContain("router.push(projectAppPath(selected))");
    expect(source).toContain("v-if=\"selectionInitialLoading\"");
    expect(source).toContain("<v-skeleton-loader");
  });
});
