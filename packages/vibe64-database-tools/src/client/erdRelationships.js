const ALIGNED_TABLE_THRESHOLD = 24;
const EDGE_CLEARANCE = 32;
const EDGE_LANE_GAP = 14;
const EDGE_PORT_STUB = 18;
const EDGE_TRACK_GAP = 6;
const COLUMN_HEIGHT = 27.52;
const COLUMN_LIST_PADDING = 5.6;
const NODE_HEADER_HEIGHT = 51.2;
const PORT_OFFSET_MAX = 82;
const PORT_OFFSET_MIN = 18;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nodeBounds(node = {}) {
  const x = finiteNumber(node.position?.x);
  const width = finiteNumber(node.dimensions?.width, 280);
  return {
    centerX: x + width / 2,
    left: x,
    right: x + width
  };
}

function relationshipId(relationship = {}, index = 0) {
  return String(relationship.id || relationship.constraintName || `relationship-${index}`);
}

function relationshipColumn(node = {}, columns = []) {
  if (node.data?.collapsed === true) {
    return null;
  }
  const available = new Set((node.data?.table?.columns || []).map((column) => column.name));
  return columns.find((column) => available.has(column)) || null;
}

function routeSides(sourceNode, targetNode, index) {
  const source = nodeBounds(sourceNode);
  const target = nodeBounds(targetNode);
  const horizontalDistance = target.centerX - source.centerX;
  if (horizontalDistance > ALIGNED_TABLE_THRESHOLD) {
    return { source: "right", target: "left" };
  }
  if (horizontalDistance < -ALIGNED_TABLE_THRESHOLD) {
    return { source: "left", target: "right" };
  }
  const side = index % 2 === 0 ? "right" : "left";
  return { source: side, target: side };
}

function routeBaseLane(route) {
  const source = nodeBounds(route.sourceNode);
  const target = nodeBounds(route.targetNode);
  if (route.sourcePosition === route.targetPosition) {
    return route.sourcePosition === "right"
      ? Math.max(source.right, target.right) + EDGE_CLEARANCE
      : Math.min(source.left, target.left) - EDGE_CLEARANCE;
  }
  const sourceX = route.sourcePosition === "right" ? source.right : source.left;
  const targetX = route.targetPosition === "right" ? target.right : target.left;
  return (sourceX + targetX) / 2;
}

function distributePortOffsets(ports = []) {
  const groups = new Map();
  for (const port of ports) {
    const key = `${port.column || "table"}:${port.position}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(port);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.id.localeCompare(right.id));
    group.forEach((port, index) => {
      port.offset = group.length === 1
        ? 50
        : PORT_OFFSET_MIN + (PORT_OFFSET_MAX - PORT_OFFSET_MIN) * index / (group.length - 1);
    });
  }
}

function distributeEdgeLanes(routes = []) {
  const groups = new Map();
  for (const route of routes) {
    route.baseLaneX = routeBaseLane(route);
    const key = Math.round(route.baseLaneX / EDGE_LANE_GAP);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(route);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => left.id.localeCompare(right.id));
    const center = group.reduce((total, route) => total + route.baseLaneX, 0) / group.length;
    group.forEach((route, index) => {
      route.laneX = center + (index - (group.length - 1) / 2) * EDGE_LANE_GAP;
      delete route.baseLaneX;
    });
  }
}

function portY(node, port) {
  const y = finiteNumber(node.position?.y);
  if (!port.column) {
    return y + finiteNumber(node.dimensions?.height, 180) * port.offset / 100;
  }
  const columnIndex = (node.data?.table?.columns || [])
    .findIndex((column) => column.name === port.column);
  return y + NODE_HEADER_HEIGHT + COLUMN_LIST_PADDING +
    Math.max(0, columnIndex) * COLUMN_HEIGHT + COLUMN_HEIGHT * port.offset / 100;
}

function distributeEndpointTracks(routes = []) {
  const groups = new Map();
  for (const route of routes) {
    for (const endpoint of ["source", "target"]) {
      const y = portY(route[`${endpoint}Node`], route[`${endpoint}Port`]);
      const key = Math.round(y / EDGE_TRACK_GAP);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ endpoint, route });
    }
  }
  for (const group of groups.values()) {
    group.sort((left, right) => (
      left.route.id.localeCompare(right.route.id) || left.endpoint.localeCompare(right.endpoint)
    ));
    group.forEach(({ endpoint, route }, index) => {
      route[`${endpoint}TrackOffset`] = (index - (group.length - 1) / 2) * EDGE_TRACK_GAP;
    });
  }
}

export function createErdRelationshipRoutes(nodes = [], relationships = []) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const portsByNode = new Map(nodes.map((node) => [node.id, []]));
  const routes = [];

  relationships.forEach((relationship, index) => {
    const sourceNode = nodeById.get(relationship.referencedTable);
    const targetNode = nodeById.get(relationship.sourceTable);
    if (!sourceNode || !targetNode) return;

    const id = relationshipId(relationship, index);
    const sides = routeSides(sourceNode, targetNode, index);
    const sourceColumn = relationshipColumn(sourceNode, relationship.referencedColumns || []);
    const targetColumn = relationshipColumn(targetNode, relationship.columns || []);
    const sourcePort = {
      column: sourceColumn,
      id: `erd-source:${id}`,
      position: sides.source,
      type: "source"
    };
    const targetPort = {
      column: targetColumn,
      id: `erd-target:${id}`,
      position: sides.target,
      type: "target"
    };
    portsByNode.get(sourceNode.id).push(sourcePort);
    portsByNode.get(targetNode.id).push(targetPort);
    routes.push({
      id,
      relationship,
      source: sourceNode.id,
      sourceColumn,
      sourceHandle: sourcePort.id,
      sourceNode,
      sourcePort,
      sourcePosition: sides.source,
      target: targetNode.id,
      targetColumn,
      targetHandle: targetPort.id,
      targetNode,
      targetPort,
      targetPosition: sides.target
    });
  });

  for (const ports of portsByNode.values()) {
    distributePortOffsets(ports);
  }
  distributeEdgeLanes(routes);
  distributeEndpointTracks(routes);

  return { portsByNode, routes };
}

export function createErdOrthogonalPath({
  laneX,
  sourcePosition,
  sourceTrackOffset,
  sourceX,
  sourceY,
  targetPosition,
  targetTrackOffset,
  targetX,
  targetY
} = {}) {
  const resolvedSourceX = finiteNumber(sourceX);
  const resolvedSourceY = finiteNumber(sourceY);
  const resolvedTargetX = finiteNumber(targetX);
  const resolvedTargetY = finiteNumber(targetY);
  const resolvedLaneX = finiteNumber(laneX, (resolvedSourceX + resolvedTargetX) / 2);
  const sourceStubX = resolvedSourceX + (sourcePosition === "left" ? -EDGE_PORT_STUB : EDGE_PORT_STUB);
  const targetStubX = resolvedTargetX + (targetPosition === "left" ? -EDGE_PORT_STUB : EDGE_PORT_STUB);
  const sourceTrackY = resolvedSourceY + finiteNumber(sourceTrackOffset);
  const targetTrackY = resolvedTargetY + finiteNumber(targetTrackOffset);
  return [
    `M${resolvedSourceX} ${resolvedSourceY}H${sourceStubX}V${sourceTrackY}H${resolvedLaneX}` +
      `V${targetTrackY}H${targetStubX}V${resolvedTargetY}H${resolvedTargetX}`,
    resolvedLaneX,
    (sourceTrackY + targetTrackY) / 2
  ];
}
