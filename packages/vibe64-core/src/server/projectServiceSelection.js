function projectServiceSourceRoot(projectService = null) {
  if (projectService && typeof projectService.currentProjectSourceRoot === "function") {
    return String(projectService.currentProjectSourceRoot() || "").trim();
  }
  return "";
}

function projectServiceNamespaceRoot(projectService = null) {
  if (!projectService || typeof projectService.currentTargetRoot !== "function") {
    return "";
  }
  return String(projectService.currentTargetRoot() || "").trim();
}

export {
  projectServiceNamespaceRoot,
  projectServiceSourceRoot
};
