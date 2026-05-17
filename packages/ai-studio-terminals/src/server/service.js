import { createAppReviewTerminalController } from "./appReviewTerminal.js";
import { createCodexTerminalController } from "./codexTerminal.js";
import { createCommandTerminalController } from "./commandTerminal.js";

function createService({ projectService } = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.ai-studio-project.service.");
  }

  const codex = createCodexTerminalController({
    projectService
  });
  const command = createCommandTerminalController({
    projectService
  });
  const appReview = createAppReviewTerminalController({
    projectService
  });

  return Object.freeze({
    async closeSessionTerminals(sessionId) {
      await Promise.all([
        appReview.closeAllForSession(sessionId),
        codex.closeAllForSession(sessionId),
        command.closeAllForSession(sessionId)
      ]);
      return {
        ok: true
      };
    },

    async closeSessionNonCodexTerminals(sessionId) {
      await Promise.all([
        appReview.closeAllForSession(sessionId),
        command.closeAllForSession(sessionId)
      ]);
      return {
        ok: true
      };
    },

    closeCodexTerminal(sessionId, terminalSessionId) {
      return codex.closeTerminal(sessionId, terminalSessionId);
    },

    closeCommandTerminal(sessionId, terminalSessionId) {
      return command.closeTerminal(sessionId, terminalSessionId);
    },

    closeAppReviewTerminal(sessionId, terminalSessionId) {
      return appReview.closeTerminal(sessionId, terminalSessionId);
    },

    readCodexTerminal(sessionId, terminalSessionId) {
      return codex.readTerminal(sessionId, terminalSessionId);
    },

    readCommandTerminal(sessionId, terminalSessionId) {
      return command.readTerminal(sessionId, terminalSessionId);
    },

    readAppReviewTerminal(sessionId, terminalSessionId) {
      return appReview.readTerminal(sessionId, terminalSessionId);
    },

    saveCodexPromptHandoff(sessionId, input = {}) {
      return codex.savePromptHandoff(sessionId, input);
    },

    saveCodexThread(sessionId, input = {}) {
      return codex.saveThread(sessionId, input);
    },

    startCodexTerminal(sessionId) {
      return codex.startTerminal(sessionId);
    },

    startCommandTerminal(sessionId, input = {}) {
      return command.startTerminal(sessionId, input);
    },

    startAppReviewTerminal(sessionId) {
      return appReview.startTerminal(sessionId);
    },

    subscribeCodexTerminal(sessionId, terminalSessionId, subscriber) {
      return codex.subscribeTerminal(sessionId, terminalSessionId, subscriber);
    },

    subscribeCommandTerminal(sessionId, terminalSessionId, subscriber) {
      return command.subscribeTerminal(sessionId, terminalSessionId, subscriber);
    },

    subscribeAppReviewTerminal(sessionId, terminalSessionId, subscriber) {
      return appReview.subscribeTerminal(sessionId, terminalSessionId, subscriber);
    },

    uploadCodexAttachment(sessionId, input = {}) {
      return codex.uploadAttachment(sessionId, input);
    },

    writeCodexTerminal(sessionId, terminalSessionId, data) {
      return codex.writeTerminal(sessionId, terminalSessionId, data);
    },

    writeCommandTerminal(sessionId, terminalSessionId, data) {
      return command.writeTerminal(sessionId, terminalSessionId, data);
    },

    writeAppReviewTerminal(sessionId, terminalSessionId, data) {
      return appReview.writeTerminal(sessionId, terminalSessionId, data);
    }
  });
}

export { createService };
