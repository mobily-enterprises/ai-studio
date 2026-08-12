import {
  CodexAppServerJsonRpcClient
} from "./codexAppServerProvider.js";

/**
 * Open one uninitialized app-server connection for a Genesis run.
 *
 * The Vibe64 provider continues to own the app-server process. Genesis owns
 * this connection's initialize handshake, thread, turn, and lifetime.
 */
async function openGenesisAppServerConnection({
  provider,
  requestTimeoutMs = provider?.options?.requestTimeoutMs,
  WebSocketImpl = provider?.options?.WebSocketImpl
} = {}) {
  if (!provider || typeof provider.ensureRuntime !== "function") {
    throw new Error("A Vibe64 Codex app-server provider is required for Genesis.");
  }
  const runtime = await provider.ensureRuntime();
  if (!runtime?.endpoint) {
    throw new Error("The Vibe64 Codex app-server runtime has no endpoint.");
  }
  const client = new CodexAppServerJsonRpcClient({
    endpoint: runtime.endpoint,
    requestTimeoutMs,
    WebSocketImpl
  });
  await client.connect();

  return Object.freeze({
    request(method, params = {}) {
      return client.request(method, params);
    },
    notify(method, params = {}) {
      client.notify(method, params);
    },
    subscribe(listener) {
      return client.subscribe(listener);
    },
    onDisconnect(listener) {
      return client.onDisconnect(listener);
    },
    setRequestHandler(handler) {
      client.setRequestHandler(typeof handler === "function"
        ? ({ method, params }) => handler(method, params)
        : null);
    },
    async close() {
      client.close();
    }
  });
}

export {
  openGenesisAppServerConnection
};
