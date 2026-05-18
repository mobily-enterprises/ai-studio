import path from "node:path";
import process from "node:process";

import {
  inspectDescribedCurrentApp,
  packageScriptEntries,
  readJsonFile
} from "../../currentAppInspection.js";
import {
  createAiStudioTargetScriptTerminalSpec,
  targetScriptError
} from "../../targetScriptTerminal.js";
import {
  dependencyNames as packageDependencyNames,
  detectPackageManager,
  packageBinCommand,
  packageScript,
  readPackageJson,
  runScriptCommand
} from "../../nodePackage.js";
import {
  nextjsRuntimeDockerArgs
} from "./databaseRuntime.js";

const DEFAULT_TARGET_SCRIPT_NAMES = Object.freeze([
  "dev",
  "build",
  "start",
  "next:build",
  "next:dev",
  "next:start"
]);

const NEXTJS_CURRENT_APP_MARKERS = Object.freeze([
  { id: "packageJson", label: "package.json", relativePath: "package.json", kind: "file" },
  { id: "appRouter", label: "app/", relativePath: "app", kind: "directory" },
  { id: "srcAppRouter", label: "src/app/", relativePath: "src/app", kind: "directory" },
  { id: "pagesRouter", label: "pages/", relativePath: "pages", kind: "directory" },
  { id: "srcPagesRouter", label: "src/pages/", relativePath: "src/pages", kind: "directory" },
  { id: "nextConfigJs", label: "next.config.js", relativePath: "next.config.js", kind: "file" },
  { id: "nextConfigMjs", label: "next.config.mjs", relativePath: "next.config.mjs", kind: "file" },
  { id: "nextConfigTs", label: "next.config.ts", relativePath: "next.config.ts", kind: "file" }
]);

const NEXTJS_PROJECT_DIRECTORIES = Object.freeze([
  { id: "app", label: "app", relativePath: "app" },
  { id: "src", label: "src", relativePath: "src" },
  { id: "pages", label: "pages", relativePath: "pages" },
  { id: "public", label: "public", relativePath: "public" }
]);

const NEXTJS_ROUTER_MARKER_IDS = new Set([
  "appRouter",
  "srcAppRouter",
  "pagesRouter",
  "srcPagesRouter"
]);

function targetScriptCommandPreview(command = "") {
  return String(command || "").trim();
}

function nextjsMarkersReady(markers = []) {
  return markers.some((marker) => NEXTJS_ROUTER_MARKER_IDS.has(marker.id) && marker.exists);
}

function syntheticNextjsScripts(packageJson, packageManager) {
  const existing = new Set(Object.keys(packageJson?.scripts || {}));
  const definitions = [
    ["next:dev", packageBinCommand(packageManager.name, "next", ["dev", "-H", "0.0.0.0"])],
    ["next:build", packageBinCommand(packageManager.name, "next", ["build"])],
    ["next:start", packageBinCommand(packageManager.name, "next", ["start", "-H", "0.0.0.0"])],
    ["next:info", packageBinCommand(packageManager.name, "next", ["info"])]
  ];
  return definitions
    .filter(([name]) => !existing.has(name))
    .map(([name, command]) => ({
      command,
      id: `adapter:${name}`,
      label: name,
      name,
      source: "adapter",
      starredByDefault: DEFAULT_TARGET_SCRIPT_NAMES.includes(name)
    }));
}

async function readTargetScripts(appRoot) {
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageJson = await readJsonFile(packageJsonPath);
  if (!packageJson) {
    return targetScriptError("package_json_missing", `Cannot find ${packageJsonPath}.`, {
      scripts: []
    });
  }
  const packageManager = await detectPackageManager(appRoot, packageJson);
  const scripts = [
    ...packageScriptEntries(packageJson, {
      defaultScriptNames: DEFAULT_TARGET_SCRIPT_NAMES
    }),
    ...syntheticNextjsScripts(packageJson, packageManager)
  ].sort((left, right) => left.name.localeCompare(right.name));
  return {
    ok: true,
    packageJson,
    packageJsonPath,
    packageManager,
    scripts
  };
}

function routerModeFromMarkers(markers = []) {
  const ids = new Set(markers.filter((marker) => marker.exists).map((marker) => marker.id));
  const hasApp = ids.has("appRouter") || ids.has("srcAppRouter");
  const hasPages = ids.has("pagesRouter") || ids.has("srcPagesRouter");
  if (hasApp && hasPages) {
    return "app+pages";
  }
  if (hasApp) {
    return "app";
  }
  if (hasPages) {
    return "pages";
  }
  return "unknown";
}

async function inspectConfig(appRoot, markers) {
  const packageJson = await readPackageJson(appRoot) || {};
  const packageManager = await detectPackageManager(appRoot, packageJson);
  return {
    buildScript: packageScript(packageJson, "build"),
    dependencies: packageDependencyNames(packageJson),
    devScript: packageScript(packageJson, "dev"),
    nextConfig: markers.some((marker) => marker.id.startsWith("nextConfig") && marker.exists),
    packageManager,
    routerMode: routerModeFromMarkers(markers),
    startScript: packageScript(packageJson, "start")
  };
}

async function inspectNextjsCurrentApp(targetRoot, {
  includeGit = true
} = {}) {
  return inspectDescribedCurrentApp(targetRoot, {
    adapter: "nextjs",
    appPath: "/",
    config: (appRoot, { markers = [] } = {}) => inspectConfig(appRoot, markers),
    directories: NEXTJS_PROJECT_DIRECTORIES,
    includeGit,
    localPackages: async (appRoot) => {
      const packageJson = await readPackageJson(appRoot) || {};
      return {
        appPackageName: String(packageJson.name || ""),
        packages: []
      };
    },
    markers: NEXTJS_CURRENT_APP_MARKERS,
    ready: nextjsMarkersReady
  });
}

async function inspectNextjsTargetScripts(appRoot) {
  const result = await readTargetScripts(path.resolve(appRoot || process.cwd()));
  if (result.ok === false) {
    return result;
  }
  return {
    ok: true,
    packageJsonPath: result.packageJsonPath,
    scriptCount: result.scripts.length,
    scripts: result.scripts
  };
}

async function createNextjsTargetScriptTerminalSpec(targetRoot, input = {}, {
  config = {}
} = {}) {
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
  const scriptsResult = await readTargetScripts(normalizedTargetRoot);
  if (scriptsResult.ok === false) {
    return scriptsResult;
  }
  const packageScripts = new Set(Object.keys(scriptsResult.packageJson?.scripts || {}));
  return createAiStudioTargetScriptTerminalSpec({
    adapterId: "nextjs",
    extraDockerArgs: nextjsRuntimeDockerArgs({
      config,
      targetRoot: normalizedTargetRoot
    }),
    input,
    packageManager: scriptsResult.packageManager.name,
    scripts: scriptsResult.scripts.map((script) => {
      if (!packageScripts.has(script.name)) {
        return {
          ...script,
          commandPreview: targetScriptCommandPreview(script.command)
        };
      }
      const command = runScriptCommand(scriptsResult.packageManager.name, script.name);
      return {
        ...script,
        command,
        commandPreview: command
      };
    }),
    targetRoot: normalizedTargetRoot
  });
}

export {
  DEFAULT_TARGET_SCRIPT_NAMES,
  createNextjsTargetScriptTerminalSpec,
  inspectNextjsCurrentApp,
  inspectNextjsTargetScripts,
  targetScriptCommandPreview
};
