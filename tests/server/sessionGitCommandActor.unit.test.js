import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  recordSessionGitCommandActor
} from "../../packages/vibe64-terminals/src/server/sessionGitCommandActor.js";

function githubSession() {
  return {
    metadata: {
      source_remote_url: "https://github.com/example/project.git"
    },
    sessionId: "session-1"
  };
}

function actorRuntime(metadata) {
  return {
    store: {
      async mutateSession(_sessionId, operation) {
        return operation();
      },
      async writeMetadataValue(_sessionId, name, value) {
        metadata[name] = value;
      }
    }
  };
}

test("session Git actor changes only when a new turn explicitly replaces it", async () => {
  const metadata = githubSession().metadata;
  const runtime = actorRuntime(metadata);
  const environment = {
    VIBE64_GITHUB_ACCOUNT_MODE: "user"
  };
  const first = await recordSessionGitCommandActor({
    env: environment,
    runtime,
    session: githubSession(),
    sourceRoot: "/project",
    vibe64User: { username: "merc" }
  });
  assert.equal(first.session.metadata.session_git_command_actor_user_key, "merc");

  const currentSession = {
    ...githubSession(),
    metadata: { ...metadata }
  };
  const preserved = await recordSessionGitCommandActor({
    env: environment,
    runtime,
    session: currentSession,
    sourceRoot: "/project",
    vibe64User: { username: "geoff" }
  });
  assert.equal(preserved.session.metadata.session_git_command_actor_user_key, "merc");

  const replaced = await recordSessionGitCommandActor({
    env: environment,
    overwrite: true,
    runtime,
    session: currentSession,
    sourceRoot: "/project",
    vibe64User: { username: "geoff" }
  });
  assert.equal(replaced.session.metadata.session_git_command_actor_user_key, "geoff");
});

test("new assistant turns explicitly replace the session Git actor", async () => {
  const [codexSource, openCodeSource] = await Promise.all([
    readFile(path.resolve("packages/vibe64-terminals/src/server/codexTerminal.js"), "utf8"),
    readFile(path.resolve("packages/vibe64-terminals/src/server/opencodeTerminal.js"), "utf8")
  ]);
  assert.match(
    codexSource,
    /recordSessionGitCommandActor\(\{\s*env,\s*overwrite: true,\s*reason: "codex-prompt"/u
  );
  assert.match(
    openCodeSource,
    /recordGitActor\(\{\s*env,\s*overwrite: !currentMonitor,\s*reason: "agent-message"/u
  );
});

test("native OpenCode terminal input preserves the actor from the latest UI turn", async () => {
  const source = await readFile(path.resolve("packages/vibe64-terminals/src/server/opencodeTerminal.js"), "utf8");
  assert.match(
    source,
    /recordGitActor\(\{\s*env,\s*overwrite: false,\s*reason: "opencode-terminal-input"/u
  );
});
