import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isPlainObject,
  normalizeText
} from "./core.js";

const projectRecordMetadataUpdates = new Map();

async function readProjectRecordMetadata(projectRecordPath = "") {
  const filePath = normalizeText(projectRecordPath);
  if (!filePath) {
    return {};
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeProjectRecordMetadata(filePath, value) {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, {
      force: true
    });
  }
}

async function updateProjectRecordMetadata(projectRecordPath = "", update = {}) {
  const filePath = normalizeText(projectRecordPath);
  if (!filePath) {
    throw new Error("Updating project metadata requires a project record path.");
  }
  const metadataPath = path.resolve(filePath);
  const previous = projectRecordMetadataUpdates.get(metadataPath) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const current = await readProjectRecordMetadata(metadataPath);
    const next = typeof update === "function"
      ? await update(current)
      : {
          ...current,
          ...(isPlainObject(update) ? update : {})
        };
    if (!isPlainObject(next)) {
      throw new TypeError("Project metadata updates must produce an object.");
    }
    await writeProjectRecordMetadata(metadataPath, next);
    return next;
  });
  projectRecordMetadataUpdates.set(metadataPath, operation);
  try {
    return await operation;
  } finally {
    if (projectRecordMetadataUpdates.get(metadataPath) === operation) {
      projectRecordMetadataUpdates.delete(metadataPath);
    }
  }
}

export {
  readProjectRecordMetadata,
  updateProjectRecordMetadata
};
