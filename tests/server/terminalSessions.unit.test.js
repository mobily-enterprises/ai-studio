import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  closeTerminalSession,
  closeTerminalSessionsForNamespacePrefix,
  countRunningTerminalSessions,
  startTerminalSession
} from "../../server/lib/terminalSessions.js";

function longRunningNodeArgs() {
  return [
    "-e",
    "process.stdin.resume(); setInterval(() => {}, 1000);"
  ];
}

test("terminal sessions reuse one running terminal per namespace and enforce a running cap", async () => {
  const prefix = `terminal-test-${crypto.randomUUID()}:`;
  const closedTerminalIds = [];

  function start(namespace) {
    return startTerminalSession({
      args: ({ id }) => {
        assert.ok(id);
        return longRunningNodeArgs();
      },
      command: process.execPath,
      commandPreview: ({ id }) => `node ${id}`,
      maxRunning: 3,
      namespace,
      namespaceLimitPrefix: prefix,
      onClose: ({ id }) => {
        closedTerminalIds.push(id);
      },
      reuseRunning: true
    });
  }

  try {
    const first = start(`${prefix}one`);
    assert.equal(first.ok, true);
    assert.equal(countRunningTerminalSessions({ namespacePrefix: prefix }), 1);

    const reused = start(`${prefix}one`);
    assert.equal(reused.ok, true);
    assert.equal(reused.id, first.id);
    assert.equal(countRunningTerminalSessions({ namespacePrefix: prefix }), 1);

    const second = start(`${prefix}two`);
    const third = start(`${prefix}three`);
    assert.equal(second.ok, true);
    assert.equal(third.ok, true);
    assert.equal(countRunningTerminalSessions({ namespacePrefix: prefix }), 3);

    const blocked = start(`${prefix}four`);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "terminal_limit");

    const closed = await closeTerminalSession(first.id, {
      namespace: `${prefix}one`
    });
    assert.equal(closed.closed, true);
    assert.deepEqual(closedTerminalIds, [first.id]);
    assert.equal(countRunningTerminalSessions({ namespacePrefix: prefix }), 2);
  } finally {
    await closeTerminalSessionsForNamespacePrefix(prefix);
  }
});
