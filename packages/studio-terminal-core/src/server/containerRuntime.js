import path from "node:path";
import { execa } from "execa";
import {
  runHostCommand
} from "./shellCommands.js";

function containerWorkspacePath(targetRoot, absolutePath) {
  const relativePath = path.relative(targetRoot, absolutePath);
  if (!relativePath || relativePath === ".") {
    return "/workspace";
  }
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return "";
  }
  return path.posix.join("/workspace", ...relativePath.split(path.sep));
}

async function removeDockerContainer(containerName) {
  const normalizedContainerName = String(containerName || "").trim();
  if (!normalizedContainerName) {
    return;
  }
  await execa("docker", ["rm", "-f", normalizedContainerName], {
    reject: false,
    timeout: 10_000
  }).catch(() => null);
}

async function dockerImageExists(imageName, {
  timeout = 12_000
} = {}) {
  const normalizedImageName = String(imageName || "").trim();
  if (!normalizedImageName) {
    return false;
  }

  const result = await runHostCommand("docker", [
    "image",
    "inspect",
    normalizedImageName,
    "--format",
    "{{.Id}}"
  ], {
    timeout
  });
  return result.ok;
}

export {
  containerWorkspacePath,
  dockerImageExists,
  removeDockerContainer
};
