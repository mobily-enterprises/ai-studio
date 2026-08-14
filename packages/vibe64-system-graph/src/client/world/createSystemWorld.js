import * as THREE from "three";
import CameraControls from "camera-controls";
import { Text } from "troika-three-text";

import {
  layoutGenesisCity,
  stableHash
} from "./worldLayout.js";

CameraControls.install({ THREE });

const BUILDING_DOUBLE_TAP_WINDOW_MS = 360;
const BUILDING_PORTAL_DURATION_MS = 260;
const DIMMED_BUILDING_COLOR = 0x303640;
const DIMMED_DISTRICT_COLOR = 0x202730;
const DIMMED_ROOF_COLOR = 0x474e59;
const SELECTED_BUILDING_COLOR = 0x75f3ff;
const WHEEL_GESTURE_IDLE_MS = 180;

function hashedColor(value = "", {
  lightness = 0.46,
  saturation = 0.58
} = {}) {
  const hue = (stableHash(value) % 360) / 360;
  return new THREE.Color().setHSL(hue, saturation, lightness).getHex();
}

function districtColor(district = {}) {
  return hashedColor(district.id, {
    lightness: Math.max(0.2, 0.3 - district.hierarchyDepth * 0.018),
    saturation: 0.5
  });
}

function buildingColor(building = {}, cityKind = "machine") {
  const identity = cityKind === "program"
    ? building.districtId
    : building.language || building.districtId;
  return hashedColor(identity, {
    lightness: cityKind === "program" ? 0.53 : 0.48,
    saturation: cityKind === "program" ? 0.66 : 0.58
  });
}

function boxGeometryWithFaceShading() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const normals = geometry.getAttribute("normal");
  const colors = [];
  for (let index = 0; index < normals.count; index += 1) {
    const normalX = normals.getX(index);
    const normalY = normals.getY(index);
    const shade = normalY > 0.5
      ? 1
      : normalY < -0.5
        ? 0.38
        : Math.abs(normalX) > 0.5
          ? 0.78
          : 0.62;
    colors.push(shade, shade, shade);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  material?.dispose?.();
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    disposeMaterial(child.material);
    child.dispose?.();
  });
}

function textObject(text, {
  anchorX = "center",
  anchorY = "middle",
  color = 0xffffff,
  fontSize = 16,
  maxWidth = 220,
  onSync = () => {},
  position = new THREE.Vector3()
} = {}) {
  const label = new Text();
  label.text = String(text || "");
  label.color = color;
  label.fontSize = fontSize;
  label.maxWidth = maxWidth;
  label.anchorX = anchorX;
  label.anchorY = anchorY;
  label.outlineColor = 0x06101c;
  label.outlineWidth = Math.max(0.5, fontSize * 0.045);
  label.position.copy(position);
  label.userData.billboard = true;
  label.sync(onSync);
  return label;
}

function normalizedViewPose(view = {}) {
  if (!Array.isArray(view.position) || !Array.isArray(view.target)) {
    return null;
  }
  return {
    position: [
      Number(view.position[0]) || 0,
      Number(view.position[1]) || 0,
      Number(view.position[2]) || 0
    ],
    target: [
      Number(view.target[0]) || 0,
      Number(view.target[1]) || 0,
      Number(view.target[2]) || 0
    ]
  };
}

function createSystemWorld({
  canvas,
  onClearSelection = () => {},
  onOpenBuilding = () => {},
  onSelectBuilding = () => {},
  onSelectDistrict = () => {},
  reducedMotion = false
} = {}) {
  if (!canvas) {
    throw new TypeError("createSystemWorld requires a canvas.");
  }

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    powerPreference: "high-performance"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(1.15, globalThis.devicePixelRatio || 1));
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050914);
  const camera = new THREE.PerspectiveCamera(42, 1, 1, 16_000);
  camera.position.set(0, 980, 1_150);
  const controls = new CameraControls(camera, canvas);
  controls.dollyToCursor = true;
  controls.infinityDolly = false;
  controls.draggingSmoothTime = 0;
  controls.smoothTime = reducedMotion ? 0 : 0.18;
  controls.azimuthRotateSpeed = 0.32;
  controls.polarRotateSpeed = 0.28;
  controls.dollySpeed = 1.15;
  controls.truckSpeed = 2.2;
  controls.minDistance = 55;
  controls.maxDistance = 12_000;
  controls.minPolarAngle = Math.PI * 0.02;
  controls.maxPolarAngle = Math.PI * 0.98;
  controls.mouseButtons.left = CameraControls.ACTION.NONE;
  controls.mouseButtons.middle = CameraControls.ACTION.TRUCK;
  controls.mouseButtons.right = CameraControls.ACTION.ROTATE;
  controls.mouseButtons.wheel = CameraControls.ACTION.DOLLY;
  controls.touches.one = CameraControls.ACTION.TOUCH_TRUCK;
  controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_ROTATE;
  controls.setLookAt(0, 980, 1_150, 0, 0, 0, false);

  const worldRoot = new THREE.Group();
  const portalRoot = new THREE.Group();
  scene.add(worldRoot, portalRoot);

  const buildingObjects = new Map();
  const districtObjects = new Map();
  const pickables = [];
  const raycaster = new THREE.Raycaster();
  const navigationPointer = new THREE.Vector2();
  const pointer = new THREE.Vector2();
  let active = true;
  let buildingInstances = null;
  let cityLayout = null;
  let dirty = true;
  let districtInstances = null;
  let grabState = null;
  let lastFrame = performance.now();
  let lastTouchBuildingTap = { at: -Infinity, buildingId: "" };
  let pointerDown = null;
  let portal = null;
  let roofInstances = null;
  let selectedBuildingId = "";
  let selectedDistrictId = "";
  let suppressSyntheticDoubleClickUntil = -Infinity;
  let wheelGestureAction = CameraControls.ACTION.DOLLY;
  let wheelGestureAt = -Infinity;

  function markDirty() {
    dirty = true;
  }

  function clearGroup(group) {
    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
      disposeObject(child);
    }
  }

  function clearPortal() {
    clearGroup(portalRoot);
    portal = null;
    markDirty();
  }

  function clearWorld() {
    clearGroup(worldRoot);
    clearPortal();
    buildingObjects.clear();
    districtObjects.clear();
    pickables.splice(0);
    buildingInstances = null;
    cityLayout = null;
    districtInstances = null;
    roofInstances = null;
    selectedBuildingId = "";
    selectedDistrictId = "";
    markDirty();
  }

  function addLabel(value, options = {}) {
    const label = textObject(value, { ...options, onSync: markDirty });
    worldRoot.add(label);
    return label;
  }

  function addCityLabel(layout) {
    addLabel(layout.cityLabel, {
      color: 0x8edfff,
      fontSize: 28,
      maxWidth: 680,
      position: new THREE.Vector3(0, 48, -layout.bounds.depth / 2 - 34)
    });
  }

  function addDistricts(layout) {
    if (layout.districts.length === 0) {
      return;
    }
    districtInstances = new THREE.InstancedMesh(
      boxGeometryWithFaceShading(),
      new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
      layout.districts.length
    );
    districtInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    districtInstances.userData.districtIds = [];
    districtInstances.userData.kind = "districts";
    const transform = new THREE.Object3D();

    layout.districts.forEach((district, index) => {
      const baseColor = districtColor(district);
      transform.position.set(
        district.x,
        district.elevation + district.terraceHeight / 2,
        district.z
      );
      transform.scale.set(district.width, district.terraceHeight, district.footprintDepth);
      transform.updateMatrix();
      districtInstances.setMatrixAt(index, transform.matrix);
      districtInstances.setColorAt(index, new THREE.Color(baseColor));
      districtInstances.userData.districtIds[index] = district.id;
      districtObjects.set(district.id, { baseColor, district, index });

      if (district.width >= 42 && district.footprintDepth >= 32) {
        addLabel(district.title, {
          anchorX: "left",
          color: 0xd9f3ff,
          fontSize: Math.max(10, 16 - district.hierarchyDepth),
          maxWidth: Math.max(34, district.width - 16),
          position: new THREE.Vector3(
            district.x - district.width / 2 + 10,
            district.elevation + district.terraceHeight + 7,
            district.z - district.footprintDepth / 2 + 12
          )
        });
      }
    });
    districtInstances.instanceColor.needsUpdate = true;
    districtInstances.computeBoundingBox();
    districtInstances.computeBoundingSphere();
    worldRoot.add(districtInstances);
    pickables.push(districtInstances);
  }

  function buildingEdges(buildings = []) {
    const positions = [];
    const edgePairs = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    for (const building of buildings) {
      const halfWidth = building.width / 2 + 0.35;
      const halfDepth = building.footprintDepth / 2 + 0.35;
      const bottom = building.elevation + 0.8;
      const top = building.elevation + building.buildingHeight + 1.4;
      const corners = [
        [building.x - halfWidth, bottom, building.z - halfDepth],
        [building.x + halfWidth, bottom, building.z - halfDepth],
        [building.x + halfWidth, bottom, building.z + halfDepth],
        [building.x - halfWidth, bottom, building.z + halfDepth],
        [building.x - halfWidth, top, building.z - halfDepth],
        [building.x + halfWidth, top, building.z - halfDepth],
        [building.x + halfWidth, top, building.z + halfDepth],
        [building.x - halfWidth, top, building.z + halfDepth]
      ];
      for (const [from, to] of edgePairs) {
        positions.push(...corners[from], ...corners[to]);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const edges = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x6b7280, depthWrite: false })
    );
    edges.renderOrder = 2;
    return edges;
  }

  function addBuildings(layout) {
    if (layout.buildings.length === 0) {
      return;
    }
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    buildingInstances = new THREE.InstancedMesh(
      boxGeometryWithFaceShading(),
      material,
      layout.buildings.length
    );
    roofInstances = new THREE.InstancedMesh(
      boxGeometryWithFaceShading(),
      material.clone(),
      layout.buildings.length
    );
    buildingInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    buildingInstances.userData.buildingIds = [];
    buildingInstances.userData.kind = "buildings";
    roofInstances.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const transform = new THREE.Object3D();

    layout.buildings.forEach((building, index) => {
      const height = building.buildingHeight;
      const baseColor = buildingColor(building, layout.cityKind);
      transform.position.set(building.x, building.elevation + height / 2 + 1, building.z);
      transform.scale.set(building.width, height, building.footprintDepth);
      transform.updateMatrix();
      buildingInstances.setMatrixAt(index, transform.matrix);
      buildingInstances.setColorAt(index, new THREE.Color(baseColor));

      const roofHeight = Math.max(1.2, Math.min(3, height * 0.025));
      transform.position.set(building.x, building.elevation + height + 1.6, building.z);
      transform.scale.set(
        Math.max(3, building.width * 0.86),
        roofHeight,
        Math.max(3, building.footprintDepth * 0.86)
      );
      transform.updateMatrix();
      roofInstances.setMatrixAt(index, transform.matrix);
      const roofColor = new THREE.Color(baseColor).offsetHSL(0, -0.08, 0.16).getHex();
      roofInstances.setColorAt(index, new THREE.Color(roofColor));

      buildingInstances.userData.buildingIds[index] = building.id;
      buildingObjects.set(building.id, {
        baseColor,
        building,
        index,
        roofColor
      });
    });
    buildingInstances.instanceColor.needsUpdate = true;
    roofInstances.instanceColor.needsUpdate = true;
    buildingInstances.computeBoundingBox();
    buildingInstances.computeBoundingSphere();
    roofInstances.computeBoundingBox();
    roofInstances.computeBoundingSphere();
    worldRoot.add(buildingInstances, roofInstances, buildingEdges(layout.buildings));
    pickables.push(buildingInstances);
  }

  function selectedDistrictRelated(district = {}) {
    if (!selectedDistrictId) {
      return false;
    }
    const selected = districtObjects.get(selectedDistrictId)?.district;
    return district.id === selectedDistrictId ||
      district.ancestorIds.includes(selectedDistrictId) ||
      selected?.ancestorIds.includes(district.id);
  }

  function applySelectionStyles() {
    const contextActive = Boolean(selectedBuildingId || selectedDistrictId);
    const selectedBuilding = buildingObjects.get(selectedBuildingId)?.building;

    for (const [buildingId, record] of buildingObjects) {
      const selected = buildingId === selectedBuildingId;
      const inDistrict = selectedDistrictId && record.building.ancestorDistrictIds.includes(selectedDistrictId);
      const dimmed = contextActive && !selected && !inDistrict;
      const color = new THREE.Color(
        selected
          ? SELECTED_BUILDING_COLOR
          : dimmed
            ? DIMMED_BUILDING_COLOR
            : record.baseColor
      );
      if (inDistrict && !selected) {
        color.offsetHSL(0, 0.05, 0.12);
      }
      buildingInstances?.setColorAt(record.index, color);
      roofInstances?.setColorAt(
        record.index,
        dimmed
          ? new THREE.Color(DIMMED_ROOF_COLOR)
          : color.clone().offsetHSL(0, -0.06, selected ? 0.2 : 0.12)
      );
    }
    if (buildingInstances?.instanceColor) {
      buildingInstances.instanceColor.needsUpdate = true;
    }
    if (roofInstances?.instanceColor) {
      roofInstances.instanceColor.needsUpdate = true;
    }

    for (const [districtId, record] of districtObjects) {
      const selected = districtId === selectedDistrictId;
      const containsBuilding = selectedBuilding?.ancestorDistrictIds.includes(districtId);
      const related = selectedDistrictRelated(record.district);
      const dimmed = contextActive && !selected && !containsBuilding && !related;
      const color = new THREE.Color(dimmed ? DIMMED_DISTRICT_COLOR : record.baseColor);
      if (selected || containsBuilding) {
        color.lerp(new THREE.Color(SELECTED_BUILDING_COLOR), selected ? 0.62 : 0.28);
      }
      districtInstances?.setColorAt(record.index, color);
    }
    if (districtInstances?.instanceColor) {
      districtInstances.instanceColor.needsUpdate = true;
    }
    markDirty();
  }

  function selectBuilding(buildingId = "") {
    const normalizedId = String(buildingId || "");
    if (normalizedId && !buildingObjects.has(normalizedId)) {
      return false;
    }
    selectedBuildingId = normalizedId;
    selectedDistrictId = "";
    applySelectionStyles();
    return true;
  }

  function selectDistrict(districtId = "") {
    const normalizedId = String(districtId || "");
    if (normalizedId && !districtObjects.has(normalizedId)) {
      return false;
    }
    selectedBuildingId = "";
    selectedDistrictId = normalizedId;
    applySelectionStyles();
    return normalizedId ? districtObjects.get(normalizedId).district : true;
  }

  function clearSelection() {
    selectedBuildingId = "";
    selectedDistrictId = "";
    applySelectionStyles();
  }

  function captureView() {
    return {
      position: camera.position.toArray(),
      target: controls.getTarget(new THREE.Vector3()).toArray()
    };
  }

  function restoreView(view = {}) {
    const pose = normalizedViewPose(view);
    if (!pose) {
      return false;
    }
    controls.setLookAt(...pose.position, ...pose.target, false);
    markDirty();
    return true;
  }

  async function flyToView(view = {}) {
    const pose = normalizedViewPose(view);
    if (!pose) {
      return false;
    }
    await controls.setLookAt(...pose.position, ...pose.target, !reducedMotion);
    markDirty();
    return true;
  }

  function buildingFocusPose(record) {
    const building = record.building;
    const footprint = Math.max(building.width, building.footprintDepth);
    const distance = Math.max(150, building.buildingHeight * 2.5, footprint * 5.5);
    return {
      position: [
        building.x + distance * 0.42,
        building.elevation + building.buildingHeight + distance * 0.72,
        building.z + distance * 0.68
      ],
      target: [
        building.x,
        building.elevation + building.buildingHeight * 0.38,
        building.z
      ]
    };
  }

  function focusBuilding(buildingId = "") {
    const record = buildingObjects.get(String(buildingId || ""));
    if (!record) {
      return false;
    }
    const pose = buildingFocusPose(record);
    void controls.setLookAt(...pose.position, ...pose.target, !reducedMotion);
    markDirty();
    return true;
  }

  async function flyToBuilding(buildingId = "") {
    const record = buildingObjects.get(String(buildingId || ""));
    if (!record) {
      return null;
    }
    const pose = buildingFocusPose(record);
    await controls.setLookAt(...pose.position, ...pose.target, !reducedMotion);
    markDirty();
    return buildingScreenRect(buildingId);
  }

  function focusDistrict(districtId = "") {
    const record = districtObjects.get(String(districtId || ""));
    if (!record) {
      return false;
    }
    const district = record.district;
    const span = Math.max(district.width, district.footprintDepth);
    const distance = Math.max(180, span * 1.45);
    controls.setLookAt(
      district.x + distance * 0.25,
      district.elevation + distance * 0.92,
      district.z + distance * 0.72,
      district.x,
      district.elevation,
      district.z,
      !reducedMotion
    );
    markDirty();
    return true;
  }

  async function fitWorld(smooth = true) {
    if (!cityLayout) {
      return false;
    }
    const span = Math.max(cityLayout.bounds.width, cityLayout.bounds.depth, 260);
    const targetY = cityLayout.bounds.height * 0.18;
    await controls.setLookAt(
      span * 0.18,
      targetY + span * 0.72,
      span * 0.86,
      0,
      targetY,
      0,
      smooth && !reducedMotion
    );
    markDirty();
    return true;
  }

  function setView(view = "perspective") {
    if (!cityLayout) {
      return false;
    }
    const span = Math.max(cityLayout.bounds.width, cityLayout.bounds.depth, 260);
    const targetY = cityLayout.bounds.height * 0.18;
    if (view === "top") {
      controls.setLookAt(0, targetY + span * 1.12, 0.01, 0, targetY, 0, !reducedMotion);
    } else {
      controls.setLookAt(0, targetY + span * 0.72, span * 0.86, 0, targetY, 0, !reducedMotion);
    }
    markDirty();
    return true;
  }

  function rotateView(azimuthDegrees = 0, polarDegrees = 0, smooth = true) {
    controls.rotate(
      THREE.MathUtils.degToRad(Number(azimuthDegrees) || 0),
      THREE.MathUtils.degToRad(Number(polarDegrees) || 0),
      smooth && !reducedMotion
    );
    markDirty();
  }

  function projectedPoint(x, y, z, bounds) {
    const projected = new THREE.Vector3(x, y, z).project(camera);
    return {
      x: bounds.left + (projected.x + 1) * bounds.width / 2,
      y: bounds.top + (1 - projected.y) * bounds.height / 2
    };
  }

  function buildingScreenRect(buildingId = "") {
    const record = buildingObjects.get(String(buildingId || ""));
    if (!record) {
      return null;
    }
    const building = record.building;
    const bounds = canvas.getBoundingClientRect();
    const halfWidth = Math.max(1, building.width / 2);
    const halfDepth = Math.max(1, building.footprintDepth / 2);
    const points = [];
    camera.updateMatrixWorld();
    for (const x of [building.x - halfWidth, building.x + halfWidth]) {
      for (const y of [building.elevation, building.elevation + building.buildingHeight + 3]) {
        for (const z of [building.z - halfDepth, building.z + halfDepth]) {
          points.push(projectedPoint(x, y, z, bounds));
        }
      }
    }
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const width = Math.max(20, maxX - minX);
    const height = Math.max(28, maxY - minY);
    return {
      height,
      width,
      x: (minX + maxX - width) / 2,
      y: (minY + maxY - height) / 2
    };
  }

  function createPortalObject(record) {
    const building = record.building;
    const group = new THREE.Group();
    const shellMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: SELECTED_BUILDING_COLOR,
      depthWrite: false,
      opacity: 0.72,
      transparent: true
    });
    const shellGeometry = new THREE.BoxGeometry(
      Math.max(3, building.width * 1.035),
      building.buildingHeight,
      Math.max(3, building.footprintDepth * 1.035)
    );
    const shell = new THREE.Mesh(shellGeometry, shellMaterial);
    shell.position.y = building.buildingHeight / 2 + 1;
    shell.renderOrder = 12;
    const outlineMaterial = new THREE.LineBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: 0xd8fbff,
      depthTest: false,
      depthWrite: false,
      opacity: 0.95,
      transparent: true
    });
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(shellGeometry), outlineMaterial);
    outline.position.copy(shell.position);
    outline.renderOrder = 13;

    const ringMaterials = [];
    const radius = Math.max(8, Math.max(building.width, building.footprintDepth) * 0.72);
    for (let index = 0; index < 3; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: index === 1 ? 0xb59cff : SELECTED_BUILDING_COLOR,
        depthTest: false,
        depthWrite: false,
        opacity: 0.72,
        side: THREE.DoubleSide,
        transparent: true
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius + 1.8, 48), material);
      ring.position.y = 1.2 + index * 1.5;
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 14;
      ring.userData.portalRingIndex = index;
      ringMaterials.push(material);
      group.add(ring);
    }
    group.add(shell, outline);
    group.position.set(building.x, building.elevation, building.z);
    return { group, outlineMaterial, ringMaterials, shellMaterial };
  }

  function beginBuildingPortal(buildingId = "") {
    const normalizedId = String(buildingId || "");
    const record = buildingObjects.get(normalizedId);
    if (!record) {
      return null;
    }
    clearPortal();
    const object = createPortalObject(record);
    portalRoot.add(object.group);
    portal = {
      ...object,
      amount: reducedMotion ? 1 : 0,
      baseY: record.building.elevation,
      buildingId: normalizedId,
      height: record.building.buildingHeight,
      phase: reducedMotion ? "open" : "opening",
      phaseAt: performance.now(),
      phaseStartAmount: reducedMotion ? 1 : 0
    };
    markDirty();
    return buildingScreenRect(normalizedId);
  }

  function endBuildingPortal({ immediate = false } = {}) {
    if (!portal) {
      return;
    }
    if (immediate || reducedMotion) {
      clearPortal();
      return;
    }
    portal.phase = "closing";
    portal.phaseAt = performance.now();
    portal.phaseStartAmount = portal.amount;
    markDirty();
  }

  function updatePortal(now) {
    if (!portal) {
      return;
    }
    const elapsed = now - portal.phaseAt;
    if (portal.phase === "opening") {
      const progress = Math.min(1, elapsed / BUILDING_PORTAL_DURATION_MS);
      portal.amount = 1 - (1 - progress) ** 3;
      if (progress >= 1) {
        portal.phase = "open";
        portal.phaseAt = now;
      }
    } else if (portal.phase === "closing") {
      const progress = Math.min(1, elapsed / (BUILDING_PORTAL_DURATION_MS * 0.72));
      portal.amount = portal.phaseStartAmount * (1 - progress ** 2);
      if (progress >= 1) {
        clearPortal();
        return;
      }
    }

    const pulse = (Math.sin(now * 0.0045) + 1) / 2;
    const amount = portal.amount;
    portal.group.position.y = portal.baseY + amount * (18 + portal.height * 0.13);
    portal.group.rotation.y = amount * (0.045 + pulse * 0.035);
    portal.group.scale.setScalar(1 + amount * (0.035 + pulse * 0.018));
    portal.shellMaterial.opacity = amount * (0.54 + pulse * 0.2);
    portal.outlineMaterial.opacity = amount * (0.72 + pulse * 0.28);
    portal.group.children.forEach((child) => {
      const index = child.userData.portalRingIndex;
      if (!Number.isInteger(index)) {
        return;
      }
      const cycle = (now * 0.0007 + index / 3) % 1;
      child.scale.setScalar(0.75 + cycle * 1.15);
      portal.ringMaterials[index].opacity = amount * (1 - cycle) * 0.7;
    });
    markDirty();
  }

  async function setOverview(overview = {}) {
    clearWorld();
    cityLayout = layoutGenesisCity(overview);
    addCityLabel(cityLayout);
    addDistricts(cityLayout);
    addBuildings(cityLayout);
    applySelectionStyles();
    await fitWorld(false);
    return cityLayout;
  }

  function resize(width, height) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    renderer.setSize(nextWidth, nextHeight, false);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    markDirty();
  }

  function updateBillboards() {
    worldRoot.traverse((object) => {
      if (object.userData.billboard) {
        object.quaternion.copy(camera.quaternion);
      }
    });
  }

  function frame(now = performance.now()) {
    const delta = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    updatePortal(now);
    const controlsChanged = controls.update(delta);
    if (!active || (!dirty && !controlsChanged)) {
      return;
    }
    updateBillboards();
    renderer.render(scene, camera);
    dirty = false;
  }

  function pointerNdc(event, target = pointer) {
    const bounds = canvas.getBoundingClientRect();
    target.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    target.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    return target;
  }

  function pickedIntersection(event) {
    pointerNdc(event);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(pickables, false)[0] || null;
  }

  function handlePointerDown(event) {
    if (document.activeElement !== canvas) {
      canvas.focus({ preventScroll: true });
    }
    if (event.button !== 0) {
      pointerDown = null;
      return;
    }
    pointerDown = { x: event.clientX, y: event.clientY };
    const target = controls.getTarget(new THREE.Vector3());
    const anchor = pickedIntersection(event)?.point?.clone() || target.clone();
    camera.updateMatrixWorld(true);
    const dragCamera = camera.clone();
    dragCamera.updateMatrixWorld(true);
    grabState = {
      anchor,
      camera: dragCamera,
      delta: new THREE.Vector3(),
      depth: anchor.clone().project(dragCamera).z,
      pointer: new THREE.Vector3(),
      pointerId: event.pointerId,
      position: camera.position.clone(),
      target
    };
    canvas.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    pointerNdc(event, navigationPointer);
    if (!grabState || event.pointerId !== grabState.pointerId) {
      return;
    }
    pointerNdc(event, grabState.pointer);
    grabState.pointer.z = grabState.depth;
    grabState.pointer.unproject(grabState.camera);
    grabState.delta.subVectors(grabState.anchor, grabState.pointer);
    controls.setLookAt(
      grabState.position.x + grabState.delta.x,
      grabState.position.y + grabState.delta.y,
      grabState.position.z + grabState.delta.z,
      grabState.target.x + grabState.delta.x,
      grabState.target.y + grabState.delta.y,
      grabState.target.z + grabState.delta.z,
      false
    );
    event.preventDefault();
    markDirty();
  }

  function walkTowardPointer(distance = 0, smooth = true) {
    const step = Number(distance) || 0;
    if (step === 0) {
      return;
    }
    camera.updateMatrixWorld(true);
    raycaster.setFromCamera(navigationPointer, camera);
    const offset = raycaster.ray.direction.clone().multiplyScalar(step);
    const position = controls.getPosition(new THREE.Vector3());
    const target = controls.getTarget(new THREE.Vector3());
    controls.setLookAt(
      position.x + offset.x,
      position.y + offset.y,
      position.z + offset.z,
      target.x + offset.x,
      target.y + offset.y,
      target.z + offset.z,
      smooth && !reducedMotion
    );
    markDirty();
  }

  function handleKeyDown(event) {
    if (event.defaultPrevented || event.altKey || event.metaKey) {
      return;
    }
    const distance = controls.distance;
    const dollyStep = Math.min(240, Math.max(16, distance * 0.08));
    const truckStep = Math.min(160, Math.max(12, distance * 0.05));
    const smooth = !reducedMotion;
    let handled = true;

    if (event.ctrlKey) {
      if (event.key === "ArrowUp") {
        walkTowardPointer(dollyStep, smooth);
      } else if (event.key === "ArrowDown") {
        walkTowardPointer(-dollyStep, smooth);
      } else {
        return;
      }
    } else {
      switch (event.key) {
        case "ArrowLeft":
          void controls.truck(-truckStep, 0, smooth);
          break;
        case "ArrowRight":
          void controls.truck(truckStep, 0, smooth);
          break;
        case "ArrowUp":
          void controls.truck(0, truckStep, smooth);
          break;
        case "ArrowDown":
          void controls.truck(0, -truckStep, smooth);
          break;
        case "w":
        case "W":
        case "+":
        case "=":
          walkTowardPointer(dollyStep, smooth);
          break;
        case "s":
        case "S":
        case "-":
        case "_":
          walkTowardPointer(-dollyStep, smooth);
          break;
        default:
          handled = false;
      }
    }
    if (!handled) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    pointerDown = null;
    markDirty();
  }

  function handleWheelMode(event) {
    const primaryButtonHeld = (event.buttons & 1) === 1;
    const eventTime = Number(event.timeStamp) || performance.now();
    if (!primaryButtonHeld && (event.ctrlKey || eventTime - wheelGestureAt > WHEEL_GESTURE_IDLE_MS)) {
      wheelGestureAction = !event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? CameraControls.ACTION.ROTATE
        : CameraControls.ACTION.DOLLY;
    }
    if (!primaryButtonHeld) {
      wheelGestureAt = eventTime;
    }
    const rotate = primaryButtonHeld || wheelGestureAction === CameraControls.ACTION.ROTATE;
    controls.mouseButtons.wheel = primaryButtonHeld
      ? CameraControls.ACTION.ROTATE
      : wheelGestureAction;
    if (!rotate) {
      controls.infinityDolly = event.deltaY < 0;
    }
    if (rotate) {
      grabState = null;
      pointerDown = null;
    }
  }

  function openBuildingImmersively(buildingId, record, event = null) {
    event?.preventDefault?.();
    const returnView = captureView();
    if (selectedBuildingId !== buildingId) {
      selectBuilding(buildingId);
      onSelectBuilding({ buildingId, path: record.building.path });
    }
    const anchor = buildingScreenRect(buildingId);
    beginBuildingPortal(buildingId);
    onOpenBuilding({
      anchor,
      buildingId,
      path: record.building.path,
      returnView
    });
  }

  function handlePointerUp(event) {
    grabState = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    if (!pointerDown || Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 6) {
      pointerDown = null;
      if (event.pointerType === "touch") {
        lastTouchBuildingTap = { at: -Infinity, buildingId: "" };
      }
      return;
    }
    pointerDown = null;
    const intersection = pickedIntersection(event);
    const object = intersection?.object;
    if (object?.userData.kind === "buildings") {
      const buildingId = object.userData.buildingIds[intersection.instanceId];
      const record = buildingObjects.get(buildingId);
      if (!record) {
        return;
      }
      if (event.pointerType === "touch") {
        const tappedAt = Number(event.timeStamp) || performance.now();
        const doubleTap = lastTouchBuildingTap.buildingId === buildingId &&
          tappedAt - lastTouchBuildingTap.at <= BUILDING_DOUBLE_TAP_WINDOW_MS;
        lastTouchBuildingTap = doubleTap
          ? { at: -Infinity, buildingId: "" }
          : { at: tappedAt, buildingId };
        if (doubleTap) {
          suppressSyntheticDoubleClickUntil = tappedAt + BUILDING_DOUBLE_TAP_WINDOW_MS;
          openBuildingImmersively(buildingId, record, event);
          return;
        }
      }
      selectBuilding(buildingId);
      onSelectBuilding({ buildingId, path: record.building.path });
      return;
    }
    if (object?.userData.kind === "districts") {
      const districtId = object.userData.districtIds[intersection.instanceId];
      const record = districtObjects.get(districtId);
      if (!record) {
        return;
      }
      selectDistrict(districtId);
      onSelectDistrict(record.district);
      return;
    }
    clearSelection();
    onClearSelection();
  }

  function handleDoubleClick(event) {
    const eventTime = Number(event.timeStamp) || performance.now();
    if (eventTime <= suppressSyntheticDoubleClickUntil) {
      event.preventDefault();
      return;
    }
    const intersection = pickedIntersection(event);
    if (intersection?.object?.userData.kind !== "buildings") {
      return;
    }
    const buildingId = intersection.object.userData.buildingIds[intersection.instanceId];
    const record = buildingObjects.get(buildingId);
    if (record) {
      openBuildingImmersively(buildingId, record, event);
    }
  }

  function handlePointerCancel() {
    grabState = null;
    pointerDown = null;
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerCancel);
  canvas.addEventListener("dblclick", handleDoubleClick);
  canvas.addEventListener("lostpointercapture", handlePointerCancel);
  canvas.addEventListener("wheel", handleWheelMode, { capture: true, passive: true });
  canvas.addEventListener("keydown", handleKeyDown);

  return Object.freeze({
    beginBuildingPortal,
    buildingScreenRect,
    captureView,
    clearOverview: clearWorld,
    clearSelection,
    dispose() {
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointercancel", handlePointerCancel);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      canvas.removeEventListener("lostpointercapture", handlePointerCancel);
      canvas.removeEventListener("wheel", handleWheelMode, true);
      canvas.removeEventListener("keydown", handleKeyDown);
      clearWorld();
      controls.dispose();
      renderer.dispose();
    },
    endBuildingPortal,
    fitWorld,
    flyToBuilding,
    flyToView,
    focusBuilding,
    focusDistrict,
    frame,
    resize,
    restoreView,
    rotateView,
    selectBuilding,
    selectDistrict,
    setActive(value) {
      active = value === true;
      markDirty();
    },
    setOverview,
    setView
  });
}

export {
  buildingColor,
  createSystemWorld,
  districtColor
};
