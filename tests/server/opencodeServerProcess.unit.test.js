import assert from "node:assert/strict";
import test from "node:test";

import {
  startSupervisedProcess
} from "../../packages/vibe64-execution/src/server/index.js";

import {
  OPENCODE_ECONOMY_AGENT_ID,
  safeOpenCodeEnvironment
} from "../../packages/vibe64-terminals/src/server/opencodeServerProcess.js";

test("OpenCode process environment is minimal and injects Vibe64's deny-all helper agent", () => {
  const env = safeOpenCodeEnvironment({
    ANTHROPIC_API_KEY: "must-not-leak",
    DEEPSEEK_API_KEY: "must-not-leak",
    LANG: "en_AU.UTF-8",
    OPENCODE_CONFIG_CONTENT: '{"agent":{"vibe64-economy":{"permission":"allow"}}}',
    PATH: "/usr/bin",
    RANDOM_APPLICATION_SECRET: "must-not-leak"
  }, {
    cacheRoot: "/private/cache",
    dbPath: "/state/opencode.sqlite",
    managedEnv: {
      PATH: "/must/not/replace/path",
      VIBE64_AGENT_ENV_SOCKET: "/run/vibe64/agent.sock",
      VIBE64_GIT_COMMAND_SOCKET: "/run/vibe64/git.sock"
    },
    password: "loopback-password",
    privateRoot: "/private/session",
    shimDirs: ["relative-shim", "/managed/shims"]
  });

  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
  assert.equal(env.RANDOM_APPLICATION_SECRET, undefined);
  assert.equal(env.LANG, "en_AU.UTF-8");
  assert.equal(env.PATH, "/managed/shims:/usr/bin");
  assert.equal(env.VIBE64_AGENT_ENV_SOCKET, "/run/vibe64/agent.sock");
  assert.equal(env.VIBE64_GIT_COMMAND_SOCKET, "/run/vibe64/git.sock");
  assert.equal(env.OPENCODE_DB, "/state/opencode.sqlite");
  assert.equal(env.OPENCODE_SERVER_PASSWORD, "loopback-password");
  assert.equal(env.OPENCODE_PURE, "1");

  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
  assert.deepEqual(config.agent[OPENCODE_ECONOMY_AGENT_ID], {
    description: "Vibe64 bounded helper turns without tools.",
    hidden: true,
    mode: "primary",
    permission: { "*": "deny" }
  });
});

test("OpenCode child cleanup terminates its detached process group", async () => {
  const supervised = await startSupervisedProcess({
    args: [
      "--input-type=module",
      "--eval",
      "setInterval(() => {}, 1000)"
    ],
    command: process.execPath,
    env: process.env,
    stopTimeoutMs: 2_000
  });
  const result = await supervised.stop();
  assert.equal(result.exited, true);
  assert.equal(result.signal, "SIGTERM");
});
