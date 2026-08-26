import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENCODE_RESPONSE_LIMIT_BYTES,
  createOpenCodeServerClient
} from "../../packages/vibe64-terminals/src/server/opencodeServerClient.js";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status
  });
}

test("OpenCode client accepts only loopback HTTP origins", () => {
  for (const baseUrl of [
    "https://127.0.0.1:4096",
    "http://192.0.2.10:4096",
    "http://example.com:4096"
  ]) {
    assert.throws(
      () => createOpenCodeServerClient({ baseUrl }),
      /loopback HTTP server/u
    );
  }
  assert.doesNotThrow(() => createOpenCodeServerClient({
    baseUrl: "http://127.0.0.1:4096"
  }));
});

test("OpenCode client combines durable v2 sessions with stable execution routes and isolates provider keys", async () => {
  const requests = [];
  const client = createOpenCodeServerClient({
    baseUrl: "http://127.0.0.1:4096",
    fetchImpl: async (url, options = {}) => {
      requests.push({
        body: options.body,
        headers: { ...options.headers },
        method: options.method,
        url: String(url)
      });
      const pathname = new URL(url).pathname;
      if (pathname === "/api/session") {
        return jsonResponse({ data: { id: "ses_created" } });
      }
      if (pathname.endsWith("/prompt_async")) {
        return new Response(null, { status: 204 });
      }
      if (pathname.endsWith("/message")) {
        return jsonResponse([{
          info: {
            finish: "stop",
            id: "msg_assistant",
            role: "assistant",
            time: { completed: 2, created: 1 }
          },
          parts: [{ id: "prt_text", text: "hello", type: "text" }]
        }]);
      }
      return jsonResponse(true);
    },
    password: "bridge-password"
  });

  await client.authenticateApiKey("deepseek", "deepseek-private-key");
  assert.deepEqual(await client.createSession({ id: "ses_created" }), { id: "ses_created" });
  assert.deepEqual(await client.prompt("ses/needs encoding", {
    agent: "build",
    id: "msg_admitted",
    model: { id: "deepseek-chat", providerID: "deepseek", variant: "high" },
    prompt: { text: "hello" }
  }), {
    delivery: "",
    id: "msg_admitted",
    sessionID: "ses/needs encoding"
  });
  assert.deepEqual(await client.messages("ses_created", { limit: 10 }), {
    data: [{
      content: [{ id: "prt_text", text: "hello", type: "text" }],
      finish: "stop",
      id: "msg_assistant",
      role: "assistant",
      time: { completed: 2, created: 1 },
      type: "assistant"
    }]
  });
  await client.interrupt("ses_created");
  await client.switchAgent("ses_created", "build");
  await client.switchModel("ses_created", { id: "deepseek-chat", providerID: "deepseek" });

  assert.deepEqual(requests.map(({ method, url }) => ({
    method,
    path: new URL(url).pathname
  })), [
    { method: "PUT", path: "/auth/deepseek" },
    { method: "POST", path: "/api/session" },
    { method: "POST", path: "/session/ses%2Fneeds%20encoding/prompt_async" },
    { method: "GET", path: "/session/ses_created/message" },
    { method: "POST", path: "/session/ses_created/abort" },
    { method: "POST", path: "/api/session/ses_created/agent" },
    { method: "POST", path: "/api/session/ses_created/model" }
  ]);
  assert.deepEqual(JSON.parse(requests[0].body), {
    key: "deepseek-private-key",
    type: "api"
  });
  assert.deepEqual(JSON.parse(requests[2].body), {
    agent: "build",
    messageID: "msg_admitted",
    model: { modelID: "deepseek-chat", providerID: "deepseek" },
    parts: [{ text: "hello", type: "text" }],
    variant: "high"
  });
  assert.equal(requests.slice(1).some((request) => (
    JSON.stringify(request).includes("deepseek-private-key")
  )), false);
  assert.equal(new Set(requests.map((request) => request.headers.authorization)).size, 1);
  assert.match(requests[0].headers.authorization, /^Basic /u);
});

test("OpenCode client rejects oversized responses before parsing them", async () => {
  const client = createOpenCodeServerClient({
    baseUrl: "http://localhost:4096",
    fetchImpl: async () => new Response("x".repeat(OPENCODE_RESPONSE_LIMIT_BYTES + 1)),
    password: "password"
  });
  await assert.rejects(
    () => client.health(),
    (error) => error?.code === "vibe64_opencode_response_too_large"
  );
});

test("OpenCode client decodes bounded server-sent events", async () => {
  const source = [
    ": heartbeat",
    "id: evt_1",
    "event: session.updated",
    'data: {"sessionID":"ses_1"}',
    "",
    "id: evt_2",
    'data: "{\\"status\\":\\"idle\\"}"',
    ""
  ].join("\n");
  let eventUrl = "";
  const client = createOpenCodeServerClient({
    baseUrl: "http://[::1]:4096",
    fetchImpl: async (url) => {
      eventUrl = String(url);
      return new Response(source, {
        headers: { "content-type": "text/event-stream" }
      });
    },
    password: "password"
  });
  const events = [];
  for await (const event of client.events("ses_1", { after: "19" })) {
    events.push(event);
  }
  assert.deepEqual(events, [
    {
      data: { sessionID: "ses_1" },
      event: "session.updated",
      id: "evt_1"
    },
    {
      data: { status: "idle" },
      event: "message",
      id: "evt_2"
    }
  ]);
  assert.equal(new URL(eventUrl).pathname, "/event");
});
