import ELK from "elkjs/lib/elk.bundled.js";

let elk = null;

function fallbackLayout(nodes = [], edges = []) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    incoming.set(edge.target, incoming.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
  }

  const levels = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id)
    .sort((left, right) => left.localeCompare(right));
  while (queue.length > 0) {
    const source = queue.shift();
    for (const target of outgoing.get(source)) {
      levels.set(target, Math.max(levels.get(target), levels.get(source) + 1));
      incoming.set(target, incoming.get(target) - 1);
      if (incoming.get(target) === 0) {
        queue.push(target);
        queue.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  const columns = new Map();
  for (const node of nodes) {
    const level = levels.get(node.id) || 0;
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level).push(node);
  }

  const positions = [];
  let x = 0;
  for (const [, column] of [...columns.entries()].sort(([left], [right]) => left - right)) {
    column.sort((left, right) => left.id.localeCompare(right.id));
    let y = 0;
    let columnWidth = 0;
    for (const node of column) {
      positions.push({ id: node.id, x, y });
      y += Number(node.height || 180) + 72;
      columnWidth = Math.max(columnWidth, Number(node.width || 280));
    }
    x += columnWidth + 100;
  }
  return positions;
}

self.addEventListener("message", async (event) => {
  const request = event.data || {};
  try {
    const nodes = Array.isArray(request.nodes) ? request.nodes : [];
    const edges = Array.isArray(request.edges) ? request.edges : [];
    let positions;
    try {
      elk ||= new ELK();
      const graph = await elk.layout({
        children: nodes.map((node) => ({
          height: Number(node.height || 180),
          id: node.id,
          width: Number(node.width || 280)
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          sources: [edge.source],
          targets: [edge.target]
        })),
        id: "database-erd",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.edgeRouting": "ORTHOGONAL",
          "elk.layered.spacing.nodeNodeBetweenLayers": "100",
          "elk.spacing.nodeNode": "72"
        }
      });
      positions = (graph.children || []).map((node) => ({
        id: node.id,
        x: Number(node.x || 0),
        y: Number(node.y || 0)
      }));
    } catch {
      positions = fallbackLayout(nodes, edges);
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
