import { conversationAttachmentContentType, conversationAttachmentReference } from "@local/vibe64-runtime/shared";

function labelComposerAttachments(attachments = []) {
  let images = 0;
  let files = 0;
  return attachments.map((attachment) => ({
    ...attachment,
    reference: conversationAttachmentReference(attachment,
      conversationAttachmentContentType(attachment.fileName).startsWith("image/") ? ++images : ++files)
  }));
}

function updateComposerAttachmentReferences(text, previous, next) {
  const replacements = new Map(previous.filter((attachment) => attachment.reference).map((attachment) => [
    attachment.reference,
    next.find((candidate) => candidate.attachmentId === attachment.attachmentId)?.reference || ""
  ]));
  return String(text || "").replace(/\[(?:Image|File) #[1-9][0-9]{0,3}\]/gu,
    (reference) => replacements.has(reference) ? replacements.get(reference) : reference);
}

function attachmentSizeLabel(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export {
  attachmentSizeLabel,
  labelComposerAttachments,
  updateComposerAttachmentReferences
};
