import crypto from "node:crypto";

function commandRequestError({
  code = "",
  message = ""
} = {}) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function shortCommandHash(value = "") {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 16);
}

async function readJsonCommandRequest(request, {
  invalidJsonError = {},
  maxBytes,
  tooLargeError = {}
} = {}) {
  const chunks = [];
  let size = 0;

  const text = await new Promise((resolve, reject) => {
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        const error = commandRequestError(tooLargeError);
        reject(error);
        request.destroy(error);
        return;
      }
      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

  try {
    const parsed = JSON.parse(text || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    throw commandRequestError(invalidJsonError);
  }
}

function sendJsonCommandResponse(response, statusCode, payload = {}) {
  const text = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Length": Buffer.byteLength(text),
    "Content-Type": "application/json"
  });
  response.end(text);
}

export {
  readJsonCommandRequest,
  sendJsonCommandResponse,
  shortCommandHash
};
