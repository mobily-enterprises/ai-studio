import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  Vibe64SessionEnvironment
} from "../../packages/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js";

test("OpenCode binds shell commands to the exact upstream Vibe64 session", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-opencode-session-environment-"));
  const registryPath = path.join(temporaryRoot, "sessions.json");
  const previousRegistry = process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY;
  try {
    await writeFile(registryPath, JSON.stringify({
      sessions: [{
        env: {
          VIBE64_AGENT_SESSION_COMMAND_WRAPPER: "/managed/session-command"
        },
        upstreamSessionId: "upstream-session-1",
        workdir: "/managed/sessions/session-1/source"
      }]
    }));
    process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY = registryPath;
    const plugin = await Vibe64SessionEnvironment();
    const command = "/usr/bin/google-chrome --headless https://example.test &";
    const output = {
      args: { command }
    };

    await plugin["tool.execute.before"]({
      sessionID: "upstream-session-1",
      tool: "bash"
    }, output);

    const encoded = Buffer.from(command, "utf8").toString("base64url");
    assert.equal(output.args.command, `'/managed/session-command' '${encoded}'`);

    const unknown = {
      args: { command: "pwd" }
    };
    await plugin["tool.execute.before"]({
      sessionID: "another-session",
      tool: "bash"
    }, unknown);
    assert.match(unknown.args.command, /vibe64_agent_control_unavailable/u);
    assert.match(unknown.args.command, /exit 126/u);
  } finally {
    if (previousRegistry === undefined) {
      delete process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY;
    } else {
      process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY = previousRegistry;
    }
    await rm(temporaryRoot, { force: true, recursive: true });
  }
});
