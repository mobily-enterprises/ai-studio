import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import test from "node:test";

import {
  AiStudioSessionRuntime,
  TargetAdapter,
  adapterProjectFacts
} from "../../server/lib/aiStudio/index.js";
import {
  createService
} from "../../packages/ai-studio-terminals/src/server/service.js";
import {
  codexTerminalArgs
} from "../../packages/ai-studio-terminals/src/server/codexTerminal.js";
import {
  resolveShellTerminalCwd,
  shellTerminalArgs
} from "../../packages/ai-studio-terminals/src/server/shellTerminal.js";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE,
  STUDIO_TOOL_HOME_BIN_PATH,
  STUDIO_TOOL_HOME_NPM_PREFIX,
  STUDIO_TOOL_HOME_PATH
} from "../../server/lib/studioRuntimeIdentity.js";
import {
  runtimeNetworkName
} from "../../server/lib/aiStudio/runtimeContainers.js";
import { withTemporaryRoot } from "./aiStudioTestHelpers.js";

async function waitForExitedTerminal(service, sessionId, terminalSessionId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const snapshot = service.readCommandTerminal(sessionId, terminalSessionId);
    if (snapshot.status === "exited") {
      return snapshot;
    }
    await delay(25);
  }
  return service.readCommandTerminal(sessionId, terminalSessionId);
}

class UnitCommandAdapter extends TargetAdapter {
  constructor() {
    super({
      id: "unit",
      label: "Unit adapter"
    });
  }

  async inspect() {
    return adapterProjectFacts({
      capabilities: {
        unit_command: true
      },
      commands: [
        {
          id: "unit_command",
          label: "Unit command"
        }
      ],
      summary: "Unit adapter"
    });
  }

  async listCommands({ facts = {} } = {}) {
    return facts.commands || [];
  }

  async createCommandTerminalSpec(_commandId, context = {}) {
    return {
      args: [
        "-lc",
        [
          "set -e",
          "printf 'fact:set\\t%s\\t%s\\n' dynamic_done \"$(printf '%s' from-result-file | base64 | tr -d '\\n')\" >> \"$AI_STUDIO_COMMAND_RESULT_FILE\""
        ].join("\n")
      ],
      applySuccessFacts({ facts }) {
        return {
          deleteMetadata: ["stale_value"],
          metadata: {
            dynamic_done: facts.dynamic_done
          }
        };
      },
      command: "bash",
      commandPreview: "bash command result",
      cwd: context.session?.targetRoot,
      ok: true,
      successMessage: "Unit command completed.",
      successMetadata: {
        terminal_done: "yes"
      }
    };
  }
}

test("AI Studio Codex terminal joins the target runtime network before the image", () => {
  const targetRoot = "/workspace/project";
  const args = codexTerminalArgs({
    codexThreadId: "",
    containerName: "ai-studio-codex-unit",
    sessionId: "unit-session",
    targetRoot,
    terminalId: "unit-terminal",
    worktree: "/workspace/project/.ai-studio/sessions/active/unit/worktree"
  });

  const networkIndex = args.indexOf("--network");
  assert.notEqual(networkIndex, -1);
  assert.deepEqual(args.slice(networkIndex, networkIndex + 2), ["--network", runtimeNetworkName(targetRoot)]);
  assert.ok(networkIndex < args.indexOf(STUDIO_BASE_TOOLCHAIN_IMAGE));

  const startupScript = args.at(-1);
  assert.ok(startupScript.includes(`export HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(startupScript.includes(`export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.ok(startupScript.includes(`export PATH=${STUDIO_TOOL_HOME_BIN_PATH}:$PATH`));
  assert.match(startupScript, /chown -R "\$AI_STUDIO_HOST_UID:\$AI_STUDIO_HOST_GID" "\$HOME"/u);
  assert.ok(args.includes(`NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
});

test("AI Studio shell terminal joins the target runtime network before the image", () => {
  const targetRoot = "/workspace/project";
  const worktree = "/workspace/project/.ai-studio/sessions/active/unit/worktree";
  const args = shellTerminalArgs({
    containerName: "ai-studio-shell-unit",
    env: {
      AI_STUDIO_CONFIG_DIR: "/workspace/project/.ai-studio/config"
    },
    sessionId: "unit-session",
    target: "worktree",
    targetRoot,
    terminalId: "unit-terminal",
    workdir: worktree
  });

  const networkIndex = args.indexOf("--network");
  assert.notEqual(networkIndex, -1);
  assert.deepEqual(args.slice(networkIndex, networkIndex + 2), ["--network", runtimeNetworkName(targetRoot)]);
  assert.ok(networkIndex < args.indexOf(STUDIO_BASE_TOOLCHAIN_IMAGE));
  assert.deepEqual(args.slice(args.indexOf("-w"), args.indexOf("-w") + 2), ["-w", worktree]);
  assert.deepEqual(args.slice(args.indexOf("--hostname"), args.indexOf("--hostname") + 2), [
    "--hostname",
    "ai-studio-worktree"
  ]);
  assert.ok(args.includes("AI_STUDIO_CONFIG_DIR=/workspace/project/.ai-studio/config"));
  assert.ok(args.includes("TERM=xterm-256color"));
  assert.ok(args.includes("COLORTERM=truecolor"));
  assert.ok(args.includes("FORCE_COLOR=1"));
  assert.ok(args.includes("USER=studio"));
  assert.ok(args.includes("AI_STUDIO_PROJECT_ROOT=/workspace/project"));
  assert.ok(args.includes(`AI_STUDIO_SHELL_WORKDIR=${worktree}`));
  assert.ok(args.some((arg) => String(arg).startsWith("AI_STUDIO_SHELL_PROMPT=\\[\\e[38;5;39m\\]studio")));
  assert.ok(args.some((arg) => String(arg).startsWith("PS1=\\[\\e[38;5;39m\\]studio")));

  const startupScript = args.at(-1);
  assert.ok(startupScript.includes(`export HOME=${STUDIO_TOOL_HOME_PATH}`));
  assert.ok(startupScript.includes(`export NPM_CONFIG_PREFIX=${STUDIO_TOOL_HOME_NPM_PREFIX}`));
  assert.ok(startupScript.includes(`export PATH=${STUDIO_TOOL_HOME_BIN_PATH}:$PATH`));
  assert.ok(startupScript.includes("PROMPT_DIRTRIM=4"));
  assert.ok(startupScript.includes("alias ls='ls --color=auto'"));
  assert.ok(startupScript.includes("PS1=\"${AI_STUDIO_SHELL_PROMPT:-\\w \\$ }\""));
  assert.match(startupScript, /chown -R "\$AI_STUDIO_HOST_UID:\$AI_STUDIO_HOST_GID" "\$HOME"/u);
  assert.match(startupScript, /setpriv .* bash --rcfile \/tmp\/ai-studio-shell\.bashrc -i/u);
});

test("AI Studio command terminal records action results and metadata after success", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new UnitCommandAdapter(),
      clock: () => new Date("2026-05-16T01:02:03.000Z"),
      targetRoot,
      workflow: {
        id: "unit-terminal",
        steps: [
          {
            actions: [
              {
                adapterCapability: "unit_command",
                id: "unit_command",
                label: "Unit command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      metadata: {
        stale_value: "delete me"
      },
      sessionId: "terminal_success"
    });

    const service = createService({
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        },
        async projectConfigEnvironment() {
          return {
            AI_STUDIO_CONFIG_DIR: path.join(targetRoot, ".ai-studio", "config")
          };
        }
      }
    });

    const terminal = await service.startCommandTerminal("terminal_success", {
      actionId: "unit_command",
      input: {
        dryRun: true
      }
    });
    assert.equal(terminal.ok, true);

    const exited = await waitForExitedTerminal(service, "terminal_success", terminal.id);
    assert.equal(exited.status, "exited");
    assert.equal(exited.exitCode, 0);

    const updatedSession = await runtime.getSession("terminal_success");
    assert.equal(updatedSession.metadata.terminal_done, "yes");
    assert.equal(updatedSession.metadata.dynamic_done, "from-result-file");
    assert.equal(updatedSession.metadata.stale_value, undefined);
    assert.deepEqual(updatedSession.actionResult, undefined);
    assert.deepEqual(updatedSession.actionResults.map((result) => ({
      actionId: result.actionId,
      input: result.input,
      message: result.message,
      metadata: result.metadata,
      status: result.status
    })), [
      {
        actionId: "unit_command",
        input: {
          dryRun: true
        },
        message: "Unit command completed.",
        metadata: {
          dynamic_done: "from-result-file",
          terminal_done: "yes"
        },
        status: "completed"
      }
    ]);
    assert.deepEqual(await runtime.store.readCommandLog("terminal_success"), [
      {
        actionId: "unit_command",
        actionLabel: "Unit command",
        actionType: "command",
        at: "2026-05-16T01:02:03.000Z",
        kind: "terminal-action",
        status: "completed",
        stepId: "unit_step"
      }
    ]);
  });
});

test("AI Studio command terminal refuses prompt actions and disabled command actions", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-terminal-blocked",
        steps: [
          {
            actions: [
              {
                id: "unit_prompt",
                label: "Unit prompt",
                type: "prompt"
              },
              {
                adapterCapability: "missing_capability",
                id: "blocked_command",
                label: "Blocked command",
                type: "command"
              }
            ],
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "terminal_blocked"
    });
    const service = createService({
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const prompt = await service.startCommandTerminal("terminal_blocked", {
      actionId: "unit_prompt"
    });
    assert.equal(prompt.ok, false);
    assert.match(prompt.error, /does not run in the command terminal/u);

    const disabled = await service.startCommandTerminal("terminal_blocked", {
      actionId: "blocked_command"
    });
    assert.equal(disabled.ok, false);
    assert.match(disabled.error, /does not support capability/u);
  });
});

test("AI Studio shell terminal resolves only declared session targets", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const worktreePath = path.join(targetRoot, ".ai-studio", "sessions", "active", "shell_success", "worktree");
    const session = {
      metadata: {
        worktree_path: worktreePath
      },
      targetRoot
    };
    await mkdir(worktreePath, {
      recursive: true
    });

    const worktree = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session,
      target: "worktree"
    });
    assert.equal(worktree.ok, true);
    assert.equal(worktree.cwd, worktreePath);

    const main = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session,
      target: "main"
    });
    assert.equal(main.ok, true);
    assert.equal(main.cwd, path.resolve(targetRoot));

    const outside = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session: {
        metadata: {
          worktree_path: "/tmp/outside"
        },
        targetRoot
      },
      target: "worktree"
    });
    assert.equal(outside.ok, false);
    assert.match(outside.error, /outside the target root/u);
  });
});

test("AI Studio shell terminal blocks unavailable worktree targets", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const missingWorktree = await resolveShellTerminalCwd({
      projectService: {
        targetRoot
      },
      session: {
        metadata: {},
        targetRoot
      },
      target: "worktree"
    });
    assert.equal(missingWorktree.ok, false);
    assert.match(missingWorktree.error, /Create the session worktree/u);
  });
});

test("AI Studio shell terminal service rejects invalid targets before Docker startup", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtime = new AiStudioSessionRuntime({
      adapter: new UnitCommandAdapter(),
      targetRoot,
      workflow: {
        id: "unit-shell-invalid",
        steps: [
          {
            id: "unit_step",
            label: "Unit step"
          }
        ]
      }
    });
    await runtime.createSession({
      sessionId: "shell_invalid"
    });
    const service = createService({
      projectService: {
        targetRoot,
        async createRuntime() {
          return runtime;
        }
      }
    });

    const invalid = await service.startShellTerminal("shell_invalid", {
      target: "/tmp"
    });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /worktree or main/u);
  });
});
