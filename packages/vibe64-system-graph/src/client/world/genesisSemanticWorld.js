function stableSort(values = [], selector = (value) => value) {
  return [...values].sort((left, right) => (
    String(selector(left)).localeCompare(String(selector(right)))
  ));
}

function genesisSemanticWorld(machineCity = null, programCity = null) {
  if (!machineCity || !programCity) {
    return null;
  }

  const machineBuildings = Array.isArray(machineCity.buildings) ? machineCity.buildings : [];
  const programBuildings = Array.isArray(programCity.buildings) ? programCity.buildings : [];
  const programDistricts = Array.isArray(programCity.districts) ? programCity.districts : [];
  const programLinks = Array.isArray(programCity.links) ? programCity.links : [];
  const machineBuildingsById = new Map(machineBuildings.map((building) => [building.id, building]));
  const operationsById = new Map(programBuildings.map((operation) => [operation.id, operation]));
  const districtsById = new Map(programDistricts.map((district) => [district.id, district]));

  const implementationLinks = stableSort(
    programLinks
      .filter((link) => link?.kind === "implemented-by")
      .map((link) => {
        const operation = operationsById.get(link.fromId);
        const file = machineBuildingsById.get(link.toId);
        const district = districtsById.get(operation?.districtId);
        if (!operation || !file || !district) {
          return null;
        }
        return {
          file,
          fileId: file.id,
          id: `${operation.id}->${file.id}`,
          kind: "implemented-by",
          operation,
          operationId: operation.id,
          subsystemId: district.id
        };
      })
      .filter(Boolean),
    (link) => link.id
  );
  const linksByOperationId = new Map();
  const linksBySubsystemId = new Map();
  for (const link of implementationLinks) {
    const operationLinks = linksByOperationId.get(link.operationId) || [];
    operationLinks.push(link);
    linksByOperationId.set(link.operationId, operationLinks);
    const subsystemLinks = linksBySubsystemId.get(link.subsystemId) || [];
    subsystemLinks.push(link);
    linksBySubsystemId.set(link.subsystemId, subsystemLinks);
  }

  const operations = stableSort(programBuildings, (operation) => operation.id).map((operation) => ({
    ...operation,
    implementationLinks: linksByOperationId.get(operation.id) || []
  }));
  const operationsByDistrictId = new Map();
  for (const operation of operations) {
    const entries = operationsByDistrictId.get(operation.districtId) || [];
    entries.push(operation);
    operationsByDistrictId.set(operation.districtId, entries);
  }

  const subsystems = stableSort(programDistricts, (district) => district.id).map((district) => {
    const subsystemOperations = operationsByDistrictId.get(district.id) || [];
    const subsystemLinks = linksBySubsystemId.get(district.id) || [];
    const files = stableSort(
      new Map(subsystemLinks.map((link) => [link.file.id, link.file])).values(),
      (file) => file.id
    );
    return {
      ...district,
      fileIds: files.map((file) => file.id),
      files,
      implementationLinks: subsystemLinks,
      operationIds: subsystemOperations.map((operation) => operation.id),
      operations: subsystemOperations
    };
  });

  return {
    implementationLinks,
    operations,
    subsystems
  };
}

export {
  genesisSemanticWorld
};
