import {
  readFileSync
} from "node:fs";
import {
  shellQuote
} from "../shellCommands.js";
import {
  normalizeText
} from "./core.js";
import {
  packageScript,
  runScriptCommand
} from "./nodePackage.js";

const AI_STUDIO_CODE_INDEX_SCRIPT_NAME = "ai-studio:index";
const AI_STUDIO_VERIFY_SCRIPT_NAME = "ai-studio:verify";
const DEFAULT_CODE_INDEX_RELATIVE_PATH = ".ai-studio/code-index.md";
const CODE_INDEX_SCRIPTS_ROOT = new URL("./codeIndexScripts/", import.meta.url);

function readCodeIndexScript(fileName) {
  return readFileSync(new URL(fileName, CODE_INDEX_SCRIPTS_ROOT), "utf8");
}

const JAVASCRIPT_CODE_INDEX_SOURCE = readCodeIndexScript("javascript.mjs");
const PHP_CODE_INDEX_SOURCE = readCodeIndexScript("php.php");

function packageManagerScriptCommand({
  packageJson = {},
  packageManager = {},
  scriptName = ""
} = {}) {
  const normalizedScriptName = normalizeText(scriptName);
  if (!normalizedScriptName || !packageScript(packageJson || {}, normalizedScriptName)) {
    return "";
  }
  return runScriptCommand(normalizeText(packageManager?.name || packageManager) || "npm", normalizedScriptName);
}

function heredocCommand({
  environment = {},
  marker = "AI_STUDIO_SCRIPT",
  runtime = "",
  source = ""
} = {}) {
  const envPrefix = Object.entries(environment)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  return [
    `${envPrefix ? `${envPrefix} ` : ""}${runtime} <<'${marker}'`,
    source.trim(),
    marker
  ].filter(Boolean).join("\n");
}

function javascriptCodeIndexCommand({
  outputPath = DEFAULT_CODE_INDEX_RELATIVE_PATH
} = {}) {
  return heredocCommand({
    environment: {
      AI_STUDIO_CODE_INDEX_PATH: outputPath
    },
    marker: "AI_STUDIO_JS_CODE_INDEX",
    runtime: "node --input-type=module",
    source: JAVASCRIPT_CODE_INDEX_SOURCE
  });
}

function phpCodeIndexCommand({
  outputPath = DEFAULT_CODE_INDEX_RELATIVE_PATH
} = {}) {
  return heredocCommand({
    environment: {
      AI_STUDIO_CODE_INDEX_PATH: outputPath
    },
    marker: "AI_STUDIO_PHP_CODE_INDEX",
    runtime: "php",
    source: PHP_CODE_INDEX_SOURCE
  });
}

export {
  AI_STUDIO_CODE_INDEX_SCRIPT_NAME,
  AI_STUDIO_VERIFY_SCRIPT_NAME,
  DEFAULT_CODE_INDEX_RELATIVE_PATH,
  javascriptCodeIndexCommand,
  packageManagerScriptCommand,
  phpCodeIndexCommand
};
