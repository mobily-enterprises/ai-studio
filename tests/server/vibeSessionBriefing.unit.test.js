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

  assert.match(briefing, /Use `vibe64-playwright` for project Playwright tests/u);
  assert.match(briefing, /exact version from `VIBE64_PLAYWRIGHT_VERSION`/u);
  assert.match(briefing, /never choose or download another browser version/u);
  assert.match(briefing, /Do not start a duplicate server/u);
});
