import path from "node:path";
import process from "node:process";

import {
  normalizeTargetRoot,
  normalizeText
} from "./core.js";
import {
  projectContractRoot
} from "./projectManifest.js";

const PROJECT_STATE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/u;
const PROJECT_RECORD_FILE = "project.json";
const PROJECT_SESSIONS_DIR = "sessions";
const PROJECT_DEPLOYMENTS_DIR = "deployments";
const PROJECT_CANONICAL_REPOSITORY_DIR = "canonical-repository";
const PROJECT_GITHUB_MIRROR_DIR = "github-mirror";
const PROJECT_REPOSITORY_DIR = "repository.git";
const PROJECT_RUNTIME_DIR = "runtime";
const PROJECT_RUNTIME_CONFIG_DIR = "runtime-config";
const PROJECT_INFO_CACHE_FILE = "projectInfoCache.json";

function normalizeProjectStateSlug(value = "") {
  const slug = normalizeText(value);
  if (!PROJECT_STATE_SLUG_PATTERN.test(slug)) {
    const error = new Error(`Invalid Vibe64 project state slug: ${slug || "(empty)"}`);
    error.code = "vibe64_invalid_project_state_slug";
    throw error;
  }
  return slug;
}

function projectStateSlugFromTargetRoot(targetRoot = process.cwd()) {
  return normalizeProjectStateSlug(path.basename(normalizeTargetRoot(targetRoot)));
}

function resolveProjectContractRoot({
  targetRoot = process.cwd()
} = {}) {
  return resolveSourceConfigRoot({
    sourceRoot: targetRoot
  });
}

function resolveProjectHomeStateRoot({
  projectHome = "",
  targetRoot = process.cwd()
} = {}) {
  return resolveProjectRuntimeRoot({
    projectRoot: projectHome || targetRoot
  });
}

function resolveProjectLocalRoot({
  targetRoot = process.cwd()
} = {}) {
  return resolveProjectRuntimeRoot({
    projectRoot: targetRoot
  });
}

function resolveProjectHomeLocalRoot({
  projectHome = "",
  targetRoot = process.cwd()
} = {}) {
  return resolveProjectRuntimeRoot({
    projectRoot: projectHome || targetRoot
  });
}

function resolveSourceConfigRoot({
  sourceRoot = process.cwd()
} = {}) {
  return projectContractRoot({
    sourceRoot: normalizeTargetRoot(sourceRoot)
  });
}

function resolveProjectRuntimeRoot({
  projectRoot = process.cwd()
} = {}) {
  return normalizeTargetRoot(projectRoot);
}

function resolveProjectRecordPath({
  projectRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot
  }), PROJECT_RECORD_FILE);
}

function resolveProjectSessionsRoot({
  projectRuntimeRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: projectRuntimeRoot
  }), PROJECT_SESSIONS_DIR);
}

function resolveProjectDeploymentsRoot({
  projectRuntimeRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: projectRuntimeRoot
  }), PROJECT_DEPLOYMENTS_DIR);
}

function resolveProjectRepositoryStoragePath(projectRoot = "", storageDirectory = "") {
  const normalizedProjectRoot = normalizeText(projectRoot);
  if (!normalizedProjectRoot || !path.isAbsolute(normalizedProjectRoot)) {
    const error = new Error("Repository storage requires an absolute project root.");
    error.code = "vibe64_repository_storage_project_root_invalid";
    throw error;
  }
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: normalizedProjectRoot
  }), storageDirectory, PROJECT_REPOSITORY_DIR);
}

function resolveProjectCanonicalRepositoryPath({
  projectRoot = ""
} = {}) {
  return resolveProjectRepositoryStoragePath(projectRoot, PROJECT_CANONICAL_REPOSITORY_DIR);
}

function resolveProjectGithubMirrorPath({
  projectRoot = ""
} = {}) {
  return resolveProjectRepositoryStoragePath(projectRoot, PROJECT_GITHUB_MIRROR_DIR);
}

function resolveProjectRuntimeFilesRoot({
  projectRuntimeRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: projectRuntimeRoot
  }), PROJECT_RUNTIME_DIR);
}

function resolveProjectRuntimeConfigRoot({
  projectRuntimeRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: projectRuntimeRoot
  }), PROJECT_RUNTIME_CONFIG_DIR);
}

function resolveProjectInfoCachePath({
  projectRuntimeRoot = process.cwd()
} = {}) {
  return path.join(resolveProjectRuntimeRoot({
    projectRoot: projectRuntimeRoot
  }), PROJECT_INFO_CACHE_FILE);
}

export {
  PROJECT_DEPLOYMENTS_DIR,
  PROJECT_CANONICAL_REPOSITORY_DIR,
  PROJECT_GITHUB_MIRROR_DIR,
  PROJECT_INFO_CACHE_FILE,
  PROJECT_REPOSITORY_DIR,
  PROJECT_RECORD_FILE,
  PROJECT_RUNTIME_CONFIG_DIR,
  PROJECT_RUNTIME_DIR,
  PROJECT_SESSIONS_DIR,
  normalizeProjectStateSlug,
  projectStateSlugFromTargetRoot,
  resolveProjectContractRoot,
  resolveProjectRecordPath,
  resolveProjectDeploymentsRoot,
  resolveProjectCanonicalRepositoryPath,
  resolveProjectGithubMirrorPath,
  resolveProjectHomeLocalRoot,
  resolveProjectHomeStateRoot,
  resolveProjectInfoCachePath,
  resolveProjectLocalRoot,
  resolveProjectRuntimeConfigRoot,
  resolveProjectRuntimeFilesRoot,
  resolveProjectRuntimeRoot,
  resolveProjectSessionsRoot,
  resolveSourceConfigRoot
};
