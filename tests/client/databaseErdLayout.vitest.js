import { describe, expect, it } from "vitest";

import {
  createErdLayoutGraph,
  fallbackErdLayout
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
  it("builds a compact top-down relationship graph", () => {
    const graph = createErdLayoutGraph(nodes, [
      ...edges,
      { id: "missing", source: "parent", target: "missing" }
    ]);

    expect(graph.layoutOptions).toMatchObject({
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.compaction.connectedComponents": "true"
    });
    expect(graph.edges).toHaveLength(2);
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
