import * as THREE from "three";

const IMPLEMENTATION_LINK_COLOR = 0xffe08a;
const IMPLEMENTATION_BUNDLE_COLOR = 0xaeb6c0;
const SUBSYSTEM_FILE_LINK_COLOR = 0x59e3ff;

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, value)));
}

function buildingLabel(building = {}) {
  return String(building.title || building.path || "unnamed file");
}

// Retained from the mature File City renderer: one atlas keeps hundreds of
// permanent file-name signs cheap enough to remain legible on every building.
function createBuildingLabelAtlas(buildings = [], maxAnisotropy = 1) {
  const names = [...new Set(buildings.map(buildingLabel).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  const cellHeight = 32;
  const cellWidth = 160;
  const columns = Math.max(1, Math.ceil(Math.sqrt(names.length * cellHeight / cellWidth)));
  const rows = Math.max(1, Math.ceil(names.length / columns));
  const canvas = document.createElement("canvas");
  canvas.width = nextPowerOfTwo(columns * cellWidth);
  canvas.height = nextPowerOfTwo(rows * cellHeight);
  const context = canvas.getContext("2d");
  const regions = new Map();
  context.font = "700 16px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";

  names.forEach((name, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = row * cellHeight;
    const centerX = x + cellWidth / 2;
    const centerY = y + cellHeight / 2;
    context.lineJoin = "round";
    context.lineWidth = 5;
    context.strokeStyle = "rgba(3, 7, 13, 0.96)";
    context.strokeText(name, centerX, centerY, cellWidth - 12);
    context.fillStyle = "#f8fbff";
    context.fillText(name, centerX, centerY, cellWidth - 12);
    regions.set(name, {
      u0: x / canvas.width,
      u1: (x + cellWidth) / canvas.width,
      v0: 1 - (y + cellHeight) / canvas.height,
      v1: 1 - y / canvas.height
    });
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = Math.min(8, maxAnisotropy);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { regions, texture };
}

// The mature renderer did not create one text object per directory. It drew
// every directory plaque into one atlas and rendered the whole set as one
// mesh. That distinction matters for real projects with hundreds of indexed
// directories: Troika text is useful for the handful of semantic labels, but
// it is far too expensive for the physical City fabric.
function createDistrictLabelAtlas(districts = [], maxAnisotropy = 1) {
  const names = [...new Set(districts.map((district) => (
    String(district.title || district.path || "Project")
  )))].sort((left, right) => left.localeCompare(right));
  const cellHeight = 64;
  const cellWidth = 256;
  const columns = Math.max(1, Math.ceil(Math.sqrt(names.length * cellHeight / cellWidth)));
  const rows = Math.max(1, Math.ceil(names.length / columns));
  const canvas = document.createElement("canvas");
  canvas.width = nextPowerOfTwo(columns * cellWidth);
  canvas.height = nextPowerOfTwo(rows * cellHeight);
  const context = canvas.getContext("2d");
  const regions = new Map();
  context.font = "700 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";

  names.forEach((name, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = row * cellHeight;
    context.fillStyle = "rgba(4, 9, 18, 0.86)";
    context.fillRect(x + 2, y + 2, cellWidth - 4, cellHeight - 4);
    context.strokeStyle = "rgba(151, 213, 239, 0.72)";
    context.lineWidth = 2;
    context.strokeRect(x + 3, y + 3, cellWidth - 6, cellHeight - 6);
    context.fillStyle = "#f5f8ff";
    context.fillText(name, x + cellWidth / 2, y + cellHeight / 2, cellWidth - 24);
    regions.set(name, {
      u0: x / canvas.width,
      u1: (x + cellWidth) / canvas.width,
      v0: 1 - (y + cellHeight) / canvas.height,
      v1: 1 - y / canvas.height
    });
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = Math.min(8, maxAnisotropy);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return { regions, texture };
}

function appendAtlasQuad(positions, uvs, corners, region) {
  const indices = [0, 1, 2, 0, 2, 3];
  const textureCoordinates = [
    [region.u0, region.v0],
    [region.u1, region.v0],
    [region.u1, region.v1],
    [region.u0, region.v1]
  ];
  for (const index of indices) {
    positions.push(...corners[index]);
    uvs.push(...textureCoordinates[index]);
  }
}

// Retained from the mature File City renderer. Each visible directory gets a
// plaque on its four vertical faces and around its upper rim, while the GPU
// still sees one geometry, one material, and one texture.
function createDistrictSurfaceLabels(districts = [], maxAnisotropy = 1) {
  if (districts.length === 0) {
    return null;
  }
  const { regions, texture } = createDistrictLabelAtlas(districts, maxAnisotropy);
  const positions = [];
  const uvs = [];

  function plaqueDimensions(availableWidth, name) {
    const width = Math.max(5, Math.min(availableWidth - 3, Math.max(30, name.length * 8 + 18)));
    return {
      height: Math.max(5, Math.min(20, width * 0.24)),
      width
    };
  }

  for (const district of districts) {
    const name = String(district.title || district.path || "Project");
    const region = regions.get(name);
    const halfWidth = district.width / 2;
    const halfDepth = district.footprintDepth / 2;
    const front = district.z + halfDepth + 1;
    const back = district.z - halfDepth - 1;
    const right = district.x + halfWidth + 1;
    const left = district.x - halfWidth - 1;
    const horizontal = plaqueDimensions(district.width, name);
    const vertical = plaqueDimensions(district.footprintDepth, name);
    const terraceTop = district.elevation + district.terraceHeight;
    const horizontalY1 = terraceTop - 2;
    const horizontalY0 = horizontalY1 - horizontal.height;
    const horizontalX0 = district.x - horizontal.width / 2;
    const horizontalX1 = district.x + horizontal.width / 2;
    const verticalY1 = terraceTop - 2;
    const verticalY0 = verticalY1 - vertical.height;
    const verticalZ0 = district.z - vertical.width / 2;
    const verticalZ1 = district.z + vertical.width / 2;

    appendAtlasQuad(positions, uvs, [
      [horizontalX0, horizontalY0, front],
      [horizontalX1, horizontalY0, front],
      [horizontalX1, horizontalY1, front],
      [horizontalX0, horizontalY1, front]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [horizontalX1, horizontalY0, back],
      [horizontalX0, horizontalY0, back],
      [horizontalX0, horizontalY1, back],
      [horizontalX1, horizontalY1, back]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [right, verticalY0, verticalZ1],
      [right, verticalY0, verticalZ0],
      [right, verticalY1, verticalZ0],
      [right, verticalY1, verticalZ1]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [left, verticalY0, verticalZ0],
      [left, verticalY0, verticalZ1],
      [left, verticalY1, verticalZ1],
      [left, verticalY1, verticalZ0]
    ], region);

    const topY = terraceTop + 0.65;
    const topInset = 2;
    const horizontalTopDepth = Math.max(2, Math.min(horizontal.height, halfDepth - topInset));
    const verticalTopDepth = Math.max(2, Math.min(vertical.height, halfWidth - topInset));
    const frontTop = district.z + halfDepth - horizontalTopDepth / 2 - topInset;
    const backTop = district.z - halfDepth + horizontalTopDepth / 2 + topInset;
    const rightTop = district.x + halfWidth - verticalTopDepth / 2 - topInset;
    const leftTop = district.x - halfWidth + verticalTopDepth / 2 + topInset;

    appendAtlasQuad(positions, uvs, [
      [horizontalX0, topY, frontTop + horizontalTopDepth / 2],
      [horizontalX1, topY, frontTop + horizontalTopDepth / 2],
      [horizontalX1, topY, frontTop - horizontalTopDepth / 2],
      [horizontalX0, topY, frontTop - horizontalTopDepth / 2]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [horizontalX1, topY, backTop - horizontalTopDepth / 2],
      [horizontalX0, topY, backTop - horizontalTopDepth / 2],
      [horizontalX0, topY, backTop + horizontalTopDepth / 2],
      [horizontalX1, topY, backTop + horizontalTopDepth / 2]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [rightTop + verticalTopDepth / 2, topY, verticalZ1],
      [rightTop + verticalTopDepth / 2, topY, verticalZ0],
      [rightTop - verticalTopDepth / 2, topY, verticalZ0],
      [rightTop - verticalTopDepth / 2, topY, verticalZ1]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [leftTop - verticalTopDepth / 2, topY, verticalZ0],
      [leftTop - verticalTopDepth / 2, topY, verticalZ1],
      [leftTop + verticalTopDepth / 2, topY, verticalZ1],
      [leftTop + verticalTopDepth / 2, topY, verticalZ0]
    ], region);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  const labels = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      alphaTest: 0.06,
      depthWrite: false,
      map: texture,
      side: THREE.DoubleSide,
      transparent: true
    })
  );
  labels.renderOrder = 4;
  labels.userData.disposables = [texture];
  return labels;
}

function createBuildingSurfaceLabels(buildings = [], maxAnisotropy = 1) {
  if (buildings.length === 0) {
    return null;
  }
  const { regions, texture } = createBuildingLabelAtlas(buildings, maxAnisotropy);
  const positions = [];
  const uvs = [];

  for (const building of buildings) {
    const region = regions.get(buildingLabel(building));
    const height = building.buildingHeight;
    const elevation = building.elevation;
    const roofHeight = Math.max(1.2, Math.min(3, height * 0.025));
    const roofWidth = Math.max(3, building.width * 0.86);
    const roofDepth = Math.max(3, building.footprintDepth * 0.86);
    const roofY = elevation + height + 1.6 + roofHeight / 2 + 0.15;

    if (roofWidth >= roofDepth) {
      const labelWidth = Math.max(2, roofWidth * 0.88);
      const labelDepth = Math.max(0.9, Math.min(roofDepth * 0.7, labelWidth * 0.2));
      appendAtlasQuad(positions, uvs, [
        [building.x - labelWidth / 2, roofY, building.z + labelDepth / 2],
        [building.x + labelWidth / 2, roofY, building.z + labelDepth / 2],
        [building.x + labelWidth / 2, roofY, building.z - labelDepth / 2],
        [building.x - labelWidth / 2, roofY, building.z - labelDepth / 2]
      ], region);
    } else {
      const labelDepth = Math.max(2, roofDepth * 0.88);
      const labelWidth = Math.max(0.9, Math.min(roofWidth * 0.7, labelDepth * 0.2));
      appendAtlasQuad(positions, uvs, [
        [building.x - labelWidth / 2, roofY, building.z - labelDepth / 2],
        [building.x - labelWidth / 2, roofY, building.z + labelDepth / 2],
        [building.x + labelWidth / 2, roofY, building.z + labelDepth / 2],
        [building.x + labelWidth / 2, roofY, building.z - labelDepth / 2]
      ], region);
    }

    const labelHeight = Math.max(3, height * 0.78);
    const y0 = elevation + 1 + (height - labelHeight) / 2;
    const y1 = y0 + labelHeight;
    const front = building.z + building.footprintDepth / 2 + 0.42;
    const back = building.z - building.footprintDepth / 2 - 0.42;
    const frontWidth = Math.max(1.1, Math.min(building.width * 0.7, labelHeight * 0.2));
    const frontX0 = building.x - frontWidth / 2;
    const frontX1 = building.x + frontWidth / 2;
    appendAtlasQuad(positions, uvs, [
      [frontX1, y0, front], [frontX1, y1, front], [frontX0, y1, front], [frontX0, y0, front]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [frontX0, y0, back], [frontX0, y1, back], [frontX1, y1, back], [frontX1, y0, back]
    ], region);

    const right = building.x + building.width / 2 + 0.42;
    const left = building.x - building.width / 2 - 0.42;
    const sideDepth = Math.max(1.1, Math.min(building.footprintDepth * 0.7, labelHeight * 0.2));
    const sideZ0 = building.z - sideDepth / 2;
    const sideZ1 = building.z + sideDepth / 2;
    appendAtlasQuad(positions, uvs, [
      [right, y0, sideZ0], [right, y1, sideZ0], [right, y1, sideZ1], [right, y0, sideZ1]
    ], region);
    appendAtlasQuad(positions, uvs, [
      [left, y0, sideZ1], [left, y1, sideZ1], [left, y1, sideZ0], [left, y0, sideZ0]
    ], region);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  const labels = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      alphaTest: 0.12,
      depthWrite: false,
      map: texture,
      side: THREE.DoubleSide,
      transparent: true
    })
  );
  labels.renderOrder = 3;
  labels.userData.disposables = [texture];
  return labels;
}

// Retained from the semantic File City: implementation evidence arcs from an
// operation node down to the exact Machine City building named by Genesis.
function createImplementationTether(from, to) {
  const midpoint = from.clone().lerp(to, 0.5);
  midpoint.y = Math.max(from.y, to.y) + 14 + Math.min(54, from.distanceTo(to) * 0.08);
  const curve = new THREE.QuadraticBezierCurve3(from, midpoint, to);
  const points = curve.getPoints(24);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: IMPLEMENTATION_LINK_COLOR,
      depthTest: true,
      depthWrite: false,
      opacity: 0.88,
      transparent: true
    })
  );
  line.renderOrder = 9;
  const arrowSize = 3.4;
  const direction = points.at(-1).clone().sub(points.at(-2)).normalize();
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(arrowSize, arrowSize * 2.5, 7),
    new THREE.MeshBasicMaterial({ color: IMPLEMENTATION_LINK_COLOR, depthWrite: false })
  );
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  arrow.position.copy(points.at(-1)).addScaledVector(direction, -arrowSize * 0.8);
  arrow.renderOrder = 9;
  const group = new THREE.Group();
  group.add(line, arrow);
  return group;
}

// Retained from the mature connection renderer. A subsystem's exact Genesis
// implementation links collect into a precinct-level trunk, then fan out over
// short last-mile links to their declared files. No dependency semantics are
// inferred: these are bundles of `implemented-by` evidence only.
function createImplementationBundleConnector(from, to, weight = 1) {
  const middle = from.clone().lerp(to, 0.5);
  middle.y = Math.max(from.y, to.y) + 52 + Math.min(120, from.distanceTo(to) * 0.1);
  const points = new THREE.QuadraticBezierCurve3(from, middle, to).getPoints(32);
  const density = Math.min(1, Math.log2(Math.max(1, weight)) / 5);
  const color = new THREE.Color(IMPLEMENTATION_BUNDLE_COLOR)
    .lerp(new THREE.Color(0x252a31), density)
    .getHex();
  const lineMaterial = new THREE.LineBasicMaterial({
    color,
    depthTest: true,
    depthWrite: false,
    opacity: 0.94,
    transparent: true
  });
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    lineMaterial
  );
  line.renderOrder = 8;
  const arrowSize = 3.8;
  const arrowMaterial = new THREE.MeshBasicMaterial({
    color,
    depthTest: true,
    depthWrite: false,
    opacity: 0.94,
    transparent: true
  });
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(arrowSize, arrowSize * 2.5, 8),
    arrowMaterial
  );
  const direction = points.at(-1).clone().sub(points.at(-2)).normalize();
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  arrow.position.copy(points.at(-1)).addScaledVector(direction, -arrowSize * 0.8);
  arrow.renderOrder = 8;
  const object = new THREE.Group();
  object.add(line, arrow);
  return {
    object,
    pickables: [line, arrow],
    setHighlighted(highlighted) {
      const nextColor = highlighted ? IMPLEMENTATION_LINK_COLOR : color;
      lineMaterial.color.setHex(nextColor);
      arrowMaterial.color.setHex(nextColor);
      lineMaterial.opacity = highlighted ? 1 : 0.94;
      arrowMaterial.opacity = highlighted ? 1 : 0.94;
    }
  };
}

function createImplementationLastMileConnector(from, to) {
  const middle = from.clone().lerp(to, 0.5);
  middle.y = Math.max(from.y, to.y) + 14 + Math.min(46, from.distanceTo(to) * 0.08);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(
      new THREE.QuadraticBezierCurve3(from, middle, to).getPoints(20)
    ),
    new THREE.LineBasicMaterial({
      color: IMPLEMENTATION_LINK_COLOR,
      depthTest: true,
      depthWrite: false,
      opacity: 0.9,
      transparent: true
    })
  );
  line.renderOrder = 9;
  return line;
}

// The old ownership tether, narrowed to what Genesis can actually prove: the
// subsystem participates in this file through at least one implemented-by link.
function createSubsystemFileTether(from, to) {
  const midpoint = from.clone().lerp(to, 0.5);
  midpoint.y = from.y * 0.56 + to.y * 0.44;
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(
      new THREE.QuadraticBezierCurve3(from, midpoint, to).getPoints(28)
    ),
    new THREE.LineBasicMaterial({
      color: SUBSYSTEM_FILE_LINK_COLOR,
      depthWrite: false,
      opacity: 0.58,
      transparent: true
    })
  );
  line.renderOrder = 7;
  return line;
}

export {
  createBuildingSurfaceLabels,
  createDistrictSurfaceLabels,
  createImplementationBundleConnector,
  createImplementationLastMileConnector,
  createImplementationTether,
  createSubsystemFileTether
};
