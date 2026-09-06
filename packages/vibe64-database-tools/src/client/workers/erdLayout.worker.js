import ELK from "elkjs/lib/elk-api.js";
import ElkWorker from "elkjs/lib/elk-worker.min.js?worker";

import {
  createErdLayoutGraph,
  fallbackErdLayout
} from "./erdLayout.js";

let elk = null;

self.addEventListener("message", async (event) => {
  const request = event.data || {};
  try {
    const nodes = Array.isArray(request.nodes) ? request.nodes : [];
    const edges = Array.isArray(request.edges) ? request.edges : [];
    let positions;
    try {
      elk ||= new ELK({
        workerFactory: () => new ElkWorker()
      });
      const graph = await elk.layout(createErdLayoutGraph(nodes, edges));
      positions = (graph.children || []).map((node) => ({
        id: node.id,
        x: Number(node.x || 0),
        y: Number(node.y || 0)
      }));
    } catch {
      positions = fallbackErdLayout(nodes, edges);
    }
    self.postMessage({
      id: request.id,
      nodes: positions,
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
