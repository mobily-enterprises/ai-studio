import {
  STUDIO_HOST_GID_ENV,
  STUDIO_HOST_UID_ENV,
  STUDIO_TOOL_HOME_BIN_PATH,
  STUDIO_TOOL_HOME_NPM_PREFIX,
  STUDIO_TOOL_HOME_PATH,
  STUDIO_TOOL_HOME_VOLUME
} from "./studioRuntimeIdentity.js";
import {
  shellQuote
} from "./shellCommands.js";

function studioToolHomeDockerArgs() {
  return [
    "-v",
    `${STUDIO_TOOL_HOME_VOLUME}:${STUDIO_TOOL_HOME_PATH}`,
    "-e",
    `HOME=${STUDIO_TOOL_HOME_PATH}`,
    "-e",
    `NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`
  ];
}

function studioToolHomeSetupLines() {
  return [
    `export HOME=${STUDIO_TOOL_HOME_PATH}`,
    `export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`,
    `export PATH=${STUDIO_TOOL_HOME_BIN_PATH}:$PATH`,
    "mkdir -p \"$HOME\" \"$NPM_CONFIG_PREFIX\""
  ];
}

function studioUserCommand(commandArgs = []) {
  const args = Array.isArray(commandArgs) ? commandArgs : [commandArgs];
  const normalizedArgs = args
    .map((arg) => String(arg ?? ""))
    .filter((arg, index) => index > 0 || arg.trim());
  return (normalizedArgs.length ? normalizedArgs : ["bash"]).map(shellQuote).join(" ");
}

function studioUserStartupScript(commandArgs = ["bash"], {
  setupLines = []
} = {}) {
  const startupCommand = studioUserCommand(commandArgs);
  return [
    "set -e",
    ...studioToolHomeSetupLines(),
    ...setupLines,
    `if [ "$(id -u)" = "0" ] && [ -n "\${${STUDIO_HOST_UID_ENV}:-}" ] && [ -n "\${${STUDIO_HOST_GID_ENV}:-}" ] && command -v setpriv >/dev/null 2>&1; then`,
    `  chown -R "$${STUDIO_HOST_UID_ENV}:$${STUDIO_HOST_GID_ENV}" "$HOME"`,
    `  exec setpriv --reuid "$${STUDIO_HOST_UID_ENV}" --regid "$${STUDIO_HOST_GID_ENV}" --clear-groups ${startupCommand}`,
    "fi",
    `exec ${startupCommand}`
  ].join("\n");
}

export {
  studioUserCommand,
  studioToolHomeDockerArgs,
  studioToolHomeSetupLines,
  studioUserStartupScript
};
