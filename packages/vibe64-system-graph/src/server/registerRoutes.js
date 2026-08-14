import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

const SYSTEM_GRAPH_SERVICE_ID = "feature.vibe64-system-graph.service";

function systemGraphService(app) {
  return app.make(SYSTEM_GRAPH_SERVICE_ID);
}

function registerRoutes(
  app,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 City routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-system-graph"]
  });
  const sessionRoute = "/system-graph/sessions/:sessionId";

  routes.serviceRoute("GET", `${sessionRoute}/status`, {
    summary: "Read Genesis Machine and Program City availability for an active session."
  }, (request) => {
    return systemGraphService(app).readStatus({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", `${sessionRoute}/cities/machine`, {
    summary: "Read the native Genesis Machine City for an active session."
  }, (request) => {
    return systemGraphService(app).readMachineCity({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", `${sessionRoute}/cities/program`, {
    summary: "Read the native Genesis Program City for an active session."
  }, (request) => {
    return systemGraphService(app).readProgramCity({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", `${sessionRoute}/refresh`, {
    bodyLimit: 16 * 1024,
    summary: "Synchronously refresh both Genesis Cities for an active session."
  }, (request) => {
    return systemGraphService(app).refresh({
      sessionId: request.params.sessionId
    });
  });
}

export {
  SYSTEM_GRAPH_SERVICE_ID,
  registerRoutes
};
