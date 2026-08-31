import assert from "node:assert/strict";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  VIBE64_SESSION_STATUS,
  assertVibe64SessionStatus,
  createVibe64SessionStore,
  vibe64SessionStatusIsHidden,
  vibe64SessionStatusIsOpen
} from "@local/vibe64-runtime/server";
import {
  projectRuntimeRoot,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";
import {
  sessionClosingReason,
  sessionIsClosing
} from "../../packages/vibe64-runtime/src/server/sessionLifecycle.js";

function createStore(targetRoot, options = {}) {
  return createVibe64SessionStore({
    projectContextRoot: targetRoot,
    projectRuntimeRoot: projectRuntimeRoot(targetRoot),
    ...options
  });
}

function linuxProcessStartTimeTicks(statText = "") {
  const text = String(statText || "").trim();
  const commandEnd = text.lastIndexOf(")");
  const fields = commandEnd < 0
    ? []
    : text.slice(commandEnd + 1).trim().split(/\s+/u);
  return String(fields[19] || "");
}

async function currentLinuxProcessStartTimeTicks() {
  return linuxProcessStartTimeTicks(
    await readFile(`/proc/${process.pid}/stat`, "utf8")
  );
}

function renewalWorkflowLockPath(store, sessionId = "") {
  const sessionPaths = store.paths(sessionId);
  return path.join(
    sessionPaths.sessionsRoot,
    ".locks",
    sessionId,
    "renewal-workflow.lock"
  );
}

async function writeRenewalWorkflowLockOwner(store, sessionId, owner) {
  const lockPath = renewalWorkflowLockPath(store, sessionId);
  await mkdir(lockPath, {
    mode: 0o700,
    recursive: true
  });
  await writeFile(
    path.join(lockPath, "owner.json"),
    `${JSON.stringify(owner, null, 2)}\n`,
    "utf8"
  );
}

async function createRenewalFixture(store, {
  renewalId = "renewal-1",
  sourceSessionId = "renewal-source",
  successorSessionId = "renewal-successor"
} = {}) {
  await store.createSession({
    runtimeKind: "genesis",
    sessionId: sourceSessionId
  });
  await store.quiesceSessionForRenewal({
    quiescedAt: "2026-08-24T01:00:30.000Z",
    renewalId,
    sourceSessionId
  });
  const successor = await store.createRenewalPendingSession({
    actorDisplayName: "Ada",
    actorId: "ada-owner",
    confirmedAt: "2026-08-24T01:01:00.000Z",
    renewalId,
    renewedFrom: sourceSessionId,
    runtimeKind: "genesis",
    sessionId: successorSessionId,
    startedAt: "2026-08-24T01:00:00.000Z"
  });
  return {
    renewalId,
    sourceSessionId,
    successor,
    successorSessionId
  };
}

async function commitPreparedRenewal(store, fixture, {
  committedAt = "2026-08-24T01:06:00.000Z"
} = {}) {
  await store.activateRenewalSuccessor({
    renewalId: fixture.renewalId,
    sourceSessionId: fixture.sourceSessionId,
    successorSessionId: fixture.successorSessionId
  });
  await store.finalizeRenewalCurrentSession({
    renewalId: fixture.renewalId,
    sourceSessionId: fixture.sourceSessionId,
    successorSessionId: fixture.successorSessionId
  });
  await store.commitRenewalArchive({
    renewalId: fixture.renewalId,
    sourceSessionId: fixture.sourceSessionId,
    successorSessionId: fixture.successorSessionId
  });
  await store.commitRenewalSuccessor({
    committedAt,
    renewalId: fixture.renewalId,
    sourceSessionId: fixture.sourceSessionId,
    successorSessionId: fixture.successorSessionId
  });
  await store.commitRenewalCurrentSession({
    renewalId: fixture.renewalId,
    sourceSessionId: fixture.sourceSessionId,
    successorSessionId: fixture.successorSessionId
  });
  await store.finalizeRenewalArchiveCommit({
    renewalId: fixture.renewalId,
    sourceSessionId: fixture.sourceSessionId,
    successorSessionId: fixture.successorSessionId
  });
}

test("session state requires an explicit runtime root", () => {
  assert.throws(
    () => createVibe64SessionStore({ projectContextRoot: "/var/lib/vibe64/merc/projects/example" }),
    (error) => error?.code === "vibe64_project_runtime_root_required"
  );
});

test("plain session status has no workflow completion state", () => {
  assert.deepEqual(VIBE64_SESSION_STATUS, {
    ABANDONED: "abandoned",
    ACTIVE: "active",
    BLOCKED: "blocked",
    RENEWAL_ACTIVATING: "renewal_activating",
    RENEWAL_PENDING: "renewal_pending",
    RENEWAL_QUIESCED: "renewal_quiesced"
  });
  assert.equal(vibe64SessionStatusIsOpen(VIBE64_SESSION_STATUS.ACTIVE), true);
  assert.equal(vibe64SessionStatusIsOpen(VIBE64_SESSION_STATUS.BLOCKED), true);
  assert.equal(vibe64SessionStatusIsOpen(VIBE64_SESSION_STATUS.RENEWAL_QUIESCED), true);
  assert.equal(vibe64SessionStatusIsOpen(VIBE64_SESSION_STATUS.RENEWAL_PENDING), false);
  assert.equal(vibe64SessionStatusIsHidden(VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING), true);
  assert.equal(vibe64SessionStatusIsHidden(VIBE64_SESSION_STATUS.RENEWAL_PENDING), true);
  assert.equal(vibe64SessionStatusIsHidden(VIBE64_SESSION_STATUS.RENEWAL_QUIESCED), false);
  assert.equal(vibe64SessionStatusIsHidden(VIBE64_SESSION_STATUS.ACTIVE), false);
  assert.throws(
    () => assertVibe64SessionStatus("finished"),
    (error) => error?.code === "vibe64_invalid_session_status"
  );
});

test("a quiesced renewal predecessor is closing for launch and agent work guards", () => {
  const session = {
    metadata: {},
    sessionId: "renewal-source",
    status: VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
  };
  assert.equal(sessionClosingReason(session), "renewing");
  assert.equal(sessionIsClosing(session), true);
  assert.equal(sessionClosingReason({
    ...session,
    metadata: { session_closing_reason: "archiving" }
  }), "archiving");
});

test("session locks persist the exact live owner process identity", {
  skip: process.platform !== "linux"
}, async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    let enterOperation;
    let releaseOperation;
    const entered = new Promise((resolve) => {
      enterOperation = resolve;
    });
    const held = new Promise((resolve) => {
      releaseOperation = resolve;
    });
    const first = store.runSessionRenewalWorkflowExclusive(
      "fingerprinted-lock",
      async () => {
        enterOperation();
        await held;
        return "released";
      }
    );
    await entered;

    const owner = JSON.parse(await readFile(
      path.join(renewalWorkflowLockPath(store, "fingerprinted-lock"), "owner.json"),
      "utf8"
    ));
    assert.equal(owner.schemaVersion, 1);
    assert.equal(owner.pid, process.pid);
    assert.deepEqual(owner.processIdentity, {
      platform: "linux-proc",
      startTimeTicks: await currentLinuxProcessStartTimeTicks()
    });
    assert.deepEqual(
      await store.runSessionRenewalWorkflowExclusive(
        "fingerprinted-lock",
        async () => "must-not-run"
      ),
      {
        acquired: false,
        value: null
      }
    );

    releaseOperation();
    assert.deepEqual(await first, {
      acquired: true,
      value: "released"
    });
  });
});

test("session locks use conservative pid ownership when Linux process fingerprints are unavailable", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot, {
      sessionLockProcessPlatform: "darwin"
    });
    let enterOperation;
    let releaseOperation;
    const entered = new Promise((resolve) => {
      enterOperation = resolve;
    });
    const held = new Promise((resolve) => {
      releaseOperation = resolve;
    });
    const first = store.runSessionRenewalWorkflowExclusive(
      "pid-only-lock",
      async () => {
        enterOperation();
        await held;
        return "released";
      }
    );
    await entered;

    const owner = JSON.parse(await readFile(
      path.join(renewalWorkflowLockPath(store, "pid-only-lock"), "owner.json"),
      "utf8"
    ));
    assert.deepEqual(owner.processIdentity, {
      platform: "pid-only",
      startTimeTicks: ""
    });
    assert.deepEqual(
      await store.runSessionRenewalWorkflowExclusive(
        "pid-only-lock",
        async () => "must-not-run"
      ),
      {
        acquired: false,
        value: null
      }
    );

    releaseOperation();
    assert.deepEqual(await first, {
      acquired: true,
      value: "released"
    });
  });
});

test("pid-only session locks reclaim only a demonstrably absent owner", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot, {
      sessionLockProcessPlatform: "win32"
    });
    await writeRenewalWorkflowLockOwner(store, "live-pid-only-lock", {
      createdAt: new Date().toISOString(),
      pid: process.pid,
      processIdentity: {
        platform: "pid-only",
        startTimeTicks: ""
      },
      schemaVersion: 1,
      token: "live-owner"
    });
    assert.deepEqual(
      await store.runSessionRenewalWorkflowExclusive(
        "live-pid-only-lock",
        async () => "must-not-run"
      ),
      {
        acquired: false,
        value: null
      }
    );

    await writeRenewalWorkflowLockOwner(store, "absent-pid-only-lock", {
      createdAt: new Date().toISOString(),
      pid: 2_147_483_647,
      processIdentity: {
        platform: "pid-only",
        startTimeTicks: ""
      },
      schemaVersion: 1,
      token: "absent-owner"
    });
    assert.deepEqual(
      await store.runSessionRenewalWorkflowExclusive(
        "absent-pid-only-lock",
        async () => "replacement-owner"
      ),
      {
        acquired: true,
        value: "replacement-owner"
      }
    );
  });
});

test("session locks retire a stale owner after its PID is reused", {
  skip: process.platform !== "linux"
}, async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const currentStartTimeTicks = await currentLinuxProcessStartTimeTicks();
    await writeRenewalWorkflowLockOwner(store, "reused-pid-lock", {
      createdAt: new Date().toISOString(),
      pid: process.pid,
      processIdentity: {
        platform: "linux-proc",
        startTimeTicks: (BigInt(currentStartTimeTicks) + 1n).toString()
      },
      schemaVersion: 1,
      token: "stale-owner"
    });

    assert.deepEqual(
      await store.runSessionRenewalWorkflowExclusive(
        "reused-pid-lock",
        async () => "replacement-owner"
      ),
      {
        acquired: true,
        value: "replacement-owner"
      }
    );
  });
});

test("session locks fail closed for a live legacy owner without a fingerprint", {
  skip: process.platform !== "linux"
}, async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await writeRenewalWorkflowLockOwner(store, "ambiguous-owner-lock", {
      createdAt: new Date().toISOString(),
      pid: process.pid,
      token: "unverifiable-live-owner"
    });

    assert.deepEqual(
      await store.runSessionRenewalWorkflowExclusive(
        "ambiguous-owner-lock",
        async () => "must-not-run"
      ),
      {
        acquired: false,
        value: null
      }
    );
  });
});

test("session locks retire an owner whose process is demonstrably absent", {
  skip: process.platform !== "linux"
}, async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await writeRenewalWorkflowLockOwner(store, "exited-owner-lock", {
      createdAt: new Date().toISOString(),
      pid: 2_147_483_647,
      processIdentity: {
        platform: "linux-proc",
        startTimeTicks: "1"
      },
      schemaVersion: 1,
      token: "exited-owner"
    });

    assert.deepEqual(
      await store.runSessionRenewalWorkflowExclusive(
        "exited-owner-lock",
        async () => "replacement-owner"
      ),
      {
        acquired: true,
        value: "replacement-owner"
      }
    );
  });
});

test("plain session store persists session identity and metadata without workflow state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot, {
      clock: () => new Date("2026-05-16T01:02:03.000Z")
    });
    const created = await store.createSession({
      metadata: {
        label: "Book catalogue"
      },
      runtimeKind: "genesis",
      sessionId: "books"
    });

    assert.equal(created.sessionId, "books");
    assert.equal(created.status, VIBE64_SESSION_STATUS.ACTIVE);
    assert.equal(created.manifest.schemaVersion, 2);
    assert.equal(created.manifest.runtimeKind, "genesis");
    assert.equal(created.metadata.label, "Book catalogue");
    for (const removedField of [
      "actionResults",
      "actionsRoot",
      "agentTask",
      "agentTasksRoot",
      "artifactReadiness",
      "commandLifecycles",
      "commandLifecyclesRoot",
      "commandLogPath",
      "completedSteps",
      "currentCommandLifecycle",
      "currentStep",
      "privateInputsRoot",
      "promptContextSnapshot",
      "reportPath",
      "stepMachine",
      "stepRevision"
    ]) {
      assert.equal(Object.hasOwn(created, removedField), false, removedField);
    }
    for (const removedMethod of [
      "appendCommandLogEntry",
      "artifactExists",
      "deleteArtifact",
      "deleteArtifacts",
      "readActionResult",
      "readAgentTask",
      "readAgentTasks",
      "readArtifactReadiness",
      "readCommandLifecycle",
      "readCommandLifecycles",
      "readCommandLog",
      "readCurrentStep",
      "readCurrentAgentTask",
      "readStepState",
      "writeActionResult",
      "writeAgentTask",
      "writeCommandLifecycleEvent",
      "writeCurrentStep",
      "writeCurrentAgentTask",
      "writePrivateInput",
      "writeStepState"
    ]) {
      assert.equal(typeof store[removedMethod], "undefined", removedMethod);
    }
  });
});

test("plain session store resolves the selected active session through its managed alias", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64SessionStore({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      projectSessionSourceRoot: targetRoot
    });
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "selected-session"
    });

    assert.equal(await store.readCurrentSession(), null);
    await store.updateCurrentSession("selected-session");
    assert.equal((await store.readCurrentSession()).sessionId, "selected-session");
    await store.updateCurrentSession("");
    assert.equal(await store.readCurrentSession(), null);
  });
});

test("renewal quiescence is visible, open-counting, read-only, and explicitly reversible", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot, {
      projectSessionSourceRoot: targetRoot
    });
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "source"
    });
    await store.updateCurrentSession("source");

    const quiesced = await store.quiesceSessionForRenewal({
      quiescedAt: "2026-08-24T00:01:00.000Z",
      renewalId: "renewal-quiesce",
      sourceSessionId: "source"
    });
    assert.equal(quiesced.status, VIBE64_SESSION_STATUS.RENEWAL_QUIESCED);
    assert.equal(quiesced.metadata.renewal_quiesced_id, "renewal-quiesce");
    assert.equal(quiesced.metadata.renewal_quiesced_at, "2026-08-24T00:01:00.000Z");
    assert.equal((await store.readSession("source")).status, VIBE64_SESSION_STATUS.RENEWAL_QUIESCED);
    assert.equal(await store.readStatus("source"), VIBE64_SESSION_STATUS.RENEWAL_QUIESCED);
    assert.equal((await store.readCurrentSession()).sessionId, "source");
    assert.deepEqual(
      (await store.listSessions({ statusGroup: "open" })).map((session) => session.sessionId),
      ["source"]
    );
    assert.deepEqual(
      (await store.listSessionsForRenewal()).map((session) => session.sessionId),
      ["source"]
    );
    for (const operation of [
      () => store.mutateSession("source", async () => null),
      () => store.runSessionExclusive("source", "agent-write", async () => null),
      () => store.writeArtifact("source", "ordinary/value.txt", "no"),
      () => store.writeMetadataValue("source", "ordinary", "no"),
      () => store.writeStatus("source", VIBE64_SESSION_STATUS.ACTIVE)
    ]) {
      await assert.rejects(operation, {
        code: "vibe64_session_renewal_quiesced"
      });
    }
    assert.equal(
      (await store.quiesceSessionForRenewal({
        quiescedAt: "2026-08-24T00:02:00.000Z",
        renewalId: "renewal-quiesce",
        sourceSessionId: "source"
      })).metadata.renewal_quiesced_at,
      "2026-08-24T00:01:00.000Z"
    );
    await assert.rejects(
      () => store.quiesceSessionForRenewal({
        renewalId: "another-renewal",
        sourceSessionId: "source"
      }),
      { code: "vibe64_session_renewal_conflict" }
    );

    const restored = await store.restoreSessionAfterRenewalCancellation({
      renewalId: "renewal-quiesce",
      restoredAt: "2026-08-24T00:03:00.000Z",
      sourceSessionId: "source"
    });
    assert.equal(restored.status, VIBE64_SESSION_STATUS.ACTIVE);
    assert.equal(restored.metadata.renewal_restored_id, "renewal-quiesce");
    assert.equal(restored.metadata.renewal_restored_at, "2026-08-24T00:03:00.000Z");
    assert.equal(restored.metadata.renewal_quiesced_id, undefined);
    assert.equal(
      (await store.restoreSessionAfterRenewalCancellation({
        renewalId: "renewal-quiesce",
        restoredAt: "2026-08-24T00:04:00.000Z",
        sourceSessionId: "source"
      })).metadata.renewal_restored_at,
      "2026-08-24T00:03:00.000Z"
    );
  });
});

test("renewal quiescence repairs only its own status-first provenance barrier", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let interruptNextStatusWrite = true;
    const store = createStore(targetRoot, {
      async onRenewalQuiesceStep({ step }) {
        if (interruptNextStatusWrite && step === "status-written") {
          interruptNextStatusWrite = false;
          const error = new Error("Interrupted after quiesced status write");
          error.code = "simulated_quiesce_response_loss";
          throw error;
        }
      }
    });
    await store.createSession({ runtimeKind: "genesis", sessionId: "source" });
    await assert.rejects(
      () => store.quiesceSessionForRenewal({
        renewalId: "renewal-status-first",
        sourceSessionId: "source"
      }),
      { code: "simulated_quiesce_response_loss" }
    );
    const interrupted = await store.readSessionForRenewal("source");
    assert.equal(interrupted.status, VIBE64_SESSION_STATUS.RENEWAL_QUIESCED);
    assert.equal(interrupted.metadata.renewal_quiesced_id, undefined);

    const recovered = await store.quiesceSessionForRenewal({
      renewalId: "renewal-status-first",
      sourceSessionId: "source"
    });
    assert.equal(recovered.metadata.renewal_quiesced_id, "renewal-status-first");
    assert.ok(recovered.metadata.renewal_quiesced_at);
    assert.equal(
      (await store.restoreSessionAfterRenewalCancellation({
        renewalId: "renewal-status-first",
        sourceSessionId: "source"
      })).status,
      VIBE64_SESSION_STATUS.ACTIVE
    );

    interruptNextStatusWrite = true;
    await store.createSession({ runtimeKind: "genesis", sessionId: "foreign" });
    await assert.rejects(
      () => store.quiesceSessionForRenewal({
        renewalId: "renewal-owner",
        sourceSessionId: "foreign"
      }),
      { code: "simulated_quiesce_response_loss" }
    );
    const foreignPaths = store.paths("foreign");
    await writeFile(
      path.join(foreignPaths.metadataRoot, "renewal_quiesced_id"),
      "another-renewal\n",
      "utf8"
    );
    await assert.rejects(
      () => store.quiesceSessionForRenewal({
        renewalId: "renewal-owner",
        sourceSessionId: "foreign"
      }),
      { code: "vibe64_session_renewal_conflict" }
    );
    assert.equal(
      (await store.readSessionForRenewal("foreign")).metadata.renewal_quiesced_id,
      "another-renewal"
    );
  });
});

test("renewal discovery includes ordinary predecessor candidates after restart", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await store.createSession({ runtimeKind: "genesis", sessionId: "active" });
    await store.createSession({ runtimeKind: "genesis", sessionId: "blocked" });
    await store.writeStatus("blocked", VIBE64_SESSION_STATUS.BLOCKED);
    await store.createSession({ runtimeKind: "genesis", sessionId: "quiesced" });
    await store.quiesceSessionForRenewal({
      renewalId: "renewal-discovery",
      sourceSessionId: "quiesced"
    });
    await store.createRenewalPendingSession({
      actorId: "owner",
      confirmedAt: "2026-08-24T00:00:00.000Z",
      renewalId: "renewal-discovery",
      renewedFrom: "quiesced",
      runtimeKind: "genesis",
      sessionId: "successor"
    });

    const restarted = createStore(targetRoot);
    assert.deepEqual(
      (await restarted.listSessionsForRenewal()).map((session) => session.sessionId),
      ["active", "blocked", "quiesced", "successor"]
    );
  });
});

test("renewal successor creation ignores and removes incomplete unpublished staging trees", async (t) => {
  const crashBoundaries = [
    {
      name: "directory only",
      prepare: async () => null
    },
    {
      name: "after manifest",
      prepare: async (stagingPath) => {
        await writeFile(path.join(stagingPath, "session.json"), `${JSON.stringify({
          createdAt: "2026-08-24T01:00:00.000Z",
          product: "vibe64",
          revision: 1,
          schemaVersion: 2,
          sessionId: "renewal-successor",
          updatedAt: "2026-08-24T01:00:00.000Z"
        }, null, 2)}\n`, "utf8");
      }
    },
    {
      name: "after status",
      prepare: async (stagingPath) => {
        await writeFile(path.join(stagingPath, "session.json"), `${JSON.stringify({
          createdAt: "2026-08-24T01:00:00.000Z",
          product: "vibe64",
          revision: 1,
          schemaVersion: 2,
          sessionId: "renewal-successor",
          updatedAt: "2026-08-24T01:00:00.000Z"
        }, null, 2)}\n`, "utf8");
        await writeFile(
          path.join(stagingPath, "status"),
          `${VIBE64_SESSION_STATUS.RENEWAL_PENDING}\n`,
          "utf8"
        );
      }
    },
    {
      name: "after renewal metadata",
      prepare: async (stagingPath) => {
        await writeFile(path.join(stagingPath, "session.json"), `${JSON.stringify({
          createdAt: "2026-08-24T01:00:00.000Z",
          product: "vibe64",
          revision: 1,
          schemaVersion: 2,
          sessionId: "renewal-successor",
          updatedAt: "2026-08-24T01:00:00.000Z"
        }, null, 2)}\n`, "utf8");
        await writeFile(
          path.join(stagingPath, "status"),
          `${VIBE64_SESSION_STATUS.RENEWAL_PENDING}\n`,
          "utf8"
        );
        await mkdir(path.join(stagingPath, "metadata"), { recursive: true });
        await writeFile(
          path.join(stagingPath, "metadata", "renewal_id"),
          "renewal-atomic\n",
          "utf8"
        );
      }
    }
  ];

  for (const crashBoundary of crashBoundaries) {
    await t.test(crashBoundary.name, async () => {
      await withTemporaryRoot(async (targetRoot) => {
        const store = createStore(targetRoot);
        await store.createSession({
          runtimeKind: "genesis",
          sessionId: "renewal-source"
        });
        await store.quiesceSessionForRenewal({
          renewalId: "renewal-atomic",
          sourceSessionId: "renewal-source"
        });
        const stagingPath = path.join(
          store.paths().activeSessionsRoot,
          ".creating",
          `renewal-successor.stale-${crashBoundary.name.replaceAll(" ", "-")}`
        );
        await mkdir(stagingPath, { recursive: true });
        await crashBoundary.prepare(stagingPath);

        const successor = await store.createRenewalPendingSession({
          actorDisplayName: "Ada",
          actorId: "ada-owner",
          confirmedAt: "2026-08-24T01:01:00.000Z",
          renewalId: "renewal-atomic",
          renewedFrom: "renewal-source",
          runtimeKind: "genesis",
          sessionId: "renewal-successor",
          startedAt: "2026-08-24T01:00:00.000Z"
        });

        assert.equal(successor.status, VIBE64_SESSION_STATUS.RENEWAL_PENDING);
        assert.equal(successor.metadata.renewal_id, "renewal-atomic");
        await assert.rejects(
          () => store.readSession("renewal-successor"),
          { code: "vibe64_session_renewal_private" }
        );
        assert.deepEqual(
          (await store.listSessionsForRenewal()).map((session) => session.sessionId),
          ["renewal-source", "renewal-successor"]
        );
        await assert.rejects(() => access(stagingPath), { code: "ENOENT" });
      });
    });
  }
});

test("renewal records are private to explicit store APIs", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot, {
      projectSessionSourceRoot: targetRoot
    });
    const fixture = await createRenewalFixture(store);

    assert.equal(fixture.successor.status, VIBE64_SESSION_STATUS.RENEWAL_PENDING);
    assert.deepEqual(fixture.successor.metadata, {
      renewal_actor_display_name: "Ada",
      renewal_actor_id: "ada-owner",
      renewal_confirmed_at: "2026-08-24T01:01:00.000Z",
      renewal_id: fixture.renewalId,
      renewal_started_at: "2026-08-24T01:00:00.000Z",
      renewal_successor_created_at: fixture.successor.metadata.renewal_successor_created_at,
      renewed_from: fixture.sourceSessionId
    });
    assert.equal(
      (await store.readSessionForRenewal(fixture.successorSessionId)).status,
      VIBE64_SESSION_STATUS.RENEWAL_PENDING
    );
    assert.equal(
      await store.readStatusForRenewal(fixture.successorSessionId),
      VIBE64_SESSION_STATUS.RENEWAL_PENDING
    );
    assert.equal(
      await store.mutateSessionForRenewal(
        fixture.successorSessionId,
        async (sessionPaths) => {
          await store.writeArtifact(
            fixture.successorSessionId,
            "renewal/state.json",
            "private-state"
          );
          return sessionPaths.sessionId;
        }
      ),
      fixture.successorSessionId
    );
    assert.equal(
      await store.readArtifactForRenewal(
        fixture.successorSessionId,
        "renewal/state.json"
      ),
      "private-state"
    );
    await store.writeMetadataValueForRenewal(
      fixture.successorSessionId,
      "provider_seed",
      "ready"
    );
    assert.equal(
      (await store.readSessionForRenewal(fixture.successorSessionId)).metadata.provider_seed,
      "ready"
    );
    assert.deepEqual(
      (await store.listSessionsForRenewal()).map((session) => session.sessionId),
      [fixture.sourceSessionId, fixture.successorSessionId]
    );
    assert.equal((await store.createRenewalPendingSession({
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      confirmedAt: "2026-08-24T01:01:00.000Z",
      renewalId: fixture.renewalId,
      renewedFrom: fixture.sourceSessionId,
      runtimeKind: "genesis",
      sessionId: fixture.successorSessionId,
      startedAt: "2026-08-24T01:00:00.000Z"
    })).sessionId, fixture.successorSessionId);
    await assert.rejects(
      () => store.createRenewalPendingSession({
        actorId: "another-actor",
        confirmedAt: "2026-08-24T01:01:00.000Z",
        renewalId: fixture.renewalId,
        renewedFrom: fixture.sourceSessionId,
        runtimeKind: "genesis",
        sessionId: fixture.successorSessionId
      }),
      { code: "vibe64_session_renewal_conflict" }
    );
    await assert.rejects(
      () => store.createRenewalPendingSession({
        actorId: "ada-owner",
        confirmedAt: "2026-08-24T01:01:00.000Z",
        renewalId: "another-renewal",
        renewedFrom: fixture.sourceSessionId,
        runtimeKind: "genesis",
        sessionId: "another-successor"
      }),
      { code: "vibe64_session_renewal_conflict" }
    );

    for (const operation of [
      () => store.readSession(fixture.successorSessionId),
      () => store.readSessionSummary(fixture.successorSessionId),
      () => store.readStatus(fixture.successorSessionId),
      () => store.updateCurrentSession(fixture.successorSessionId),
      () => store.readManifest(fixture.successorSessionId),
      () => store.readMetadata(fixture.successorSessionId),
      () => store.readMetadataValue(fixture.successorSessionId, "renewal_id"),
      () => store.readSessionSourceDescriptor(fixture.successorSessionId),
      () => store.readArtifact(fixture.successorSessionId, "composer/draft.json"),
      () => store.readAgentRun(fixture.successorSessionId, "codex"),
      () => store.readAgentRuns(fixture.successorSessionId),
      () => store.readBackgroundTask(fixture.successorSessionId, "save-work"),
      () => store.readBackgroundTasks(fixture.successorSessionId),
      () => store.readConversationLog(fixture.successorSessionId),
      () => store.readConversationLogPage(fixture.successorSessionId),
      () => store.conversationMessageIdExists(fixture.successorSessionId, "message-1"),
      () => store.compactClosedSession(fixture.successorSessionId),
      () => store.mutateSession(fixture.successorSessionId, async () => null),
      () => store.runSessionExclusive(fixture.successorSessionId, "agent-write", async () => null),
      () => store.writeMetadataValue(fixture.successorSessionId, "test", "value"),
      () => store.writeSessionLabel(fixture.successorSessionId, "Private"),
      () => store.deleteMetadataValue(fixture.successorSessionId, "test"),
      () => store.deleteMetadataValues(fixture.successorSessionId, ["test"]),
      () => store.writeArtifact(fixture.successorSessionId, "test/value.txt", "value"),
      () => store.writeAgentRunEvent(fixture.successorSessionId, "codex", {}),
      () => store.writeBackgroundTaskEvent(fixture.successorSessionId, "save-work", {}),
      () => store.writeConversationUserMessage(fixture.successorSessionId, { text: "Hello" }),
      () => store.writeConversationAssistantMessage(fixture.successorSessionId, { text: "Hello" }),
      () => store.upsertConversationAssistantMessage(fixture.successorSessionId, {
        text: "Hello",
        turnId: "000001"
      }),
      () => store.writeConversationCommentaryMessage(fixture.successorSessionId, { text: "Hello" }),
      () => store.writeConversationThinkingMessage(fixture.successorSessionId, { text: "Hello" }),
      () => store.writeConversationSystemMessage(fixture.successorSessionId, { text: "Hello" })
    ]) {
      await assert.rejects(operation, {
        code: "vibe64_session_renewal_private"
      });
    }
    assert.deepEqual(
      await store.runSessionExclusiveForRenewal(
        fixture.successorSessionId,
        "agent-write",
        async () => "renewal-locked"
      ),
      {
        acquired: true,
        value: "renewal-locked"
      }
    );
    for (const options of [
      {},
      { statusGroup: "all" },
      { statusGroup: "open" },
      { statusGroup: "closed" },
      { statuses: [VIBE64_SESSION_STATUS.RENEWAL_PENDING] }
    ]) {
      const sessions = await store.listSessions(options);
      assert.equal(
        sessions.some((session) => session.sessionId === fixture.successorSessionId),
        false
      );
      const summaries = await store.listSessionSummaries(options);
      assert.equal(
        summaries.some((session) => session.sessionId === fixture.successorSessionId),
        false
      );
    }
    await assert.rejects(
      () => store.createSession({
        runtimeKind: "genesis",
        sessionId: "ordinary-hidden-create",
        status: VIBE64_SESSION_STATUS.RENEWAL_PENDING
      }),
      { code: "vibe64_session_renewal_transition_required" }
    );
    await assert.rejects(
      () => store.writeStatus(fixture.sourceSessionId, "renewing"),
      { code: "vibe64_invalid_session_status" }
    );
    await assert.rejects(
      () => store.writeStatus(fixture.successorSessionId, VIBE64_SESSION_STATUS.ACTIVE),
      { code: "vibe64_session_renewal_private" }
    );
  });
});

test("project renewal state stays mutable after the predecessor archive is committed", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const fixture = await createRenewalFixture(store);
    const initial = {
      renewalId: fixture.renewalId,
      revision: 7,
      sessionId: fixture.sourceSessionId,
      stage: "old_archiving"
    };
    await store.writeSessionRenewalStateRecord(fixture.sourceSessionId, initial);

    await store.transitionRenewalSuccessor({
      acknowledgedAt: "2026-08-24T01:03:00.000Z",
      renewalId: fixture.renewalId,
      sourceSessionId: fixture.sourceSessionId,
      successorSessionId: fixture.successorSessionId
    });
    await store.compactRenewedSession({
      renewalId: fixture.renewalId,
      sourceSessionId: fixture.sourceSessionId,
      successorSessionId: fixture.successorSessionId
    });
    await store.activateRenewalSuccessor(fixture);
    await store.commitRenewalArchive(fixture);

    assert.equal(
      JSON.parse(await store.readSessionRenewalStateRecord(fixture.sourceSessionId)).revision,
      7
    );
    assert.deepEqual(
      await store.listSessionRenewalStateSessionIds(),
      [fixture.sourceSessionId]
    );
    await store.runSessionRenewalStateExclusive(fixture.sourceSessionId, async () => {
      await store.writeSessionRenewalStateRecord(fixture.sourceSessionId, {
        ...initial,
        revision: 8,
        stage: "successor_activating"
      });
    });
    assert.deepEqual(
      JSON.parse(await store.readSessionRenewalStateRecord(fixture.sourceSessionId)),
      {
        ...initial,
        revision: 8,
        stage: "successor_activating"
      }
    );
    assert.equal(
      await store.readArtifactForRenewal(fixture.sourceSessionId, "renewal/state.json"),
      ""
    );
  });
});

test("pending renewal creation requires an active predecessor and complete provenance", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "source"
    });
    const base = {
      actorDisplayName: "Ada",
      actorId: "ada-owner",
      confirmedAt: "2026-08-24T01:01:00.000Z",
      renewalId: "renewal-validation",
      renewedFrom: "source",
      runtimeKind: "genesis",
      sessionId: "successor"
    };

    await assert.rejects(
      () => store.createRenewalPendingSession({
        ...base,
        actorId: ""
      }),
      { code: "vibe64_session_renewal_actor_required" }
    );
    await assert.rejects(
      () => store.createRenewalPendingSession({
        ...base,
        confirmedAt: ""
      }),
      { code: "vibe64_session_renewal_confirmation_required" }
    );
    await assert.rejects(
      () => store.createRenewalPendingSession({
        ...base,
        renewalId: "bad id"
      }),
      { code: "vibe64_invalid_session_renewal_id" }
    );
    await assert.rejects(
      () => store.createRenewalPendingSession({
        ...base,
        sessionId: "source"
      }),
      { code: "vibe64_session_renewal_same_session" }
    );
    await store.writeStatus("source", VIBE64_SESSION_STATUS.BLOCKED);
    await assert.rejects(
      () => store.createRenewalPendingSession(base),
      { code: "vibe64_session_renewal_source_not_quiesced" }
    );
  });
});

test("renewal handoff and private preparation preserve the predecessor projection until commit", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot, {
      projectSessionSourceRoot: targetRoot
    });
    const fixture = await createRenewalFixture(store);
    await store.updateCurrentSession(fixture.sourceSessionId);

    await assert.rejects(
      () => store.transitionRenewalSuccessor({
        renewalId: fixture.renewalId,
        sourceSessionId: fixture.sourceSessionId,
        successorSessionId: fixture.successorSessionId
      }),
      { code: "vibe64_session_renewal_acknowledgement_required" }
    );
    await store.transitionRenewalSuccessor({
      acknowledgedAt: "2026-08-24T01:03:00.000Z",
      renewedAt: "2026-08-24T01:04:00.000Z",
      renewalId: fixture.renewalId,
      sourceSessionId: fixture.sourceSessionId,
      successorSessionId: fixture.successorSessionId
    });

    const source = await store.readSessionForRenewal(fixture.sourceSessionId);
    const successor = await store.readSessionForRenewal(fixture.successorSessionId);
    assert.equal(source.status, VIBE64_SESSION_STATUS.RENEWAL_QUIESCED);
    assert.equal(successor.status, VIBE64_SESSION_STATUS.RENEWAL_PENDING);
    assert.equal(source.metadata.renewed_to, undefined);
    assert.equal(successor.metadata.renewed_from, fixture.sourceSessionId);
    assert.equal(source.metadata.renewal_actor_id, undefined);
    assert.equal(source.metadata.renewal_acknowledged_at, undefined);
    assert.equal(source.metadata.renewed_at, undefined);
    assert.equal((await store.readSession(fixture.sourceSessionId)).sessionId, fixture.sourceSessionId);
    await assert.rejects(
      () => store.activateRenewalSuccessor({
        renewalId: fixture.renewalId,
        sourceSessionId: fixture.sourceSessionId,
        successorSessionId: fixture.successorSessionId
      }),
      { code: "vibe64_session_renewal_archive_required" }
    );
    assert.equal(await store.readStatus(fixture.sourceSessionId), VIBE64_SESSION_STATUS.RENEWAL_QUIESCED);
    assert.deepEqual(
      (await store.listSessionsForRenewal()).map((session) => session.sessionId),
      [fixture.sourceSessionId, fixture.successorSessionId]
    );
    assert.deepEqual(
      (await store.listSessions({ statusGroup: "open" })).map((session) => session.sessionId),
      [fixture.sourceSessionId]
    );
    assert.equal((await store.readCurrentSession()).sessionId, fixture.sourceSessionId);

    await store.transitionRenewalSuccessor({
      acknowledgedAt: "2026-08-24T02:03:00.000Z",
      renewedAt: "2026-08-24T02:04:00.000Z",
      renewalId: fixture.renewalId,
      sourceSessionId: fixture.sourceSessionId,
      successorSessionId: fixture.successorSessionId
    });
    assert.equal(
      (await store.readSessionForRenewal(fixture.sourceSessionId)).status,
      VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
    );
    assert.equal(
      (await store.readSessionForRenewal(fixture.successorSessionId)).metadata.renewed_at,
      "2026-08-24T01:04:00.000Z"
    );
    const prepared = await store.compactRenewedSession(fixture);
    assert.equal(prepared.index.metadata.renewed_to, fixture.successorSessionId);
    await store.activateRenewalSuccessor(fixture);
    assert.equal(
      (await store.readSession(fixture.sourceSessionId)).status,
      VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
    );
    assert.equal(
      (await store.readSessionForRenewal(fixture.successorSessionId)).status,
      VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING
    );
    assert.deepEqual(
      (await store.listSessions({ statusGroup: "open" })).map((session) => session.sessionId),
      [fixture.sourceSessionId]
    );
    assert.equal((await store.readCurrentSession()).sessionId, fixture.sourceSessionId);
    await store.rollbackRenewalSuccessorActivation(fixture);
    assert.equal((await store.restoreRenewalClosingSession(fixture)).restored, true);
    await store.removeRenewalPendingSession({
      renewalId: fixture.renewalId,
      sessionId: fixture.successorSessionId
    });
    await store.restoreSessionAfterRenewalCancellation(fixture);
    assert.equal((await store.readSession(fixture.sourceSessionId)).status, VIBE64_SESSION_STATUS.ACTIVE);
    assert.equal((await store.readCurrentSession()).sessionId, fixture.sourceSessionId);
  });
});

test("renewal archive commit resumes every reachable closing-tree interruption", async (t) => {
  const metadataNames = [
    "renewal_acknowledged_at",
    "renewal_actor_display_name",
    "renewal_actor_id",
    "renewal_archived_at",
    "renewal_confirmed_at",
    "renewal_id",
    "renewal_started_at",
    "renewal_successor_created_at",
    "renewed_at",
    "renewed_to",
    "renewal_selected_before_archive"
  ];
  const scenarios = [
    { name: "after closing rename", step: "closing-renamed" },
    ...metadataNames.map((metadataName) => ({
      metadataName,
      name: `after ${metadataName} write`,
      step: "closing-metadata-written"
    })),
    { name: "after abandoned status write", step: "closing-status-written" }
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      await withTemporaryRoot(async (targetRoot) => {
        let interrupted = false;
        const store = createStore(targetRoot, {
          onRenewalArchiveCommitStep(input = {}) {
            if (
              !interrupted &&
              input.step === scenario.step &&
              (!scenario.metadataName || input.metadataName === scenario.metadataName)
            ) {
              interrupted = true;
              const error = new Error(`Interrupted ${scenario.name}`);
              error.code = "simulated_renewal_archive_commit_interruption";
              throw error;
            }
          },
          projectSessionSourceRoot: targetRoot
        });
        const fixture = await createRenewalFixture(store);
        await store.updateCurrentSession(fixture.sourceSessionId);
        await store.transitionRenewalSuccessor({
          acknowledgedAt: "2026-08-24T01:03:00.000Z",
          renewedAt: "2026-08-24T01:04:00.000Z",
          renewalId: fixture.renewalId,
          sourceSessionId: fixture.sourceSessionId,
          successorSessionId: fixture.successorSessionId
        });
        await store.compactRenewedSession(fixture);
        await store.activateRenewalSuccessor(fixture);
        await store.finalizeRenewalCurrentSession(fixture);

        await assert.rejects(
          () => store.commitRenewalArchive(fixture),
          { code: "simulated_renewal_archive_commit_interruption" }
        );
        assert.equal(interrupted, true);
        const interruptedPredecessor = await store.readSessionForRenewal(
          fixture.sourceSessionId
        );
        assert.equal(
          interruptedPredecessor.status,
          scenario.step === "closing-status-written"
            ? VIBE64_SESSION_STATUS.ABANDONED
            : VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
        );
        const sourcePaths = store.paths(fixture.sourceSessionId);
        const closingRoot = path.join(
          sourcePaths.closingSessionsRoot,
          fixture.sourceSessionId
        );
        await assert.rejects(access(sourcePaths.manifestPath));
        await access(path.join(closingRoot, "session.json"));

        const published = await store.commitRenewalArchive(fixture);
        assert.equal(published.sessionId, fixture.sourceSessionId);
        await store.commitRenewalSuccessor({
          committedAt: "2026-08-24T01:06:00.000Z",
          ...fixture
        });
        await store.commitRenewalCurrentSession(fixture);
        await store.finalizeRenewalArchiveCommit(fixture);

        assert.equal(
          (await store.readSessionForRenewal(fixture.sourceSessionId)).archived,
          true
        );
        assert.equal(
          (await store.readCurrentSession()).sessionId,
          fixture.successorSessionId
        );
        await assert.rejects(access(closingRoot));
        await assert.rejects(access(path.join(
          sourcePaths.closedSessionsRoot,
          ".renewals",
          fixture.sourceSessionId
        )));
        await assert.rejects(access(path.join(
          sourcePaths.closedSessionsRoot,
          ".renewals",
          ".publishing",
          fixture.sourceSessionId
        )));
      });
    });
  }
});

test("renewal restoration is idempotent before any private archive exists", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const fixture = await createRenewalFixture(store);
    const restored = await store.restoreRenewalClosingSession(fixture);
    assert.equal(restored.restored, false);
    assert.equal(restored.status, VIBE64_SESSION_STATUS.RENEWAL_QUIESCED);
    assert.equal((await store.readSession(fixture.sourceSessionId)).sessionId, fixture.sourceSessionId);
  });
});

test("pending renewal removal is exact, private, and idempotent", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const fixture = await createRenewalFixture(store);

    await assert.rejects(
      () => store.removeRenewalPendingSession({
        renewalId: "another-renewal",
        sessionId: fixture.successorSessionId
      }),
      { code: "vibe64_session_renewal_transition_invalid" }
    );
    const removed = await store.removeRenewalPendingSession({
      renewalId: fixture.renewalId,
      sessionId: fixture.successorSessionId
    });
    assert.deepEqual(removed, {
      removed: true,
      renewalId: fixture.renewalId,
      sessionId: fixture.successorSessionId
    });
    await assert.rejects(
      () => store.readSessionForRenewal(fixture.successorSessionId),
      { code: "vibe64_session_not_found" }
    );
    assert.deepEqual(await store.removeRenewalPendingSession({
      renewalId: fixture.renewalId,
      sessionId: fixture.successorSessionId
    }), {
      removed: false,
      renewalId: fixture.renewalId,
      sessionId: fixture.successorSessionId
    });
    await assert.rejects(
      () => store.removeRenewalPendingSession({
        renewalId: fixture.renewalId,
        sessionId: fixture.sourceSessionId
      }),
      { code: "vibe64_session_renewal_transition_invalid" }
    );
  });
});

test("activation rollback clears a partially written preparation marker", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const fixture = await createRenewalFixture(store);
    await store.writeMetadataValueForRenewal(
      fixture.successorSessionId,
      "renewal_activation_prepared_at",
      "2026-08-24T01:02:00.000Z"
    );

    const restored = await store.rollbackRenewalSuccessorActivation({
      renewalId: fixture.renewalId,
      sourceSessionId: fixture.sourceSessionId,
      successorSessionId: fixture.successorSessionId
    });

    assert.equal(restored.status, VIBE64_SESSION_STATUS.RENEWAL_PENDING);
    assert.equal(restored.metadata.renewal_activation_prepared_at, undefined);
    await assert.rejects(
      () => store.readSession(fixture.successorSessionId),
      { code: "vibe64_session_renewal_private" }
    );
  });
});

test("renewed session archives retain bounded handoff provenance", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const fixture = await createRenewalFixture(store);
    await store.writeMetadataValueForRenewal(
      fixture.sourceSessionId,
      "private_not_indexed",
      "do not list"
    );
    await store.transitionRenewalSuccessor({
      acknowledgedAt: "2026-08-24T01:03:00.000Z",
      renewedAt: "2026-08-24T01:04:00.000Z",
      renewalId: fixture.renewalId,
      sourceSessionId: fixture.sourceSessionId,
      successorSessionId: fixture.successorSessionId
    });
    await store.writeMetadataValueForRenewal(
      fixture.sourceSessionId,
      "renewal_archived_at",
      "2026-08-24T01:06:00.000Z"
    );
    const prepared = await store.compactRenewedSession({
      renewalId: fixture.renewalId,
      sourceSessionId: fixture.sourceSessionId,
      successorSessionId: fixture.successorSessionId
    });
    assert.deepEqual(
      (await store.listSessionsForRenewal()).map((session) => session.sessionId),
      [fixture.sourceSessionId, fixture.successorSessionId]
    );
    await commitPreparedRenewal(store, fixture);

    assert.deepEqual(
      (await store.listSessionsForRenewal()).map((session) => session.sessionId),
      [fixture.successorSessionId]
    );
    await store.writeMetadataValueForRenewal(
      fixture.successorSessionId,
      "renewal_finalized_at",
      "2026-08-24T01:07:00.000Z"
    );
    assert.deepEqual(
      (await store.listSessionsForRenewal()).map((session) => session.sessionId),
      [fixture.successorSessionId]
    );

    const closed = await store.listSessionSummaries({ statusGroup: "closed" });
    assert.equal(closed.length, 1);
    assert.equal(closed[0].sessionId, fixture.sourceSessionId);
    assert.deepEqual(closed[0].metadata, {
      renewal_acknowledged_at: "2026-08-24T01:03:00.000Z",
      renewal_actor_display_name: "Ada",
      renewal_actor_id: "ada-owner",
      renewal_archived_at: prepared.index.metadata.renewal_archived_at,
      renewal_confirmed_at: "2026-08-24T01:01:00.000Z",
      renewal_id: fixture.renewalId,
      renewal_quiesced_at: "2026-08-24T01:00:30.000Z",
      renewal_quiesced_id: fixture.renewalId,
      renewal_started_at: "2026-08-24T01:00:00.000Z",
      renewal_successor_created_at: closed[0].metadata.renewal_successor_created_at,
      renewed_at: "2026-08-24T01:04:00.000Z",
      renewed_to: fixture.successorSessionId
    });
    assert.equal(Object.hasOwn(closed[0].metadata, "private_not_indexed"), false);
    assert.equal((await store.readSession(fixture.sourceSessionId)).archived, true);
    assert.equal((await store.readSession(fixture.sourceSessionId)).archived, true);
  });
});

test("a renewal successor can later close normally and retains its predecessor link", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const fixture = await createRenewalFixture(store);
    await store.transitionRenewalSuccessor({
      acknowledgedAt: "2026-08-24T01:03:00.000Z",
      renewedAt: "2026-08-24T01:04:00.000Z",
      renewalId: fixture.renewalId,
      sourceSessionId: fixture.sourceSessionId,
      successorSessionId: fixture.successorSessionId
    });
    await store.compactRenewedSession({
      renewalId: fixture.renewalId,
      sourceSessionId: fixture.sourceSessionId,
      successorSessionId: fixture.successorSessionId
    });
    await commitPreparedRenewal(store, fixture);
    await store.writeMetadataValueForRenewal(
      fixture.successorSessionId,
      "renewal_finalized_at",
      "2026-08-24T01:06:00.000Z"
    );
    await store.writeMetadataValue(
      fixture.successorSessionId,
      "agent_renewal_seed_turn_id",
      "private-turn"
    );
    await store.writeStatus(fixture.successorSessionId, VIBE64_SESSION_STATUS.ABANDONED);

    await store.compactClosedSession(fixture.successorSessionId);

    const successor = (await store.listSessionSummaries({ statusGroup: "closed" }))
      .find((session) => session.sessionId === fixture.successorSessionId);
    assert.equal(successor.metadata.renewal_id, fixture.renewalId);
    assert.equal(successor.metadata.renewal_finalized_at, "2026-08-24T01:06:00.000Z");
    assert.equal(successor.metadata.renewed_from, fixture.sourceSessionId);
    assert.equal(successor.metadata.renewed_to, undefined);
    assert.equal(Object.hasOwn(successor.metadata, "agent_renewal_seed_turn_id"), false);
  });
});

test("a finalized successor can renew again but an unfinished successor cannot", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const first = await createRenewalFixture(store, {
      renewalId: "renewal-generation-1",
      sourceSessionId: "generation-1",
      successorSessionId: "generation-2"
    });
    await store.transitionRenewalSuccessor({
      acknowledgedAt: "2026-08-24T01:03:00.000Z",
      renewedAt: "2026-08-24T01:04:00.000Z",
      renewalId: first.renewalId,
      sourceSessionId: first.sourceSessionId,
      successorSessionId: first.successorSessionId
    });
    await store.compactRenewedSession({
      renewalId: first.renewalId,
      sourceSessionId: first.sourceSessionId,
      successorSessionId: first.successorSessionId
    });
    await commitPreparedRenewal(store, first);
    await assert.rejects(
      () => store.quiesceSessionForRenewal({
        quiescedAt: "2026-08-24T02:00:30.000Z",
        renewalId: "renewal-generation-2",
        sourceSessionId: first.successorSessionId
      }),
      { code: "vibe64_session_renewal_source_not_active" }
    );
    await store.writeMetadataValueForRenewal(
      first.successorSessionId,
      "renewal_finalized_at",
      "2026-08-24T01:06:00.000Z"
    );
    await store.quiesceSessionForRenewal({
      quiescedAt: "2026-08-24T02:00:30.000Z",
      renewalId: "renewal-generation-2",
      sourceSessionId: first.successorSessionId
    });

    const second = await store.createRenewalPendingSession({
      actorDisplayName: "Bea",
      actorId: "bea-owner",
      confirmedAt: "2026-08-24T02:01:00.000Z",
      renewalId: "renewal-generation-2",
      renewedFrom: first.successorSessionId,
      runtimeKind: "genesis",
      sessionId: "generation-3",
      startedAt: "2026-08-24T02:00:00.000Z"
    });

    await store.transitionRenewalSuccessor({
      acknowledgedAt: "2026-08-24T02:03:00.000Z",
      renewedAt: "2026-08-24T02:04:00.000Z",
      renewalId: "renewal-generation-2",
      sourceSessionId: first.successorSessionId,
      successorSessionId: second.sessionId
    });

    const middle = await store.readSessionForRenewal(first.successorSessionId);
    assert.equal(middle.status, VIBE64_SESSION_STATUS.RENEWAL_QUIESCED);
    assert.equal(middle.metadata.renewal_id, first.renewalId);
    assert.equal(middle.metadata.renewal_finalized_at, "2026-08-24T01:06:00.000Z");
    assert.equal(middle.metadata.renewed_at, "2026-08-24T01:04:00.000Z");
    assert.equal(middle.metadata.renewed_from, first.sourceSessionId);
    assert.equal(middle.metadata.renewed_to, undefined);

    const secondPrepared = await store.compactRenewedSession({
      renewalId: "renewal-generation-2",
      sourceSessionId: first.successorSessionId,
      successorSessionId: second.sessionId
    });
    assert.equal(secondPrepared.index.metadata.renewal_id, "renewal-generation-2");
    assert.equal(secondPrepared.index.metadata.renewed_to, second.sessionId);
    await commitPreparedRenewal(store, {
      renewalId: "renewal-generation-2",
      sourceSessionId: first.successorSessionId,
      successorSessionId: second.sessionId
    }, {
      committedAt: "2026-08-24T02:06:00.000Z"
    });
    await store.writeMetadataValueForRenewal(
      second.sessionId,
      "renewal_finalized_at",
      "2026-08-24T02:06:00.000Z"
    );

    const archivedMiddle = (await store.listSessionSummaries({ statusGroup: "closed" }))
      .find((session) => session.sessionId === first.successorSessionId);
    assert.equal(archivedMiddle.metadata.renewal_id, "renewal-generation-2");
    assert.equal(archivedMiddle.metadata.renewed_from, first.sourceSessionId);
    assert.equal(archivedMiddle.metadata.renewed_to, second.sessionId);
    assert.deepEqual(
      (await store.listSessionsForRenewal()).map((session) => session.sessionId),
      [second.sessionId]
    );
  });
});

test("plain session store keeps generic artifacts without workflow readiness state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "artifacts"
    });

    await store.writeArtifact("artifacts", "composer/draft.json", "draft");

    assert.equal(await store.readArtifact("artifacts", "composer/draft.json"), "draft");
    assert.equal(Object.hasOwn(await store.readSession("artifacts"), "artifactReadiness"), false);
  });
});

test("plain session store serializes metadata mutations", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "metadata"
    });

    await Promise.all([
      store.writeMetadataValue("metadata", "first", "one"),
      store.writeMetadataValue("metadata", "second", "two")
    ]);
    const session = await store.readSession("metadata");

    assert.equal(session.metadata.first, "one");
    assert.equal(session.metadata.second, "two");
    assert.equal(session.revision, 3);
  });
});

test("plain session store persists paged conversation messages", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "conversation"
    });
    await store.writeConversationUserMessage("conversation", {
      text: "Add search."
    });
    await store.writeConversationAssistantMessage("conversation", {
      text: "I’ll add it."
    });

    const page = await store.readConversationLogPage("conversation", {
      limit: 10
    });
    assert.equal(page.conversationLog.length, 1);
    assert.equal(page.conversationLog[0].user.text, "Add search.");
    assert.equal(page.conversationLog[0].assistant.text, "I’ll add it.");
    assert.equal(page.pagination.hasMoreBefore, false);
  });
});

test("plain session store deduplicates durable system messages by message id", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "conversation-system-dedupe"
    });
    const first = await store.writeConversationSystemMessage("conversation-system-dedupe", {
      messageId: "codex-turn-outcome-fixed",
      text: "Codex was interrupted."
    });
    const duplicate = await store.writeConversationSystemMessage("conversation-system-dedupe", {
      messageId: "codex-turn-outcome-fixed",
      text: "Codex was interrupted."
    });

    assert.equal(first.system.messageId, "codex-turn-outcome-fixed");
    assert.equal(duplicate, null);
    const conversationLog = await store.readConversationLog("conversation-system-dedupe");
    assert.equal(conversationLog.length, 1);
    assert.equal(conversationLog[0].system.text, "Codex was interrupted.");

    await store.writeStatus("conversation-system-dedupe", VIBE64_SESSION_STATUS.ABANDONED);
    await store.compactClosedSession("conversation-system-dedupe");
    const archivedLog = await store.readConversationLog("conversation-system-dedupe");
    assert.equal(archivedLog.length, 1);
    assert.equal(archivedLog[0].system.messageId, "codex-turn-outcome-fixed");
  });
});

test("plain session store gives one durable user turn to one message id", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "conversation-user-dedupe"
    });
    const first = await store.writeConversationUserMessage("conversation-user-dedupe", {
      messageId: "message_tab_test_one_1",
      text: "Apply the fix."
    });
    const duplicate = await store.writeConversationUserMessage("conversation-user-dedupe", {
      messageId: "message_tab_test_one_1",
      text: "Apply the fix."
    });

    assert.equal(first.user.messageId, "message_tab_test_one_1");
    assert.equal(duplicate, null);
    assert.equal(await store.conversationMessageIdExists(
      "conversation-user-dedupe",
      "message_tab_test_one_1"
    ), true);
    const conversationLog = await store.readConversationLog("conversation-user-dedupe");
    assert.equal(conversationLog.length, 1);
  });
});

test("plain session store keeps immutable actor and AI policy attribution on each user turn", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "conversation-attribution"
    });
    const first = await store.writeConversationUserMessage("conversation-attribution", {
      messageId: "message_attribution_1",
      text: "Build the first screen.",
      turnMetadata: {
        actorDisplayName: "Ada",
        actorId: "ada",
        policyRevision: 2,
        policyVersion: 1
      }
    });
    await store.writeConversationAssistantMessage("conversation-attribution", {
      text: "Done."
    });
    const second = await store.writeConversationUserMessage("conversation-attribution", {
      messageId: "message_attribution_2",
      text: "Now add search.",
      turnMetadata: {
        actorDisplayName: "Grace",
        actorId: "grace",
        policyRevision: 3,
        policyVersion: 1
      }
    });

    assert.deepEqual(first.metadata, {
      actorDisplayName: "Ada",
      actorId: "ada",
      policyRevision: 2,
      policyVersion: 1
    });
    assert.deepEqual(second.metadata, {
      actorDisplayName: "Grace",
      actorId: "grace",
      policyRevision: 3,
      policyVersion: 1
    });
    const reloaded = await createStore(targetRoot).readConversationLog("conversation-attribution");
    assert.deepEqual(reloaded.map((turn) => turn.metadata), [first.metadata, second.metadata]);
  });
});

test("plain session store archives closed sessions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    await store.createSession({
      runtimeKind: "genesis",
      sessionId: "closed"
    });
    await store.writeStatus("closed", VIBE64_SESSION_STATUS.ABANDONED);
    await store.compactClosedSession("closed");

    const session = await store.readSession("closed");
    assert.equal(session.archived, true);
    assert.equal(session.status, VIBE64_SESSION_STATUS.ABANDONED);
    assert.equal(session.manifest.runtimeKind, "genesis");
  });
});

test("plain session store bounds durable background-task events at write time", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const sessionId = "bounded-background-task";
    await store.createSession({
      runtimeKind: "genesis",
      sessionId
    });
    for (let index = 0; index < 220; index += 1) {
      await store.writeBackgroundTaskEvent(sessionId, "checkpoint", {
        event: {
          kind: "checkpoint",
          message: `checkpoint ${index}`
        },
        patch: {
          status: "ready"
        }
      });
    }
    const task = await store.readBackgroundTask(sessionId, "checkpoint");
    assert.equal(task.events.length, 200);
    assert.equal(task.events[0].message, "checkpoint 20");
    assert.equal(task.events.at(-1).message, "checkpoint 219");
  });
});

test("plain session store starts a fresh background-task attempt when requested", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const sessionId = "retried-background-task";
    await store.createSession({
      runtimeKind: "genesis",
      sessionId
    });
    await store.writeBackgroundTaskEvent(sessionId, "save-work", {
      event: {
        kind: "save-failed",
        message: "Old failure.",
        status: "failed"
      },
      patch: {
        code: "old_failure",
        error: "Old failure.",
        operationId: "old-attempt",
        status: "failed"
      }
    });

    await store.writeBackgroundTaskEvent(sessionId, "save-work", {
      event: {
        kind: "save-started",
        message: "Saving session work.",
        status: "running"
      },
      patch: {
        operationId: "new-attempt",
        status: "running"
      },
      reset: true
    });

    const task = await store.readBackgroundTask(sessionId, "save-work");
    assert.equal(task.operationId, "new-attempt");
    assert.equal(task.status, "running");
    assert.equal(Object.hasOwn(task, "code"), false);
    assert.equal(task.error, "");
    assert.deepEqual(task.events.map((event) => event.message), ["Saving session work."]);
  });
});

test("plain session store finalizes a background task's visible summary", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const store = createStore(targetRoot);
    const sessionId = "finalized-background-task";
    await store.createSession({
      runtimeKind: "genesis",
      sessionId
    });
    await store.writeBackgroundTaskEvent(sessionId, "save-work", {
      event: {
        kind: "reconcile",
        message: "Reconciling the session onto the saved commit.",
        status: "running"
      },
      patch: {
        kind: "reconcile",
        message: "Reconciling the session onto the saved commit.",
        stage: "reconciling",
        status: "running"
      }
    });
    await store.writeBackgroundTaskEvent(sessionId, "save-work", {
      event: {
        kind: "saved",
        message: "Session work was saved.",
        status: "ready"
      },
      patch: {
        saveCommit: "saved-commit",
        status: "ready"
      }
    });

    const task = await store.readBackgroundTask(sessionId, "save-work");
    assert.equal(task.kind, "saved");
    assert.equal(task.message, "Session work was saved.");
    assert.equal(task.status, "ready");
    assert.equal(Object.hasOwn(task, "stage"), false);
  });
});
