import assert from "node:assert/strict";
import test from "node:test";

import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "../../packages/vibe64-core/src/server/sessionSourcePath.js";
import {
  codexTerminalNamespace,
  globalCodexTerminalNamespace,
  launchTargetTerminalNamespace,
  sessionTerminalCwd,
  terminalSessionSourceRoot
} from "../../packages/vibe64-terminals/src/server/terminalShared.js";

test("Vibe64 terminal namespaces include the active project scope", async () => {
  const globalNamespace = codexTerminalNamespace("session-1");

  const alpha = await runWithProjectRequestContext({
    slug: "alpha_1",
    targetRoot: "/tmp/vibe64/alpha_1"
  }, () => ({
    codex: codexTerminalNamespace("session-1"),
    globalCodex: globalCodexTerminalNamespace(),
    launch: launchTargetTerminalNamespace("session-1")
  }));

  const beta = await runWithProjectRequestContext({
    slug: "beta-2",
    targetRoot: "/tmp/vibe64/beta-2"
  }, () => ({
    codex: codexTerminalNamespace("session-1"),
    globalCodex: globalCodexTerminalNamespace(),
    launch: launchTargetTerminalNamespace("session-1")
  }));

  assert.equal(globalNamespace, "vibe64-codex:global:session-1");
  assert.equal(alpha.codex, "vibe64-codex:project:alpha_1:session-1");
  assert.equal(alpha.globalCodex, "vibe64-global-codex:project:alpha_1");
  assert.equal(alpha.launch, "vibe64-launch-target:project:alpha_1:session-1");
  assert.notEqual(alpha.codex, beta.codex);
  assert.notEqual(alpha.globalCodex, beta.globalCodex);
  assert.notEqual(alpha.launch, beta.launch);
});

test("Vibe64 terminal roots prefer the selected session source path", () => {
  const sourcePath = "/tmp/vibe64/managed-source/sessions/active/session-1/source";
  const session = {
    metadata: {
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
    },
    sessionId: "session-1",
    targetRoot: "/var/lib/vibe64/merc/projects/demo"
  };
  const projectService = {
    targetRoot: "/var/lib/vibe64/merc/projects/demo"
  };

  assert.equal(
    sessionTerminalCwd(session, projectService),
    sourcePath
  );
  assert.equal(
    terminalSessionSourceRoot(session),
    sourcePath
  );
});

test("Vibe64 terminal roots never fall back to the hosted namespace", () => {
  const hostedNamespace = "/var/lib/vibe64/merc/projects/demo";
  const session = {
    sessionId: "session-without-source",
    targetRoot: hostedNamespace
  };
  const projectService = {
    currentProjectSourceRoot() {
      return "";
    },
    currentTargetRoot() {
      return hostedNamespace;
    },
    targetRoot: hostedNamespace
  };

  assert.equal(sessionTerminalCwd(session, projectService), "");
  assert.equal(terminalSessionSourceRoot(session), "");
});
