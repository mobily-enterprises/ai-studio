import assert from "node:assert/strict";
import test from "node:test";

import {
  codexSessionBriefingFingerprint,
  codexSessionBriefingNeedsRefresh
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";

test("existing Codex sessions receive changed Vibe64 briefing instructions on their next turn", () => {
  const briefing = "Current Vibe64 briefing";
  const fingerprint = codexSessionBriefingFingerprint(briefing);

  assert.equal(codexSessionBriefingNeedsRefresh({
    metadata: {}
  }, briefing), false);
  assert.equal(codexSessionBriefingNeedsRefresh({
    metadata: {
      agent_briefing_delivered: "yes"
    }
  }, briefing), true);
  assert.equal(codexSessionBriefingNeedsRefresh({
    metadata: {
      agent_briefing_delivered: "yes",
      agent_briefing_fingerprint: fingerprint
    }
  }, briefing), false);
  assert.equal(codexSessionBriefingNeedsRefresh({
    metadata: {
      agent_briefing_delivered: "yes",
      agent_briefing_fingerprint: fingerprint
    }
  }, `${briefing}\nUpdated policy`), true);
});
