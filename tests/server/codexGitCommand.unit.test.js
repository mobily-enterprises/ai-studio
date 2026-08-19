import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  currentOsUser
} from "@local/vibe64-core/server/osUserIdentity";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  createCodexGitCommandService,
  prepareCodexGitCommand
} from "@local/vibe64-terminals/server/codexGitCommand";
import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

process.env[VIBE64_RUNTIME_NAMESPACE_ENV] = "unit-owner";

const SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES = Object.freeze([
  "base_commit",
  "canonical_commit",
  "repository_mode",
  "source",
  "source_kind",
  "source_path",
  "source_path_authority",
  "source_removed"
]);

function runProcessWithInput(command, args = [], {
  cwd = "",
  env = process.env,
  input = ""
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      resolve({ exitCode, signal, stderr, stdout });
    });
    child.stdin.end(input);
  });
}

function sessionSource(root = "", sessionId = "session-1", metadata = {}) {
  const sourcePath = path.join(root, "managed", "sessions", "active", sessionId, "source");
  return {
    id: sessionId,
    metadata: {
      source_kind: "session_clone",
      source_path: sourcePath,
      source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED,
      ...metadata
    },
    sessionId,
    targetRoot: path.join(root, "project")
  };
}

function githubSession(root = "", sessionId = "github-session") {
  const user = currentOsUser();
  const session = sessionSource(root, sessionId, {
    github_repository: "owner/repo",
    source_remote_url: "https://github.com/owner/repo.git"
  });
  Object.assign(session.metadata, {
    session_git_command_actor_reason: "unit-test",
    session_git_command_actor_scope: "user",
    session_git_command_actor_session_id: sessionId,
    session_git_command_actor_target_root: session.metadata.source_path,
    session_git_command_actor_thread_id: "thread-1",
    session_git_command_actor_user_key: user.username,
    session_git_command_actor_workdir: session.metadata.source_path
  });
  return session;
}

function serviceForSession(session = {}, {
  authorizeActorAccess = null,
  metadataReads = null,
  runGatewayCommand
} = {}) {
  return createCodexGitCommandService({
    authorizeActorAccess,
    projectService: {
      async createSessionStore() {
        return {
          async readMetadataValue(sessionId, name) {
            assert.equal(sessionId, session.sessionId);
            metadataReads?.push(name);
            return session.metadata?.[name] || "";
          },
          async readSessionSourceDescriptor(sessionId) {
            assert.equal(sessionId, session.sessionId);
            return {
              metadata: Object.fromEntries(
                SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES.map((name) => [
                  name,
                  session.metadata?.[name] || ""
                ])
              ),
              sessionId,
              targetRoot: session.targetRoot
            };
          }
        };
      }
    },
    runGatewayCommand
  });
}

test("Codex runs local Git inside the managed session source", async () => {
  await withTemporaryRoot(async (root) => {
    const session = sessionSource(root);
    await mkdir(session.metadata.source_path, { recursive: true });
    let gatewayCall = null;
    const metadataReads = [];
    const service = serviceForSession(session, {
      metadataReads,
      authorizeActorAccess: async () => {
        throw new Error("Local Git must not require GitHub authorization.");
      },
      async runGatewayCommand(request) {
        gatewayCall = request;
        return {
          exitCode: 0,
          ok: true,
          stdout: "clean"
        };
      }
    });

    const result = await service.run({
      args: ["status", "--porcelain"],
      command: "git",
      sessionId: session.sessionId
    });

    assert.equal(result.ok, true);
    assert.equal(result.stdout, "clean");
    assert.equal(gatewayCall.actor, "app");
    assert.equal(gatewayCall.command, "git");
    assert.deepEqual(gatewayCall.args, ["status", "--porcelain"]);
    assert.equal(gatewayCall.cwd, session.metadata.source_path);
    assert.equal(gatewayCall.gitTransport, "none");
    assert.equal(gatewayCall.purpose, "codex");
    assert.equal(gatewayCall.session.sessionId, session.sessionId);
    assert.ok(metadataReads.includes("github_repository"));
    assert.ok(metadataReads.includes("source_remote_url"));
  });
});

test("Codex recognizes a GitHub session from its source remote URL", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    delete session.metadata.github_repository;
    await mkdir(session.metadata.source_path, { recursive: true });
    const gatewayCalls = [];
    const service = serviceForSession(session, {
      async runGatewayCommand(request) {
        gatewayCalls.push(request);
        return request.command === "gh"
          ? {
              exitCode: 0,
              ok: true,
              stdout: "secret-github-token\n"
            }
          : {
              exitCode: 0,
              ok: true,
              stdout: "fetched"
            };
      }
    });

    const result = await service.run({
      args: ["fetch", "origin", "main"],
      command: "git",
      sessionId: session.sessionId
    });

    assert.equal(result.ok, true);
    assert.equal(gatewayCalls.length, 2);
    assert.equal(gatewayCalls[0].command, "gh");
    assert.equal(gatewayCalls[1].command, "git");
    assert.equal(gatewayCalls[1].gitTransport, "github-token");
    assert.equal(gatewayCalls[1].gitAuthToken, "secret-github-token");
  });
});

test("Codex Git wrapper transports the complete command request", async () => {
  await withTemporaryRoot(async (root) => {
    const sessionId = "wrapper-session";
    const sourcePath = path.join(root, "source");
    await mkdir(sourcePath, { recursive: true });
    const calls = [];
    const prepared = await prepareCodexGitCommand({
      commandService: {
        async run(input) {
          calls.push(input);
          return {
            exitCode: 0,
            ok: true,
            stderr: "",
            stdout: "transport-ok\n"
          };
        }
      },
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments")
      },
      sessionId,
      stateRoot: path.join(root, "state")
    });

    const result = await runProcessWithInput(
      path.join(prepared.hostWrapperDir, "git"),
      ["status", "--short"],
      {
        cwd: sourcePath,
        env: {
          ...process.env,
          ...prepared.env
        },
        input: "stdin payload"
      }
    );

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "transport-ok\n");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].command, "git");
    assert.deepEqual(calls[0].args, ["status", "--short"]);
    assert.equal(calls[0].cwd, sourcePath);
    assert.equal(Buffer.from(calls[0].inputBase64, "base64").toString("utf8"), "stdin payload");
    assert.equal(calls[0].sessionId, sessionId);
  });
});

test("Codex Git command preparation preserves unchanged wrappers", async () => {
  await withTemporaryRoot(async (root) => {
    const options = {
      commandService: {
        async run() {
          return {
            exitCode: 0,
            ok: true,
            stdout: ""
          };
        }
      },
      env: {
        VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments")
      },
      sessionId: "stable-wrapper-session",
      stateRoot: path.join(root, "state")
    };

    const first = await prepareCodexGitCommand(options);
    const firstGit = await stat(path.join(first.hostWrapperDir, "git"));
    const firstGh = await stat(path.join(first.hostWrapperDir, "gh"));
    const second = await prepareCodexGitCommand(options);
    const secondGit = await stat(path.join(second.hostWrapperDir, "git"));
    const secondGh = await stat(path.join(second.hostWrapperDir, "gh"));

    assert.equal(second.hostWrapperDir, first.hostWrapperDir);
    assert.equal(secondGit.mtimeMs, firstGit.mtimeMs);
    assert.equal(secondGh.mtimeMs, firstGh.mtimeMs);
  });
});

test("Codex rejects gh for a non-GitHub session", async () => {
  await withTemporaryRoot(async (root) => {
    const session = sessionSource(root);
    const service = serviceForSession(session, {
      async runGatewayCommand() {
        throw new Error("Non-GitHub gh must not run.");
      }
    });

    const result = await service.run({
      args: ["auth", "status"],
      command: "gh",
      sessionId: session.sessionId
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_git_command_github_unavailable");
    assert.equal(result.statusCode, 403);
  });
});

test("Codex keeps local Git filesystem work on the daemon identity", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    await mkdir(session.metadata.source_path, { recursive: true });
    const gatewayCalls = [];
    const service = serviceForSession(session, {
      async runGatewayCommand(request) {
        gatewayCalls.push(request);
        return {
          exitCode: 0,
          ok: true,
          stdout: "staged"
        };
      }
    });

    const result = await service.run({
      args: ["add", "-A"],
      command: "git",
      sessionId: session.sessionId
    });

    const user = currentOsUser();
    assert.equal(result.ok, true);
    assert.equal(gatewayCalls.length, 1);
    assert.equal(gatewayCalls[0].actor, "app");
    assert.equal(gatewayCalls[0].gitTransport, "none");
    assert.equal(gatewayCalls[0].gitAuthToken, "");
    assert.equal(gatewayCalls[0].userKey, user.username);
    assert.equal(gatewayCalls[0].project.ownerUserKey, user.username);
  });
});

test("Codex separates GitHub authorization from the Git filesystem identity", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    await mkdir(session.metadata.source_path, { recursive: true });
    const gatewayCalls = [];
    const service = serviceForSession(session, {
      async runGatewayCommand(request) {
        gatewayCalls.push(request);
        if (request.command === "gh") {
          return {
            exitCode: 0,
            ok: true,
            stdout: "secret-github-token\n"
          };
        }
        return {
          exitCode: 0,
          ok: true,
          stdout: "remote"
        };
      }
    });

    const result = await service.run({
      args: ["ls-remote", "origin"],
      command: "git",
      inputBase64: Buffer.from("stdin").toString("base64"),
      sessionId: session.sessionId
    });

    const user = currentOsUser();
    assert.equal(result.ok, true);
    assert.equal(gatewayCalls.length, 2);
    assert.equal(gatewayCalls[0].actor, "owner-user");
    assert.equal(gatewayCalls[0].command, "gh");
    assert.deepEqual(gatewayCalls[0].args, ["auth", "token"]);
    assert.equal(gatewayCalls[0].cwd, user.home);
    assert.equal(gatewayCalls[0].purpose, "github-api");
    assert.equal(gatewayCalls[0].session.targetRoot, undefined);
    assert.equal(gatewayCalls[1].actor, "app");
    assert.equal(gatewayCalls[1].command, "git");
    assert.equal(gatewayCalls[1].gitTransport, "github-token");
    assert.equal(gatewayCalls[1].gitAuthToken, "secret-github-token");
    assert.equal(gatewayCalls[1].input.toString("utf8"), "stdin");
    assert.equal(gatewayCalls[1].userKey, user.username);
    assert.equal(gatewayCalls[1].project.ownerUserKey, user.username);
    assert.equal(gatewayCalls[1].session.metadata.session_git_command_actor_user_key, user.username);
  });
});

test("Codex reports the underlying GitHub token lookup failure", async () => {
  await withTemporaryRoot(async (root) => {
    const session = githubSession(root);
    await mkdir(session.metadata.source_path, { recursive: true });
    const service = serviceForSession(session, {
      async runGatewayCommand() {
        return {
          exitCode: 2,
          ok: false,
          stderr: "GitHub token lookup failed in the user home."
        };
      }
    });

    const result = await service.run({
      args: ["fetch", "origin", "main"],
      command: "git",
      sessionId: session.sessionId
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "vibe64_codex_git_command_github_auth_unavailable");
    assert.equal(result.error, "GitHub token lookup failed in the user home.");
  });
});
