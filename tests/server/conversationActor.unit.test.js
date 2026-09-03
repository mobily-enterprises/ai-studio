import assert from "node:assert/strict";
import test from "node:test";

import {
  conversationActorMetadata
} from "../../packages/vibe64-terminals/src/server/conversationActor.js";

test("conversation actor metadata uses the standalone profile without prompt context", async () => {
  const metadata = await conversationActorMetadata({
    actorUser: () => ({ displayName: "Ada OS", username: "ada" }),
    personalProfileStore: {
      async read() {
        return { preferredName: "Ada" };
      }
    }
  });

  assert.deepEqual(metadata, {
    actorDisplayName: "Ada",
    actorId: "ada"
  });
});

test("authenticated actor preference wins without reading the standalone profile", async () => {
  let localReads = 0;
  const metadata = await conversationActorMetadata({
    personalProfileStore: {
      async read() {
        localReads += 1;
        return { preferredName: "Wrong person" };
      }
    },
    vibe64User: {
      displayName: "Ada Account",
      preferredName: "Countess Ada",
      username: "ada"
    }
  });

  assert.equal(localReads, 0);
  assert.deepEqual(metadata, {
    actorDisplayName: "Countess Ada",
    actorId: "ada"
  });
});
