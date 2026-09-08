import ELK from "elkjs/lib/elk-api.js";
import ElkWorker from "elkjs/lib/elk-worker.min.js?worker";

import { createErdRelationshipRoutes } from "../erdRelationships.js";
import { layoutErdGroups } from "./erdLayout.js";

let elk = null;

self.addEventListener("message", async (event) => {
  const request = event.data || {};
  try {
    const nodes = Array.isArray(request.nodes) ? request.nodes : [];
    if (request.kind === "routes") {
      const graph = createErdRelationshipRoutes(nodes, request.relationships, request.options);
      self.postMessage({
        id: request.id, ok: true, portsByNode: graph.portsByNode,
        routes: graph.routes.map((route) => ({ ...route, sourceNode: undefined, targetNode: undefined }))
      });
      return;
    }
    const edges = Array.isArray(request.edges) ? request.edges : [];
    elk ||= new ELK({ workerFactory: () => new ElkWorker() });
    const result = await layoutErdGroups(elk, nodes, edges, request.groups);
    self.postMessage({
      ...result,
      id: request.id,
      ok: true
    });
  } catch (error) {
    self.postMessage({
      error: String(error?.message || error || "ERD layout failed."),
      id: request.id,
      ok: false
    });
  }
});
