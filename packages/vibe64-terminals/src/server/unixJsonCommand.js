import crypto from "node:crypto";
import http from "node:http";
import { stat } from "node:fs/promises";

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

async function unixCommandSocketIsPresent(socketPath = "") {
  try {
    return (await stat(socketPath)).isSocket();
  } catch {
    return false;
  }
}

function requestUnixJsonCommand({
  body = {},
  path = "/",
  socketPath = "",
  timeoutMs = 2000
} = {}) {
  const requestBody = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      headers: {
        "Content-Length": Buffer.byteLength(requestBody),
        "Content-Type": "application/json"
      },
      method: "POST",
      path,
      socketPath,
      timeout: timeoutMs
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.once("end", () => {
        let payload = null;
        try {
          payload = JSON.parse(text || "{}");
        } catch {
          payload = null;
        }
        resolve({
          payload,
          statusCode: Number(response.statusCode || 0),
          text
        });
      });
    });
    request.once("error", reject);
    request.once("timeout", () => {
      const error = new Error("Unix command request timed out.");
      error.code = "ETIMEDOUT";
      request.destroy(error);
    });
    request.end(requestBody);
  });
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
  requestUnixJsonCommand,
  sendJsonCommandResponse,
  shortCommandHash,
  unixCommandSocketIsPresent
};
