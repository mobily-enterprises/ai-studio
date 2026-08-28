import fs from "node:fs";
import path from "node:path";
import { effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const endpointMocks = vi.hoisted(() => ({
  options: [],
  resources: [],
  useEndpointResource: vi.fn()
}));
const commandMocks = vi.hoisted(() => ({
  command: null,
  options: null,
  useCommand: vi.fn()
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: commandMocks.useCommand
}));

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug() {
    return ref("project-a");
  }
}));

import {
  useVibe64AssistantAccess
} from "../../src/composables/useVibe64AssistantAccess.js";

function resource(data = null) {
  return {
    data: ref(data),
    isInitialLoading: ref(data === null),
    isLoading: ref(data === null),
    loadError: ref(""),
    reload: vi.fn(async () => null)
  };
}

describe("useVibe64AssistantAccess", () => {
  beforeEach(() => {
    endpointMocks.options.length = 0;
    endpointMocks.resources = [resource(), resource()];
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockImplementation((options) => {
      endpointMocks.options.push(options);
      return endpointMocks.resources[endpointMocks.options.length - 1];
    });
    commandMocks.command = {
      run: vi.fn(async () => ({ ok: true }))
    };
    commandMocks.options = null;
    commandMocks.useCommand.mockReset();
    commandMocks.useCommand.mockImplementation((options) => {
      commandMocks.options = options;
      return commandMocks.command;
    });
  });

  it("hydrates access and queue resources for warm-cache and realtime navigation", async () => {
    endpointMocks.resources = [
      resource({
        accessLabel: "Workspace use",
        available: true,
        canRequestMessage: false,
        canUse: true,
        ok: true
      }),
      resource({ canManage: false, ok: true, suggestions: [] })
    ];
    const scope = effectScope();
    const sessionId = ref("session-a");
    const access = scope.run(() => useVibe64AssistantAccess({
      sessionId,
      sessionsApiPath: ref("/api/vibe64/sessions")
    }));

    expect(endpointMocks.options).toHaveLength(2);
    expect(endpointMocks.options[0].path.value).toBe(
      "/api/vibe64/sessions/session-a/assistant-access"
    );
    expect(endpointMocks.options[1].path.value).toBe(
      "/api/vibe64/sessions/session-a/message-suggestions"
    );
    expect(endpointMocks.options[0].queryOptions.refetchOnMount).toBe("always");
    expect(endpointMocks.options[1].queryOptions.refetchOnMount).toBe("always");
    expect(endpointMocks.options[0].queryOptions.refetchOnWindowFocus).toBe(true);
    expect(access.accessLabel.value).toBe("Workspace use");
    expect(access.canUseAi.value).toBe(true);
    expect(access.canSubmitMainChat.value).toBe(true);
    expect(endpointMocks.options[0].realtime.events).toEqual([
      "vibe64.session.changed",
      "vibe64.connections.changed"
    ]);
    expect(endpointMocks.options[0].realtime.matches({
      event: "vibe64.connections.changed",
      payload: { connectionId: "openai" }
    })).toBe(true);

    sessionId.value = "session-b";
    await nextTick();
    expect(endpointMocks.options[0].path.value).toBe(
      "/api/vibe64/sessions/session-b/assistant-access"
    );
    expect(endpointMocks.options[0].realtime.matches({
      payload: { sessionId: "session-b" }
    })).toBe(true);
    expect(endpointMocks.options[0].realtime.matches({
      payload: { sessionId: "session-a" }
    })).toBe(false);
    scope.stop();
  });

  it("turns a personal member's main-chat message into a suggestion only", async () => {
    endpointMocks.resources = [
      resource({
        accessLabel: "Personal use",
        available: true,
        canRequestMessage: true,
        canUse: false,
        ownerOnly: true,
        ok: true
      }),
      resource({
        canManage: false,
        ok: true,
        suggestions: [{ id: "suggestion-a", status: "pending" }]
      })
    ];
    const scope = effectScope();
    const access = scope.run(() => useVibe64AssistantAccess({
      sessionId: ref("session-a"),
      sessionsApiPath: ref("/api/vibe64/sessions")
    }));

    expect(access.canUseAi.value).toBe(false);
    expect(access.canRequestMessage.value).toBe(true);
    expect(access.canSubmitMainChat.value).toBe(true);
    expect(access.restrictionMessage.value).toContain("request a main-chat message");
    expect(access.pendingSuggestions.value.map(({ id }) => id)).toEqual(["suggestion-a"]);

    const result = await access.suggestMessage({
      attachmentIds: ["attachment-a"],
      message: "Please review this"
    });
    expect(result.suggested).toBe(true);
    expect(commandMocks.command.run).toHaveBeenCalledWith({
      body: {
        attachmentIds: ["attachment-a"],
        message: "Please review this"
      },
      path: "/api/vibe64/sessions/session-a/message-suggestions"
    });
    expect(endpointMocks.resources[1].reload).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("approves a request through the session's current AI without route confirmation", async () => {
    endpointMocks.resources = [
      resource({
        accessLabel: "Personal use",
        available: true,
        canRequestMessage: false,
        canUse: true,
        ownerOnly: true,
        ok: true
      }),
      resource({
        canManage: true,
        ok: true,
        suggestions: [{ id: "suggestion-a", status: "pending" }]
      })
    ];
    const scope = effectScope();
    const access = scope.run(() => useVibe64AssistantAccess({
      sessionId: ref("session-a"),
      sessionsApiPath: ref("/api/vibe64/sessions")
    }));

    await access.approveSuggestion("suggestion-a");
    expect(commandMocks.command.run).toHaveBeenCalledWith({
      body: {},
      path: "/api/vibe64/sessions/session-a/message-suggestions/suggestion-a/approve"
    });
    scope.stop();
  });

  it("uses zero normal footer space and opens pending suggestions from an alert", () => {
    const autopilot = fs.readFileSync(path.resolve(
      "src/components/studio/vibe64-session/Vibe64AutopilotView.vue"
    ), "utf8");
    const panel = fs.readFileSync(path.resolve(
      "src/components/studio/vibe64-session/Vibe64AssistantAccessPanel.vue"
    ), "utf8");
    const assistantMenuSource = fs.readFileSync(path.resolve(
      "src/components/studio/vibe64-session/Vibe64SessionAssistantMenu.vue"
    ), "utf8");
    const assistantDialog = fs.readFileSync(path.resolve(
      "src/components/studio/vibe64-session/Vibe64AssistantSessionDialog.vue"
    ), "utf8");
    const footerStart = autopilot.indexOf('<template #footer="{ attachmentState }">');
    const accessControl = autopilot.indexOf("<Vibe64AssistantAccessPanel");
    const assistantMenu = autopilot.indexOf("<Vibe64SessionAssistantMenu", accessControl);

    expect(footerStart).toBeGreaterThan(-1);
    expect(accessControl).toBeGreaterThan(footerStart);
    expect(accessControl).toBeLessThan(assistantMenu);
    expect(panel).toContain('<v-dialog v-model="queueOpen"');
    expect(panel).toContain('@click="queueOpen = true"');
    expect(panel).toContain('v-if="accessError || suggestionsRelevant"');
    expect(panel).toContain("props.suggestionsError ||\n  props.pendingSuggestions.length");
    expect(panel).toMatch(/\.vibe64-assistant-access \{[\s\S]*?display: flex;/u);
    expect(panel).not.toContain("<v-chip");
    expect(panel).not.toContain("Workspace use");
    expect(panel).not.toContain("border-block:");
    expect(autopilot).toContain(':access-label="assistantAccessLabel"');
    expect(autopilot).toContain(':access-loading="assistantAccessLoading"');
    expect(autopilot).toContain(':disabled="composerSending || agentActive || !assistantDirectAllowed"');
    expect(autopilot).toContain(':disabled-reason="!assistantDirectAllowed ? assistantRestrictionMessage : \'\'"');
    expect(assistantMenuSource).toContain(':access-label="accessLabel"');
    expect(assistantMenuSource).toContain(':access-loading="accessLoading"');
    expect(assistantMenuSource).toContain('if (props.disabled && disabledReason)');
    expect(assistantDialog).toContain('v-if="editing && accessLoading"');
    expect(assistantDialog).toContain('type="list-item"');
    expect(assistantDialog).toContain('v-else-if="editing && normalizedAccessLabel"');
    expect(assistantDialog.indexOf('class="vibe64-assistant-dialog__access"')).toBeLessThan(
      assistantDialog.indexOf('<v-card-text class="vibe64-assistant-dialog__body">')
    );
    expect(assistantDialog).toContain('<v-btn-toggle');
    expect(assistantDialog).toContain('height="48"');
    expect(assistantDialog).toContain("Authorized workspace members may use this owner-configured API connection.");
  });
});
