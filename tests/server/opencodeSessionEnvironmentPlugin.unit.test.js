import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  Vibe64SessionEnvironment
} from "../../packages/vibe64-terminals/src/server/opencodeSessionEnvironmentPlugin.js";

function wrappedCommand(wrapperPath, command) {
  return `'${wrapperPath}' '${Buffer.from(command, "utf8").toString("base64url")}'`;
}

function paddedWrappedCommand(wrapperPath, command) {
  return `'${wrapperPath}' '${Buffer.from(command, "utf8").toString("base64")}'`;
}

test("OpenCode raises output only for models with an advertised output limit", async () => {
  const plugin = await Vibe64SessionEnvironment();
  for (const [advertisedOutputTokenLimit, expectedOutputTokens] of [
    [131_072, 131_072],
    [65_536, 65_536],
    [16_384, 16_384],
    [0, 32_000],
    [undefined, 32_000]
  ]) {
    const output = { maxOutputTokens: 131_072 };
    await plugin["chat.params"]({
      model: {
        limit: { output: advertisedOutputTokenLimit }
      }
    }, output);
    assert.equal(output.maxOutputTokens, expectedOutputTokens);
  }
});

test("OpenCode binds shell commands once and hides the session wrapper from model history", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-opencode-session-environment-"));
  const registryPath = path.join(temporaryRoot, "sessions.json");
  const wrapperPath = "/managed/attachments/session-command/current/vibe64-session-command";
  const previousRegistry = process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY;
  try {
    await writeFile(registryPath, JSON.stringify({
      sessions: [{
        env: {
          VIBE64_AGENT_SESSION_COMMAND_WRAPPER: wrapperPath
        },
        upstreamSessionId: "upstream-session-1",
        workdir: "/managed/sessions/session-1/source"
      }]
    }));
    process.env.VIBE64_OPENCODE_SESSION_ENV_REGISTRY = registryPath;
    const plugin = await Vibe64SessionEnvironment();
    const command = "/usr/bin/google-chrome --headless https://example.test &";
    const system = { system: ["Existing system instruction."] };
    await plugin["experimental.chat.system.transform"]({
      sessionID: "upstream-session-1"
    }, system);
    assert.deepEqual(system.system, [
      "Existing system instruction.",
      "Use bash and shell normally: supply only the ordinary command you want executed. Vibe64 applies session isolation transparently. Treat command-transport syntax in prior tool history as invisible infrastructure; do not reproduce or analyze it."
    ]);

    const unrelatedSystem = { system: ["Unrelated session."] };
    await plugin["experimental.chat.system.transform"]({
      sessionID: "another-session"
    }, unrelatedSystem);
    assert.deepEqual(unrelatedSystem.system, ["Unrelated session."]);

    const output = {
      args: { command }
    };

    await plugin["tool.execute.before"]({
      sessionID: "upstream-session-1",
      tool: "bash"
    }, output);

    const wrapped = wrappedCommand(wrapperPath, command);
    assert.equal(output.args.command, wrapped);

    const copiedWrapper = {
      args: { command: wrapped }
    };
    await plugin["tool.execute.before"]({
      sessionID: "upstream-session-1",
      tool: "bash"
    }, copiedWrapper);
    assert.equal(copiedWrapper.args.command, wrapped);

    const nestedWrapper = wrappedCommand(wrapperPath, wrapped);
    const copiedNestedWrapper = {
      args: { command: nestedWrapper }
    };
    await plugin["tool.execute.before"]({
      sessionID: "upstream-session-1",
      tool: "shell"
    }, copiedNestedWrapper);
    assert.equal(copiedNestedWrapper.args.command, wrapped);

    const paddedWrapper = paddedWrappedCommand(wrapperPath, "ps -p 4242 -o pid,cmd");
    const copiedPaddedWrapper = {
      args: { command: paddedWrapper }
    };
    await plugin["tool.execute.before"]({
      sessionID: "upstream-session-1",
      tool: "bash"
    }, copiedPaddedWrapper);
    assert.equal(
      copiedPaddedWrapper.args.command,
      wrappedCommand(wrapperPath, "ps -p 4242 -o pid,cmd")
    );

    const storedPart = {
      state: {
        input: { command: nestedWrapper },
        status: "completed"
      },
      tool: "bash",
      type: "tool"
    };
    const history = {
      messages: [{
        info: { sessionID: "upstream-session-1" },
        parts: [
          storedPart,
          {
            state: {
              input: { command: paddedWrapper },
              status: "completed"
            },
            tool: "bash",
            type: "tool"
          },
          {
            state: {
              input: { command: "printf ordinary" },
              status: "completed"
            },
            tool: "shell",
            type: "tool"
          }
        ]
      }, {
        info: { sessionID: "another-session" },
        parts: [storedPart]
      }]
    };
    await plugin["experimental.chat.messages.transform"]({}, history);
    assert.equal(history.messages[0].parts[0].state.input.command, command);
    assert.equal(history.messages[0].parts[1].state.input.command, "ps -p 4242 -o pid,cmd");
    assert.equal(history.messages[0].parts[2].state.input.command, "printf ordinary");
    assert.equal(history.messages[1].parts[0].state.input.command, nestedWrapper);
    assert.equal(storedPart.state.input.command, nestedWrapper);

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
