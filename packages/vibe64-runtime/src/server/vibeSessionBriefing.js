import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";

function text(value = "") {
  return String(value || "").trim();
}

function vibeManagedPreviewPolicyInstruction() {
  return [
    "- The Vibe64-managed preview is the canonical server for the primary application. Do not start a duplicate server on another port.",
    "- Use `vibe64-preview status`, `vibe64-preview screenshot`, `vibe64-preview logs`, and `vibe64-preview browser eval` for preview inspection and interaction.",
    "- Use `vibe64-playwright` for project Playwright tests. Do not install another browser or browser payload.",
    "- When a project generator accepts a Playwright version, pass the exact version from `VIBE64_PLAYWRIGHT_VERSION`. If it is unavailable, report the platform blocker; never choose or download another browser version.",
    "- Describe only rendered browser evidence. If the managed preview is unavailable, report that blocker instead of starting a replacement server."
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
    "Fixed session paths:",
    `- session id: ${text(session.sessionId || session.id)}`,
    `- target root: ${text(session.targetRoot)}`,
    `- session source path: ${text(sessionSourcePath(session))}`,
    "",
    "Managed preview:",
    vibeManagedPreviewPolicyInstruction(),
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
