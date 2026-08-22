import assert from "node:assert/strict";
import test from "node:test";

import {
  vibe64SessionBriefing
} from "@local/vibe64-runtime/server";

test("Vibe64 briefing keeps browser versions and browser installation under platform control", () => {
  const briefing = vibe64SessionBriefing({
    session: {
      sessionId: "genesis-neutral-session",
      targetRoot: "/srv/projects/demo"
    }
  });

  assert.match(briefing, /Use `vibe64-playwright` only when running an existing, already-configured project Playwright suite/u);
  assert.match(briefing, /These commands do not depend on the project's Playwright configuration/u);
  assert.match(briefing, /do not install or change JSKIT, Playwright, Chrome, Chromium/u);
  assert.match(briefing, /exact version from `VIBE64_PLAYWRIGHT_VERSION`/u);
  assert.match(briefing, /never choose or download another browser version/u);
  assert.match(briefing, /Do not start a duplicate server/u);
});

test("Vibe64 briefing directs agents to manage scoped Env and report successful mutations", () => {
  const briefing = vibe64SessionBriefing({
    session: {
      sessionId: "env-session",
      targetRoot: "/srv/projects/demo"
    }
  });

  assert.match(briefing, /`vibe64-env status \[development\|production\|all\]`/u);
  assert.match(briefing, /Pass values only on stdin, never as positional arguments/u);
  assert.match(briefing, /Zero-length stdin stores an empty value/u);
  assert.match(briefing, /Never substitute whitespace or a dummy value/u);
  assert.match(briefing, /Development and production Env are separate/u);
  assert.match(briefing, /Do not tell the user to create an Env entry manually/u);
  assert.match(briefing, /stores user values outside Git/u);
  assert.match(briefing, /tell the user exactly which scope and key names were created, updated, or removed, including which ones were stored empty/u);
  assert.match(briefing, /never claim a mutation succeeded unless the command did/u);
});
