import assert from "node:assert/strict";
import test from "node:test";

import {
  openGenesisAppServerConnection
} from "@local/vibe64-runtime/server/genesisAppServerConnection";

function delay() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

class FakeWebSocket {
  static instances = [];

  constructor(url, options = {}) {
    this.listeners = new Map();
    this.options = options;
    this.readyState = 0;
    this.sent = [];
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(eventName, listener) {
    const listeners = this.listeners.get(eventName) || [];
    listeners.push(listener);
    this.listeners.set(eventName, listeners);
  }

  removeEventListener(eventName, listener) {
    const listeners = this.listeners.get(eventName) || [];
    this.listeners.set(eventName, listeners.filter((entry) => entry !== listener));
  }

  emit(eventName, event = {}) {
    if (eventName === "open") {
      this.readyState = 1;
    } else if (eventName === "close") {
      this.readyState = 3;
    }
    for (const listener of this.listeners.get(eventName) || []) {
      listener(event);
    }
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.emit("close");
  }
}

async function openConnection() {
  FakeWebSocket.instances = [];
  const providerCalls = [];
  const provider = {
    options: {
      requestTimeoutMs: 1000,
      WebSocketImpl: FakeWebSocket
    },
    async ensureRuntime() {
      providerCalls.push("ensureRuntime");
      return {
        endpoint: "unix:///tmp/vibe64/codex-app-server/app-server.sock"
      };
    }
  };
  const pending = openGenesisAppServerConnection({ provider });
  await delay();
  const socket = FakeWebSocket.instances[0];
  socket.emit("open");
  return {
    connection: await pending,
    providerCalls,
    socket
  };
}

test("Genesis gets a dedicated uninitialized connection to Vibe64's app-server", async () => {
  const { connection, providerCalls, socket } = await openConnection();

  assert.deepEqual(providerCalls, ["ensureRuntime"]);
  assert.equal(socket.url, "ws://localhost/");
  assert.equal(socket.options.perMessageDeflate, false);
  assert.deepEqual(socket.sent, []);
  for (const method of [
    "request",
    "notify",
    "subscribe",
    "onDisconnect",
    "setRequestHandler",
    "close"
  ]) {
    assert.equal(typeof connection[method], "function", method);
  }

  const initialize = connection.request("initialize", {
    clientInfo: {
      name: "genesis"
    }
  });
  assert.deepEqual(socket.sent, [{
    id: 1,
    method: "initialize",
    params: {
      clientInfo: {
        name: "genesis"
      }
    }
  }]);
  socket.emit("message", {
    data: JSON.stringify({
      id: 1,
      result: {
        userAgent: "codex-test"
      }
    })
  });
  assert.deepEqual(await initialize, {
    userAgent: "codex-test"
  });

  connection.notify("initialized", {});
  assert.deepEqual(socket.sent.at(-1), {
    method: "initialized",
    params: {}
  });
  await connection.close();
});

test("Genesis receives streamed notifications and handles app-server requests", async () => {
  const { connection, socket } = await openConnection();
  const notifications = [];
  connection.subscribe((message) => notifications.push(message));
  connection.setRequestHandler(async (method, params) => ({
    accepted: method === "item/tool/call" && params.callId === "call-1"
  }));

  const reasoning = {
    method: "item/reasoning/summaryTextDelta",
    params: {
      delta: "Checking the generated dates.",
      threadId: "thread-1",
      turnId: "turn-1"
    }
  };
  socket.emit("message", {
    data: JSON.stringify(reasoning)
  });
  assert.deepEqual(notifications, [reasoning]);

  socket.emit("message", {
    data: JSON.stringify({
      id: "server-1",
      method: "item/tool/call",
      params: {
        callId: "call-1"
      }
    })
  });
  await delay();
  assert.deepEqual(socket.sent.at(-1), {
    id: "server-1",
    result: {
      accepted: true
    }
  });
  await connection.close();
});

test("Genesis is notified when its dedicated connection disconnects", async () => {
  const { connection, socket } = await openConnection();
  const disconnects = [];
  connection.onDisconnect((error) => disconnects.push(error.message));

  const pending = connection.request("thread/read", {
    threadId: "thread-1"
  });
  socket.emit("close");

  await assert.rejects(pending, /Codex app-server connection closed/u);
  assert.deepEqual(disconnects, ["Codex app-server connection closed."]);
});
