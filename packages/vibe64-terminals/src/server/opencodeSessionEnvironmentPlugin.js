import { readFile } from "node:fs/promises";
import path from "node:path";

function text(value = "") {
  return String(value ?? "").trim();
}

function pathContains(root = "", candidate = "") {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function sessionEnvironment(cwd = "") {
  const registryPath = text(process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY);
  if (!registryPath) {
    return null;
  }
  const source = JSON.parse(await readFile(registryPath, "utf8"));
  const normalizedCwd = path.resolve(text(cwd) || process.cwd());
  return (Array.isArray(source?.sessions) ? source.sessions : [])
    .filter((entry) => text(entry?.workdir) && pathContains(path.resolve(entry.workdir), normalizedCwd))
    .sort((left, right) => path.resolve(right.workdir).length - path.resolve(left.workdir).length)[0] || null;
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
  }
});
