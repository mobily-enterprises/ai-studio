import { Buffer } from "node:buffer";

const OPENCODE_RESPONSE_LIMIT_BYTES = 2 * 1024 * 1024;
const OPENCODE_CATALOG_LIMIT_BYTES = 32 * 1024 * 1024;
const OPENCODE_EVENT_LIMIT_BYTES = 2 * 1024 * 1024;

function text(value = "") {
  return String(value ?? "").trim();
}

function openCodeServerError(message, {
  body = null,
  code = "vibe64_opencode_server_request_failed",
  method = "",
  path = "",
  status = 0
} = {}) {
  const error = new Error(message);
  error.body = body;
  error.code = code;
  error.method = method;
  error.path = path;
  error.statusCode = status;
  return error;
}

async function readBoundedResponse(response, limitBytes = OPENCODE_RESPONSE_LIMIT_BYTES) {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      length += next.value.byteLength;
      if (length > limitBytes) {
        throw openCodeServerError(
          "OpenCode returned more data than the bridge accepts.",
          { code: "vibe64_opencode_response_too_large", status: response.status }
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), length).toString("utf8");
}

function parsedJson(value = "") {
  const source = String(value || "").trim();
  if (!source) {
    return null;
  }
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function responseErrorMessage(payload = null, fallback = "OpenCode rejected the request.") {
  return text(
    payload?.message ||
    payload?.error?.message ||
    payload?.error ||
    payload?.data?.message
  ) || fallback;
}

function queryString(values = {}) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && String(value).length > 0) {
      params.set(name, String(value));
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function sessionPath(sessionId = "", suffix = "") {
  const id = encodeURIComponent(text(sessionId));
  if (!id) {
    throw new TypeError("OpenCode session requests require a session id.");
  }
  return `/api/session/${id}${suffix}`;
}

function stableSessionPath(sessionId = "", suffix = "") {
  const id = encodeURIComponent(text(sessionId));
  if (!id) {
    throw new TypeError("OpenCode session requests require a session id.");
  }
  return `/session/${id}${suffix}`;
}

function normalizedMessageRows(value = null) {
  const rows = Array.isArray(value) ? value : Array.isArray(value?.data) ? value.data : [];
  return rows.map((message) => {
    const info = message?.info;
    if (!info || typeof info !== "object" || Array.isArray(info)) {
      return message;
    }
    return {
      ...info,
      content: Array.isArray(message.parts) ? message.parts : [],
      type: text(info.role)
    };
  });
}

function stablePromptBody(input = {}) {
  const model = input?.model && typeof input.model === "object" ? input.model : {};
  const modelID = text(model.modelID || model.id);
  const providerID = text(model.providerID);
  const prompt = text(input?.prompt?.text);
  if (!prompt) {
    throw new TypeError("OpenCode prompt requests require text.");
  }
  return {
    ...(text(input.agent) ? { agent: text(input.agent) } : {}),
    ...(text(input.id) ? { messageID: text(input.id) } : {}),
    ...(modelID && providerID ? { model: { modelID, providerID } } : {}),
    parts: [{ text: prompt, type: "text" }],
    ...(text(model.variant) ? { variant: text(model.variant) } : {})
  };
}

function eventSessionId(value = null) {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const properties = payload.properties && typeof payload.properties === "object"
    ? payload.properties
    : {};
  return text(
    payload.sessionID ||
    properties.sessionID ||
    properties.info?.sessionID ||
    properties.part?.sessionID
  );
}

function decodeOpenCodeEventData(value = "") {
  const first = parsedJson(value);
  if (typeof first !== "string") {
    return first;
  }
  return parsedJson(first) ?? first;
}

function createOpenCodeServerClient({
  baseUrl = "",
  directory = "",
  fetchImpl = globalThis.fetch,
  password = "",
  username = "opencode"
} = {}) {
  const origin = new URL(baseUrl);
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
    throw new TypeError("OpenCode bridge clients require a loopback HTTP server.");
  }
  if (typeof fetchImpl !== "function") {
    throw new TypeError("OpenCode bridge clients require fetch().");
  }
  const authorization = `Basic ${Buffer.from(`${text(username) || "opencode"}:${String(password)}`).toString("base64")}`;
  const scopedDirectory = text(directory);

  function requestHeaders(accept = "application/json", body = undefined) {
    return {
      accept,
      authorization,
      ...(scopedDirectory ? { "x-opencode-directory": scopedDirectory } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" })
    };
  }

  async function request(method = "GET", requestPath = "/", {
    body,
    limitBytes = OPENCODE_RESPONSE_LIMIT_BYTES,
    signal
  } = {}) {
    const response = await fetchImpl(new URL(requestPath, origin), {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: requestHeaders("application/json", body),
      method,
      signal
    });
    const source = response.status === 204
      ? ""
      : await readBoundedResponse(response, limitBytes);
    const payload = parsedJson(source);
    if (!response.ok) {
      throw openCodeServerError(responseErrorMessage(payload), {
        body: payload,
        method,
        path: requestPath,
        status: response.status
      });
    }
    return payload;
  }

  async function *events(sessionId = "", { signal } = {}) {
    const requestPath = "/event";
    const response = await fetchImpl(new URL(requestPath, origin), {
      headers: requestHeaders("text/event-stream"),
      method: "GET",
      signal
    });
    if (!response.ok || !response.body) {
      const source = await readBoundedResponse(response);
      const payload = parsedJson(source);
      throw openCodeServerError(responseErrorMessage(payload), {
        body: payload,
        method: "GET",
        path: requestPath,
        status: response.status
      });
    }
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffered = "";
    let event = { data: [], event: "message", id: "" };
    let eventBytes = 0;
    const dispatch = () => {
      if (!event.data.length) {
        event = { data: [], event: "message", id: "" };
        eventBytes = 0;
        return null;
      }
      const value = {
        data: decodeOpenCodeEventData(event.data.join("\n")),
        event: event.event,
        id: event.id
      };
      event = { data: [], event: "message", id: "" };
      eventBytes = 0;
      return value;
    };
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          const finalEvent = dispatch();
          const finalSessionId = eventSessionId(finalEvent?.data);
          if (finalEvent && (!finalSessionId || finalSessionId === text(sessionId))) {
            yield finalEvent;
          }
          return;
        }
        buffered += decoder.decode(next.value, { stream: true });
        let lineEnd = buffered.indexOf("\n");
        while (lineEnd >= 0) {
          const line = buffered.slice(0, lineEnd).replace(/\r$/u, "");
          buffered = buffered.slice(lineEnd + 1);
          if (!line) {
            const value = dispatch();
            const valueSessionId = eventSessionId(value?.data);
            if (value && (!valueSessionId || valueSessionId === text(sessionId))) {
              yield value;
            }
          } else if (!line.startsWith(":")) {
            const separator = line.indexOf(":");
            const field = separator < 0 ? line : line.slice(0, separator);
            const value = separator < 0
              ? ""
              : line.slice(separator + 1).replace(/^ /u, "");
            if (field === "data") {
              eventBytes += Buffer.byteLength(value);
              if (eventBytes > OPENCODE_EVENT_LIMIT_BYTES) {
                throw openCodeServerError("An OpenCode event exceeded the bridge limit.", {
                  code: "vibe64_opencode_event_too_large",
                  method: "GET",
                  path: requestPath,
                  status: response.status
                });
              }
              event.data.push(value);
            } else if (field === "event") {
              event.event = value;
            } else if (field === "id") {
              event.id = value;
            }
          }
          lineEnd = buffered.indexOf("\n");
        }
      }
    } finally {
      await reader.cancel().catch(() => null);
      reader.releaseLock();
    }
  }

  return Object.freeze({
    async agents({ directory = "", signal } = {}) {
      return request("GET", `/agent${queryString({ directory })}`, {
        limitBytes: OPENCODE_CATALOG_LIMIT_BYTES,
        signal
      });
    },
    async authenticateApiKey(modelProviderId = "", apiKey = "", { signal } = {}) {
      const providerId = encodeURIComponent(text(modelProviderId));
      if (!providerId || !String(apiKey)) {
        throw new TypeError("OpenCode API-key authentication requires a provider id and key.");
      }
      return request("PUT", `/auth/${providerId}`, {
        body: { key: String(apiKey), type: "api" },
        signal
      });
    },
    async createSession(input = {}, { signal } = {}) {
      return (await request("POST", "/api/session", { body: input, signal }))?.data || null;
    },
    async deleteSession(sessionId = "", { signal } = {}) {
      return request("DELETE", `/session/${encodeURIComponent(text(sessionId))}`, { signal });
    },
    events,
    forDirectory(nextDirectory = "") {
      const normalizedDirectory = text(nextDirectory);
      if (!normalizedDirectory) {
        throw new TypeError("OpenCode project clients require a working directory.");
      }
      return createOpenCodeServerClient({
        baseUrl: origin.toString(),
        directory: normalizedDirectory,
        fetchImpl,
        password,
        username
      });
    },
    async health({ signal } = {}) {
      return request("GET", "/global/health", { signal });
    },
    async interrupt(sessionId = "", { signal } = {}) {
      return request("POST", stableSessionPath(sessionId, "/abort"), { signal });
    },
    async messages(sessionId = "", input = {}, { signal } = {}) {
      const result = await request(
        "GET",
        `${stableSessionPath(sessionId, "/message")}${queryString({ limit: input.limit })}`,
        { signal }
      );
      return { data: normalizedMessageRows(result) };
    },
    async prompt(sessionId = "", input = {}, { signal } = {}) {
      await request("POST", stableSessionPath(sessionId, "/prompt_async"), {
        body: stablePromptBody(input),
        signal
      });
      return {
        delivery: text(input.delivery),
        id: text(input.id),
        sessionID: text(sessionId)
      };
    },
    async providers({ directory = "", signal } = {}) {
      return request("GET", `/provider${queryString({ directory })}`, {
        limitBytes: OPENCODE_CATALOG_LIMIT_BYTES,
        signal
      });
    },
    async readSession(sessionId = "", { signal } = {}) {
      return (await request("GET", sessionPath(sessionId), { signal }))?.data || null;
    },
    async removeAuthentication(modelProviderId = "", { signal } = {}) {
      return request("DELETE", `/auth/${encodeURIComponent(text(modelProviderId))}`, { signal });
    },
    async switchAgent(sessionId = "", agent = "", { signal } = {}) {
      return request("POST", sessionPath(sessionId, "/agent"), {
        body: { agent: text(agent) },
        signal
      });
    },
    async switchModel(sessionId = "", model = {}, { signal } = {}) {
      return request("POST", sessionPath(sessionId, "/model"), {
        body: { model },
        signal
      });
    }
  });
}

export {
  OPENCODE_CATALOG_LIMIT_BYTES,
  OPENCODE_EVENT_LIMIT_BYTES,
  OPENCODE_RESPONSE_LIMIT_BYTES,
  createOpenCodeServerClient,
  openCodeServerError
};
