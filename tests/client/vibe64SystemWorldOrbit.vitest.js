import { readFileSync } from "node:fs";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  viewportCenterOrbitPivot
} from "../../packages/vibe64-system-graph/src/client/world/worldOrbitPivot.js";

describe("Genesis City viewport orbit pivot", () => {
  it("stays at the visual center through viewport resize and rotation", () => {
    const camera = new THREE.PerspectiveCamera(42, 1, 1, 16_000);
    const expectedPivot = new THREE.Vector3(84, 76, -42);
    camera.position.set(420, 620, 980);
    camera.lookAt(expectedPivot);
    camera.updateProjectionMatrix();

    const beforeResize = viewportCenterOrbitPivot(camera, expectedPivot.y);
    camera.aspect = 0.38;
    camera.updateProjectionMatrix();
    const afterResize = viewportCenterOrbitPivot(camera, expectedPivot.y);

    const offset = camera.position.clone().sub(expectedPivot)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
    camera.position.copy(expectedPivot).add(offset);
    camera.lookAt(expectedPivot);
    camera.updateMatrixWorld(true);
    const afterRotate = viewportCenterOrbitPivot(camera, expectedPivot.y);

    for (const pivot of [beforeResize, afterResize, afterRotate]) {
      expect(pivot.x).toBeCloseTo(expectedPivot.x, 6);
      expect(pivot.y).toBeCloseTo(expectedPivot.y, 6);
      expect(pivot.z).toBeCloseTo(expectedPivot.z, 6);
    }
  });

  it("keeps selection and drill-down separate from explicit focus", () => {
    const renderer = readFileSync(
      "packages/vibe64-system-graph/src/client/world/createSystemWorld.js",
      "utf8"
    );
    const component = readFileSync(
      "packages/vibe64-system-graph/src/client/components/Vibe64SystemWorldView.vue",
      "utf8"
    );
    const selectionFunctions = renderer.slice(
      renderer.indexOf("function selectBuilding"),
      renderer.indexOf("function setSemanticLayers")
    );
    const focusFunctions = renderer.slice(
      renderer.indexOf("function focusBuilding"),
      renderer.indexOf("async function fitWorld")
    );
    const viewportPivotFunction = renderer.slice(
      renderer.indexOf("function prepareViewportOrbitPivot"),
      renderer.indexOf("// CameraControls owns right-drag")
    );

    expect(selectionFunctions).not.toContain("useExplicitOrbitPivot");
    expect(focusFunctions).toContain("useExplicitOrbitPivot");
    expect(viewportPivotFunction).toContain("viewportCenterOrbitPivot(");
    expect(viewportPivotFunction).not.toContain("pickedIntersection");
    expect(viewportPivotFunction).not.toContain("selectedBuildingId");
    expect(renderer).toContain("prepareViewportOrbitPivot();\n    controls.rotate(");
    expect(renderer).toContain('canvas.addEventListener("pointerdown", prepareOrbitPointerDown, true)');
    expect(component).not.toContain("inspectDistrict(district, { focus: true })");
    expect(component).not.toContain("inspectBuilding(building, { focus: true })");
    expect(component).toContain('@click="focusCurrentSelection"');
  });

  it("keeps zoom bounded and wakes the sleeping renderer on wheel input", () => {
    const renderer = readFileSync(
      "packages/vibe64-system-graph/src/client/world/createSystemWorld.js",
      "utf8"
    );
    const wheelHandler = renderer.slice(
      renderer.indexOf("function handleWheelMode"),
      renderer.indexOf("function openBuildingImmersively")
    );

    expect(renderer).toContain("controls.infinityDolly = false;");
    expect(wheelHandler).not.toContain("controls.infinityDolly = event.deltaY");
    expect(wheelHandler).toContain("controls.infinityDolly = false;");
    expect(wheelHandler.trimEnd()).toMatch(/markDirty\(\);\n {2}}$/);
  });
});
