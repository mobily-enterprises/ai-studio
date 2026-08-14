import { describe, expect, it } from "vitest";

import {
  DISTRICT_ELEVATION_STEP,
  buildingHeight,
  layoutGenesisCity
} from "../../packages/vibe64-system-graph/src/client/world/worldLayout.js";

function machineBuilding(id, districtId, path, lines) {
  return {
    bytes: lines * 20,
    districtId,
    extractors: ["javascript"],
    functionIds: [],
    hash: `hash:${id}`,
    id,
    internalFunctionCount: 0,
    language: "javascript",
    lines,
    mode: 0o100644,
    path,
    publicFunctionCount: 0,
    role: "source",
    title: path.split("/").at(-1)
  };
}

function inside(building, district) {
  return building.x >= district.x - district.width / 2 &&
    building.x <= district.x + district.width / 2 &&
    building.z >= district.z - district.footprintDepth / 2 &&
    building.z <= district.z + district.footprintDepth / 2;
}

describe("native Genesis City layout", () => {
  it("lays out the declared district hierarchy deterministically", () => {
    const city = {
      buildings: [
        machineBuilding("file:src/catalog.js", "directory:src", "elsewhere/catalog.js", 120),
        machineBuilding("file:README.md", "directory:root", "README.md", 20)
      ],
      cityKind: "machine",
      cityLabel: "MACHINE CITY · FILES AND FUNCTIONS",
      districts: [{
        id: "directory:root",
        parentId: null,
        path: "",
        title: "Project"
      }, {
        id: "directory:src",
        parentId: "directory:root",
        path: "native/source-district",
        title: "Source"
      }]
    };

    const first = layoutGenesisCity(city);
    const second = layoutGenesisCity(city);

    expect(second).toEqual(first);
    expect(first).not.toHaveProperty("campuses");
    expect(first).not.toHaveProperty("files");
    expect(first).not.toHaveProperty("subsystemStrata");
    expect(first.districts).toHaveLength(2);
    expect(first.buildings).toHaveLength(2);

    const root = first.districts.find((district) => district.id === "directory:root");
    const source = first.districts.find((district) => district.id === "directory:src");
    const catalog = first.buildings.find((building) => building.id === "file:src/catalog.js");
    expect(root.buildingCount).toBe(2);
    expect(root.lines).toBe(140);
    expect(source.buildingCount).toBe(1);
    expect(source.elevation).toBe(DISTRICT_ELEVATION_STEP);
    expect(catalog.ancestorDistrictIds).toEqual(["directory:root", "directory:src"]);
    expect(inside(catalog, source)).toBe(true);
  });

  it("uses districtId rather than reconstructing ownership from building paths", () => {
    const layout = layoutGenesisCity({
      buildings: [
        machineBuilding("file:a", "district:left", "same/path/a.js", 30),
        machineBuilding("file:b", "district:right", "same/path/b.js", 30)
      ],
      cityKind: "machine",
      districts: [{
        id: "district:left",
        parentId: null,
        path: "declared-left",
        title: "Left"
      }, {
        id: "district:right",
        parentId: null,
        path: "declared-right",
        title: "Right"
      }]
    });

    const left = layout.districts.find((district) => district.id === "district:left");
    const right = layout.districts.find((district) => district.id === "district:right");
    expect(inside(layout.buildings.find((building) => building.id === "file:a"), left)).toBe(true);
    expect(inside(layout.buildings.find((building) => building.id === "file:b"), right)).toBe(true);
  });

  it("renders Program operations uniformly inside their native subsystem districts", () => {
    const operations = ["read", "write"].map((name) => ({
      description: `${name} operation`,
      districtId: "subsystem:catalog",
      id: `operation:catalog/${name}`,
      implementationMap: "",
      name,
      path: `genesis/program/catalog/${name}.md`,
      publicContract: `${name} contract`,
      sourceFileIds: [`file:src/${name}.js`],
      sources: [`src/${name}.js`],
      subsystem: "catalog",
      title: name
    }));
    const layout = layoutGenesisCity({
      buildings: operations,
      cityKind: "program",
      cityLabel: "PROGRAM CITY · SUBSYSTEMS AND OPERATIONS",
      districts: [{
        id: "subsystem:catalog",
        parentId: null,
        path: "catalog",
        title: "Catalog"
      }],
      links: operations.map((operation, index) => ({
        fromId: operation.id,
        kind: "implemented-by",
        toId: operation.sourceFileIds[index] || operation.sourceFileIds[0]
      }))
    });

    expect(layout.cityKind).toBe("program");
    expect(layout.districts[0].title).toBe("Catalog");
    expect(layout.districts[0].buildingCount).toBe(2);
    expect(layout.buildings.map((building) => building.buildingHeight)).toEqual([38, 38]);
    expect(buildingHeight({ lines: 50_000 }, "program")).toBe(38);
  });
});
