import {
  hierarchy,
  treemap,
  treemapSquarify
} from "d3-hierarchy";

const CITY_DEPTH = 920;
const CITY_WIDTH = 1_240;
const DISTRICT_ELEVATION_STEP = 8;
const DISTRICT_INSET = 5;
const DISTRICT_LABEL_GUTTER = 24;
const DISTRICT_TERRACE_HEIGHT = 4;
const BUILDING_HEIGHT_MAX = 290;

function stableHash(value = "") {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableSort(values = [], selector = (value) => value) {
  return [...values].sort((left, right) => (
    String(selector(left)).localeCompare(String(selector(right)))
  ));
}

function machineBuildingHeight(lines = 0) {
  const lineCount = Math.max(0, Number(lines) || 0);
  return 12 + Math.min(BUILDING_HEIGHT_MAX - 12, Math.pow(lineCount, 0.62) * 1.75);
}

function buildingHeight(building = {}, cityKind = "machine") {
  return cityKind === "program" ? 38 : machineBuildingHeight(building.lines);
}

function buildingWeight(building = {}, cityKind = "machine") {
  if (cityKind === "program") {
    return 1;
  }
  return Math.max(8, Number(building.lines) || 0);
}

function districtTree(districts = [], buildings = []) {
  const nodes = new Map(stableSort(districts, (district) => district.id).map((district) => [
    district.id,
    {
      children: [],
      district,
      type: "district",
      weight: 8
    }
  ]));

  for (const district of districts) {
    if (district.parentId !== null) {
      nodes.get(district.parentId).children.push(nodes.get(district.id));
    }
  }

  for (const building of stableSort(buildings, (entry) => entry.id)) {
    nodes.get(building.districtId).children.push({
      building,
      children: [],
      type: "building",
      weight: 0
    });
  }

  const roots = stableSort(
    districts.filter((district) => district.parentId === null).map((district) => nodes.get(district.id)),
    (node) => node.district.id
  );
  return {
    children: roots,
    type: "city",
    weight: 0
  };
}

function assertAcyclicDistricts(districts = []) {
  const districtsById = new Map(districts.map((district) => [district.id, district]));
  for (const district of districts) {
    const ancestry = new Set();
    let current = district;
    while (current) {
      if (ancestry.has(current.id)) {
        throw new TypeError(`Genesis City district hierarchy contains a cycle at ${current.id}.`);
      }
      ancestry.add(current.id);
      current = current.parentId === null ? null : districtsById.get(current.parentId);
    }
  }
}

function descendantBuildings(node) {
  return node.leaves().map((leaf) => leaf.data.building).filter(Boolean);
}

function layoutGenesisCity(city = {}) {
  const cityKind = city.cityKind === "program" ? "program" : "machine";
  const districts = Array.isArray(city.districts) ? city.districts : [];
  const buildings = Array.isArray(city.buildings) ? city.buildings : [];
  if (districts.length === 0) {
    return {
      bounds: {
        depth: CITY_DEPTH,
        height: 0,
        width: CITY_WIDTH
      },
      buildings: [],
      cityKind,
      cityLabel: city.cityLabel || "GENESIS CITY",
      districts: []
    };
  }

  assertAcyclicDistricts(districts);
  const tree = districtTree(districts, buildings);
  const root = hierarchy(tree, (node) => node.children)
    .sum((node) => node.type === "building"
      ? buildingWeight(node.building, cityKind)
      : node.weight)
    .sort((left, right) => (
      right.value - left.value || String(left.data.district?.id || left.data.building?.id || "")
        .localeCompare(String(right.data.district?.id || right.data.building?.id || ""))
    ));

  treemap()
    .size([CITY_WIDTH, CITY_DEPTH])
    .paddingOuter(DISTRICT_INSET)
    .paddingInner(DISTRICT_INSET)
    .paddingTop((node) => node.data.type === "district" ? DISTRICT_LABEL_GUTTER : 0)
    .round(true)
    .tile(treemapSquarify)(root);

  const districtLayouts = [];
  const buildingLayouts = [];
  const districtAncestors = new Map();

  for (const node of root.descendants()) {
    if (node.data.type !== "district") {
      continue;
    }
    const district = node.data.district;
    const hierarchyDepth = Math.max(0, node.depth - 1);
    const elevation = hierarchyDepth * DISTRICT_ELEVATION_STEP;
    const descendants = descendantBuildings(node);
    const ancestorIds = node.ancestors()
      .filter((ancestor) => ancestor.data.type === "district")
      .map((ancestor) => ancestor.data.district.id)
      .reverse();
    districtAncestors.set(district.id, ancestorIds);
    districtLayouts.push({
      ...district,
      ancestorIds,
      buildingCount: descendants.length,
      directBuildingCount: node.children?.filter((child) => child.data.type === "building").length || 0,
      elevation,
      footprintDepth: Math.max(3, node.y1 - node.y0),
      hierarchyDepth,
      lines: cityKind === "machine"
        ? descendants.reduce((total, building) => total + Math.max(0, Number(building.lines) || 0), 0)
        : 0,
      terraceHeight: DISTRICT_TERRACE_HEIGHT,
      width: Math.max(3, node.x1 - node.x0),
      x: (node.x0 + node.x1) / 2 - CITY_WIDTH / 2,
      z: (node.y0 + node.y1) / 2 - CITY_DEPTH / 2
    });
  }

  const districtsById = new Map(districtLayouts.map((district) => [district.id, district]));
  for (const leaf of root.leaves()) {
    if (leaf.data.type !== "building") {
      continue;
    }
    const building = leaf.data.building;
    const district = districtsById.get(building.districtId);
    const height = buildingHeight(building, cityKind);
    buildingLayouts.push({
      ...building,
      ancestorDistrictIds: districtAncestors.get(building.districtId) || [building.districtId],
      buildingHeight: height,
      elevation: district.elevation + DISTRICT_TERRACE_HEIGHT,
      footprintDepth: Math.max(4, leaf.y1 - leaf.y0 - 2),
      width: Math.max(4, leaf.x1 - leaf.x0 - 2),
      x: (leaf.x0 + leaf.x1) / 2 - CITY_WIDTH / 2,
      z: (leaf.y0 + leaf.y1) / 2 - CITY_DEPTH / 2
    });
  }

  const maximumHeight = buildingLayouts.reduce((highest, building) => Math.max(
    highest,
    building.elevation + building.buildingHeight
  ), 0);

  return {
    bounds: {
      depth: CITY_DEPTH,
      height: maximumHeight,
      width: CITY_WIDTH
    },
    buildings: stableSort(buildingLayouts, (building) => building.id),
    cityKind,
    cityLabel: city.cityLabel || "GENESIS CITY",
    districts: stableSort(districtLayouts, (district) => district.id)
  };
}

export {
  BUILDING_HEIGHT_MAX,
  CITY_DEPTH,
  CITY_WIDTH,
  DISTRICT_ELEVATION_STEP,
  DISTRICT_TERRACE_HEIGHT,
  buildingHeight,
  layoutGenesisCity,
  stableHash
};
