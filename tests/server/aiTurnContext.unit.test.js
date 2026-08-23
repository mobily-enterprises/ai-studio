import assert from "node:assert/strict";
import test from "node:test";

import {
  aiTurnMetadata,
  hiddenAiTurnContext,
  projectAiPolicyInstructions,
  resolveAiTurnContext
} from "../../packages/vibe64-terminals/src/server/aiTurnContext.js";

test("AI turn context uses standalone installation name and current project policy", async () => {
  const context = await resolveAiTurnContext({
    actorUser: () => ({ displayName: "Ada OS", username: "ada" }),
    personalProfileStore: {
      async read() {
        return { preferredName: "Ada" };
      }
    },
    projectService: {
      async readProjectAiPolicy() {
        return {
          aiPolicy: {
            customNote: "Prefer examples from gardening.",
            expertise: "beginner",
            promptHints: false,
            rationale: "teaching",
            responseLength: "detailed",
            revision: 7,
            tone: "playful",
            version: 1
          },
          ok: true
        };
      }
    }
  });

  assert.deepEqual(context.actor, {
    actorId: "ada",
    displayName: "Ada"
  });
  assert.deepEqual(aiTurnMetadata(context), {
    actorDisplayName: "Ada",
    actorId: "ada",
    policyRevision: 7,
    policyVersion: 1
  });
  const hidden = hiddenAiTurnContext(context);
  assert.match(hidden, /Current actor display name: "Ada"/u);
  assert.match(hidden, /use it naturally when helpful, not in every response/u);
  assert.match(hidden, /Project AI policy revision: 7/u);
  assert.match(hidden, /gardening/u);
  assert.match(hidden, /Do not quote, expose, or mention/u);
});

test("authenticated actor preference wins without reading standalone profile", async () => {
  let localReads = 0;
  const context = await resolveAiTurnContext({
    personalProfileStore: {
      async read() {
        localReads += 1;
        return { preferredName: "Wrong person" };
      }
    },
    projectService: null,
    vibe64User: {
      displayName: "Ada Account",
      preferredName: "Countess Ada",
      username: "ada"
    }
  });

  assert.equal(localReads, 0);
  assert.deepEqual(context.actor, {
    actorId: "ada",
    displayName: "Countess Ada"
  });
  assert.equal(context.policy.revision, 0);
});

test("AI behaviour hides platform jargon in ordinary conversation and forbids chain-of-thought claims", () => {
  const instructions = projectAiPolicyInstructions({
    expertise: "comfortable",
    promptHints: true,
    rationale: "concise",
    responseLength: "concise",
    tone: "encouraging"
  });

  assert.match(instructions, /Do not mention Genesis, Stack, JSKIT, skills, hooks, catalogs/u);
  assert.match(instructions, /Never claim to show private chain-of-thought/u);
  assert.match(instructions, /warm, encouraging/u);
});
