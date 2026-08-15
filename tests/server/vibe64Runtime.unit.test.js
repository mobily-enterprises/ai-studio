import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import test from "node:test";

import {
  Vibe64SessionRuntime
} from "@local/vibe64-runtime/server";
import {
  WORKSPACE_SETUP_METADATA_NAME,
  writeWorkspaceSetupState
} from "@local/vibe64-runtime/server/workspaceSetupState";
import {
  renderTestGenesisPrompt,
  sourceMetadata,
  sourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

test("plain runtime creates a Genesis session and awaits source materialization", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const calls = [];
    const runtime = new Vibe64SessionRuntime({
      createSessionSource: async ({ session, store }) => {
        calls.push(session.sessionId);
        const metadata = sourceMetadata(targetRoot, session.sessionId);
        await mkdir(metadata.source_path, {
          recursive: true
        });
        await Promise.all(Object.entries(metadata).map(([name, value]) => (
          store.writeMetadataValue(session.sessionId, name, value)
        )));
      },
      targetRoot
    });

    const created = await runtime.createSession({
      sessionId: "plain-session"
    });

    assert.deepEqual(calls, ["plain-session"]);
    assert.equal(created.companion.id, "genesis");
    assert.equal(created.sourcePath, sourcePath(targetRoot, "plain-session"));
    assert.equal(created.sourceReady, true);
    assert.deepEqual(created.workspaceSetup, {
      currentLabel: "",
      diagnostic: "",
      finishedAt: "",
      recipeHash: "",
      startedAt: "",
      status: "unconfigured",
      updatedAt: ""
    });
    assert.equal(Object.hasOwn(created, "actions"), false);
    assert.equal(Object.hasOwn(created, "agentTask"), false);
    assert.equal(Object.hasOwn(created, "artifactReadiness"), false);
    assert.equal(Object.hasOwn(created, "artifactsRoot"), false);
    assert.equal(Object.hasOwn(created, "commandLifecycles"), false);
    assert.equal(Object.hasOwn(created, "currentStep"), false);
    assert.equal(Object.hasOwn(created, "reportPath"), false);
    assert.equal(Object.hasOwn(created, "workflow"), false);
  });
});

test("plain runtime exposes compact workspace setup state without leaking its storage field", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({ targetRoot });
    await runtime.createSession({
      metadata: sourceMetadata(targetRoot, "setup-state-session"),
      sessionId: "setup-state-session"
    });
    await writeWorkspaceSetupState(runtime.store, "setup-state-session", {
      currentLabel: "Install dependencies",
      recipeHash: "sha256:recipe",
      startedAt: "2026-08-15T01:00:00.000Z",
      status: "running",
      updatedAt: "2026-08-15T01:00:00.000Z"
    });

    const session = await runtime.getSession("setup-state-session", {
      inspectSource: false
    });
    assert.equal(session.workspaceSetup.status, "running");
    assert.equal(session.workspaceSetup.currentLabel, "Install dependencies");
    assert.equal(Object.hasOwn(session.metadata, WORKSPACE_SETUP_METADATA_NAME), false);
  });
});

test("plain runtime uses Genesis onboarding for the first user turn, then ordinary work", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      promptRenderer: renderTestGenesisPrompt,
      targetRoot
    });
    await runtime.createSession({
      metadata: sourceMetadata(targetRoot, "prompt-session"),
      sessionId: "prompt-session"
    });

    const firstPrompt = await runtime.renderPrompt("prompt-session", {
      request: "Add book search.",
      task: "work"
    });

    assert.deepEqual(firstPrompt.context, {
      genesis: true,
      task: "start"
    });
    assert.match(firstPrompt.prompt, /Test Genesis prompt for start/u);

    await runtime.writeConversationUserMessage("prompt-session", {
      text: "Build a book catalogue."
    });
    const nextPrompt = await runtime.renderPrompt("prompt-session", {
      request: "Use JSKIT.",
      task: "work"
    });
    assert.equal(nextPrompt.context.task, "work");
  });
});

test("plain runtime refuses to return a session without chat-ready source", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({ targetRoot });

    await assert.rejects(
      () => runtime.createSession({ sessionId: "missing-source" }),
      { code: "vibe64_session_source_creator_required" }
    );
    const blocked = await runtime.store.readSession("missing-source");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.metadata.source_creation_failed, "yes");
  });
});

test("plain runtime hides sessions using an unsupported runtime record", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      targetRoot
    });
    await runtime.store.createSession({
      runtimeKind: "obsolete-runtime",
      sessionId: "old-session"
    });

    await assert.rejects(
      () => runtime.getSession("old-session"),
      { code: "vibe64_session_runtime_unsupported" }
    );
    assert.deepEqual(await runtime.listSessions(), []);
  });
});
