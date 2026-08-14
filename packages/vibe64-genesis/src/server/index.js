import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import * as genesisCompiler from "genesis-compiler";

const require = createRequire(import.meta.url);

const {
  addStack,
  generatePrompt,
  indexCodebase,
  initialize,
  inspectLaunch
} = genesisCompiler;

const GENESIS_BLUEPRINT_PATH = "genesis/blueprint.md";
const GENESIS_MACHINE_CITY_PATH = ".genesis/machine-city.json";
const GENESIS_PROGRAM_CITY_PATH = ".genesis/program-city.json";
const GENESIS_PROMPT_TASKS = new Set([
  "blueprint",
  "describe",
  "deslop",
  "program",
  "review",
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

const addGenesisStack = addStack;
const initializeGenesisProject = initialize;
const inspectGenesisLaunch = inspectLaunch;
const refreshGenesisCities = indexCodebase;

function inspectGenesisWorkspaceSetup(options = {}) {
  if (typeof genesisCompiler.inspectWorkspaceSetup !== "function") {
    throw new Error("The installed Genesis compiler does not expose workspace setup inspection.");
  }
  return genesisCompiler.inspectWorkspaceSetup(options);
}

function adoptionPrompt(request) {
  return withVibe64ConversationContract([
    "This existing project has not been adopted by Genesis.",
    "Strongly recommend that the user run `genesis adopt` before substantial work. It preserves the existing implementation and prepares a prompt for its Blueprint and Program.",
    "Do not mutate the project merely to bypass this missing explanatory foundation.",
    "",
    "USER REQUEST",
    "",
    request
  ].join("\n"));
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
    result = await generatePrompt({ environment, projectRoot, request, task });
  } catch (error) {
    if (error?.code === "BLUEPRINT_INVALID" && requestedTask !== "blueprint") {
      task = "blueprint";
      result = await generatePrompt({ environment, projectRoot, request, task });
    } else if (error?.code === "BLUEPRINT_REQUIRED") {
      return {
        context: { genesis: false, task: "adopt" },
        originalPrompt: request,
        prompt: adoptionPrompt(request),
        promptId: normalizeText(action.promptId || action.id) || "adopt"
      };
    } else {
      throw error;
    }
  }
  return {
    context: {
      genesis: true,
      requestedTask,
      task,
      verificationCommands: result.verificationCommands,
      warnings: result.warnings
    },
    originalPrompt: request,
    prompt: withVibe64ConversationContract(result.prompt),
    promptId: normalizeText(action.promptId || action.id) || task
  };
}

export {
  GENESIS_BLUEPRINT_PATH,
  GENESIS_MACHINE_CITY_PATH,
  GENESIS_PROGRAM_CITY_PATH,
  addGenesisStack,
  assertGenesisPromptTask,
  genesisPackageBinDirectory,
  genesisPromptRequest,
  genesisPromptTask,
  initializeGenesisProject,
  inspectGenesisLaunch,
  inspectGenesisWorkspaceSetup,
  refreshGenesisCities,
  renderGenesisPrompt,
  withVibe64ConversationContract,
  withGenesisCommandShim
};
