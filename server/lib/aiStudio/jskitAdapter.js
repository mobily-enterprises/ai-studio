import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  TargetAdapter,
  adapterActionResult,
  adapterCommand,
  adapterDetection,
  adapterProjectFacts
} from "./adapter.js";
import { normalizeText } from "./core.js";

const JSKIT_MARKERS = Object.freeze([
  {
    id: "package_json",
    label: "package.json",
    relativePath: "package.json"
  },
  {
    id: "public_config",
    label: "config/public.js",
    relativePath: "config/public.js"
  },
  {
    id: "client_entry",
    label: "src/main.js",
    relativePath: "src/main.js"
  },
  {
    id: "main_descriptor",
    label: "packages/main/package.descriptor.mjs",
    relativePath: "packages/main/package.descriptor.mjs"
  },
  {
    id: "jskit_lock",
    label: ".jskit/lock.json",
    relativePath: ".jskit/lock.json"
  }
]);

const JSKIT_CAPABILITIES = Object.freeze({
  create_issue_file: true,
  create_issue_on_gh: true,
  create_worktree: true,
  edit_issue: true,
  install_dependencies: true,
  send_issue_prompt: true
});

const JSKIT_COMMANDS = Object.freeze([
  {
    id: "create_worktree",
    label: "Create worktree"
  },
  {
    id: "install_dependencies",
    label: "Install dependencies"
  },
  {
    id: "create_issue_on_gh",
    label: "Create issue on GH"
  }
]);

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  if (!await pathExists(filePath)) {
    return {};
  }
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function inspectMarkers(targetRoot) {
  return Promise.all(JSKIT_MARKERS.map(async (marker) => {
    return {
      ...marker,
      exists: await pathExists(path.join(targetRoot, marker.relativePath))
    };
  }));
}

function allMarkersExist(markers) {
  return markers.every((marker) => marker.exists);
}

function missingMarkerLabels(markers) {
  return markers
    .filter((marker) => !marker.exists)
    .map((marker) => marker.label)
    .sort((left, right) => left.localeCompare(right));
}

function packageScripts(packageJson = {}) {
  return Object.keys(packageJson.scripts || {})
    .sort((left, right) => left.localeCompare(right));
}

function setupSummary(markers) {
  return allMarkersExist(markers)
    ? "JSKIT project detected."
    : `Missing JSKIT markers: ${missingMarkerLabels(markers).join(", ")}`;
}

function jskitPromptContext({ markers = [], packageJson = {}, targetRoot = "" } = {}) {
  return {
    adapter: "jskit",
    package_name: normalizeText(packageJson.name),
    scripts: packageScripts(packageJson).join(", "),
    target_root: normalizeText(targetRoot),
    valid_jskit_markers: String(allMarkersExist(markers))
  };
}

function jskitFacts({ markers = [], packageJson = {}, targetRoot = "" } = {}) {
  const detected = allMarkersExist(markers);
  return adapterProjectFacts({
    capabilities: detected ? JSKIT_CAPABILITIES : {},
    commands: detected ? JSKIT_COMMANDS : [],
    promptContext: jskitPromptContext({
      markers,
      packageJson,
      targetRoot
    }),
    summary: setupSummary(markers)
  });
}

function notConfiguredCommandRunner({ commandId }) {
  return adapterActionResult({
    message: `JSKIT command ${commandId} needs a command runner before it can execute.`,
    status: "blocked"
  });
}

class JskitTargetAdapter extends TargetAdapter {
  constructor({
    commandRunner = notConfiguredCommandRunner
  } = {}) {
    super({
      id: "jskit",
      label: "JSKIT target adapter"
    });
    this.commandRunner = commandRunner;
  }

  async projectInspection(targetRoot) {
    const resolvedTargetRoot = path.resolve(targetRoot);
    const [markers, packageJson] = await Promise.all([
      inspectMarkers(resolvedTargetRoot),
      readJsonIfExists(path.join(resolvedTargetRoot, "package.json"))
    ]);
    return {
      markers,
      packageJson,
      targetRoot: resolvedTargetRoot
    };
  }

  async detect({ targetRoot } = {}) {
    const inspection = await this.projectInspection(targetRoot || process.cwd());
    const detected = allMarkersExist(inspection.markers);
    return adapterDetection({
      detected,
      reason: detected ? "" : setupSummary(inspection.markers)
    });
  }

  async inspect({ targetRoot } = {}) {
    return jskitFacts(await this.projectInspection(targetRoot || process.cwd()));
  }

  async getPromptContext({ facts = {}, targetRoot } = {}) {
    if (facts.promptContext) {
      return facts.promptContext;
    }
    return jskitPromptContext(await this.projectInspection(targetRoot || process.cwd()));
  }

  async listCommands({ facts = {} } = {}) {
    return (facts.commands || []).map(adapterCommand);
  }

  async runCommand(commandId, context = {}) {
    const result = await this.commandRunner({
      commandId,
      context,
      targetRoot: context.session?.targetRoot || context.targetRoot || ""
    });
    return adapterActionResult(result);
  }
}

export {
  JSKIT_CAPABILITIES,
  JSKIT_COMMANDS,
  JSKIT_MARKERS,
  JskitTargetAdapter
};
