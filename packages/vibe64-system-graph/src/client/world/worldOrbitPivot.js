import * as THREE from "three";

const VIEWPORT_CENTER = new THREE.Vector2(0, 0);

// CameraControls always rotates around its target. Resolve that target from
// the ray through the viewport center and the active City's visual mid-plane,
// never from a pointer hit or selected building. Aspect-ratio changes do not
// move NDC (0, 0), which keeps the orbit pivot stable across pane resizes.
function viewportCenterOrbitPivot(camera, planeY = 0, fallback = new THREE.Vector3()) {
  if (!camera) {
    return fallback.clone();
  }
  camera.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(VIEWPORT_CENTER, camera);
  const directionY = raycaster.ray.direction.y;
  if (Math.abs(directionY) < 1e-7) {
    return fallback.clone();
  }
  const distance = (Number(planeY) - raycaster.ray.origin.y) / directionY;
  if (!Number.isFinite(distance) || distance <= 0) {
    return fallback.clone();
  }
  return raycaster.ray.at(distance, new THREE.Vector3());
}

export {
  viewportCenterOrbitPivot
};
