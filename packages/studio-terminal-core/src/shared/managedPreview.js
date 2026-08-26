function preferredPreviewTarget(outputTargets = []) {
  const targets = (Array.isArray(outputTargets) ? outputTargets : [])
    .filter((target) => target?.presentation?.kind === "web");
  return targets.find((target) => target?.default === true) ||
    targets[0] ||
    null;
}

function managedPreviewTarget(outputTargets = []) {
  const availableTargets = (Array.isArray(outputTargets) ? outputTargets : [])
    .filter((target) => target?.available !== false);
  return preferredPreviewTarget(availableTargets);
}

export {
  managedPreviewTarget,
  preferredPreviewTarget
};
