import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { sendVibe64EventStream } from "@local/vibe64-core/server/eventStream";

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
    localRequestMessage: "Vibe64 System routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-system-graph"]
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/status", {
    summary: "Read current-state System availability and freshness for an active session."
  }, (request) => {
    return systemGraphService(app).readStatus({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/overview", {
    summary: "Read the current semantic System overview for an active session."
  }, (request) => {
    return systemGraphService(app).readOverview({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/system-graph/sessions/:sessionId/subsystems/:subsystemKey/depth", {
    bodyLimit: 16 * 1024,
    summary: "Arrange one subsystem's physical File City stratum below its generated baseline."
  }, (request) => {
    const body = routes.requestBody(request);
    return systemGraphService(app).setSubsystemDepth({
      depth: body.depth,
      sessionId: request.params.sessionId,
      subsystemKey: request.params.subsystemKey
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/entities/:entityKey", {
    summary: "Read one focused System entity and its immediate relationships."
  }, (request) => {
    return systemGraphService(app).readEntity({
      entityKey: request.params.entityKey,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/entities/:entityKey/evidence", {
    summary: "Read source evidence for one focused System entity."
  }, (request) => {
    return systemGraphService(app).readEntityEvidence({
      entityKey: request.params.entityKey,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/files/:fileKey/constellation", {
    summary: "Read a one-hop file, directory, import, and subsystem constellation."
  }, (request) => {
    return systemGraphService(app).readFileConstellation({
      fileKey: request.params.fileKey,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/findings", {
    summary: "Read spatial architecture findings for the current System model."
  }, (request) => {
    return systemGraphService(app).readFindings({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/system-graph/sessions/:sessionId/updates", {
    bodyLimit: 16 * 1024,
    summary: "Start a manual current-state System update."
  }, (request) => {
    return systemGraphService(app).startUpdate({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/updates/:updateId/stream", {
    summary: "Stream runtime-local progress for one manual System update."
  }, async (request, reply) => {
    await sendVibe64EventStream(reply, ({ emit, isClosed }) => {
      return systemGraphService(app).streamUpdate({
        sessionId: request.params.sessionId,
        updateId: request.params.updateId
      }, {
        emit(payload = {}) {
          emit(payload.type || "system-update.progress", payload);
        },
        isClosed
      });
    }, {
      errorEvent: "system-update.stream-failed",
      errorPayload: (error) => ({
        error: {
          code: String(error?.code || "vibe64_system_update_stream_failed"),
          message: String(error?.message || error)
        },
        type: "system-update.stream-failed"
      }),
      retryMs: 0
    });
  });

  routes.serviceRoute("POST", "/system-graph/sessions/:sessionId/findings/:findingId/accept", {
    bodyLimit: 16 * 1024,
    summary: "Record an evidence-bound acceptance declaration for one current finding."
  }, (request) => {
    const body = routes.requestBody(request);
    return systemGraphService(app).acceptFinding({
      findingId: request.params.findingId,
      reason: body.reason,
      sessionId: request.params.sessionId
    });
  });
}

export {
  SYSTEM_GRAPH_SERVICE_ID,
  registerRoutes
};
