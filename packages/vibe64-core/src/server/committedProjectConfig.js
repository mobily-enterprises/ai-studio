import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  isPlainObject,
  normalizeText,
  pathExists
} from "./core.js";
import {
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  readProjectRecordMetadata
} from "./projectBootstrapConfig.js";
import {
  normalizeProjectRepository,
  projectRepositoryStorageRole
} from "./projectRepository.js";
import {
  VIBE64_PROJECT_MANIFEST_FILE,
  parseProjectManifestText
} from "./projectManifest.js";

const COMMITTED_PROJECT_TYPE_FIELD = "projectType";
const COMMITTED_PROJECT_CONFIG_VALUES_DIR = VIBE64_PROJECT_MANIFEST_FILE;
const VIBE64_COMMITTED_PROJECT_CONFIG_READER_SERVICE = "feature.vibe64-project.committed-config-reader";
const DEFAULT_COMMITTED_SOURCE_FILE_MAX_BYTES = 16 * 1024 * 1024;

function committedConfigUnavailable(code, message, extra = {}) {
  return Object.freeze({
    available: false,
    code,
    configValues: {},
    message,
    ok: false,
    projectType: "",
    ...extra
  });
}

function committedConfigAvailable({
  commit = "",
  configRoot = "",
  configValues = {},
  gitDir = "",
  ref = "",
  sourceRoot = "",
  sourceType = ""
} = {}) {
  return Object.freeze({
    available: true,
    code: "",
    commit,
    configRoot,
    configValues,
    gitDir,
    message: "",
    ok: true,
    projectType: normalizeText(configValues[COMMITTED_PROJECT_TYPE_FIELD]),
    ref,
    sourceRoot,
    sourceType
  });
}

function gitObjectPath(relativePath = "") {
  return String(relativePath || "")
    .split(/[\\/]+/u)
    .filter(Boolean)
    .join("/");
}

function committedSourceRelativePath(relativePath = "") {
  const value = normalizeText(relativePath);
  const parts = value.split(/[\\/]+/u);
  if (
    !value ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    parts.includes("..")
  ) {
    const error = new Error(`Committed project source path must be relative: ${value || "(empty)"}.`);
    error.code = "vibe64_committed_project_source_path_invalid";
    throw error;
  }
  return gitObjectPath(value);
}

function gitArgs(args = [], {
  gitDir = ""
} = {}) {
  return gitDir
    ? [`--git-dir=${path.resolve(gitDir)}`, ...args]
    : args;
}

async function runGit(args = [], {
  cwd = "",
  gitDir = "",
  maxBuffer = 16 * 1024 * 1024,
  outputEncoding = "utf8"
} = {}) {
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const resolvedGitDir = gitDir ? path.resolve(gitDir) : "";
  const result = await runVibe64Command({
    actor: "daemon",
    allowedRoots: [
      resolvedCwd,
      resolvedGitDir
    ].filter(Boolean),
    args: gitArgs(args, {
      gitDir: resolvedGitDir
    }),
    command: "git",
    cwd: resolvedCwd,
    envPolicy: "project",
    gitSafeDirectories: [
      resolvedCwd,
      resolvedGitDir
    ].filter(Boolean),
    maxBuffer,
    mode: "capture",
    outputEncoding,
    purpose: "source-editor",
    runtimes: ["git"]
  });
  if (!result.ok) {
    const stderr = outputEncoding === "base64"
      ? Buffer.from(result.stderr || "", "base64").toString("utf8")
      : result.stderr;
    const error = new Error(normalizeText(stderr || result.output || result.error) || "git failed.");
    error.code = result.code || "vibe64_committed_project_git_failed";
    error.stdout = result.stdout || "";
    error.stderr = result.stderr || "";
    throw error;
  }
  return result.stdout;
}

async function runGitBuffer(args = [], {
  cwd = "",
  gitDir = "",
  maxBytes = DEFAULT_COMMITTED_SOURCE_FILE_MAX_BYTES
} = {}) {
  const resolvedCwd = path.resolve(cwd || process.cwd());
  const resolvedGitDir = gitDir ? path.resolve(gitDir) : "";
  const resolvedMaxBytes = Number.isSafeInteger(Number(maxBytes)) && Number(maxBytes) > 0
    ? Number(maxBytes)
    : DEFAULT_COMMITTED_SOURCE_FILE_MAX_BYTES;
  const output = await runGit(args, {
    cwd: resolvedCwd,
    gitDir: resolvedGitDir,
    maxBuffer: Math.ceil(resolvedMaxBytes / 3) * 4 + 4,
    outputEncoding: "base64"
  });
  const bytes = Buffer.from(output || "", "base64");
  if (bytes.length > resolvedMaxBytes) {
    const error = new Error(`Committed project source file exceeds ${resolvedMaxBytes} bytes.`);
    error.code = "vibe64_committed_project_source_file_too_large";
    throw error;
  }
  return bytes;
}

async function resolveGitCommit({
  cwd = "",
  gitDir = "",
  ref = "HEAD"
} = {}) {
  const normalizedRef = normalizeText(ref) || "HEAD";
  return normalizeText(await runGit(["rev-parse", "--verify", `${normalizedRef}^{commit}`], {
    cwd,
    gitDir
  }));
}

async function readGitFile({
  cwd = "",
  filePath = "",
  gitDir = "",
  ref = "HEAD"
} = {}) {
  const normalizedPath = gitObjectPath(filePath);
  const treeEntry = normalizeText(await runGit([
    "ls-tree",
    "--name-only",
    ref,
    "--",
    normalizedPath
  ], {
    cwd,
    gitDir
  }));
  if (!treeEntry) {
    return null;
  }
  return runGit(["show", `${ref}:${normalizedPath}`], {
    cwd,
    gitDir
  });
}

function committedProjectManifestInvalid(message = "", extra = {}) {
  return committedConfigUnavailable(
    "vibe64_committed_project_manifest_invalid",
    message || "Committed vibe64.project.json is invalid.",
    extra
  );
}

function readCommittedProjectConfigFromText({
  commit = "",
  gitDir = "",
  manifestText = null,
  ref = "",
  sourceRoot = "",
  sourceType = ""
} = {}) {
  const common = {
    commit,
    configRoot: VIBE64_PROJECT_MANIFEST_FILE,
    gitDir,
    ref,
    sourceRoot,
    sourceType
  };
  if (manifestText === null || manifestText === undefined) {
    return committedConfigUnavailable(
      "vibe64_committed_project_type_missing",
      "Committed vibe64.project.json is missing. Choose the app type to configure this repository.",
      common
    );
  }

  let manifest;
  try {
    manifest = parseProjectManifestText(manifestText);
  } catch (error) {
    if (error?.code === "vibe64_project_manifest_invalid_json") {
      return committedProjectManifestInvalid(
        "Committed vibe64.project.json contains invalid JSON. Repair and commit the file before opening this project.",
        {
          ...common,
          causeCode: error.code
        }
      );
    }
    if (error?.code === "vibe64_project_manifest_object_required") {
      return committedProjectManifestInvalid(
        "Committed vibe64.project.json must contain a JSON object.",
        {
          ...common,
          causeCode: error.code
        }
      );
    }
    if (error?.code === "vibe64_project_manifest_schema_unsupported") {
      return committedProjectManifestInvalid(
        "Committed vibe64.project.json uses an unsupported schema or schema version.",
        {
          ...common,
          causeCode: error.code
        }
      );
    }
    return committedProjectManifestInvalid(
      normalizeText(error?.message) || "Committed vibe64.project.json is invalid. Repair and commit the file before opening this project.",
      {
        ...common,
        causeCode: normalizeText(error?.code)
      }
    );
  }
  if (!manifest.projectType) {
    return committedProjectManifestInvalid(
      "Committed vibe64.project.json is missing projectType. Repair and commit the file before opening this project.",
      common
    );
  }
  const configValues = Object.fromEntries([
    [COMMITTED_PROJECT_TYPE_FIELD, manifest.projectType],
    ...Object.entries(manifest.config || {})
  ].sort(([left], [right]) => left.localeCompare(right)));

  return committedConfigAvailable({
    commit,
    configRoot: VIBE64_PROJECT_MANIFEST_FILE,
    configValues,
    gitDir,
    ref,
    sourceRoot,
    sourceType
  });
}

async function createCommittedGitSourceReader({
  committedConfig = {}
} = {}) {
  const gitDir = normalizeText(committedConfig.gitDir);
  const sourceRoot = normalizeText(committedConfig.sourceRoot);
  if (!gitDir && !sourceRoot) {
    const error = new Error("Committed Git source is unavailable for workflow inspection.");
    error.code = "vibe64_committed_project_source_unavailable";
    throw error;
  }

  const resolvedGitDir = gitDir ? path.resolve(gitDir) : "";
  const cwd = sourceRoot ? path.resolve(sourceRoot) : path.dirname(resolvedGitDir);
  const revision = normalizeText(committedConfig.commit || committedConfig.ref) || "HEAD";
  const treeOutput = await runGit([
    "ls-tree",
    "-r",
    "-z",
    revision
  ], {
    cwd,
    gitDir: resolvedGitDir
  });
  const objectsByPath = committedGitTreeObjects(treeOutput);
  return Object.freeze({
    exists(relativePath = "") {
      return objectsByPath.has(committedSourceRelativePath(relativePath));
    },
    objectId(relativePath = "") {
      return objectsByPath.get(committedSourceRelativePath(relativePath)) || "";
    },
    async readBuffer(relativePath = "", options = {}) {
      const normalizedPath = committedSourceRelativePath(relativePath);
      const objectId = objectsByPath.get(normalizedPath);
      if (!objectId) {
        return null;
      }
      const maxBytes = Number.isSafeInteger(Number(options?.maxBytes)) && Number(options.maxBytes) > 0
        ? Number(options.maxBytes)
        : DEFAULT_COMMITTED_SOURCE_FILE_MAX_BYTES;
      const expectedBytes = Number(normalizeText(await runGit(["cat-file", "-s", objectId], {
        cwd,
        gitDir: resolvedGitDir
      })));
      if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0) {
        const error = new Error("Committed project source file size is unavailable.");
        error.code = "vibe64_committed_project_source_file_size_invalid";
        throw error;
      }
      if (expectedBytes > maxBytes) {
        const error = new Error(`Committed project source file exceeds ${maxBytes} bytes.`);
        error.code = "vibe64_committed_project_source_file_too_large";
        throw error;
      }
      const bytes = await runGitBuffer(["cat-file", "blob", objectId], {
        cwd,
        gitDir: resolvedGitDir,
        maxBytes
      });
      if (bytes.length !== expectedBytes) {
        const error = new Error("Committed project source file could not be read completely.");
        error.code = "vibe64_committed_project_source_file_incomplete";
        throw error;
      }
      return bytes;
    },
    async readText(relativePath = "") {
      const normalizedPath = committedSourceRelativePath(relativePath);
      if (!objectsByPath.has(normalizedPath)) {
        return null;
      }
      return runGit(["show", `${revision}:${normalizedPath}`], {
        cwd,
        gitDir: resolvedGitDir
      });
    }
  });
}

function committedGitTreeObjects(output = "") {
  const objectsByPath = new Map();
  for (const entry of String(output || "").split("\0").filter(Boolean)) {
    const separatorIndex = entry.indexOf("\t");
    if (separatorIndex < 1) {
      continue;
    }
    const header = entry.slice(0, separatorIndex).trim().split(/\s+/u);
    const objectId = normalizeText(header[2]);
    const filePath = entry.slice(separatorIndex + 1);
    if (objectId && filePath) {
      objectsByPath.set(filePath, objectId);
    }
  }
  return objectsByPath;
}

async function readCommittedConfigFromGit({
  cwd = "",
  gitDir = "",
  ref = "HEAD",
  sourceRoot = "",
  sourceType = ""
} = {}) {
  let commit = "";
  try {
    commit = await resolveGitCommit({
      cwd,
      gitDir,
      ref
    });
  } catch {
    try {
      const firstRef = normalizeText(await runGit([
        "for-each-ref",
        "--count=1",
        "--format=%(refname)"
      ], {
        cwd,
        gitDir
      }));
      if (!firstRef) {
        return readCommittedProjectConfigFromText({
          gitDir,
          manifestText: null,
          ref,
          sourceRoot,
          sourceType
        });
      }
    } catch {
      // The configured-ref error below is the actionable repository result.
    }
    return committedConfigUnavailable(
      "vibe64_committed_project_git_ref_unavailable",
      "Committed project config could not be read because the configured Git ref is unavailable.",
      {
        gitDir,
        ref,
        sourceRoot,
        sourceType
      }
    );
  }

  const manifestPath = gitObjectPath(VIBE64_PROJECT_MANIFEST_FILE);
  let manifestText;
  try {
    manifestText = await readGitFile({
      cwd,
      filePath: manifestPath,
      gitDir,
      ref
    });
  } catch {
    return committedConfigUnavailable(
      "vibe64_committed_project_repository_unreadable",
      "Committed project config could not be read from the configured Git repository.",
      {
        commit,
        gitDir,
        ref,
        sourceRoot,
        sourceType
      }
    );
  }
  return readCommittedProjectConfigFromText({
    commit,
    gitDir,
    manifestText,
    ref,
    sourceRoot,
    sourceType
  });
}

async function readCommittedProjectConfigFromSource({
  ref = "HEAD",
  readMode = "git",
  sourceRoot = ""
} = {}) {
  const resolvedSourceRoot = normalizeText(sourceRoot)
    ? path.resolve(sourceRoot)
    : "";
  if (!resolvedSourceRoot || !await pathExists(resolvedSourceRoot)) {
    return committedConfigUnavailable(
      "vibe64_committed_project_source_missing",
      "Committed project config requires an existing source root.",
      {
        ref,
        sourceRoot: resolvedSourceRoot,
        sourceType: "source"
      }
    );
  }
  if (normalizeText(readMode) === "filesystem") {
    const manifestPath = path.join(resolvedSourceRoot, VIBE64_PROJECT_MANIFEST_FILE);
    if (!await pathExists(manifestPath)) {
      return readCommittedProjectConfigFromText({
        manifestText: null,
        sourceRoot: resolvedSourceRoot,
        sourceType: "source-tree"
      });
    }
    return readCommittedProjectConfigFromText({
      manifestText: await readFile(manifestPath, "utf8"),
      sourceRoot: resolvedSourceRoot,
      sourceType: "source-tree"
    });
  }
  return readCommittedConfigFromGit({
    cwd: resolvedSourceRoot,
    ref,
    sourceRoot: resolvedSourceRoot,
    sourceType: "source"
  });
}

function committedProjectConfigRefFromMetadata(metadata = {}) {
  const defaultBranch = normalizeText(metadata?.repository?.defaultBranch);
  if (!defaultBranch) {
    const error = new Error("Project repository metadata does not define a default branch.");
    error.code = "vibe64_committed_project_repository_metadata_invalid";
    throw error;
  }
  return `refs/heads/${defaultBranch}`;
}

function committedRepositoryStorage(mode = "", projectRoot = "") {
  if (!projectRoot) {
    return null;
  }
  const role = projectRepositoryStorageRole({
    mode,
    projectRoot
  });
  if (!role) {
    return null;
  }
  return {
    ...role,
    missingCode: role.durable
      ? "vibe64_committed_project_canonical_repository_missing"
      : "vibe64_committed_project_github_mirror_missing",
    sourceType: role.directory
  };
}

async function readCommittedProjectConfigFromRepositoryStorage({
  metadata = null,
  projectRoot = "",
  projectRecordPath = "",
  projectRuntimeRoot = "",
  ref = ""
} = {}) {
  const resolvedRuntimeRoot = normalizeText(projectRuntimeRoot)
    ? path.resolve(projectRuntimeRoot)
    : "";
  const resolvedProjectRoot = normalizeText(projectRoot)
    ? path.resolve(projectRoot)
    : "";
  const projectMetadata = isPlainObject(metadata)
    ? metadata
    : await readProjectRecordMetadata(projectRecordPath);
  const repository = normalizeProjectRepository(projectMetadata.repository);
  const storage = committedRepositoryStorage(repository?.mode, resolvedProjectRoot);
  if (!storage) {
    return committedConfigUnavailable(
      "vibe64_committed_project_repository_storage_unassigned",
      "Committed project config is unavailable because the project repository mode has no repository storage role.",
      {
        projectRuntimeRoot: resolvedRuntimeRoot,
        projectRoot: resolvedProjectRoot,
        sourceType: "repository-storage"
      }
    );
  }
  if (!await pathExists(storage.path)) {
    return committedConfigUnavailable(
      storage.missingCode,
      `Committed project config is unavailable because the project ${storage.label.toLowerCase()} is missing.`,
      {
        gitDir: storage.path,
        projectRuntimeRoot: resolvedRuntimeRoot,
        projectRoot: resolvedProjectRoot,
        sourceType: storage.sourceType
      }
    );
  }
  const resolvedRef = normalizeText(ref) || committedProjectConfigRefFromMetadata(projectMetadata);
  return readCommittedConfigFromGit({
    gitDir: storage.path,
    ref: resolvedRef,
    sourceType: storage.sourceType
  });
}

async function readCommittedProjectConfigFromRepositoryReader({
  committedProjectConfigReader = null,
  metadata = {},
  projectRoot = "",
  projectRecordPath = "",
  projectRuntimeRoot = "",
  ref = "",
  vibe64User = null
} = {}) {
  if (typeof committedProjectConfigReader?.readCommittedProjectConfig !== "function") {
    return null;
  }

  let result;
  try {
    result = await committedProjectConfigReader.readCommittedProjectConfig({
      metadata,
      projectRoot,
      projectRecordPath,
      projectRuntimeRoot,
      ref: normalizeText(ref) || committedProjectConfigRefFromMetadata(metadata),
      vibe64User
    });
  } catch (error) {
    if (normalizeText(error?.code).startsWith("vibe64_committed_project_")) {
      throw error;
    }
    const wrapped = new Error(
      `Committed project config could not be read from the repository: ${normalizeText(error?.message || error) || "repository read failed."}`
    );
    wrapped.code = "vibe64_committed_project_repository_unreadable";
    wrapped.cause = error;
    wrapped.details = {
      causeCode: normalizeText(error?.code),
      sourceType: "repository"
    };
    throw wrapped;
  }
  if (!result || result.handled !== true) {
    return null;
  }
  if (result.found !== false && typeof result.manifestText !== "string") {
    const error = new Error("Committed project repository reader returned no manifest contents.");
    error.code = "vibe64_committed_project_repository_unreadable";
    throw error;
  }
  return readCommittedProjectConfigFromText({
    commit: normalizeText(result.commit),
    manifestText: result.found === false ? null : result.manifestText,
    ref: normalizeText(result.ref),
    sourceType: normalizeText(result.sourceType) || "repository"
  });
}

async function readCommittedProjectConfig({
  committedProjectConfigReader = null,
  projectRoot = "",
  projectRecordPath = "",
  projectRuntimeRoot = "",
  ref = "",
  sourceReadMode = "git",
  sourceRoot = "",
  vibe64User = null
} = {}) {
  const resolvedSourceRoot = normalizeText(sourceRoot);
  if (resolvedSourceRoot) {
    return readCommittedProjectConfigFromSource({
      ref: ref || "HEAD",
      readMode: sourceReadMode,
      sourceRoot: resolvedSourceRoot
    });
  }
  const metadata = await readProjectRecordMetadata(projectRecordPath);
  const repositoryConfig = await readCommittedProjectConfigFromRepositoryReader({
    committedProjectConfigReader,
    metadata,
    projectRoot,
    projectRecordPath,
    projectRuntimeRoot,
    ref,
    vibe64User
  });
  if (repositoryConfig) {
    return repositoryConfig;
  }
  return readCommittedProjectConfigFromRepositoryStorage({
    metadata,
    projectRoot,
    projectRecordPath,
    projectRuntimeRoot,
    ref
  });
}

export {
  COMMITTED_PROJECT_CONFIG_VALUES_DIR,
  COMMITTED_PROJECT_TYPE_FIELD,
  VIBE64_COMMITTED_PROJECT_CONFIG_READER_SERVICE,
  committedProjectConfigRefFromMetadata,
  createCommittedGitSourceReader,
  readCommittedProjectConfig,
  readCommittedProjectConfigFromRepositoryStorage,
  readCommittedProjectConfigFromText,
  readCommittedProjectConfigFromSource
};
