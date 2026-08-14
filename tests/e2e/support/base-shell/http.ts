async function fulfillJson(route, payload) {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(payload)
  });
}

function apiEndpointPattern(pathSuffix, {
  children = false,
  prefix = false
} = {}) {
  const suffix = `/${String(pathSuffix || "").trim().replace(/^\/+|\/+$/gu, "")}`;
  const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const trailingPattern = children ? "(?:/.*)" : prefix ? "(?:/.*)?" : "";
  return new RegExp(`/api(?:/app/[^/]+)?${escapedSuffix}${trailingPattern}(?:\\?.*)?$`, "u");
}

async function routeApiEndpoint(page, pathSuffix, handler, options = {}) {
  await page.route(apiEndpointPattern(pathSuffix, options), handler);
}

function trackStudioApiRequests(page) {
  const requests: string[] = [];

  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes("/api/studio/") || /\/api\/app\/[^/]+\/studio\//u.test(pathname)) {
      requests.push(pathname);
    }
  });

  return {
    count(pathname: string) {
      return requests.filter((requestPathname) => requestPathname === pathname).length;
    },
    requests
  };
}

export {
  apiEndpointPattern,
  fulfillJson,
  routeApiEndpoint,
  trackStudioApiRequests
};
