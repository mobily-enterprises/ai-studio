<template>
  <section class="system-world">
    <header class="system-world__toolbar">
      <div class="system-world__identity">
        <span class="system-world__mark" aria-hidden="true">
          <v-icon :icon="mdiCityVariantOutline" size="19" />
        </span>
        <div>
          <strong>Genesis City · {{ rendererRevision }}</strong>
          <span>{{ statusLabel }}</span>
        </div>
      </div>

      <div class="system-world__city-switch" aria-label="Choose Genesis City">
        <v-btn
          :active="cityKind === 'machine'"
          :prepend-icon="mdiFileCodeOutline"
          size="small"
          title="Explore files and functions from the Genesis Machine City"
          type="button"
          variant="text"
          @click="selectCity('machine')"
        >
          Machine
        </v-btn>
        <v-btn
          :active="cityKind === 'program'"
          :prepend-icon="mdiLayersTripleOutline"
          size="small"
          title="Explore subsystems and public operations from the Genesis Program City"
          type="button"
          variant="text"
          @click="selectCity('program')"
        >
          Program
        </v-btn>
      </div>

      <div class="system-world__view-actions">
        <v-btn
          aria-label="Back to previous Genesis City view"
          :disabled="!canNavigateWorldBack || worldHistoryBusy"
          :icon="mdiArrowLeft"
          size="x-small"
          title="Back to previous Genesis City view"
          type="button"
          variant="text"
          @click="navigateWorldHistory('back')"
        />
        <v-btn
          aria-label="Forward to next Genesis City view"
          :disabled="!canNavigateWorldForward || worldHistoryBusy"
          :icon="mdiArrowRight"
          size="x-small"
          title="Forward to next Genesis City view"
          type="button"
          variant="text"
          @click="navigateWorldHistory('forward')"
        />
        <v-btn
          :icon="mdiCrosshairsGps"
          size="x-small"
          title="Fit the current City"
          type="button"
          variant="text"
          @click="fitWorld"
        />
        <v-btn
          :icon="mdiMapOutline"
          size="x-small"
          title="Top-down map"
          type="button"
          variant="text"
          @click="setWorldView('top')"
        />
        <v-btn
          :icon="mdiRotate3dVariant"
          size="x-small"
          title="Perspective view"
          type="button"
          variant="text"
          @click="setWorldView('perspective')"
        />
        <v-btn
          color="primary"
          :loading="refreshing"
          :prepend-icon="mdiRefresh"
          size="small"
          type="button"
          variant="tonal"
          @click="refreshCities"
        >
          Refresh Cities
        </v-btn>
      </div>
    </header>

    <div class="system-world__stage">
      <canvas
        ref="canvasElement"
        aria-label="Interactive 3D Genesis City. Drag or use arrow keys to move, scroll or use W and S to zoom, click a building to inspect it, and double-click a building to open its source."
        class="system-world__canvas"
        tabindex="0"
      />

      <div v-if="loading && !currentCity" class="system-world__state-card" role="status">
        <span class="system-world__state-orbit" aria-hidden="true" />
        <strong>Loading {{ cityTitle }}…</strong>
        <span>Reading the native Genesis City document.</span>
      </div>

      <div v-else-if="worldError || error || cityAvailability.state === 'invalid'" class="system-world__state-card system-world__state-card--error">
        <v-icon :icon="mdiAlertOutline" size="32" />
        <strong>{{ cityTitle }} could not render.</strong>
        <span>{{ worldError || error || cityAvailability.error?.message }}</span>
        <v-btn size="small" type="button" variant="tonal" @click="reload">Retry</v-btn>
      </div>

      <div v-else-if="!currentCity" class="system-world__state-card">
        <v-icon :icon="mdiInformationOutline" size="34" />
        <strong>{{ cityTitle }} has not been generated yet.</strong>
        <span>Genesis can refresh both Cities from the current project.</span>
        <v-btn
          color="primary"
          :loading="refreshing"
          :prepend-icon="mdiRefresh"
          size="small"
          type="button"
          @click="refreshCities"
        >
          Generate Cities
        </v-btn>
      </div>

      <div v-else-if="buildings.length === 0" class="system-world__state-card">
        <v-icon :icon="mdiInformationOutline" size="34" />
        <strong>{{ cityTitle }} is empty.</strong>
        <span>{{ emptyCityMessage }}</span>
      </div>

      <div v-if="refreshing" class="system-world__progress" role="status">
        <span class="system-world__progress-pulse" />
        Refreshing both Genesis Cities…
      </div>

      <div v-if="worldOverview" class="system-world__view-gizmo" aria-label="Rotate Genesis City view">
        <button aria-label="Rotate view left" title="Rotate left" type="button" @click="rotateWorld(-20)">
          <v-icon :icon="mdiRotateLeft" size="15" />
        </button>
        <button
          class="system-world__view-gizmo-puck"
          aria-label="Drag to rotate the view"
          title="Drag to orbit the City"
          type="button"
          @lostpointercapture="endViewRotation"
          @pointercancel="endViewRotation"
          @pointerdown="startViewRotation"
          @pointermove="continueViewRotation"
          @pointerup="endViewRotation"
        >
          <v-icon :icon="mdiOrbit" size="17" />
          <span>N</span>
        </button>
        <button aria-label="Rotate view right" title="Rotate right" type="button" @click="rotateWorld(20)">
          <v-icon :icon="mdiRotateRight" size="15" />
        </button>
      </div>

      <nav v-if="buildings.length" class="system-world__navigator" :aria-label="`${cityTitle} buildings`">
        <header>
          <span>{{ cityKind === 'machine' ? 'Files' : 'Operations' }}</span>
          <strong>{{ buildings.length }}</strong>
        </header>
        <button
          v-for="building in buildings"
          :key="building.id"
          :class="{ 'system-world__navigator-button--active': selectedBuilding?.id === building.id }"
          type="button"
          @click="inspectBuilding(building, { focus: true })"
        >
          <v-icon :icon="cityKind === 'machine' ? mdiFileCodeOutline : mdiLayersTripleOutline" size="13" />
          <span>
            <strong>{{ building.title }}</strong>
            <small>{{ cityKind === 'machine' ? building.path : building.subsystem }}</small>
          </span>
        </button>
      </nav>

      <aside v-if="selectedBuilding" class="system-world__inspector">
        <span class="system-world__eyebrow">{{ cityKind === 'machine' ? 'Machine file' : 'Program operation' }}</span>
        <h2>{{ selectedBuilding.title }}</h2>
        <p class="system-world__path">{{ selectedBuilding.path }}</p>

        <template v-if="cityKind === 'machine'">
          <div class="system-world__chips">
            <span>{{ selectedBuilding.language }}</span>
            <span>{{ selectedBuilding.role }}</span>
          </div>
          <div class="system-world__metrics">
            <span><strong>{{ formatNumber(selectedBuilding.lines) }}</strong> lines</span>
            <span><strong>{{ formatBytes(selectedBuilding.bytes) }}</strong> size</span>
            <span><strong>{{ selectedFunctions.length }}</strong> functions</span>
          </div>
          <div v-if="selectedFunctions.length" class="system-world__section">
            <strong>Indexed functions</strong>
            <ul>
              <li v-for="entry in selectedFunctions" :key="entry.id">
                <button
                  class="system-world__function-link"
                  type="button"
                  @click="openSourceFile(entry.path, { line: entry.line, column: entry.column })"
                >
                  <strong>{{ entry.qualifiedName }}</strong>
                  <span>{{ entry.visibility }} {{ entry.kind }} · line {{ entry.line }}</span>
                </button>
              </li>
            </ul>
          </div>
        </template>

        <template v-else>
          <div class="system-world__chips">
            <span>{{ selectedBuilding.subsystem }}</span>
            <span>{{ formatCount(selectedBuilding.sources.length, 'source') }}</span>
            <span>{{ formatCount(selectedImplementationLinks.length, 'implementation link') }}</span>
          </div>
          <p v-if="selectedBuilding.description">{{ selectedBuilding.description }}</p>
          <div class="system-world__section">
            <strong>Public contract</strong>
            <pre>{{ selectedBuilding.publicContract }}</pre>
          </div>
          <div v-if="selectedBuilding.implementationMap" class="system-world__section">
            <strong>Implementation map</strong>
            <pre>{{ selectedBuilding.implementationMap }}</pre>
          </div>
          <div class="system-world__section">
            <strong>Implementation sources</strong>
            <button
              v-for="source in selectedBuilding.sources"
              :key="source"
              class="system-world__source-link"
              type="button"
              @click="openSourceFile(source)"
            >
              {{ source }}
            </button>
          </div>
        </template>

        <div class="system-world__inspector-actions">
          <v-btn
            :prepend-icon="mdiFileCodeOutline"
            size="small"
            type="button"
            variant="tonal"
            @click="openSourceFile(selectedBuilding.path)"
          >
            Open {{ cityKind === 'machine' ? 'file' : 'Program module' }}
          </v-btn>
          <v-btn
            v-if="askChatAvailable"
            :prepend-icon="mdiMessageOutline"
            size="small"
            type="button"
            variant="text"
            @click="askAboutSelection"
          >
            Explain in Chat
          </v-btn>
        </div>
      </aside>

      <aside v-else-if="selectedDistrict" class="system-world__inspector">
        <span class="system-world__eyebrow">{{ cityKind === 'machine' ? 'Directory' : 'Subsystem' }}</span>
        <h2>{{ selectedDistrict.title }}</h2>
        <p class="system-world__path">{{ selectedDistrict.path || (cityKind === 'machine' ? 'Project root' : selectedDistrict.id) }}</p>
        <div class="system-world__metrics">
          <span><strong>{{ selectedDistrict.buildingCount }}</strong> buildings</span>
          <span v-if="cityKind === 'machine'"><strong>{{ formatNumber(selectedDistrict.lines) }}</strong> lines</span>
        </div>
      </aside>

      <aside v-else-if="currentCity" class="system-world__orientation">
        <span class="system-world__eyebrow">{{ cityTitle }}</span>
        <strong>{{ cityKind === 'machine' ? 'The implementation as Genesis can prove it.' : 'The public Program, grouped by subsystem.' }}</strong>
        <span>{{ orientationText }}</span>
      </aside>

      <div v-if="currentCity" class="system-world__controls-hint" aria-label="Genesis City controls">
        <span><v-icon :icon="mdiMouse" size="14" /> Drag / arrows to move</span>
        <span><v-icon :icon="mdiMouseScrollWheel" size="14" /> Scroll / W S to zoom</span>
        <span><v-icon :icon="mdiMouseRightClickOutline" size="14" /> Right-drag to orbit</span>
      </div>

      <div v-if="currentCity" class="system-world__legend">
        <span>{{ cityKind === 'machine' ? 'Building height and footprint follow indexed line count' : 'Each building is one public Program operation' }}</span>
        <span>{{ cityKind === 'machine' ? 'Directory' : 'Subsystem' }} terraces follow native Genesis districts</span>
      </div>
    </div>
  </section>
</template>

<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRef,
  watch
} from "vue";
import {
  mdiAlertOutline,
  mdiArrowLeft,
  mdiArrowRight,
  mdiCityVariantOutline,
  mdiCrosshairsGps,
  mdiFileCodeOutline,
  mdiInformationOutline,
  mdiLayersTripleOutline,
  mdiMapOutline,
  mdiMessageOutline,
  mdiMouse,
  mdiMouseRightClickOutline,
  mdiMouseScrollWheel,
  mdiOrbit,
  mdiRefresh,
  mdiRotate3dVariant,
  mdiRotateLeft,
  mdiRotateRight
} from "@mdi/js";

import {
  useVibe64SystemGraph
} from "../composables/useVibe64SystemGraph.js";
import {
  createSystemWorld
} from "../world/createSystemWorld.js";
import {
  GENESIS_MACHINE_CITY_KIND,
  GENESIS_PROGRAM_CITY_KIND,
  genesisCityKind,
  genesisCityWorld
} from "../world/genesisCityWorld.js";
import {
  createWorldViewHistory
} from "../world/worldViewHistory.js";

const rendererRevision = "057";

const props = defineProps({
  active: {
    type: Boolean,
    default: false
  },
  askChatAvailable: {
    type: Boolean,
    default: true
  },
  restoreRequest: {
    type: Object,
    default: null
  },
  resolveRequestUrl: {
    type: Function,
    default: (value) => value
  },
  sessionId: {
    type: String,
    required: true
  }
});

const emit = defineEmits([
  "ask-in-chat",
  "open-source-file-immersive",
  "open-source-file"
]);

const canvasElement = ref(null);
const cityKind = ref(GENESIS_MACHINE_CITY_KIND);
const selectedBuildingId = ref("");
const selectedDistrict = ref(null);
const worldError = ref("");
const worldHistoryBusy = ref(false);
const worldView = ref("perspective");
const canNavigateWorldBack = ref(false);
const canNavigateWorldForward = ref(false);
let animationFrame = 0;
let resizeObserver = null;
let viewRotationPointer = null;
let world = null;
let overviewGeneration = 0;
let overviewPromise = Promise.resolve();
let applyingRestoreRequest = false;
const worldViewHistory = createWorldViewHistory({ limit: 64 });

const {
  error,
  loading,
  machineCity,
  programCity,
  refresh,
  refreshing,
  reload,
  systemStatus
} = useVibe64SystemGraph({
  active: toRef(props, "active"),
  sessionId: toRef(props, "sessionId")
});

const currentCity = computed(() => (
  cityKind.value === GENESIS_PROGRAM_CITY_KIND ? programCity.value : machineCity.value
));
const worldOverview = computed(() => genesisCityWorld(currentCity.value, cityKind.value));
const buildings = computed(() => currentCity.value?.buildings || []);
const selectedBuilding = computed(() => (
  buildings.value.find((building) => building.id === selectedBuildingId.value) || null
));
const functionsById = computed(() => new Map(
  (machineCity.value?.functions || []).map((entry) => [entry.id, entry])
));
const selectedFunctions = computed(() => (
  cityKind.value === GENESIS_MACHINE_CITY_KIND && selectedBuilding.value
    ? selectedBuilding.value.functionIds.map((id) => functionsById.value.get(id)).filter(Boolean)
    : []
));
const selectedImplementationLinks = computed(() => (
  cityKind.value === GENESIS_PROGRAM_CITY_KIND && selectedBuilding.value
    ? (currentCity.value?.links || []).filter((link) => link.fromId === selectedBuilding.value.id)
    : []
));
const cityAvailability = computed(() => (
  systemStatus.value?.cities?.[cityKind.value] || { state: "missing" }
));
const cityTitle = computed(() => (
  cityKind.value === GENESIS_MACHINE_CITY_KIND ? "Machine City" : "Program City"
));
const statusLabel = computed(() => {
  if (!currentCity.value) {
    return cityAvailability.value.state || systemStatus.value.status || "loading";
  }
  if (cityKind.value === GENESIS_MACHINE_CITY_KIND) {
    return `${formatCount(currentCity.value.buildings.length, "file")} · ${formatCount(currentCity.value.functions.length, "function")}`;
  }
  return `${formatCount(currentCity.value.districts.length, "subsystem")} · ${formatCount(currentCity.value.buildings.length, "operation")}`;
});
const emptyCityMessage = computed(() => (
  cityKind.value === GENESIS_MACHINE_CITY_KIND
    ? "Add Stack pieces with a code indexer, then refresh the Cities."
    : "Add explanatory Program modules, then refresh the Cities."
));
const orientationText = computed(() => (
  cityKind.value === GENESIS_MACHINE_CITY_KIND
    ? "Files and functions come directly from .genesis/machine-city.json. No imports, routes, or architectural meaning are inferred here."
    : "Subsystems, public contracts, implementation maps, and source links come directly from .genesis/program-city.json."
));
const machineBuildingsByPath = computed(() => new Map(
  (machineCity.value?.buildings || []).map((building) => [building.path, building])
));
const programBuildingsByPath = computed(() => new Map(
  (programCity.value?.buildings || []).map((building) => [building.path, building])
));

function formatCount(value = 0, singular = "item", plural = `${singular}s`) {
  const count = Math.max(0, Number(value) || 0);
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function formatNumber(value = 0) {
  return Math.max(0, Number(value) || 0).toLocaleString();
}

function formatBytes(value = 0) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
}

function renderFrame(time) {
  animationFrame = 0;
  world?.frame(time);
  if (props.active && world) {
    animationFrame = requestAnimationFrame(renderFrame);
  }
}

function startRenderLoop() {
  if (!animationFrame && props.active && world) {
    animationFrame = requestAnimationFrame(renderFrame);
  }
}

function stopRenderLoop() {
  cancelAnimationFrame(animationFrame);
  animationFrame = 0;
}

function resizeWorld() {
  const canvas = canvasElement.value;
  if (!canvas || !world) {
    return;
  }
  const bounds = canvas.getBoundingClientRect();
  world.resize(bounds.width, bounds.height);
}

function syncWorldHistoryAvailability() {
  canNavigateWorldBack.value = worldViewHistory.canBack;
  canNavigateWorldForward.value = worldViewHistory.canForward;
}

function sourceNavigationContext() {
  return {
    camera: world?.captureView() || null,
    cityKind: cityKind.value,
    selectedBuildingId: selectedBuildingId.value,
    selectedDistrictId: selectedDistrict.value?.id || "",
    view: worldView.value
  };
}

function recordWorldNavigation() {
  if (!world || !worldOverview.value || applyingRestoreRequest || worldHistoryBusy.value) {
    return false;
  }
  const recorded = worldViewHistory.record(sourceNavigationContext());
  syncWorldHistoryAvailability();
  return recorded;
}

function clearSelection() {
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
  world?.clearSelection();
}

function handleBuildingPick(selection = {}) {
  if (!selection.buildingId) {
    return;
  }
  recordWorldNavigation();
  selectedBuildingId.value = selection.buildingId;
  selectedDistrict.value = null;
}

function handleDistrictPick(district = null) {
  recordWorldNavigation();
  selectedBuildingId.value = "";
  selectedDistrict.value = district;
}

function handleClearSelection() {
  if (selectedBuildingId.value || selectedDistrict.value) {
    recordWorldNavigation();
  }
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
}

function openPayload(path = "", {
  column = 0,
  immersive = false,
  line = 0
} = {}) {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) {
    return null;
  }
  const located = locateBuilding(normalizedPath);
  const returnView = world?.captureView() || null;
  return {
    anchor: immersive && located?.kind === cityKind.value
      ? world?.buildingScreenRect(located.building.id) || null
      : null,
    buildingId: located?.building.id || "",
    column: Math.max(0, Number(column) || 0),
    line: Math.max(0, Number(line) || 0),
    origin: "system",
    path: normalizedPath,
    returnView,
    systemContext: sourceNavigationContext()
  };
}

function openSourceFile(path = "", location = {}) {
  const payload = openPayload(path, location);
  if (payload) {
    emit("open-source-file", payload);
  }
}

function handleImmersiveFileOpen(selection = {}) {
  const payload = openPayload(selection.path, { immersive: true });
  if (payload) {
    emit("open-source-file-immersive", {
      ...payload,
      anchor: selection.anchor || payload.anchor,
      returnView: selection.returnView || payload.returnView
    });
  }
}

async function createWorld() {
  if (!canvasElement.value || world) {
    return;
  }
  try {
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    world = createSystemWorld({
      canvas: canvasElement.value,
      onClearSelection: handleClearSelection,
      onOpenBuilding: handleImmersiveFileOpen,
      onSelectBuilding: handleBuildingPick,
      onSelectDistrict: handleDistrictPick,
      reducedMotion
    });
    resizeObserver = new ResizeObserver(resizeWorld);
    resizeObserver.observe(canvasElement.value);
    resizeWorld();
    startRenderLoop();
    if (worldOverview.value) {
      await world.setOverview(worldOverview.value);
    }
    if (props.restoreRequest) {
      await applyRestoreRequest(props.restoreRequest);
    }
  } catch (caught) {
    worldError.value = String(caught?.message || caught || "WebGL could not start.");
  }
}

async function applyOverview(nextOverview) {
  if (!world || !nextOverview) {
    return;
  }
  const generation = ++overviewGeneration;
  const previousView = world.captureView();
  try {
    await world.setOverview(nextOverview);
    if (generation !== overviewGeneration) {
      return;
    }
    if (selectedBuilding.value) {
      world.selectBuilding(selectedBuilding.value.id);
    } else if (selectedDistrict.value) {
      world.selectDistrict(selectedDistrict.value.id);
    }
    if (previousView.position) {
      world.restoreView(previousView);
    }
  } catch (caught) {
    worldError.value = String(caught?.message || caught);
  }
}

function selectCity(kind, { recordHistory = true } = {}) {
  const nextKind = genesisCityKind(kind);
  if (nextKind === cityKind.value) {
    return;
  }
  if (recordHistory) {
    recordWorldNavigation();
  }
  cityKind.value = nextKind;
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
}

function inspectBuilding(building, { focus = false } = {}) {
  if (!building?.id) {
    return;
  }
  recordWorldNavigation();
  selectedBuildingId.value = building.id;
  selectedDistrict.value = null;
  world?.selectBuilding(building.id);
  if (focus) {
    world?.focusBuilding(building.id);
  }
}

function fitWorld() {
  recordWorldNavigation();
  void world?.fitWorld();
}

function setWorldView(view) {
  recordWorldNavigation();
  worldView.value = view;
  world?.setView(view);
}

function rotateWorld(degrees) {
  recordWorldNavigation();
  world?.rotateView(degrees, 0, true);
}

function startViewRotation(event) {
  if (event.button !== 0) {
    return;
  }
  recordWorldNavigation();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  viewRotationPointer = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY
  };
  event.preventDefault();
}

function continueViewRotation(event) {
  if (!viewRotationPointer || viewRotationPointer.id !== event.pointerId) {
    return;
  }
  const horizontalDelta = event.clientX - viewRotationPointer.x;
  const verticalDelta = event.clientY - viewRotationPointer.y;
  viewRotationPointer.x = event.clientX;
  viewRotationPointer.y = event.clientY;
  world?.rotateView(-horizontalDelta * 0.45, -verticalDelta * 0.28, false);
  event.preventDefault();
}

function endViewRotation(event) {
  if (!viewRotationPointer || viewRotationPointer.id !== event.pointerId) {
    return;
  }
  if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  viewRotationPointer = null;
}

async function refreshCities() {
  worldError.value = "";
  try {
    await refresh();
  } catch (caught) {
    worldError.value = String(caught?.message || caught || "Genesis Cities could not be refreshed.");
  }
}

function askAboutSelection() {
  if (!selectedBuilding.value || !props.askChatAvailable) {
    return;
  }
  const prompt = cityKind.value === GENESIS_MACHINE_CITY_KIND
    ? [
        "Please explain this file using the code and its Genesis explanatory layer. Do not change code unless I ask.",
        `File: ${selectedBuilding.value.path}`,
        `Language: ${selectedBuilding.value.language}`,
        `Indexed functions: ${selectedFunctions.value.map((entry) => entry.qualifiedName).join(", ") || "none"}`
      ].join("\n")
    : [
        "Please explain this public Program operation and how its listed sources implement it. Do not change code unless I ask.",
        `Program module: ${selectedBuilding.value.path}`,
        `Subsystem: ${selectedBuilding.value.subsystem}`,
        `Operation: ${selectedBuilding.value.title}`,
        `Sources: ${selectedBuilding.value.sources.join(", ")}`
      ].join("\n");
  emit("ask-in-chat", { prompt });
}

async function navigateWorldHistory(direction) {
  if (!world || !worldOverview.value || worldHistoryBusy.value) {
    return;
  }
  const currentView = sourceNavigationContext();
  const targetView = direction === "forward"
    ? worldViewHistory.forward(currentView)
    : worldViewHistory.back(currentView);
  syncWorldHistoryAvailability();
  if (!targetView) {
    return;
  }
  worldHistoryBusy.value = true;
  try {
    await applyRestoreRequest(targetView);
  } finally {
    worldHistoryBusy.value = false;
    syncWorldHistoryAvailability();
  }
}

async function applyRestoreRequest(request = {}) {
  if (!request || !world) {
    return false;
  }
  applyingRestoreRequest = true;
  try {
    const requestedKind = genesisCityKind(request.cityKind || cityKind.value);
    if (requestedKind !== cityKind.value) {
      selectCity(requestedKind, { recordHistory: false });
      await nextTick();
      await overviewPromise;
    }
    worldView.value = request.view === "top" ? "top" : "perspective";
    world.setView(worldView.value);
    clearSelection();
    if (request.selectedBuildingId && buildings.value.some((building) => building.id === request.selectedBuildingId)) {
      selectedBuildingId.value = request.selectedBuildingId;
      world.selectBuilding(request.selectedBuildingId);
      world.focusBuilding(request.selectedBuildingId);
    } else if (request.selectedDistrictId) {
      const district = currentCity.value?.districts.find((entry) => entry.id === request.selectedDistrictId);
      if (district) {
        selectedDistrict.value = world.selectDistrict(district.id) || district;
        world.focusDistrict(district.id);
      }
    }
    if (request.camera) {
      world.restoreView(request.camera);
    }
    return true;
  } finally {
    applyingRestoreRequest = false;
  }
}

function locateBuilding(path = "") {
  const normalizedPath = String(path || "");
  const machine = machineBuildingsByPath.value.get(normalizedPath);
  if (machine) {
    return { building: machine, kind: GENESIS_MACHINE_CITY_KIND };
  }
  const program = programBuildingsByPath.value.get(normalizedPath);
  return program ? { building: program, kind: GENESIS_PROGRAM_CITY_KIND } : null;
}

function hasImmersiveFile(path = "") {
  return Boolean(locateBuilding(path));
}

function immersiveFileAnchor(path = "") {
  const located = locateBuilding(path);
  return located?.kind === cityKind.value
    ? world?.buildingScreenRect(located.building.id) || null
    : null;
}

function closeImmersiveFilePortal({ immediate = false } = {}) {
  world?.endBuildingPortal({ immediate });
}

async function restoreImmersiveView(view = null, { immediate = false } = {}) {
  if (!world || !view) {
    return false;
  }
  return immediate ? world.restoreView(view) : world.flyToView(view);
}

async function travelImmersiveFile(path = "") {
  const located = locateBuilding(path);
  if (!located || !world || worldHistoryBusy.value) {
    return null;
  }
  recordWorldNavigation();
  worldHistoryBusy.value = true;
  try {
    if (located.kind !== cityKind.value) {
      selectCity(located.kind, { recordHistory: false });
      await nextTick();
      await overviewPromise;
    }
    selectedBuildingId.value = located.building.id;
    selectedDistrict.value = null;
    world.selectBuilding(located.building.id);
    const anchor = await world.flyToBuilding(located.building.id);
    world.beginBuildingPortal(located.building.id);
    return {
      anchor: world.buildingScreenRect(located.building.id) || anchor,
      buildingId: located.building.id,
      path: located.building.path
    };
  } finally {
    worldHistoryBusy.value = false;
    syncWorldHistoryAvailability();
  }
}

watch(worldOverview, (nextOverview) => {
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
  if (!nextOverview) {
    world?.clearOverview();
    overviewPromise = Promise.resolve();
    return;
  }
  overviewPromise = applyOverview(nextOverview);
});

watch(() => props.active, (active) => {
  world?.setActive(active);
  if (active) {
    resizeWorld();
    startRenderLoop();
  } else {
    stopRenderLoop();
  }
});

watch(() => props.restoreRequest, (request) => {
  if (request && props.active) {
    void applyRestoreRequest(request);
  }
}, { deep: true });

watch(() => props.sessionId, () => {
  worldViewHistory.clear();
  syncWorldHistoryAvailability();
  selectedBuildingId.value = "";
  selectedDistrict.value = null;
  cityKind.value = GENESIS_MACHINE_CITY_KIND;
});

onMounted(() => {
  void createWorld();
});

onBeforeUnmount(() => {
  stopRenderLoop();
  resizeObserver?.disconnect();
  world?.dispose();
  world = null;
});

defineExpose({
  closeImmersiveFilePortal,
  hasImmersiveFile,
  immersiveFileAnchor,
  restoreImmersiveView,
  travelImmersiveFile
});
</script>

<style scoped>
.system-world {
  --city-blue: #56d8ff;
  background: #050914;
  color: #f4f8ff;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}

.system-world__toolbar {
  align-items: center;
  background: linear-gradient(90deg, rgba(11, 20, 40, 0.98), rgba(7, 13, 28, 0.98));
  border-bottom: 1px solid rgba(121, 180, 225, 0.2);
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(12rem, 1fr) auto minmax(12rem, 1fr);
  min-height: 3.5rem;
  padding: 0.55rem 0.75rem;
}

.system-world__identity,
.system-world__view-actions,
.system-world__city-switch,
.system-world__controls-hint,
.system-world__legend,
.system-world__chips,
.system-world__metrics,
.system-world__inspector-actions {
  align-items: center;
  display: flex;
}

.system-world__identity { gap: 0.58rem; min-width: 0; }
.system-world__identity > div { display: grid; min-width: 0; }
.system-world__identity strong { font-size: 0.82rem; }
.system-world__identity span { color: rgba(217, 232, 255, 0.55); font-size: 0.62rem; }
.system-world__mark { align-items: center; background: rgba(86, 216, 255, 0.13); border: 1px solid rgba(86, 216, 255, 0.28); border-radius: 0.55rem; color: var(--city-blue); display: inline-flex; height: 2rem; justify-content: center; width: 2rem; }
.system-world__city-switch { background: rgba(2, 8, 18, 0.5); border: 1px solid rgba(121, 180, 225, 0.17); border-radius: 0.7rem; padding: 0.14rem; }
.system-world__view-actions { gap: 0.16rem; justify-content: flex-end; }

.system-world__stage { min-height: 0; overflow: hidden; position: relative; }
.system-world__canvas {
  background: radial-gradient(circle at 24% 38%, rgba(31, 109, 153, 0.2), transparent 34%), linear-gradient(#080e1e, #040711);
  cursor: move;
  display: block;
  height: 100%;
  outline: none;
  width: 100%;
}
.system-world__canvas:active { cursor: grabbing; }
.system-world__canvas:focus-visible { box-shadow: inset 0 0 0 2px var(--city-blue); }

.system-world__state-card {
  align-items: center;
  backdrop-filter: blur(24px);
  background: rgba(8, 14, 31, 0.92);
  border: 1px solid rgba(114, 183, 228, 0.24);
  border-radius: 1.2rem;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  left: 50%;
  max-width: 31rem;
  padding: 1.6rem 2rem;
  position: absolute;
  text-align: center;
  top: 50%;
  transform: translate(-50%, -50%);
  z-index: 12;
}
.system-world__state-card > span { color: rgba(223, 234, 255, 0.64); font-size: 0.79rem; }
.system-world__state-card--error { border-color: rgba(255, 93, 120, 0.46); }
.system-world__state-orbit { animation: system-orbit 1.3s linear infinite; border: 2px solid rgba(53, 208, 255, 0.16); border-right-color: var(--city-blue); border-radius: 50%; height: 2.5rem; width: 2.5rem; }
@keyframes system-orbit { to { transform: rotate(1turn); } }

.system-world__progress {
  align-items: center;
  backdrop-filter: blur(12px);
  background: rgba(11, 28, 48, 0.9);
  border: 1px solid rgba(53, 208, 255, 0.3);
  border-radius: 999px;
  bottom: 4.5rem;
  display: flex;
  font-size: 0.68rem;
  gap: 0.42rem;
  left: 50%;
  padding: 0.4rem 0.72rem;
  position: absolute;
  transform: translateX(-50%);
  z-index: 8;
}
.system-world__progress-pulse { animation: system-pulse 1s ease-in-out infinite; background: var(--city-blue); border-radius: 50%; height: 0.42rem; width: 0.42rem; }
@keyframes system-pulse { 50% { opacity: 0.25; transform: scale(0.7); } }

.system-world__navigator {
  backdrop-filter: blur(16px);
  background: rgba(7, 13, 27, 0.82);
  border: 1px solid rgba(132, 164, 219, 0.16);
  border-radius: 0.85rem;
  display: flex;
  flex-direction: column;
  left: 0.7rem;
  max-height: calc(100% - 7rem);
  overflow-y: auto;
  padding: 0.36rem;
  position: absolute;
  top: 0.7rem;
  width: min(17rem, 28%);
  z-index: 8;
}
.system-world__navigator header { align-items: center; color: rgba(218, 232, 255, 0.52); display: flex; font-size: 0.57rem; justify-content: space-between; letter-spacing: 0.12em; padding: 0.32rem 0.45rem; text-transform: uppercase; }
.system-world__navigator button { align-items: center; background: transparent; border: 0; border-radius: 0.5rem; color: rgba(231, 239, 255, 0.76); cursor: pointer; display: grid; font: inherit; gap: 0.42rem; grid-template-columns: auto minmax(0, 1fr); padding: 0.38rem 0.42rem; text-align: left; }
.system-world__navigator button:hover,
.system-world__navigator button:focus-visible,
.system-world__navigator-button--active { background: rgba(93, 188, 238, 0.14) !important; color: #fff !important; }
.system-world__navigator button > span { display: grid; min-width: 0; }
.system-world__navigator button strong,
.system-world__navigator button small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.system-world__navigator button strong { font-size: 0.65rem; }
.system-world__navigator button small { color: rgba(201, 218, 242, 0.48); font-size: 0.53rem; }

.system-world__inspector,
.system-world__orientation {
  backdrop-filter: blur(22px);
  background: linear-gradient(155deg, rgba(11, 20, 40, 0.96), rgba(6, 10, 23, 0.92));
  border: 1px solid rgba(141, 176, 230, 0.21);
  border-radius: 1rem;
  box-shadow: 0 1.2rem 4rem rgba(0, 0, 0, 0.34);
  position: absolute;
  right: 0.75rem;
  top: 0.75rem;
  width: min(24rem, 38%);
  z-index: 10;
}
.system-world__inspector { max-height: calc(100% - 6rem); overflow-y: auto; padding: 1rem; }
.system-world__orientation { display: grid; gap: 0.38rem; padding: 0.9rem 1rem; }
.system-world__eyebrow { color: var(--city-blue); font-size: 0.58rem; font-weight: 800; letter-spacing: 0.15em; text-transform: uppercase; }
.system-world__inspector h2 { font-size: 1.08rem; line-height: 1.22; margin: 0.3rem 0 0.42rem; }
.system-world__inspector p,
.system-world__orientation span { color: rgba(225, 235, 255, 0.7); font-size: 0.72rem; line-height: 1.48; }
.system-world__path { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
.system-world__chips,
.system-world__metrics,
.system-world__inspector-actions { flex-wrap: wrap; gap: 0.42rem; }
.system-world__chips span { background: rgba(114, 157, 223, 0.12); border: 1px solid rgba(127, 178, 236, 0.16); border-radius: 999px; color: rgba(226, 238, 255, 0.8); font-size: 0.58rem; padding: 0.22rem 0.48rem; text-transform: uppercase; }
.system-world__metrics { border-bottom: 1px solid rgba(133, 166, 220, 0.12); border-top: 1px solid rgba(133, 166, 220, 0.12); margin: 0.75rem 0; padding: 0.58rem 0; }
.system-world__metrics span { color: rgba(208, 222, 248, 0.58); display: grid; font-size: 0.56rem; min-width: 5rem; text-transform: uppercase; }
.system-world__metrics strong { color: #fff; font-size: 0.78rem; }
.system-world__section { border-top: 1px solid rgba(133, 166, 220, 0.12); display: grid; gap: 0.34rem; margin-top: 0.7rem; padding-top: 0.65rem; }
.system-world__section > strong { font-size: 0.64rem; letter-spacing: 0.05em; text-transform: uppercase; }
.system-world__section ul { display: grid; gap: 0.28rem; list-style: none; margin: 0; padding: 0; }
.system-world__section li { background: rgba(92, 133, 191, 0.08); border-radius: 0.45rem; display: grid; gap: 0.08rem; padding: 0.42rem 0.5rem; }
.system-world__section li strong { font-size: 0.64rem; }
.system-world__section li span { color: rgba(208, 222, 244, 0.56); font-size: 0.58rem; }
.system-world__function-link { background: transparent; border: 0; color: inherit; cursor: pointer; display: grid; font: inherit; gap: 0.08rem; padding: 0; text-align: left; }
.system-world__function-link:hover strong,
.system-world__function-link:focus-visible strong { color: var(--city-blue); }
.system-world__section pre { background: rgba(3, 8, 17, 0.48); border-radius: 0.45rem; color: rgba(226, 237, 253, 0.78); font: 0.62rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; overflow-wrap: anywhere; padding: 0.55rem; white-space: pre-wrap; }
.system-world__source-link { background: rgba(86, 216, 255, 0.08); border: 1px solid rgba(86, 216, 255, 0.16); border-radius: 0.4rem; color: rgba(220, 241, 255, 0.82); cursor: pointer; font: 0.58rem ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; padding: 0.4rem 0.48rem; text-align: left; }
.system-world__source-link:hover { background: rgba(86, 216, 255, 0.15); }
.system-world__inspector-actions { margin-top: 0.8rem; }

.system-world__view-gizmo { align-items: center; background: rgba(7, 13, 27, 0.9); border: 1px solid rgba(125, 201, 239, 0.26); border-radius: 999px; bottom: 2.3rem; display: flex; gap: 0.2rem; left: 50%; padding: 0.22rem; position: absolute; transform: translateX(-50%); z-index: 9; }
.system-world__view-gizmo button { align-items: center; background: transparent; border: 0; border-radius: 50%; color: rgba(224, 239, 255, 0.72); cursor: pointer; display: inline-flex; height: 1.75rem; justify-content: center; padding: 0; width: 1.75rem; }
.system-world__view-gizmo button:hover { background: rgba(86, 216, 255, 0.15); color: #fff; }
.system-world__view-gizmo-puck { border: 1px solid rgba(86, 216, 255, 0.34) !important; cursor: grab !important; position: relative; touch-action: none; }
.system-world__view-gizmo-puck span { color: var(--city-blue); font-size: 0.42rem; font-weight: 800; left: 50%; position: absolute; top: 0.08rem; transform: translateX(-50%); }

.system-world__controls-hint,
.system-world__legend { backdrop-filter: blur(12px); background: rgba(5, 10, 21, 0.72); border: 1px solid rgba(128, 170, 222, 0.13); border-radius: 0.55rem; bottom: 0.55rem; color: rgba(210, 226, 247, 0.55); font-size: 0.55rem; gap: 0.65rem; padding: 0.35rem 0.55rem; position: absolute; }
.system-world__controls-hint { left: 0.65rem; }
.system-world__legend { right: 0.65rem; }

@media (max-width: 920px) {
  .system-world__toolbar { grid-template-columns: 1fr auto; }
  .system-world__city-switch { grid-column: 1 / -1; grid-row: 2; justify-self: center; }
  .system-world__navigator { width: min(14rem, 38%); }
  .system-world__inspector,
  .system-world__orientation { width: min(20rem, 48%); }
  .system-world__legend { display: none; }
}
</style>
