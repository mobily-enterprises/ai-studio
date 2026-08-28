import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import * as genesisCompiler from "genesis-compiler";

import {
  VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
  VIBE64_APPLICATION_DEPLOYMENT_SECTION,
  parseVibe64DeploymentLines,
  vibe64DeploymentInspection
} from "./applicationDeployment.js";
import {
  VIBE64_OUTPUTS_CONTRACT,
  VIBE64_OUTPUTS_SECTION,
  VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  parseVibe64OutputsLines,
  vibe64OutputsInspection
} from "./outputs.js";
import {
  VIBE64_WORKSPACE_SETUP_CONTRACT,
  VIBE64_WORKSPACE_SETUP_SECTION,
  parseVibe64WorkspaceSetupLines,
  vibe64WorkspaceSetupInspection
} from "./workspaceSetup.js";

const require = createRequire(import.meta.url);

const {
  GENESIS_CONTRACTS,
  addStack,
  generatePrompt,
  indexCodebase,
  initialize,
  inspectDerivedArtifacts,
  inspectEngineering,
  inspectEnvironment,
  inspectStackSection,
  setEngineeringProfile
} = genesisCompiler;

const GENESIS_BLUEPRINT_PATH = "genesis/blueprint.md";
const VIBE64_AUTOMATIC_HOOK_NO_OUTPUT = "VIBE64_AUTOMATIC_HOOK_NO_OUTPUT";
const VIBE64_POSTGRESQL_NEW_PROJECT_AVAILABLE = false;
const VIBE64_HIDDEN_ONBOARDING_STACK_PIECES = Object.freeze([
  "vue",
  ...(VIBE64_POSTGRESQL_NEW_PROJECT_AVAILABLE ? [] : ["jskit-postgresql", "postgresql"])
]);
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

function genesisCommandShimDirectory() {
  const serverEntrypoint = require.resolve("@local/vibe64-genesis/server");
  return path.resolve(path.dirname(serverEntrypoint), "../../bin");
}

function withGenesisCommandShim(shimDirectories = []) {
  const bin = genesisCommandShimDirectory();
  const compilerBin = genesisPackageBinDirectory();
  const directories = Array.isArray(shimDirectories) ? shimDirectories : [];
  return [
    ...directories.filter((directory) => ![bin, compilerBin].includes(normalizeText(directory))),
    bin
  ];
}

function withVibe64StackCatalog(options = {}, {
  prompt = false
} = {}) {
  return {
    ...options,
    ...(prompt ? { hiddenStackPieces: VIBE64_HIDDEN_ONBOARDING_STACK_PIECES } : {}),
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
  const projectRoot = normalizeText(options.projectRoot);
  if (!projectRoot || !path.isAbsolute(projectRoot)) {
    throw new TypeError("Genesis inspection requires an explicit absolute projectRoot.");
  }
  const result = await inspector(withVibe64StackCatalog(options));
  if (result?.contract !== contract) {
    throw new Error(`Genesis returned ${result?.contract || "no contract identity"}; expected ${contract}.`);
  }
  return result;
}

function inspectGenesisStackSection(name, options = {}) {
  return exactGenesisInspection(
    (inspectionOptions) => inspectStackSection({ ...inspectionOptions, name }),
    GENESIS_CONTRACTS.stackSection,
    options
  );
}

async function inspectVibe64Deployment(options = {}) {
  const [section, environment] = await Promise.all([
    inspectGenesisStackSection(VIBE64_APPLICATION_DEPLOYMENT_SECTION, options),
    exactGenesisInspection(inspectEnvironment, GENESIS_CONTRACTS.environment, options)
  ]);
  return vibe64DeploymentInspection({ environment, section });
}

function inspectGenesisEnvironment(options = {}) {
  return exactGenesisInspection(inspectEnvironment, GENESIS_CONTRACTS.environment, options);
}

function inspectGenesisEngineering(options = {}) {
  return exactGenesisInspection(inspectEngineering, GENESIS_CONTRACTS.engineering, options);
}

function setGenesisEngineeringProfile(options = {}) {
  return exactGenesisInspection(setEngineeringProfile, GENESIS_CONTRACTS.engineering, options);
}

async function inspectVibe64Outputs(options = {}) {
  const [section, environment] = await Promise.all([
    inspectGenesisStackSection(VIBE64_OUTPUTS_SECTION, options),
    exactGenesisInspection(inspectEnvironment, GENESIS_CONTRACTS.environment, options)
  ]);
  return vibe64OutputsInspection({ environment, section });
}

async function inspectVibe64WorkspaceSetup(options = {}) {
  const section = await inspectGenesisStackSection(VIBE64_WORKSPACE_SETUP_SECTION, options);
  return vibe64WorkspaceSetupInspection({
    projectRoot: options.projectRoot,
    section
  });
}

function withVibe64ConversationContract(prompt = "", {
  task = ""
} = {}) {
  return [
    normalizeText(prompt),
    "",
    "VIBE64 CONVERSATION",
    "",
    "If you need user input, ask no more than three concise, high-impact questions at once.",
    "When asking multiple questions, put each on its own line as `[1] Question`, `[2] Question`, and so on.",
    "When a question has a small fixed set of useful answers, finish with `Possible answers:` and a short bullet list. The user can always type a different answer.",
    ...(task === "start" ? [
      "",
      "VIBE64 NEW-PROJECT OPENING",
      "",
      "Apply the following rules only when GENESIS CONTEXT says `projectKind` is `new`.",
      "The Vibe64 interface has already welcomed the person and invited their rough idea. Respond directly to their first message without repeating that greeting.",
      "If the person still has not described an idea, warmly invite them to write what they would like to make and stop there; do not lead with technical questions.",
      "Keep the conversation in friendly product language. Do not mention Genesis, Stack, JSKIT, Vue, or other internal foundation names unless the person explicitly asks about technology.",
      "When the idea is clearly a web app and the person has not requested a technology, use Vibe64's standard web-app foundation. Run the Genesis `stack add jskit-mysql` operation when the product clearly needs durable application records; otherwise run the Genesis `stack add jskit` operation. This is an explicit Vibe64 host default and overrides the earlier generic instruction not to select technology silently for this case.",
      "Do not ask the person to choose a database when Vibe64's MySQL default satisfies the product they described.",
      ...(!VIBE64_POSTGRESQL_NEW_PROJECT_AVAILABLE ? [
        "PostgreSQL is temporarily unavailable for new Vibe64 projects. Do not offer or select `postgresql` or `jskit-postgresql`.",
        "If the person explicitly requests PostgreSQL, explain briefly that it is not available yet and ask whether MySQL is acceptable; do not silently substitute MySQL."
      ] : []),
      "Do not offer standalone `vue` as a new-project choice. Honor an explicit technology request; otherwise ask about technology only when the product cannot use the standard web-app foundation."
    ] : []),
    "",
    "AUTOMATIC HOOK FOLLOW-UPS",
    "",
    "A hook prompt is internal follow-up work, not a new human message. Do not send commentary, progress announcements, or routine review summaries during it.",
    "Exception: when a hook explicitly requests the final automatic user-facing summary, provide that summary exactly as requested even though it changes no files.",
    `If an automatic hook follow-up changes no project files and finds no new blocker or failure, make its final answer exactly \`${VIBE64_AUTOMATIC_HOOK_NO_OUTPUT}\`.`,
    `Do not use \`${VIBE64_AUTOMATIC_HOOK_NO_OUTPUT}\` for the explicitly requested final user-facing summary.`,
    "If it changes files or finds a new blocker or failure, give only the concise result the person needs."
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
    result = await generatePrompt(
      withVibe64StackCatalog({ environment, projectRoot, request, task }, { prompt: true })
    );
  } catch (error) {
    if (error?.code === "BLUEPRINT_INVALID" && requestedTask !== "blueprint") {
      task = "blueprint";
      result = await generatePrompt(
        withVibe64StackCatalog({ environment, projectRoot, request, task }, { prompt: true })
      );
    } else if (error?.code === "BLUEPRINT_REQUIRED" && requestedTask !== "start") {
      task = "start";
      result = await generatePrompt(
        withVibe64StackCatalog({ environment, projectRoot, request, task }, { prompt: true })
      );
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
    prompt: withVibe64ConversationContract(result.prompt, {
      task: effectiveTask
    }),
    promptId: normalizeText(action.promptId || action.id) || effectiveTask
  };
}

export {
  GENESIS_BLUEPRINT_PATH,
  GENESIS_DERIVED_ARTIFACT_PATHS,
  GENESIS_MACHINE_CITY_PATH,
  GENESIS_PROGRAM_CITY_PATH,
  VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
  VIBE64_APPLICATION_DEPLOYMENT_SECTION,
  VIBE64_AUTOMATIC_HOOK_NO_OUTPUT,
  VIBE64_OUTPUTS_CONTRACT,
  VIBE64_OUTPUTS_SECTION,
  VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  VIBE64_WORKSPACE_SETUP_CONTRACT,
  VIBE64_WORKSPACE_SETUP_SECTION,
  addGenesisStack,
  assertGenesisPromptTask,
  genesisPackageBinDirectory,
  genesisCommandShimDirectory,
  genesisPromptRequest,
  genesisPromptTask,
  initializeGenesisProject,
  inspectGenesisDerivedArtifacts,
  inspectGenesisEngineering,
  inspectGenesisStackSection,
  inspectVibe64Deployment,
  inspectGenesisEnvironment,
  inspectVibe64Outputs,
  inspectVibe64WorkspaceSetup,
  parseVibe64OutputsLines,
  parseVibe64DeploymentLines,
  parseVibe64WorkspaceSetupLines,
  refreshGenesisCities,
  renderGenesisPrompt,
  setGenesisEngineeringProfile,
  withVibe64ConversationContract,
  withGenesisCommandShim
};
