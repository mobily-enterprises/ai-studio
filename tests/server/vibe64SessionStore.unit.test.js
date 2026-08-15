import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_SESSION_STATUS,
  assertVibe64SessionStatus,
  createVibe64SessionStore
} from "@local/vibe64-runtime/server";
import {
  projectRuntimeRoot,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

function createStore(targetRoot, options = {}) {
  return createVibe64SessionStore({
    projectLocalRoot: projectRuntimeRoot(targetRoot),
    targetRoot,
    ...options
  });
}

test("plain session status has no workflow completion state", () => {
  assert.deepEqual(VIBE64_SESSION_STATUS, {
    ABANDONED: "abandoned",
    ACTIVE: "active",
    BLOCKED: "blocked"
  });
  assert.throws(
    () => assertVibe64SessionStatus("finished"),
    (error) => error?.code === "vibe64_invalid_session_status"
  );
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
      projectLocalRoot: projectRuntimeRoot(targetRoot),
      projectSessionSourceRoot: targetRoot,
      targetRoot
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
