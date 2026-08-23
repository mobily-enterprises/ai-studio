import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

function text(value = "") {
  return String(value || "").trim();
}

function vibeManagedPreviewPolicyInstruction() {
  return [
    "- The Vibe64-managed preview is the canonical server for the primary application. Do not start a duplicate server on another port.",
    "- Use `vibe64-preview status`, `vibe64-preview screenshot`, `vibe64-preview logs`, and `vibe64-preview browser eval` for browser inspection, interaction, responsive checks, and rendered proof. These commands do not depend on the project's Playwright configuration.",
    "- Use `vibe64-playwright` only when running an existing, already-configured project Playwright suite. If that suite has a missing or stale JavaScript dependency or config, report the project-test blocker once; do not install or change JSKIT, Playwright, Chrome, Chromium, browser payloads, or alternate test configurations merely to obtain browser evidence.",
    "- When a project generator accepts a Playwright version, pass the exact version from `VIBE64_PLAYWRIGHT_VERSION`. If it is unavailable, report the platform blocker; never choose or download another browser version.",
    "- Describe only rendered browser evidence. If the managed preview is unavailable, report that blocker instead of starting a replacement server."
  ].join("\n");
}

function vibeManagedEnvPolicyInstruction() {
  return [
    "- Use `vibe64-env status [development|production|all]` to inspect which project Env keys are configured or missing. The command reports metadata only and never reveals values.",
    "- When the user supplies an Env value, or an app-local value is legitimately generated as part of the task, pipe the exact value into `vibe64-env set <development|production> <KEY> [--secret]`. Pass values only on stdin, never as positional arguments.",
    "- When the user asks to create an Env key without a value, run `vibe64-env set <development|production> <KEY> [--secret] </dev/null`. Zero-length stdin stores an empty value. Never substitute whitespace or a dummy value.",
    "- Development and production Env are separate. Use the scope the task actually requires and never copy a value between scopes without explicit user direction.",
    "- Do not tell the user to create an Env entry manually when the value is available to you and `vibe64-env` can save it. Never invent missing third-party credentials; ask the user for a value when one is genuinely required and unavailable.",
    "- Do not put user Env values or secrets in repository files or edit Vibe64 runtime/session storage. Vibe64 stores user values outside Git and materializes any Genesis-declared environment files.",
    "- After every successful Env mutation, tell the user exactly which scope and key names were created, updated, or removed, including which ones were stored empty. Never repeat values, and never claim a mutation succeeded unless the command did."
  ].join("\n");
}

function vibe64SessionBriefing({
  session = {}
} = {}) {
  const lines = [
    "Vibe64 session briefing",
    "",
    "Genesis owns project intent, Stack guidance, Program context, verification guidance, and cleanup prompts. Follow the project skills and Genesis context supplied to each task.",
    "",
    "Fixed session source:",
    `- session id: ${text(session.sessionId || session.id)}`,
    `- session source path: ${text(sessionSourcePath(session))}`,
    "",
    "Managed preview:",
    vibeManagedPreviewPolicyInstruction(),
    "",
    "Project Env:",
    vibeManagedEnvPolicyInstruction(),
    "",
    "Git and GitHub:",
    "- Use the managed `git` and `gh` commands on PATH. Do not bypass them with absolute host binaries, a stripped PATH, or alternate credentials.",
    "- Report an authentication or transport failure directly; do not inspect credentials or invent another login path.",
    "",
    "Vibe64 response routing:",
    "- Vibe64 owns session state. Do not edit Vibe64 runtime/session storage.",
    "- Answer conversation turns normally in ordinary Markdown.",
    "- If the source changes while you work, inspect the current source again instead of guessing."
  ];
  return lines.join("\n").trim();
}

export {
  vibe64SessionBriefing
};
