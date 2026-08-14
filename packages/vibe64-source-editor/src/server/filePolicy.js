const DEFAULT_SOURCE_EDITOR_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_SOURCE_EDITOR_MAX_TREE_DEPTH = 16;
const DEFAULT_SOURCE_EDITOR_MAX_TREE_ENTRIES = 5000;
const VIBE64_SOURCE_CONTRACT_DIR = ".vibe64";
const VIBE64_SOURCE_CONTRACT_PREFIX = `${VIBE64_SOURCE_CONTRACT_DIR}/`;

const BASE_SOURCE_EDITOR_EXCLUDE_PATTERNS = Object.freeze([
  ".git",
  ".git/**"
]);

function normalizePolicyText(value = "") {
  return String(value || "").trim();
}

function normalizePolicyPath(value = "") {
  return normalizePolicyText(value)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/u, "")
    .replace(/\/+$/u, "");
}

function sourceEditorSourceContractPathExcluded(value = "") {
  const label = normalizePolicyPath(value);
  return label === VIBE64_SOURCE_CONTRACT_DIR || label.startsWith(VIBE64_SOURCE_CONTRACT_PREFIX);
}

function sourceEditorFilePolicy() {
  return {
    defaultOpenFiles: [],
    exclude: [...BASE_SOURCE_EDITOR_EXCLUDE_PATTERNS],
    maxFileBytes: DEFAULT_SOURCE_EDITOR_MAX_FILE_BYTES,
    maxTreeDepth: DEFAULT_SOURCE_EDITOR_MAX_TREE_DEPTH,
    maxTreeEntries: DEFAULT_SOURCE_EDITOR_MAX_TREE_ENTRIES,
    preexpandedDirectories: [],
    preloadDirectories: []
  };
}

export {
  sourceEditorFilePolicy,
  sourceEditorSourceContractPathExcluded
};
