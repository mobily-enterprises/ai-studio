import { ref } from "vue";
import { describe, expect, it } from "vitest";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

import { agentMessageInputValidator } from "../../packages/vibe64-sessions/src/server/inputSchemas.js";
import {
  agentMessageAcceptanceSignal,
  agentTurnControlPayloadFromContext,
  proxySessionDialogs,
  runtimeHostAgentWorking,
  runtimeHostToolbarSessions
} from "../../src/composables/useVibe64SessionRuntimeHost.js";

describe("Vibe64 direct session runtime host", () => {
  it("lets an early chat request wait for declared workspace preparation", () => {
    const controller = new AbortController();
    const signal = agentMessageAcceptanceSignal(controller, {
      waitingForWorkspaceSetup: true
    });

    expect(signal).toBe(controller.signal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });

  it("projects only the supplied direct-session dialogs", () => {
    const diffOpen = ref(false);
    const dialogs = proxySessionDialogs({
      abandon: { open: ref(true) },
      diff: { open: diffOpen }
    });

    expect(Object.keys(dialogs)).toEqual(["abandon", "diff"]);
    expect(dialogs.diff.open).toBe(false);
    diffOpen.value = true;
    expect(dialogs.diff.open).toBe(true);
  });

  it("uses the provider turn projection as visible assistant activity", () => {
    expect(runtimeHostAgentWorking({
      selectedSession: {
        agentSession: { turn: { active: true } },
        sessionId: "session-a"
      }
    })).toBe(true);
    expect(runtimeHostAgentWorking({
      selectedSession: {
        agentSession: { turn: { active: false } },
        sessionId: "session-a"
      }
    })).toBe(false);
  });

  it("marks the selected toolbar session as thinking from live direct-session state", () => {
    expect(runtimeHostToolbarSessions({
      activeAgentThinking: true,
      selectedSession: { sessionId: "session-a" },
      selectedSessionId: "session-a",
      sessions: [
        { sessionId: "session-a", sessionName: "Alpha" },
        { agentThinking: true, sessionId: "session-b", sessionName: "Beta" }
      ]
    })).toEqual([
      { agentThinking: true, sessionId: "session-a", sessionName: "Alpha" },
      { agentThinking: false, sessionId: "session-b", sessionName: "Beta" }
    ]);
  });

  it("builds schema-valid assistant message and interrupt payloads", () => {
    const message = agentTurnControlPayloadFromContext({
      displayMessage: "Especially the drying part",
      message: "Especially the drying part",
      messageId: "message:test",
      sessionId: "session-a"
    });
    expect(message).toMatchObject({
      displayMessage: "Especially the drying part",
      message: "Especially the drying part",
      messageId: "message:test"
    });
    expect(message.originId).toMatch(/^tab:/u);
    expect(() => validateSchemaPayload(agentMessageInputValidator, message, {
      context: "agent message request contract"
    })).not.toThrow();

    expect(agentTurnControlPayloadFromContext({
      reason: "user_interrupt",
      sessionId: "session-a"
    })).toMatchObject({
      reason: "user_interrupt"
    });
  });
});
