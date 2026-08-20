import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import * as genesisCompiler from "genesis-compiler";

const require = createRequire(import.meta.url);

const {
  GENESIS_CONTRACTS,
  addStack,
  generatePrompt,
  indexCodebase,
  initialize,
  inspectDeployment,
  inspectDerivedArtifacts,
  inspectEnvironment,
  inspectLaunch,
  inspectWorkspaceSetup
} = genesisCompiler;

const GENESIS_BLUEPRINT_PATH = "genesis/blueprint.md";
const VIBE64_STACK_PACKAGES = Object.freeze(["genesis-stack"]);
const GENESIS_PROMPT_TASKS = new Set([
  "blueprint",
  "describe",
  "deslop",
  "program",
  "review",
  "start",
  "work"
]);

function normalizeText(value = "") {
  return String(value || "").trim();
}

function assertGenesisPromptTask(value, {
  required = false
} = {}) {
  const task = normalizeText(value);
  if (!task && !required) {
    return "";
  }
  if (!GENESIS_PROMPT_TASKS.has(task)) {
    throw new TypeError(task
      ? `Unknown Genesis prompt task: ${task}.`
      : "Genesis prompt actions require an explicit task.");
  }
  return task;
}

function genesisPromptTask(action = {}) {
  return assertGenesisPromptTask(action.genesisTask) || "work";
}

function genesisPromptRequest(input = {}, action = {}) {
  const candidates = [
    input.conversationRequest,
    input.feedback,
    input.request,
    input.plan,
    input.description,
    action.label
  ];
  return candidates.map(normalizeText).find(Boolean) || "Continue the requested project work.";
}

function genesisPackageBinDirectory() {
  const nodeModulesRoot = (require.resolve.paths("genesis-compiler") || [])
    .find((candidate) => (
      existsSync(path.join(candidate, "genesis-compiler")) &&
      existsSync(path.join(candidate, ".bin", "genesis"))
    ));
  if (!nodeModulesRoot) {
    throw new Error("The installed Genesis compiler executable could not be located.");
  }
  return path.join(nodeModulesRoot, ".bin");
}

function withGenesisCommandShim(shimDirectories = []) {
  const bin = genesisPackageBinDirectory();
  const directories = Array.isArray(shimDirectories) ? shimDirectories : [];
  return [
    ...directories.filter((directory) => normalizeText(directory) !== bin),
    bin
  ];
}

function withVibe64StackCatalog(options = {}) {
  return {
    ...options,
    stackPackages: VIBE64_STACK_PACKAGES
  };
}

function addGenesisStack(options = {}) {
  return addStack(withVibe64StackCatalog(options));
}

function initializeGenesisProject(options = {}) {
  return initialize(withVibe64StackCatalog(options));
}

function refreshGenesisCities(options = {}) {
  return indexCodebase(withVibe64StackCatalog(options));
}

function inspectGenesisDerivedArtifacts() {
  const result = inspectDerivedArtifacts();
  if (result?.contract !== GENESIS_CONTRACTS.derivedArtifacts) {
    throw new Error(`Genesis returned ${result?.contract || "no contract identity"}; expected ${GENESIS_CONTRACTS.derivedArtifacts}.`);
  }
  const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
  if (!artifacts.length || artifacts.some((artifact) => !normalizeText(artifact?.path))) {
    throw new Error("Genesis returned an invalid derived-artifact contract.");
  }
  return {
    ...result,
    artifacts: artifacts.map((artifact) => ({ ...artifact }))
  };
}

const GENESIS_DERIVED_ARTIFACT_CONTRACT = inspectGenesisDerivedArtifacts();
const GENESIS_DERIVED_ARTIFACT_PATHS = Object.freeze(
  GENESIS_DERIVED_ARTIFACT_CONTRACT.artifacts.map((artifact) => artifact.path)
);
const GENESIS_DERIVED_ARTIFACTS_BY_ID = new Map(
  GENESIS_DERIVED_ARTIFACT_CONTRACT.artifacts.map((artifact) => [artifact.id, artifact])
);
const GENESIS_MACHINE_CITY_PATH = GENESIS_DERIVED_ARTIFACTS_BY_ID.get("machine-city")?.path;
const GENESIS_PROGRAM_CITY_PATH = GENESIS_DERIVED_ARTIFACTS_BY_ID.get("program-city")?.path;
if (!GENESIS_MACHINE_CITY_PATH || !GENESIS_PROGRAM_CITY_PATH) {
  throw new Error("Genesis did not declare both City projection artifacts.");
}

async function exactGenesisInspection(inspector, contract, options = {}) {
  const result = await inspector(withVibe64StackCatalog(options));
  if (result?.contract !== contract) {
    throw new Error(`Genesis returned ${result?.contract || "no contract identity"}; expected ${contract}.`);
  }
  return result;
}

function inspectGenesisDeployment(options = {}) {
  return exactGenesisInspection(inspectDeployment, GENESIS_CONTRACTS.deployment, options);
}

function inspectGenesisEnvironment(options = {}) {
  return exactGenesisInspection(inspectEnvironment, GENESIS_CONTRACTS.environment, options);
}

function inspectGenesisLaunch(options = {}) {
  return exactGenesisInspection(inspectLaunch, GENESIS_CONTRACTS.launch, options);
}

function inspectGenesisWorkspaceSetup(options = {}) {
  return exactGenesisInspection(inspectWorkspaceSetup, GENESIS_CONTRACTS.workspaceSetup, options);
}

function withVibe64ConversationContract(prompt = "") {
  return [
    normalizeText(prompt),
    "",
    "VIBE64 CONVERSATION",
    "",
    "If you need user input, ask no more than three concise, high-impact questions at once.",
    "When asking multiple questions, put each on its own line as `[1] Question`, `[2] Question`, and so on.",
    "When a question has a small fixed set of useful answers, finish with `Possible answers:` and a short bullet list. The user can always type a different answer."
  ].join("\n");
}

async function renderGenesisPrompt({
  action = {},
  environment = process.env,
  input = {},
  projectRoot
} = {}) {
  const requestedTask = genesisPromptTask(action);
  const request = genesisPromptRequest(input, action);
  let task = requestedTask;
  let result;
  try {
    result = await generatePrompt(withVibe64StackCatalog({ environment, projectRoot, request, task }));
  } catch (error) {
    if (error?.code === "BLUEPRINT_INVALID" && requestedTask !== "blueprint") {
      task = "blueprint";
      result = await generatePrompt(withVibe64StackCatalog({ environment, projectRoot, request, task }));
    } else if (error?.code === "BLUEPRINT_REQUIRED" && requestedTask !== "start") {
      task = "start";
      result = await generatePrompt(withVibe64StackCatalog({ environment, projectRoot, request, task }));
    } else {
      throw error;
    }
  }
  const effectiveTask = assertGenesisPromptTask(result.task) || task;
  return {
    context: {
      genesis: true,
      requestedTask,
      task: effectiveTask,
      verificationCommands: result.verificationCommands,
      warnings: result.warnings
    },
    originalPrompt: request,
    prompt: withVibe64ConversationContract(result.prompt),
    promptId: normalizeText(action.promptId || action.id) || effectiveTask
  };
}

export {
  GENESIS_BLUEPRINT_PATH,
  GENESIS_DERIVED_ARTIFACT_PATHS,
  GENESIS_MACHINE_CITY_PATH,
  GENESIS_PROGRAM_CITY_PATH,
  addGenesisStack,
  assertGenesisPromptTask,
  genesisPackageBinDirectory,
  genesisPromptRequest,
  genesisPromptTask,
  initializeGenesisProject,
  inspectGenesisDerivedArtifacts,
  inspectGenesisDeployment,
  inspectGenesisEnvironment,
  inspectGenesisLaunch,
  inspectGenesisWorkspaceSetup,
  refreshGenesisCities,
  renderGenesisPrompt,
  withVibe64ConversationContract,
  withGenesisCommandShim
};
