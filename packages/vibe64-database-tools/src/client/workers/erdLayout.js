const HORIZONTAL_GAP = 64;
const VERTICAL_GAP = 80;

export const ERD_LAYOUT_OPTIONS = Object.freeze({
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.compaction.connectedComponents": "true",
  "elk.layered.spacing.nodeNodeBetweenLayers": String(VERTICAL_GAP),
  "elk.spacing.componentComponent": "40",
  "elk.spacing.nodeNode": String(HORIZONTAL_GAP)
});

export function createErdLayoutGraph(nodes = [], edges = []) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  return {
    children: nodes.map((node) => ({
      height: Number(node.height || 180),
      id: node.id,
      width: Number(node.width || 280)
    })),
    edges: edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target]
      })),
    id: "database-erd",
    layoutOptions: ERD_LAYOUT_OPTIONS
  };
}

export function fallbackErdLayout(nodes = [], edges = []) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    incoming.set(edge.target, incoming.get(edge.target) + 1);
    outgoing.get(edge.source).push(edge.target);
    degree.set(edge.source, degree.get(edge.source) + 1);
    degree.set(edge.target, degree.get(edge.target) + 1);
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

  const rows = new Map();
  for (const node of nodes) {
    const level = levels.get(node.id) || 0;
    if (!rows.has(level)) rows.set(level, []);
    rows.get(level).push(node);
  }

  const positions = [];
  let y = 0;
  for (const [, row] of [...rows.entries()].sort(([left], [right]) => left - right)) {
    row.sort((left, right) => (
      degree.get(right.id) - degree.get(left.id) || left.id.localeCompare(right.id)
    ));
    let x = 0;
    let rowHeight = 0;
    for (const node of row) {
      positions.push({ id: node.id, x, y });
      x += Number(node.width || 280) + HORIZONTAL_GAP;
      rowHeight = Math.max(rowHeight, Number(node.height || 180));
    }
    y += rowHeight + VERTICAL_GAP;
  }
  return positions;
}
