import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
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
  managedSessionSourceRoot,
  projectRuntimeRoot,
  sourceMetadata,
  sourcePath,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

test("session runtime never derives private state from a project context path", () => {
  assert.throws(
    () => new Vibe64SessionRuntime({
      projectContextRoot: "/var/lib/vibe64/merc/projects/example"
    }),
    (error) => error?.code === "vibe64_project_runtime_root_required"
  );
});

test("plain runtime creates a Genesis session and awaits source materialization", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const calls = [];
    const runtime = new Vibe64SessionRuntime({
      createSessionSource: async ({ session, store, vibe64User }) => {
        calls.push({
          sessionId: session.sessionId,
          vibe64User
        });
        const metadata = sourceMetadata(targetRoot, session.sessionId);
        await mkdir(metadata.source_path, {
          recursive: true
        });
        await Promise.all(Object.entries(metadata).map(([name, value]) => (
          store.writeMetadataValue(session.sessionId, name, value)
        )));
      },
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });

    const created = await runtime.createSession({
      sessionId: "plain-session",
      sourceContext: {
        vibe64User: {
          username: "ada"
        }
      }
    });

    assert.deepEqual(calls, [{
      sessionId: "plain-session",
      vibe64User: {
        username: "ada"
      }
    }]);
    assert.equal(created.companion.id, "genesis");
    assert.equal(created.sourcePath, sourcePath(targetRoot, "plain-session"));
    assert.equal(created.sourceReady, true);
    assert.equal(Object.hasOwn(created, "standaloneSourceRoot"), false);
    assert.equal(Object.hasOwn(created, "targetRoot"), false);
    assert.deepEqual(created.workspaceSetup, {
      currentLabel: "",
      diagnostic: "",
      finishedAt: "",
      recipeHash: "",
      startedAt: "",
      status: "unconfigured",
      transcript: "",
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

test("plain runtime rejects a standalone authority folder presented as session source", async () => {
  await withTemporaryRoot(async (standaloneSourceRoot) => {
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: standaloneSourceRoot,
      projectRuntimeRoot: projectRuntimeRoot(standaloneSourceRoot)
    });
    await assert.rejects(runtime.createSession({
      metadata: {
        repository_mode: "local_source",
        source_path: standaloneSourceRoot
      },
      sessionId: "standalone-session"
    }), (error) => error?.code === "vibe64_session_source_creator_required");
  });
});

test("plain runtime exposes compact workspace setup state without leaking its storage field", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
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
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
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
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });

    await assert.rejects(
      () => runtime.createSession({ sessionId: "missing-source" }),
      { code: "vibe64_session_source_creator_required" }
    );
    const blocked = await runtime.store.readSession("missing-source");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.metadata.source_creation_failed, "yes");
    assert.deepEqual(
      (await runtime.listSessionSummaries({ statusGroup: "open" })).map((session) => session.sessionId),
      ["missing-source"]
    );
  });
});

test("prompt rendering never falls back to a project context directory", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    let rendered = false;
    await mkdir(path.join(targetRoot, ".git"), {
      recursive: true
    });
    const runtime = new Vibe64SessionRuntime({
      promptRenderer() {
        rendered = true;
        return {};
      },
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await runtime.store.createSession({
      runtimeKind: "genesis",
      sessionId: "namespace-only"
    });

    await assert.rejects(
      () => runtime.renderPrompt("namespace-only", {
        request: "Inspect this project."
      }),
      { code: "vibe64_session_source_required" }
    );
    assert.equal(rendered, false);
  });
});

test("plain runtime excludes open state records whose managed source no longer exists", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
    });
    await runtime.store.createSession({
      metadata: sourceMetadata(targetRoot, "ghost-session"),
      runtimeKind: "genesis",
      sessionId: "ghost-session"
    });

    assert.deepEqual(await runtime.listSessionSummaries({ statusGroup: "open" }), []);
    assert.deepEqual(await runtime.listSessions({ statusGroup: "open" }), []);
  });
});

test("a blocked session whose source creation failed can be closed and archived", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const projectSessionSourceRoot = managedSessionSourceRoot(targetRoot);
    const failedSourcePath = sourcePath(targetRoot, "failed-source");
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot),
      projectSessionSourceRoot,
    });

    await assert.rejects(
      () => runtime.createSession({ sessionId: "failed-source" }),
      { code: "vibe64_session_source_creator_required" }
    );
    await mkdir(failedSourcePath, {
      recursive: true
    });

    const closed = await runtime.abandonSession("failed-source");
    assert.equal(closed.status, "abandoned");
    assert.equal(closed.archived, true);
    assert.deepEqual(await runtime.listSessions({ statusGroup: "open" }), []);
    await assert.rejects(() => access(failedSourcePath));
  });
});

test("plain runtime hides sessions using an unsupported runtime record", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new Vibe64SessionRuntime({
      projectContextRoot: targetRoot,
      projectRuntimeRoot: projectRuntimeRoot(targetRoot)
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
