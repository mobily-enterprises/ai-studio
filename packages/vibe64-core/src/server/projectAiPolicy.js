import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import {
  isMissingPathError,
  isPlainObject,
  normalizeText,
  vibe64Error
} from "./core.js";
import {
  resolveProjectRuntimeRoot
} from "./projectState.js";

const PROJECT_AI_POLICY_DIRECTORY = "settings";
const PROJECT_AI_POLICY_FILE = "ai-policy.json";
const PROJECT_AI_POLICY_VERSION = 1;
const PROJECT_AI_POLICY_CUSTOM_NOTE_MAX_LENGTH = 500;
const PROJECT_AI_POLICY_TONES = Object.freeze([
  "encouraging",
  "playful",
  "direct",
  "military"
]);
const PROJECT_AI_POLICY_RESPONSE_LENGTHS = Object.freeze([
  "very_short",
  "concise",
  "balanced",
  "detailed"
]);
const PROJECT_AI_POLICY_EXPERTISE_LEVELS = Object.freeze([
  "beginner",
  "comfortable",
  "expert"
]);
const PROJECT_AI_POLICY_RATIONALE_LEVELS = Object.freeze([
  "conclusions",
  "concise",
  "teaching"
]);
const PROJECT_AI_POLICY_FIELDS = Object.freeze([
  "customNote",
  "expertise",
  "promptHints",
  "rationale",
  "responseLength",
  "tone"
]);
const projectAiPolicyUpdates = new Map();

function defaultProjectAiPolicy() {
  return {
    customNote: "",
    expertise: "comfortable",
    promptHints: true,
    rationale: "concise",
    responseLength: "concise",
    revision: 0,
    tone: "encouraging",
    version: PROJECT_AI_POLICY_VERSION
  };
}

function projectAiPolicyPath(projectRuntimeRoot = "") {
  return path.join(
    resolveProjectRuntimeRoot({ projectRuntimeRoot }),
    PROJECT_AI_POLICY_DIRECTORY,
    PROJECT_AI_POLICY_FILE
  );
}

function projectAiPolicyError(message = "Project AI policy is invalid.") {
  return vibe64Error(message, "vibe64_project_ai_policy_invalid");
}

function assertAllowedFields(value = {}, allowedFields = []) {
  const allowed = new Set(allowedFields);
  const unsupported = Object.keys(value).filter((field) => !allowed.has(field));
  if (unsupported.length > 0) {
    throw projectAiPolicyError(
      `Project AI policy contains unsupported fields: ${unsupported.join(", ")}.`
    );
  }
}

function enumValue(value, allowed, label) {
  const normalized = normalizeText(value);
  if (!allowed.includes(normalized)) {
    throw projectAiPolicyError(`Project AI policy ${label} is invalid.`);
  }
  return normalized;
}

function normalizeCustomNote(value = "") {
  if (typeof value !== "string") {
    throw projectAiPolicyError("Project AI policy custom note must be text.");
  }
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (normalized.includes("\0")) {
    throw projectAiPolicyError("Project AI policy custom note contains invalid characters.");
  }
  if (Array.from(normalized).length > PROJECT_AI_POLICY_CUSTOM_NOTE_MAX_LENGTH) {
    throw projectAiPolicyError(
      `Project AI policy custom note must be ${PROJECT_AI_POLICY_CUSTOM_NOTE_MAX_LENGTH} characters or fewer.`
    );
  }
  return normalized;
}

function normalizeProjectAiPolicy(value = {}) {
  if (!isPlainObject(value)) {
    throw projectAiPolicyError("Project AI policy must be an object.");
  }
  assertAllowedFields(value, PROJECT_AI_POLICY_FIELDS);
  const defaults = defaultProjectAiPolicy();
  const promptHints = Object.hasOwn(value, "promptHints")
    ? value.promptHints
    : defaults.promptHints;
  if (typeof promptHints !== "boolean") {
    throw projectAiPolicyError("Project AI policy prompt hints choice must be true or false.");
  }
  return {
    customNote: normalizeCustomNote(value.customNote ?? defaults.customNote),
    expertise: enumValue(
      value.expertise ?? defaults.expertise,
      PROJECT_AI_POLICY_EXPERTISE_LEVELS,
      "expertise level"
    ),
    promptHints,
    rationale: enumValue(
      value.rationale ?? defaults.rationale,
      PROJECT_AI_POLICY_RATIONALE_LEVELS,
      "rationale level"
    ),
    responseLength: enumValue(
      value.responseLength ?? defaults.responseLength,
      PROJECT_AI_POLICY_RESPONSE_LENGTHS,
      "response length"
    ),
    tone: enumValue(value.tone ?? defaults.tone, PROJECT_AI_POLICY_TONES, "tone")
  };
}

function normalizeStoredProjectAiPolicy(value = {}) {
  if (!isPlainObject(value)) {
    throw projectAiPolicyError("Stored project AI policy must be an object.");
  }
  assertAllowedFields(value, [
    ...PROJECT_AI_POLICY_FIELDS,
    "revision",
    "updatedAt",
    "version"
  ]);
  const missingFields = PROJECT_AI_POLICY_FIELDS.filter((field) => !Object.hasOwn(value, field));
  if (missingFields.length > 0) {
    throw projectAiPolicyError(
      `Stored project AI policy is missing fields: ${missingFields.join(", ")}.`
    );
  }
  if (value.version !== PROJECT_AI_POLICY_VERSION) {
    throw vibe64Error(
      `Project AI policy version ${String(value.version ?? "(missing)")} is not supported.`,
      "vibe64_project_ai_policy_version_unsupported"
    );
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw projectAiPolicyError("Stored project AI policy revision is invalid.");
  }
  const updatedAt = normalizeText(value.updatedAt);
  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) {
    throw projectAiPolicyError("Stored project AI policy update time is invalid.");
  }
  return {
    ...normalizeProjectAiPolicy(Object.fromEntries(
      PROJECT_AI_POLICY_FIELDS.map((field) => [field, value[field]])
    )),
    revision: value.revision,
    updatedAt,
    version: PROJECT_AI_POLICY_VERSION
  };
}

async function readProjectAiPolicyFile(filePath = "") {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return normalizeStoredProjectAiPolicy(parsed);
  } catch (error) {
    if (isMissingPathError(error)) {
      return defaultProjectAiPolicy();
    }
    if (error instanceof SyntaxError) {
      throw projectAiPolicyError("Stored project AI policy is not valid JSON.");
    }
    throw error;
  }
}

async function readProjectAiPolicy({
  projectRuntimeRoot = ""
} = {}) {
  const filePath = projectAiPolicyPath(projectRuntimeRoot);
  return {
    filePath,
    policy: await readProjectAiPolicyFile(filePath)
  };
}

async function writeProjectAiPolicyFile(filePath = "", policy = {}) {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await writeFile(temporaryPath, `${JSON.stringify(policy, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o660
    });
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o660);
  } finally {
    await rm(temporaryPath, {
      force: true
    });
  }
}

async function saveProjectAiPolicy({
  now = () => new Date(),
  policy = {},
  projectRuntimeRoot = ""
} = {}) {
  const filePath = projectAiPolicyPath(projectRuntimeRoot);
  const normalizedPolicy = normalizeProjectAiPolicy(policy);
  const previous = projectAiPolicyUpdates.get(filePath) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const current = await readProjectAiPolicyFile(filePath);
    const updatedAt = now().toISOString();
    const next = {
      ...normalizedPolicy,
      revision: current.revision + 1,
      updatedAt,
      version: PROJECT_AI_POLICY_VERSION
    };
    await writeProjectAiPolicyFile(filePath, next);
    return next;
  });
  projectAiPolicyUpdates.set(filePath, operation);
  try {
    return {
      filePath,
      policy: await operation
    };
  } finally {
    if (projectAiPolicyUpdates.get(filePath) === operation) {
      projectAiPolicyUpdates.delete(filePath);
    }
  }
}

export {
  PROJECT_AI_POLICY_CUSTOM_NOTE_MAX_LENGTH,
  PROJECT_AI_POLICY_EXPERTISE_LEVELS,
  PROJECT_AI_POLICY_FILE,
  PROJECT_AI_POLICY_RATIONALE_LEVELS,
  PROJECT_AI_POLICY_RESPONSE_LENGTHS,
  PROJECT_AI_POLICY_TONES,
  PROJECT_AI_POLICY_VERSION,
  defaultProjectAiPolicy,
  normalizeProjectAiPolicy,
  projectAiPolicyPath,
  readProjectAiPolicy,
  saveProjectAiPolicy
};
