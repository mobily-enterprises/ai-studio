import { describe, expect, it } from "vitest";

import {
  buildingHeight,
  districtElevationStep,
  districtPadding,
  layoutGenesisCity,
  layoutGenesisSemanticSky
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
    expect(first.campuses.map((campus) => campus.id)).toEqual(["directory:src"]);
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
    expect(source.elevation).toBe(root.surfaceElevation);
    expect(source.terraceHeight).toBe(64);
    expect(source.surfaceElevation).toBe(68);
    expect(catalog.elevation).toBe(source.surfaceElevation);
    expect(source.precinctId).toBe("directory:src");
    expect(catalog.precinctId).toBe("directory:src");
    expect(catalog.ancestorDistrictIds).toEqual(["directory:root", "directory:src"]);
    expect(inside(catalog, source)).toBe(true);
  });

  it("tapers directory spacing and retaining-floor elevation through deep hierarchies", () => {
    const paths = ["", "src", "src/client", "src/client/features", "src/client/features/catalog"];
    const districts = paths.map((path, index) => ({
      id: `directory:${path || "root"}`,
      parentId: index === 0 ? null : `directory:${paths[index - 1] || "root"}`,
      path,
      title: path.split("/").at(-1) || "Project"
    }));
    const layout = layoutGenesisCity({
      buildings: [machineBuilding(
        "file:src/client/features/catalog/index.js",
        "directory:src/client/features/catalog",
        "src/client/features/catalog/index.js",
        120
      )],
      cityKind: "machine",
      districts
    });
    const levels = paths.map((path) => layout.districts.find((district) => (
      district.id === `directory:${path || "root"}`
    )));

    expect(levels.map((district) => district.layoutPadding)).toEqual(
      paths.map((_, depth) => districtPadding(depth))
    );
    levels.slice(1).forEach((district, index) => {
      expect(district.terraceHeight).toBeCloseTo(districtElevationStep(index + 1), 8);
    });
    expect(levels.slice(1).every((district, index, shallowLevels) => (
      index === 0 || district.layoutPadding < shallowLevels[index - 1].layoutPadding
    ))).toBe(true);
    expect(levels.slice(1).every((district, index, shallowLevels) => (
      index === 0 || district.terraceHeight < shallowLevels[index - 1].terraceHeight
    ))).toBe(true);
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

  it("separates Stack-declared regions and keeps each declared campus physical", () => {
    const regions = [{
      id: "packages", title: "Packages", pathPrefix: "packages", fallback: false
    }, {
      id: "source", title: "Source", pathPrefix: "src", fallback: false
    }, {
      id: "everything-else", title: "Everything else", pathPrefix: null, fallback: true
    }];
    const campuses = [{
      id: "campus:packages:accounts",
      regionId: "packages",
      path: "packages/accounts",
      title: "accounts",
      districtId: "directory:packages/accounts"
    }, {
      id: "campus:packages:catalog",
      regionId: "packages",
      path: "packages/catalog",
      title: "catalog",
      districtId: "directory:packages/catalog"
    }, {
      id: "campus:source:client",
      regionId: "source",
      path: "src/client",
      title: "client",
      districtId: "directory:src/client"
    }, {
      id: "campus:other:scripts",
      regionId: "everything-else",
      path: "scripts",
      title: "scripts",
      districtId: "directory:scripts"
    }];
    const district = (path, parentPath, campusId, regionId) => ({
      id: `directory:${path || "."}`,
      parentId: parentPath === null ? null : `directory:${parentPath || "."}`,
      path,
      presentationCampusId: campusId,
      presentationRegionId: regionId,
      title: path.split("/").at(-1) || "Project"
    });
    const districts = [
      district("", null, "campus:other:root", "everything-else"),
      district("packages", "", "campus:packages:root", "packages"),
      district("packages/accounts", "packages", "campus:packages:accounts", "packages"),
      district("packages/accounts/src", "packages/accounts", "campus:packages:accounts", "packages"),
      district("packages/catalog", "packages", "campus:packages:catalog", "packages"),
      district("src", "", "campus:source:root", "source"),
      district("src/client", "src", "campus:source:client", "source"),
      district("scripts", "", "campus:other:scripts", "everything-else")
    ];
    const placements = new Map(campuses.map((campus) => [campus.path, campus]));
    const buildings = [
      ["packages/accounts/src/index.js", "packages/accounts/src", 80],
      ["packages/catalog/index.js", "packages/catalog", 90],
      ["src/client/main.js", "src/client", 100],
      ["scripts/release.js", "scripts", 40]
    ].map(([path, directoryPath, lines]) => {
      const campus = [...placements.values()].find((entry) => (
        directoryPath === entry.path || directoryPath.startsWith(`${entry.path}/`)
      ));
      return {
        ...machineBuilding(`file:${path}`, `directory:${directoryPath}`, path, lines),
        presentationCampusId: campus.id,
        presentationRegionId: campus.regionId
      };
    });

    const layout = layoutGenesisCity({
      buildings,
      cityKind: "machine",
      districts,
      presentationCampuses: campuses,
      presentationRegions: regions
    });

    expect(layout.regions.map(({ title }) => title).sort()).toEqual([
      "Everything else", "Packages", "Source"
    ]);
    expect(layout.campuses.map(({ title }) => title).sort()).toEqual([
      "accounts", "catalog", "client", "scripts"
    ]);
    const packages = layout.regions.find((region) => region.id === "packages");
    const accounts = layout.campuses.find((campus) => campus.id === "campus:packages:accounts");
    const accountSource = layout.districts.find((entry) => entry.path === "packages/accounts/src");
    expect(inside(accounts, packages)).toBe(true);
    expect(accountSource.precinctId).toBe(accounts.id);
    expect(accountSource.hierarchyDepth).toBe(1);
    expect(accountSource.surfaceElevation).toBeGreaterThan(accounts.surfaceElevation);
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

  it("places subsystem islands, operation nodes, and exact implementation tethers deterministically", () => {
    const machineCity = {
      buildings: [
        machineBuilding("file:src/read.js", "directory:src", "src/read.js", 80),
        machineBuilding("file:src/write.js", "directory:src", "src/write.js", 90)
      ],
      cityKind: "machine",
      districts: [{
        id: "directory:src",
        parentId: null,
        path: "src",
        title: "Source"
      }]
    };
    const cityLayout = layoutGenesisCity(machineCity);
    const filesById = new Map(machineCity.buildings.map((file) => [file.id, file]));
    const operations = ["read", "write"].map((name) => ({
      id: `operation:catalog/${name}`,
      implementationLinks: [],
      title: name
    }));
    const links = operations.map((operation) => ({
      file: filesById.get(`file:src/${operation.title}.js`),
      fileId: `file:src/${operation.title}.js`,
      id: `${operation.id}->file:src/${operation.title}.js`,
      kind: "implemented-by",
      operation,
      operationId: operation.id,
      subsystemId: "subsystem:catalog"
    }));
    operations.forEach((operation) => {
      operation.implementationLinks = links.filter((link) => link.operationId === operation.id);
    });
    const semantic = {
      implementationLinks: links,
      operations,
      subsystems: [{
        fileIds: [...filesById.keys()],
        files: [...filesById.values()],
        id: "subsystem:catalog",
        implementationLinks: links,
        operationIds: operations.map((operation) => operation.id),
        operations,
        path: "catalog",
        title: "Catalog"
      }]
    };

    const first = layoutGenesisSemanticSky(cityLayout, semantic);
    const second = layoutGenesisSemanticSky(cityLayout, semantic);

    expect(second).toEqual(first);
    expect(first.subsystems).toHaveLength(1);
    expect(first.operations.map((operation) => operation.id)).toEqual([
      "operation:catalog/read",
      "operation:catalog/write"
    ]);
    expect(first.implementationLinks).toHaveLength(2);
    expect(first.implementationBundles).toEqual([
      expect.objectContaining({
        fileIds: ["file:src/read.js", "file:src/write.js"],
        operationIds: ["operation:catalog/read", "operation:catalog/write"],
        precinctId: "directory:src",
        subsystemId: "subsystem:catalog",
        weight: 2
      })
    ]);
    expect(first.implementationLinks.map((link) => link.to)).toEqual(
      cityLayout.buildings.map((building) => ({
        x: building.x,
        y: building.elevation + building.buildingHeight + 3,
        z: building.z
      }))
    );
    expect(first.subsystems[0].y).toBeGreaterThan(cityLayout.bounds.height);
  });
});
