import { readFile } from "node:fs/promises";
import path from "node:path";

function text(value = "") {
  return String(value ?? "").trim();
}

function pathContains(root = "", candidate = "") {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function sessionEnvironments() {
  const registryPath = text(process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY);
  if (!registryPath) {
    return [];
  }
  const source = JSON.parse(await readFile(registryPath, "utf8"));
  return Array.isArray(source?.sessions) ? source.sessions : [];
}

async function sessionEnvironment(cwd = "") {
  const normalizedCwd = path.resolve(text(cwd) || process.cwd());
  return (await sessionEnvironments())
    .filter((entry) => text(entry?.workdir) && pathContains(path.resolve(entry.workdir), normalizedCwd))
    .sort((left, right) => path.resolve(right.workdir).length - path.resolve(left.workdir).length)[0] || null;
}

async function sessionEnvironmentForUpstreamSession(sessionId = "") {
  const normalizedSessionId = text(sessionId);
  if (!normalizedSessionId) {
    return null;
  }
  return (await sessionEnvironments()).find((entry) => (
    text(entry?.upstreamSessionId) === normalizedSessionId
  )) || null;
}

function shellQuote(value = "") {
  return `'${String(value ?? "").replaceAll("'", `'"'"'`)}'`;
}

function unavailableCommand() {
  return "printf '%s\\n' 'vibe64_agent_control_unavailable: Session command control is unavailable. Reconnect the assistant.' >&2; exit 126";
}

function sessionCommand(command = "", selected = null) {
  const wrapperPath = text(selected?.env?.VIBE64_AGENT_SESSION_COMMAND_WRAPPER);
  if (!wrapperPath) {
    return unavailableCommand();
  }
  return [
    shellQuote(wrapperPath),
    shellQuote(Buffer.from(String(command), "utf8").toString("base64url"))
  ].join(" ");
}

export const Vibe64SessionEnvironment = async () => ({
  "shell.env": async (input = {}, output = {}) => {
    const selected = await sessionEnvironment(input.cwd);
    if (!selected) {
      return;
    }
    const env = selected.env && typeof selected.env === "object" && !Array.isArray(selected.env)
      ? selected.env
      : {};
    const outputEnv = output.env && typeof output.env === "object" && !Array.isArray(output.env)
      ? output.env
      : {};
    output.env = outputEnv;
    Object.assign(outputEnv, env);
    const pathEntries = Array.isArray(selected.pathEntries)
      ? selected.pathEntries.map(text).filter(Boolean)
      : [];
    outputEnv.PATH = [
      ...pathEntries,
      text(env.PATH),
      text(process.env.PATH)
    ].filter(Boolean).join(path.delimiter);
  },
  "tool.execute.before": async (input = {}, output = {}) => {
    if (!["bash", "shell"].includes(text(input.tool).toLowerCase())) {
      return;
    }
    const args = output.args && typeof output.args === "object" && !Array.isArray(output.args)
      ? output.args
      : null;
    if (!args || typeof args.command !== "string") {
      return;
    }
    const selected = await sessionEnvironmentForUpstreamSession(
      input.sessionID || input.sessionId
    );
    args.command = selected
      ? sessionCommand(args.command, selected)
      : unavailableCommand();
  }
});
