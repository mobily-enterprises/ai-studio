import crypto from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  isMissingPathError,
  isPlainObject,
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  normalizePreviewApplicationIdentities
} from "@local/vibe64-core/server/previewAuth";

const PREVIEW_APPLICATION_IDENTITIES_DIR = "preview";
const PREVIEW_APPLICATION_IDENTITIES_FILE = "application-identities.json";
const PREVIEW_APPLICATION_IDENTITIES_VERSION = 1;
const LEGACY_PREVIEW_APPLICATION_IDENTITIES_DIR = "runtime-config";
const LEGACY_PREVIEW_APPLICATION_IDENTITIES_FILE = "preview_application_identities";

function resolvePreviewIdentityProjectRoot(projectLocalRoot = "") {
  const root = normalizeText(projectLocalRoot);
  if (!root) {
    throw vibe64Error(
      "Managed app identities require projectLocalRoot.",
      "vibe64_preview_application_identities_root_required"
    );
  }
  return path.resolve(root);
}

function previewApplicationIdentitiesPath(projectLocalRoot = "") {
  return path.join(
    resolvePreviewIdentityProjectRoot(projectLocalRoot),
    PREVIEW_APPLICATION_IDENTITIES_DIR,
    PREVIEW_APPLICATION_IDENTITIES_FILE
  );
}

function normalizeStoredPreviewApplicationIdentities(state = {}) {
  if (
    !isPlainObject(state) ||
    state.version !== PREVIEW_APPLICATION_IDENTITIES_VERSION ||
    !Array.isArray(state.identities)
  ) {
    throw vibe64Error(
      "Managed app identity state is invalid.",
      "vibe64_invalid_preview_application_identity_state"
    );
  }
  return {
    identities: normalizePreviewApplicationIdentities(state.identities),
    version: PREVIEW_APPLICATION_IDENTITIES_VERSION
  };
}

function legacyPreviewApplicationIdentitiesPath(projectLocalRoot = "") {
  return path.join(
    resolvePreviewIdentityProjectRoot(projectLocalRoot),
    LEGACY_PREVIEW_APPLICATION_IDENTITIES_DIR,
    LEGACY_PREVIEW_APPLICATION_IDENTITIES_FILE
  );
}

async function readStoredPreviewApplicationIdentities(filePath = "") {
  try {
    return normalizeStoredPreviewApplicationIdentities(
      JSON.parse(await readFile(filePath, "utf8"))
    );
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw vibe64Error(
        "Managed app identity state is invalid.",
        "vibe64_invalid_preview_application_identity_state"
      );
    }
    throw error;
  }
}

async function migrateLegacyPreviewApplicationIdentities({
  projectLocalRoot = ""
} = {}) {
  const legacyPath = legacyPreviewApplicationIdentitiesPath(projectLocalRoot);
  let legacyText;
  try {
    legacyText = await readFile(legacyPath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
  const migrated = await savePreviewApplicationIdentities({
    identities: normalizePreviewApplicationIdentities(legacyText),
    projectLocalRoot
  });
  await rm(legacyPath, {
    force: true
  });
  return migrated;
}

async function readPreviewApplicationIdentities({
  projectLocalRoot = ""
} = {}) {
  const filePath = previewApplicationIdentitiesPath(projectLocalRoot);
  const state = await readStoredPreviewApplicationIdentities(filePath);
  if (state) {
    return {
      filePath,
      identities: state.identities
    };
  }
  const migrated = await migrateLegacyPreviewApplicationIdentities({
    projectLocalRoot
  });
  return migrated || {
    filePath,
    identities: []
  };
}

async function savePreviewApplicationIdentities({
  identities = [],
  projectLocalRoot = ""
} = {}) {
  const filePath = previewApplicationIdentitiesPath(projectLocalRoot);
  const state = normalizeStoredPreviewApplicationIdentities({
    identities,
    version: PREVIEW_APPLICATION_IDENTITIES_VERSION
  });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600
    });
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } finally {
    await rm(temporaryPath, {
      force: true
    });
  }
  return {
    filePath,
    identities: state.identities
  };
}

export {
  readPreviewApplicationIdentities,
  savePreviewApplicationIdentities
};
