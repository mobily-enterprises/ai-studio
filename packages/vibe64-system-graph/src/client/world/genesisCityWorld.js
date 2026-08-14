const GENESIS_MACHINE_CITY_KIND = "machine";
const GENESIS_PROGRAM_CITY_KIND = "program";

function genesisCityKind(value = "") {
  return value === GENESIS_PROGRAM_CITY_KIND
    ? GENESIS_PROGRAM_CITY_KIND
    : GENESIS_MACHINE_CITY_KIND;
}

function genesisCityWorld(city = null, kind = GENESIS_MACHINE_CITY_KIND) {
  if (!city) {
    return null;
  }
  const normalizedKind = genesisCityKind(kind);
  const world = {
    buildings: city.buildings,
    cityKind: normalizedKind,
    cityLabel: normalizedKind === GENESIS_MACHINE_CITY_KIND
      ? "MACHINE CITY · FILES AND FUNCTIONS"
      : "PROGRAM CITY · SUBSYSTEMS AND OPERATIONS",
    districts: city.districts
  };
  if (normalizedKind === GENESIS_MACHINE_CITY_KIND) {
    world.functions = city.functions;
  } else {
    world.links = city.links;
  }
  return world;
}

export {
  GENESIS_MACHINE_CITY_KIND,
  GENESIS_PROGRAM_CITY_KIND,
  genesisCityKind,
  genesisCityWorld
};
