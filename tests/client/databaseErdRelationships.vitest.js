import { describe, expect, it } from "vitest";

import {
  createErdOrthogonalPath,
  createErdRelationshipRoutes
} from "../../packages/vibe64-database-tools/src/client/erdRelationships.js";

function tableNode(id, x, columns, { collapsed = false, y = 0 } = {}) {
  return {
    data: {
      collapsed,
      table: {
        columns: columns.map((name) => ({ name }))
      }
    },
    dimensions: { height: 220, width: 280 },
    id,
    position: { x, y }
  };
}

const relationships = [
  {
    columns: ["parent_id"],
    id: "child:parent",
    referencedColumns: ["id"],
    referencedTable: "parent",
    sourceTable: "child"
  },
  {
    columns: ["backup_parent_id"],
    id: "child:backup-parent",
    referencedColumns: ["id"],
    referencedTable: "parent",
    sourceTable: "child"
  }
];

describe("Database ERD relationships", () => {
  it("routes parent keys to the matching child foreign-key columns", () => {
    const parent = tableNode("parent", 0, ["id", "name"]);
    const child = tableNode("child", 420, ["id", "parent_id", "backup_parent_id"], { y: 340 });
    const graph = createErdRelationshipRoutes([parent, child], relationships);

    expect(graph.routes).toHaveLength(2);
    expect(graph.routes.map((route) => [
      route.source,
      route.sourceColumn,
      route.target,
      route.targetColumn
    ])).toEqual([
      ["parent", "id", "child", "parent_id"],
      ["parent", "id", "child", "backup_parent_id"]
    ]);
    expect(new Set(graph.routes.map((route) => route.sourceHandle)).size).toBe(2);
    expect(new Set(graph.routes.map((route) => route.targetHandle)).size).toBe(2);
    expect(new Set(graph.routes.map((route) => route.laneX)).size).toBe(2);

    const parentPorts = graph.portsByNode.get("parent");
    const childPorts = graph.portsByNode.get("child");
    expect(parentPorts.every((port) => port.column === "id" && port.type === "source")).toBe(true);
    expect(childPorts.map((port) => port.column)).toEqual(["parent_id", "backup_parent_id"]);
    expect(new Set(parentPorts.map((port) => port.offset)).size).toBe(2);
  });

  it("uses a table-side target when its columns are collapsed", () => {
    const parent = tableNode("parent", 0, ["id"]);
    const child = tableNode("child", 420, ["parent_id"], { collapsed: true });
    const graph = createErdRelationshipRoutes([parent, child], relationships.slice(0, 1));

    expect(graph.routes[0].targetColumn).toBeNull();
    expect(graph.portsByNode.get("child")[0]).toMatchObject({
      column: null,
      type: "target"
    });
  });

  it("draws a distinct orthogonal lane between the relationship ports", () => {
    expect(createErdOrthogonalPath({
      laneX: 360,
      sourcePosition: "right",
      sourceTrackOffset: -6,
      sourceX: 280,
      sourceY: 90,
      targetPosition: "left",
      targetTrackOffset: 6,
      targetX: 420,
      targetY: 410
    })).toEqual([
      "M280 90H298V84H360V416H402V410H420",
      360,
      250
    ]);
  });
});
