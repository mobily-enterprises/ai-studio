import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";

import {
  sendVibe64EventStream
} from "../../packages/vibe64-core/src/server/eventStream.js";

function eventStreamReply() {
  const raw = new EventEmitter();
  raw.chunks = [];
  raw.destroyed = false;
  raw.ended = false;
  raw.end = () => {
    raw.ended = true;
  };
  raw.write = (chunk) => {
    raw.chunks.push(String(chunk));
  };
  raw.writeHead = (statusCode, headers) => {
    raw.headers = headers;
    raw.statusCode = statusCode;
  };
  return {
    hijacked: false,
    hijack() {
      this.hijacked = true;
    },
    raw
  };
}

test("Vibe64 event streams frame events and release registered resources", async () => {
  const reply = eventStreamReply();
  let released = false;

  await sendVibe64EventStream(reply, async ({ emit, isClosed, onClose }) => {
    assert.equal(isClosed(), false);
    onClose(() => {
      released = true;
    });
    emit("source.updated", {
      path: "src/app.js"
    });
  });

  assert.equal(reply.hijacked, true);
  assert.equal(reply.raw.statusCode, 200);
  assert.equal(reply.raw.headers["Content-Type"], "text/event-stream; charset=utf-8");
  assert.equal(reply.raw.chunks.join(""), [
    "retry: 3000\n",
    ": connected\n\n",
    "event: source.updated\n",
    "data: {\"path\":\"src/app.js\"}\n\n"
  ].join(""));
  assert.equal(released, true);
  assert.equal(reply.raw.ended, true);
});

test("Vibe64 event streams return a named error event when setup fails", async () => {
  const reply = eventStreamReply();

  await sendVibe64EventStream(reply, async () => {
    throw new Error("watch failed");
  }, {
    errorEvent: "source.sync.error"
  });

  assert.match(reply.raw.chunks.join(""), /event: source\.sync\.error\ndata: \{"error":"watch failed"\}/u);
  assert.equal(reply.raw.ended, true);
});

test("Vibe64 event streams release every resource when a close handler fails", async () => {
  const reply = eventStreamReply();
  let released = false;

  await sendVibe64EventStream(reply, async ({ onClose }) => {
    onClose(() => {
      throw new Error("already gone");
    });
    onClose(() => {
      released = true;
    });
  });

  assert.equal(released, true);
  assert.equal(reply.raw.ended, true);
});
