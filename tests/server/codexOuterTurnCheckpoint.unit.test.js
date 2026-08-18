import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createCodexTerminalController
} from "../../packages/vibe64-terminals/src/server/codexTerminal.js";

test("terminal state preserves the stable outer turn independently of provider successor turns", async () => {
  const controller = createCodexTerminalController({
    projectService: {
      createSessionStore() {
        return {
          async readAgentRun() {
            return {
              id: "codex_app_server",
              outerTurnId: "client-message-1",
              providerThreadId: "provider-thread",
              providerTurnId: "provider-successor-turn",
              state: "active"
            };
          },
          async readMetadataValue() {
            return "";
          },
          async readSessionSourceDescriptor() {
            return {
              metadata: {},
              sessionId: "session-1"
            };
          }
        };
      }
    }
  });

  const state = await controller.terminalState("session-1");
  assert.equal(state.codexAgentTurn.outerTurnId, "client-message-1");
  assert.equal(state.codexAgentTurn.turnId, "provider-successor-turn");
});

test("a new chat turn claims its client message id and stable terminal outcomes checkpoint it", async () => {
  const source = await readFile(new URL(
    "../../packages/vibe64-terminals/src/server/codexTerminal.js",
    import.meta.url
  ), "utf8");

  assert.match(source, /claimCodexAppServerTurnStart\(runtime, sessionId, messageId\)/u);
  assert.match(source, /outerTurnId: normalizedOuterTurnId/u);
  assert.match(source, /checkpointCodexAppServerTurn\(sessionId/u);
  assert.match(source, /createGitTurnCheckpoint\(\{/u);
});
