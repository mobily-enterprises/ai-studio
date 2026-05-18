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
  normalizePlainObject
} from "../../serverResponses.js";
import {
  detectPackageManager,
  packageBinCommand,
  packageScript,
  readPackageJson,
  runScriptCommand,
  scriptUsesVinext
} from "./packageManager.js";

const DEFAULT_TARGET_SCRIPT_NAMES = Object.freeze([
  "dev:vinext",
  "build:vinext",
  "start:vinext",
  "vinext:check",
  "vinext:build",
  "vinext:dev"
]);

const VINEXT_CURRENT_APP_MARKERS = Object.freeze([
  { id: "packageJson", label: "package.json", relativePath: "package.json", kind: "file" },
  { id: "appRouter", label: "app/", relativePath: "app", kind: "directory" },
  { id: "srcAppRouter", label: "src/app/", relativePath: "src/app", kind: "directory" },
  { id: "pagesRouter", label: "pages/", relativePath: "pages", kind: "directory" },
  { id: "srcPagesRouter", label: "src/pages/", relativePath: "src/pages", kind: "directory" },
  { id: "viteConfig", label: "vite.config.ts", relativePath: "vite.config.ts", kind: "file" },
  { id: "nextConfig", label: "next.config.ts", relativePath: "next.config.ts", kind: "file" },
  { id: "wranglerConfig", label: "wrangler.jsonc", relativePath: "wrangler.jsonc", kind: "file" }
]);

const VINEXT_PROJECT_DIRECTORIES = Object.freeze([
  { id: "app", label: "app", relativePath: "app" },
  { id: "src", label: "src", relativePath: "src" },
  { id: "pages", label: "pages", relativePath: "pages" },
  { id: "public", label: "public", relativePath: "public" }
]);

const VINEXT_ROUTER_MARKER_IDS = new Set([
  "appRouter",
  "srcAppRouter",
  "pagesRouter",
  "srcPagesRouter"
]);

function targetScriptCommandPreview(command = "") {
  return String(command || "").trim();
}

function vinextMarkersReady(markers = []) {
  return markers.some((marker) => VINEXT_ROUTER_MARKER_IDS.has(marker.id) && marker.exists);
}

function syntheticVinextScripts(packageJson, packageManager) {
  const existing = new Set(Object.keys(packageJson?.scripts || {}));
  const definitions = [
    ["vinext:check", packageBinCommand(packageManager.name, "vinext", ["check"])],
    ["vinext:build", packageBinCommand(packageManager.name, "vinext", ["build"])],
    ["vinext:dev", packageBinCommand(packageManager.name, "vinext", ["dev", "--hostname", "0.0.0.0"])],
    ["vinext:start", packageBinCommand(packageManager.name, "vinext", ["start", "--hostname", "0.0.0.0"])],
    ["vinext:deploy:dry-run", packageBinCommand(packageManager.name, "vinext", ["deploy", "--dry-run"])]
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
    ...syntheticVinextScripts(packageJson, packageManager)
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

function dependencyNames(packageJson) {
  return Object.keys({
    ...normalizePlainObject(packageJson?.dependencies),
    ...normalizePlainObject(packageJson?.devDependencies)
  }).sort((left, right) => left.localeCompare(right));
}

async function inspectConfig(appRoot, markers) {
  const packageJson = await readPackageJson(appRoot) || {};
  const packageManager = await detectPackageManager(appRoot, packageJson);
  return {
    buildScript: packageScript(packageJson, "build:vinext") || packageScript(packageJson, "build"),
    cloudflare: markers.some((marker) => ["wranglerConfig"].includes(marker.id) && marker.exists),
    dependencies: dependencyNames(packageJson),
    devScript: packageScript(packageJson, "dev:vinext") || packageScript(packageJson, "dev"),
    packageManager,
    routerMode: routerModeFromMarkers(markers),
    startScript: packageScript(packageJson, "start:vinext") || packageScript(packageJson, "start"),
    vinextScript: Object.values(packageJson.scripts || {}).some(scriptUsesVinext)
  };
}

async function inspectVinextCurrentApp(targetRoot, {
  includeGit = true
} = {}) {
  return inspectDescribedCurrentApp(targetRoot, {
    adapter: "vinext",
    appPath: "/",
    config: (appRoot, { markers = [] } = {}) => inspectConfig(appRoot, markers),
    directories: VINEXT_PROJECT_DIRECTORIES,
    includeGit,
    localPackages: async (appRoot) => {
      const packageJson = await readPackageJson(appRoot) || {};
      return {
        appPackageName: String(packageJson.name || ""),
        packages: []
      };
    },
    markers: VINEXT_CURRENT_APP_MARKERS,
    ready: vinextMarkersReady
  });
}

async function inspectVinextTargetScripts(appRoot) {
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

async function createVinextTargetScriptTerminalSpec(targetRoot, input = {}) {
  const normalizedTargetRoot = path.resolve(targetRoot || process.cwd());
  const scriptsResult = await readTargetScripts(normalizedTargetRoot);
  if (scriptsResult.ok === false) {
    return scriptsResult;
  }
  const packageScripts = new Set(Object.keys(scriptsResult.packageJson?.scripts || {}));
  return createAiStudioTargetScriptTerminalSpec({
    adapterId: "vinext",
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
  createVinextTargetScriptTerminalSpec,
  inspectVinextCurrentApp,
  inspectVinextTargetScripts,
  targetScriptCommandPreview
};
