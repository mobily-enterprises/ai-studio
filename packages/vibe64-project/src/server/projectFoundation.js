import {
  cp,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import {
  addGenesisStack,
  initializeGenesisProject
} from "@local/vibe64-genesis/server";

const require = createRequire(import.meta.url);
const FOUNDATION_NAME_PATHS = Object.freeze([
  "app.json",
  "bin/server.js",
  "package-lock.json",
  "package.json",
  "server.js",
  "tests/client/smoke.vitest.js"
]);

function projectFoundationTemplateRoot() {
  const packageEntrypoint = require.resolve("@local/vibe64-project/server/managedProject");
  return path.resolve(path.dirname(packageEntrypoint), "../../templates/jskit-shell");
}

function normalizeFoundationProjectName(value = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "vibe64-project";
}

async function personalizeFoundation(projectRoot, projectName) {
  await Promise.all(FOUNDATION_NAME_PATHS.map(async (relativePath) => {
    const absolutePath = path.join(projectRoot, relativePath);
    const source = await readFile(absolutePath, "utf8");
    await writeFile(absolutePath, source.replaceAll("reading-room", projectName), "utf8");
  }));
}

async function copyFoundationFiles(templateRoot, projectRoot) {
  const entries = await readdir(templateRoot);
  await Promise.all(entries.map((entry) => cp(
    path.join(templateRoot, entry),
    path.join(projectRoot, entry),
    {
      errorOnExist: true,
      force: false,
      recursive: true
    }
  )));
}

async function materializeInitialProjectFoundation({
  initializeProject = initializeGenesisProject,
  projectName = "",
  projectRoot = "",
  selectStack = addGenesisStack,
  templateRoot = projectFoundationTemplateRoot()
} = {}) {
  const root = path.resolve(String(projectRoot || ""));
  const name = normalizeFoundationProjectName(projectName);
  await initializeProject({ projectRoot: root });
  await copyFoundationFiles(templateRoot, root);
  await personalizeFoundation(root, name);
  await selectStack({
    pieces: ["jskit"],
    projectRoot: root
  });
  return {
    name,
    projectRoot: root
  };
}

export {
  materializeInitialProjectFoundation,
  normalizeFoundationProjectName,
  projectFoundationTemplateRoot
};
