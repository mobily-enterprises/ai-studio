import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import {
  vibe64ApiError
} from "@/lib/vibe64ApiResponses.js";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64AgentAttachmentFilePath,
  vibe64AgentAttachmentPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  resolveStudioRequestUrl
} from "@/lib/studioUrls.js";

const ATTACHMENT_UPLOAD_ERROR = "Assistant attachment could not be uploaded.";

function normalizeSessionId(sessionId = "") {
  return String(sessionId || "").trim();
}

function missingSessionResponse() {
  return {
    error: "Vibe64 session id is required.",
    ok: false
  };
}

function missingAttachmentResponse() {
  return {
    error: "Attachment id is required.",
    ok: false
  };
}

function attachmentUploadAbortError() {
  const error = new Error("Attachment upload was cancelled.");
  error.name = "AbortError";
  return error;
}

function attachmentUploadPayload(request) {
  const response = request?.response;
  if (response && typeof response === "object") {
    return response;
  }
  const source = typeof response === "string"
    ? response
    : String(request?.responseText || "");
  if (!source.trim()) {
    return null;
  }
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function attachmentUploadProgress(event = {}, fileSize = 0) {
  const totalBytes = Number.isFinite(Number(fileSize))
    ? Math.max(0, Number(fileSize))
    : 0;
  const transportTotal = event.lengthComputable === true && Number.isFinite(Number(event.total))
    ? Math.max(0, Number(event.total))
    : 0;
  if (transportTotal < 1) {
    return {
      bytesSent: 0,
      progress: null,
      totalBytes
    };
  }
  const transportLoaded = Number.isFinite(Number(event.loaded))
    ? Number(event.loaded)
    : 0;
  const progress = Math.min(1, Math.max(0, transportLoaded / transportTotal));
  return {
    bytesSent: Math.min(totalBytes, Math.floor(totalBytes * progress)),
    progress,
    totalBytes
  };
}

function uploadAttachmentRequest({
  file,
  onProgress = null,
  path,
  signal = null
} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(attachmentUploadAbortError());
      return;
    }

    let request;
    try {
      request = new globalThis.XMLHttpRequest();
    } catch {
      reject(new Error(`${ATTACHMENT_UPLOAD_ERROR} Browser upload support is unavailable.`));
      return;
    }

    let settled = false;
    const progressHandler = (event) => {
      if (typeof onProgress !== "function") {
        return;
      }
      try {
        onProgress(attachmentUploadProgress(event, file.size));
      } catch {
        // Presentation callbacks cannot take ownership of the upload request.
      }
    };
    const cleanup = () => {
      signal?.removeEventListener?.("abort", abortHandler);
      request.upload?.removeEventListener?.("progress", progressHandler);
      request.onload = null;
      request.onerror = null;
      request.onabort = null;
      request.ontimeout = null;
    };
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    };
    const abortHandler = () => {
      request.abort();
      settle(reject, attachmentUploadAbortError());
    };

    try {
      const body = new FormData();
      body.append("file", file, String(file.name || "attachment"));
      request.open("POST", resolveStudioRequestUrl(path), true);
      request.onload = () => {
        const payload = attachmentUploadPayload(request);
        if (request.status >= 200 && request.status < 300) {
          if (payload && typeof payload === "object") {
            settle(resolve, payload);
            return;
          }
          settle(reject, new Error("Assistant attachment upload returned an invalid response."));
          return;
        }
        const error = vibe64ApiError(
          payload || {},
          `${ATTACHMENT_UPLOAD_ERROR} (HTTP ${request.status || "unknown"})`
        );
        error.status = Number(request.status || 0);
        error.statusCode = error.status;
        settle(reject, error);
      };
      request.onerror = () => {
        settle(reject, new Error(`${ATTACHMENT_UPLOAD_ERROR} Check your connection and try again.`));
      };
      request.onabort = () => {
        settle(reject, attachmentUploadAbortError());
      };
      request.ontimeout = () => {
        settle(reject, new Error(`${ATTACHMENT_UPLOAD_ERROR} The request timed out.`));
      };
      request.upload?.addEventListener?.("progress", progressHandler);
      signal?.addEventListener?.("abort", abortHandler, { once: true });
      if (signal?.aborted) {
        abortHandler();
        return;
      }
      request.withCredentials = true;
      request.setRequestHeader("Accept", "application/json");
      request.send(body);
    } catch (error) {
      settle(reject, error instanceof Error ? error : new Error(ATTACHMENT_UPLOAD_ERROR));
    }
  });
}

function useVibe64AttachmentCommands() {
  const paths = usePaths();
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const deleteAttachmentCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      path: vibe64AgentAttachmentFilePath(
        sessionsApiPath.value,
        context.sessionId,
        context.attachmentId
      )
    }),
    fallbackRunError: "Assistant attachment could not be removed.",
    messages: {
      error: "Assistant attachment could not be removed."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.agent-attachment.delete",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "DELETE"
  });

  async function deleteAttachment(sessionId = "", attachmentId = "") {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return missingSessionResponse();
    }
    const normalizedAttachmentId = String(attachmentId || "").trim();
    if (!normalizedAttachmentId) {
      return missingAttachmentResponse();
    }
    return await deleteAttachmentCommand.run({
      attachmentId: normalizedAttachmentId,
      sessionId: normalizedSessionId
    });
  }

  async function uploadAttachment(sessionId = "", file = null, {
    onProgress = null,
    signal = null
  } = {}) {
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return missingSessionResponse();
    }
    if (!file || typeof file.arrayBuffer !== "function") {
      return {
        error: "Attachment file is required.",
        ok: false
      };
    }
    return await uploadAttachmentRequest({
      file,
      onProgress,
      path: vibe64AgentAttachmentPath(sessionsApiPath.value, normalizedSessionId),
      signal
    });
  }

  return { deleteAttachment, uploadAttachment };
}

export {
  useVibe64AttachmentCommands
};
