import { describe, expect, it } from "vitest";

import {
  GENESIS_MACHINE_CITY_KIND,
  GENESIS_PROGRAM_CITY_KIND,
  genesisCityKind,
  genesisCityWorld
} from "../../packages/vibe64-system-graph/src/client/world/genesisCityWorld.js";
import {
  layoutGenesisCity
} from "../../packages/vibe64-system-graph/src/client/world/worldLayout.js";

describe("Genesis City world projection", () => {
  it("passes native Machine City districts, buildings, and functions by reference", () => {
    const districts = [{
      id: "directory:src",
      parentId: null,
      path: "src",
      title: "src"
    }];
    const buildings = [{
      bytes: 120,
      districtId: "directory:src",
      extractors: ["javascript"],
      functionIds: [],
      hash: "hash",
      id: "file:src/catalog.js",
      internalFunctionCount: 0,
      language: "javascript",
      lines: 4,
      mode: 0o100644,
      path: "src/catalog.js",
      publicFunctionCount: 0,
      role: "source",
      title: "catalog.js"
    }];
    const functions = [];
    const city = { buildings, districts, functions };

    const overview = genesisCityWorld(city, GENESIS_MACHINE_CITY_KIND);

    expect(overview).toEqual({
      buildings,
      cityKind: "machine",
      cityLabel: "MACHINE CITY · FILES AND FUNCTIONS",
      districts,
      functions
    });
    expect(overview.buildings).toBe(buildings);
    expect(overview.districts).toBe(districts);
    expect(overview.functions).toBe(functions);
    expect(overview).not.toHaveProperty("adapter");
    expect(overview).not.toHaveProperty("relationships");
    expect(overview).not.toHaveProperty("findings");
  });

  it("passes native Program links and lays out operations without invented architecture", () => {
    const operation = {
      description: "Lists the catalogue.",
      districtId: "subsystem:catalog",
      id: "operation:catalog/list-books",
      implementationMap: "- `listBooks()` returns records.",
      name: "list-books",
      path: "genesis/program/catalog/list-books.md",
      publicContract: "Returns the current books.",
      sourceFileIds: ["file:src/catalog.js"],
      sources: ["src/catalog.js"],
      subsystem: "catalog",
      title: "List books"
    };
    const districts = [{
      id: "subsystem:catalog",
      parentId: null,
      path: "catalog",
      title: "Catalog"
    }];
    const links = [{
      fromId: operation.id,
      kind: "implemented-by",
      toId: "file:src/catalog.js"
    }];
    const overview = genesisCityWorld({
      buildings: [operation],
      districts,
      links
    }, GENESIS_PROGRAM_CITY_KIND);

    const layout = layoutGenesisCity(overview);

    expect(layout.buildings).toHaveLength(1);
    expect(layout.buildings[0]).toEqual(expect.objectContaining({
      id: operation.id,
      path: operation.path,
      title: operation.title
    }));
    expect(overview.buildings[0]).not.toHaveProperty("lines");
    expect(overview.buildings[0]).not.toHaveProperty("imports");
    expect(overview.buildings[0]).not.toHaveProperty("routes");
    expect(overview.buildings[0]).not.toHaveProperty("evidence");
    expect(overview.links).toBe(links);
    expect(layout.districts[0].title).toBe("Catalog");
  });

  it("normalizes unknown selector values to Machine City", () => {
    expect(genesisCityKind("program")).toBe("program");
    expect(genesisCityKind("anything-else")).toBe("machine");
  });
});
