import { describe, expect, it, vi } from "vitest";
import {
  resolveRealtimeClientListeners
} from "@jskit-ai/realtime/client/listeners";
import {
  VIBE64_LIVE_QUERY_RECOVERY_LISTENER,
  invalidateVibe64LiveQueries,
  registerVibe64RealtimeListeners
} from "../../packages/main/src/client/vibe64RealtimeQueries.js";
import {
  isVibe64LiveQuery
} from "../../src/lib/vibe64LiveQueryRecovery.js";

function createClientAppDouble() {
  const instances = new Map();
  const singletons = new Map();
  const tags = new Map();

  return {
    has(token) {
      return instances.has(token) || singletons.has(token);
    },
    instance(token, value) {
      instances.set(token, value);
    },
    make(token) {
      if (instances.has(token)) {
        return instances.get(token);
      }
      if (!singletons.has(token)) {
        throw new Error(`Missing token: ${String(token)}`);
      }
      const resolved = singletons.get(token)(this);
      instances.set(token, resolved);
      return resolved;
    },
    resolveTag(tagName) {
      const tagged = tags.get(String(tagName || "").trim());
      return tagged ? [...tagged].map((token) => this.make(token)) : [];
    },
    singleton(token, factory) {
      singletons.set(token, factory);
    },
    tag(token, tagName) {
      const normalizedTagName = String(tagName || "").trim();
      if (!tags.has(normalizedTagName)) {
        tags.set(normalizedTagName, new Set());
      }
      tags.get(normalizedTagName).add(token);
    }
  };
}

describe("MainClientProvider realtime integration", () => {
  it("recovers active Vibe64 queries after a realtime reconnect", async () => {
    const app = createClientAppDouble();
    const invalidateQueries = vi.fn(async () => null);
    app.instance("jskit.client.query-client", { invalidateQueries });

    registerVibe64RealtimeListeners(app);
    const listener = resolveRealtimeClientListeners(app)
      .find((entry) => entry.listenerId === VIBE64_LIVE_QUERY_RECOVERY_LISTENER);

    expect(listener?.event).toBe("connect");
    await listener.handle({ app });

    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    const [{ predicate, refetchType }] = invalidateQueries.mock.calls[0];
    expect(refetchType).toBe("active");
    expect(predicate({ queryKey: ["vibe64", "project", "beepollen", "sessions"] })).toBe(true);
    expect(predicate({ queryKey: ["other", "project", "beepollen"] })).toBe(false);
  });

  it("ignores missing query clients", async () => {
    expect(isVibe64LiveQuery({ queryKey: ["vibe64", "sessions"] })).toBe(true);
    expect(isVibe64LiveQuery({ queryKey: ["other", "sessions"] })).toBe(false);
    expect(await Promise.resolve(invalidateVibe64LiveQueries(createClientAppDouble()))).toBeNull();
  });
});
