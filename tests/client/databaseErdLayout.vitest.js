import { describe, expect, it } from "vitest";
import ELK from "elkjs/lib/elk.bundled.js";
import { denseErdSchema } from "../fixtures/denseErdSchema.js";
import { createErdRelationshipRoutes } from "../../packages/vibe64-database-tools/src/client/erdRelationships.js";
import { erdColumns, erdNodeHeight, erdLayoutGroups, placeErdNodes } from "../../packages/vibe64-database-tools/src/client/erdModel.js";

import {
  createErdLayoutGraph,
  fallbackErdLayout,
  layoutErdGroups
} from "../../packages/vibe64-database-tools/src/client/workers/erdLayout.js";

const nodes = [
  { height: 180, id: "parent", width: 280 },
  { height: 220, id: "child-a", width: 280 },
  { height: 200, id: "child-b", width: 280 },
  { height: 160, id: "isolated", width: 280 }
];
const edges = [
  { id: "parent-child-a", source: "parent", target: "child-a" },
  { id: "parent-child-b", source: "parent", target: "child-b" }
];

describe("Database ERD layout", () => {
  it("finishes a dense 130-table schema without dropping any relationship", async () => {
    const schema = denseErdSchema();
    const nodes = schema.tables.map((table) => {
      const columns = erdColumns(table, schema.relationships);
      return { id: table.qualifiedName, data: { table, columns }, position: { x: 0, y: 0 }, dimensions: { width: 296, height: erdNodeHeight(columns) } };
    });
    const graph = createErdRelationshipRoutes(nodes, schema.relationships, { fixedSides: true, calculatePaths: false });
    const layout = await layoutErdGroups(new ELK(), nodes.map((node) => ({ id: node.id, ...node.dimensions, ports: graph.portsByNode.get(node.id) })), graph.routes, erdLayoutGroups(nodes, schema.relationships));
    const placed = placeErdNodes(nodes, layout.nodes);
    const result = createErdRelationshipRoutes(placed, schema.relationships, { fixedSides: true, layoutPaths: new Map(layout.paths.map((path) => [path.id, path.points])) });
    expect(layout.nodes).toHaveLength(130);
    expect(result.routes).toHaveLength(479);
    for (const route of result.routes) {
      expect(route.points[0]).toEqual(route.start);
      expect(route.points.at(-1)).toEqual(route.end);
      expect(route.points.slice(1).every((point, index) => Math.abs(point.x - route.points[index].x) < 1e-6 || Math.abs(point.y - route.points[index].y) < 1e-6), JSON.stringify(route.points)).toBe(true);
    }
  }, 10_000);

  it("builds a relationship graph along the column port direction", () => {
    const graph = createErdLayoutGraph(nodes, [
      ...edges,
      { id: "missing", source: "parent", target: "missing" }
    ]);

    expect(graph.layoutOptions).toMatchObject({
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.compaction.connectedComponents": "true"
    });
    expect(graph.edges).toHaveLength(2);
  });

  it("returns real ELK routes joining the fixed column ports and separates named groups", async () => {
    const source = { id: "parent", width: 296, height: 148, ports: [{ id: "source", x: 296, y: 78, position: "right" }] };
    const target = { id: "child", width: 296, height: 176, ports: [{ id: "target", x: 0, y: 106, position: "left" }] };
    const isolated = { id: "isolated", width: 296, height: 120 };
    const result = await layoutErdGroups(new ELK(), [source, target, isolated], [{ id: "fk", source: "parent", target: "child", sourceHandle: "source", targetHandle: "target" }], [
      { id: "domain", tables: ["parent", "child"] }, { id: "erd-disconnected", tables: ["isolated"] }
    ]);
    const positions = new Map(result.nodes.map((node) => [node.id, node]));
    expect(result.fallback).toBe(false);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].points[0]).toEqual({ x: positions.get("parent").x + 296, y: positions.get("parent").y + 78 });
    expect(result.paths[0].points.at(-1)).toEqual({ x: positions.get("child").x, y: positions.get("child").y + 106 });
    const island = positions.get("isolated");
    const connected = positions.get("child");
    expect(island.y > connected.y + target.height || island.x > connected.x + target.width).toBe(true);
  });

  it("keeps the fallback non-overlapping and parents above children", () => {
    const positions = new Map(fallbackErdLayout(nodes, edges).map((position) => [
      position.id,
      position
    ]));

    expect(positions.get("parent").y).toBeLessThan(positions.get("child-a").y);
    expect(positions.get("parent").y).toBeLessThan(positions.get("child-b").y);

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = { ...nodes[leftIndex], ...positions.get(nodes[leftIndex].id) };
        const right = { ...nodes[rightIndex], ...positions.get(nodes[rightIndex].id) };
        const overlaps = left.x < right.x + right.width &&
          left.x + left.width > right.x &&
          left.y < right.y + right.height &&
          left.y + left.height > right.y;
        expect(overlaps).toBe(false);
      }
    }
  });
});
