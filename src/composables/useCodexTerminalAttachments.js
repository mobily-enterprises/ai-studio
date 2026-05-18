import { computed, ref, unref } from "vue";

function filesFromDropEvent(event) {
  return Array.from(event?.dataTransfer?.files || []).filter((file) => file && file.size >= 0);
}

function dragEventHasFiles(event) {
  return filesFromDropEvent(event).length > 0 ||
    Array.from(event?.dataTransfer?.types || []).includes("Files");
}

function useCodexTerminalAttachments({
  ensureTerminalReady,
  focusTerminal,
  sendTerminalData,
  sessionId,
  uploadAttachment
} = {}) {
  const dragDepth = ref(0);
  const status = ref("");
  const uploading = ref(false);
  const dragActive = computed(() => dragDepth.value > 0);

  function resetDragState() {
    dragDepth.value = 0;
  }

  function clearStatus() {
    status.value = "";
  }

  function handleDragEnter(event) {
    if (!dragEventHasFiles(event)) {
      return;
    }
    dragDepth.value += 1;
    if (event?.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragOver(event) {
    if (event?.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragLeave() {
    dragDepth.value = Math.max(0, dragDepth.value - 1);
  }

  async function injectAttachmentPath(containerPath) {
    const normalizedPath = String(containerPath || "").trim();
    if (!normalizedPath) {
      return false;
    }
    return sendTerminalData(`\u001b[200~[${normalizedPath}] \u001b[201~`);
  }

  async function uploadDroppedAttachment(file) {
    const attachment = await uploadAttachment(unref(sessionId), file);
    if (attachment?.ok === false) {
      throw new Error(attachment.error || attachment.errors?.[0]?.message || "Attachment upload failed.");
    }
    if (!(await injectAttachmentPath(attachment.containerPath))) {
      throw new Error("Attachment path could not be sent to Codex.");
    }
    return attachment;
  }

  async function handleDrop(event) {
    resetDragState();
    const files = filesFromDropEvent(event);
    if (!files.length) {
      return;
    }
    uploading.value = true;
    status.value = "";
    try {
      if (!(await ensureTerminalReady())) {
        return;
      }
      const uploaded = [];
      for (const file of files) {
        uploaded.push(await uploadDroppedAttachment(file));
      }
      const label = uploaded.length === 1
        ? uploaded[0].fileName
        : `${uploaded.length} files`;
      status.value = `${label} attached. Press Enter in Codex when ready.`;
      focusTerminal();
    } catch (error) {
      status.value = String(error?.message || error || "Attachment upload failed.");
    } finally {
      uploading.value = false;
    }
  }

  return {
    attachmentDragActive: dragActive,
    attachmentStatus: status,
    attachmentUploading: uploading,
    clearAttachmentStatus: clearStatus,
    handleAttachmentDragEnter: handleDragEnter,
    handleAttachmentDragLeave: handleDragLeave,
    handleAttachmentDragOver: handleDragOver,
    handleAttachmentDrop: handleDrop,
    resetAttachmentDragState: resetDragState
  };
}

export {
  useCodexTerminalAttachments
};
