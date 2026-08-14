function normalizeHostCommandOptions(options = {}) {
  return Array.isArray(options) ? { extraArgs: options } : options;
}

function buildHostCommandArgs(commandArgs) {
  return Array.isArray(commandArgs) ? commandArgs.map((arg) => String(arg)) : [];
}

function buildTerminalArgs(commandArgs, options = {}) {
  void normalizeHostCommandOptions(options);
  return buildHostCommandArgs(commandArgs);
}

export {
  buildHostCommandArgs,
  buildTerminalArgs,
  normalizeHostCommandOptions
};
