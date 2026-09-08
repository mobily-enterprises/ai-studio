import { unref } from "vue";
import {
  useAgentAttachments
} from "@/composables/useAgentAttachments.js";

function attachmentPathForTerminal(attachmentPath = "") {
  const normalizedPath = String(attachmentPath || "").trim();
  return normalizedPath ? `[${normalizedPath}] ` : "";
}

function useCodexTerminalAttachments({
  canUpload = () => true,
  deleteAttachment,
  ensureTerminalReady,
  focusTerminal,
  sendAttachmentPath,
  sessionId,
  uploadAttachment
} = {}) {
  async function injectAttachmentPath(attachmentPath = "", attachmentIds = []) {
    const terminalText = attachmentPathForTerminal(attachmentPath);
    return terminalText ? sendAttachmentPath(terminalText, attachmentIds) : false;
  }

  async function injectUploadedAttachments(uploaded = []) {
    for (const attachment of uploaded) {
      const fileName = String(attachment.fileName || "attachment");
      const attachmentPath = String(attachment.path || "").trim();
      if (!attachmentPath) {
        throw new Error(`${fileName} uploaded, but no Codex path was returned.`);
      }
      if (!(await injectAttachmentPath(attachmentPath, [attachment.attachmentId]))) {
        throw new Error(`${fileName} uploaded, but its path could not be sent to Codex.`);
      }
    }
  }

  const attachments = useAgentAttachments({
    canUpload: () => Boolean(unref(sessionId)) && (
      typeof canUpload === "function"
        ? canUpload() !== false
        : unref(canUpload) !== false
    ),
    deleteAttachment,
    onUploaded: async (uploaded = []) => {
      await injectUploadedAttachments(uploaded);
      const label = uploaded.length === 1
        ? uploaded[0].fileName
        : `${uploaded.length} files`;
      attachments.status.value = `${label} attached. Press Enter in Codex when ready.`;
      focusTerminal();
      return { accepted: true };
    },
    sessionId,
    uploadAttachment: async (currentSessionId, file, options = {}) => {
      if (!(await ensureTerminalReady())) {
        throw new Error("Codex terminal is not ready for attachments.");
      }
      return uploadAttachment(currentSessionId, file, options);
    }
  });

  return {
    attachmentDragActive: attachments.dragActive,
    attachmentCanAddFiles: attachments.canAddFiles,
    attachmentQueueItems: attachments.queueItems,
    attachmentStatus: attachments.status,
    attachmentUploading: attachments.uploading,
    abandonAttachments: attachments.abandonAttachments,
    cancelAttachment: attachments.cancelAttachment,
    clearAttachmentStatus: attachments.clearStatus,
    handleAttachmentDragEnter: attachments.handleDragEnter,
    handleAttachmentDragLeave: attachments.handleDragLeave,
    handleAttachmentDragOver: attachments.handleDragOver,
    handleAttachmentDrop: attachments.handleDrop,
    removeAttachment: attachments.removeAttachment,
    resetAttachmentDragState: attachments.resetDragState,
    retryAttachment: attachments.retryAttachment,
    uploadAttachmentFiles: attachments.uploadFiles
  };
}

export {
  attachmentPathForTerminal,
  useCodexTerminalAttachments
};
