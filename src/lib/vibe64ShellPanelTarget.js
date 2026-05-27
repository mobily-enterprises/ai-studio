import {
  stableLocalStorageKeyPart
} from "@/lib/browserLocalStorage.js";

function aiStudioShellPanelTargetId(sessionId = "") {
  return `ai-studio-shell-panel-${stableLocalStorageKeyPart(sessionId)}`;
}

function aiStudioShellPanelTargetSelector(sessionId = "") {
  return `#${aiStudioShellPanelTargetId(sessionId)}`;
}

export {
  aiStudioShellPanelTargetId,
  aiStudioShellPanelTargetSelector
};
