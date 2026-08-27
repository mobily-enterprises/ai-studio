import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  startSupervisedProcess
} from "../../packages/vibe64-execution/src/server/index.js";

import {
  OPENCODE_ECONOMY_AGENT_ID,
  OPENCODE_EXPECTED_VERSION,
  createOpenCodeServerProcess,
  openCodeInlineConfig,
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
  assert.equal(config.snapshot, false);
});

test("OpenCode forces Z.AI API and Coding Plan through distinct canonical billing routes", () => {
  const standard = JSON.parse(openCodeInlineConfig({
    canonicalUrl: "https://api.z.ai/api/paas/v4",
    modelProviderId: "zai"
  }));
  const codingPlan = JSON.parse(openCodeInlineConfig({
    canonicalUrl: "https://api.z.ai/api/coding/paas/v4",
    modelProviderId: "zai-coding-plan"
  }));

  assert.deepEqual(Object.keys(standard.provider), ["zai"]);
  assert.equal(
    standard.provider.zai.options.baseURL,
    "https://api.z.ai/api/paas/v4"
  );
  assert.deepEqual(Object.keys(codingPlan.provider), ["zai-coding-plan"]);
  assert.equal(
    codingPlan.provider["zai-coding-plan"].options.baseURL,
    "https://api.z.ai/api/coding/paas/v4"
  );
  assert.notDeepEqual(standard.provider, codingPlan.provider);
});

test("OpenCode route configuration contains one provider and no inherited provider keys", () => {
  const env = safeOpenCodeEnvironment({
    ANTHROPIC_API_KEY: "must-not-leak",
    DEEPSEEK_API_KEY: "must-not-leak",
    OPENAI_API_KEY: "must-not-leak",
    ZHIPU_API_KEY: "must-not-leak"
  }, {
    canonicalUrl: "https://api.z.ai/api/coding/paas/v4",
    dbPath: "/state/opencode.sqlite",
    modelProviderId: "zai-coding-plan",
    password: "loopback-password",
    privateRoot: "/private/session"
  });
  const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT);

  assert.deepEqual(Object.keys(config.provider), ["zai-coding-plan"]);
  assert.equal(
    config.provider["zai-coding-plan"].options.baseURL,
    "https://api.z.ai/api/coding/paas/v4"
  );
  for (const name of [
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "ZHIPU_API_KEY"
  ]) {
    assert.equal(env[name], undefined);
  }
  assert.equal(JSON.stringify(env).includes("must-not-leak"), false);
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

test("OpenCode servers run and drain through one managed execution id", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-opencode-managed-"));
  const privateRoot = path.join(root, "private");
  const requests = [];
  const stops = [];
  const executionId = "11111111-1111-4111-8111-111111111111";
  t.after(() => rm(root, { force: true, recursive: true }));

  const server = await createOpenCodeServerProcess({
    commandRunner: async (request) => {
      requests.push(request);
      return {
        execution: { ...request.execution, id: executionId },
        ok: true,
        pid: 4242
      };
    },
    dbPath: path.join(root, "state", "opencode.db"),
    env: {
      ANTHROPIC_API_KEY: "must-not-leak",
      LANG: "en_AU.UTF-8",
      PATH: "/usr/bin"
    },
    execution: {
      ownerId: "session-1",
      projectSlug: "catalogue",
      sessionId: "session-1"
    },
    expectedVersion: OPENCODE_EXPECTED_VERSION,
    fetchImpl: async (url) => {
      assert.equal(new URL(url).pathname, "/global/health");
      return new Response(JSON.stringify({
        healthy: true,
        version: OPENCODE_EXPECTED_VERSION
      }), {
        headers: { "content-type": "application/json" },
        status: 200
      });
    },
    port: 43210,
    privateRoot,
    stopExecution: async (id, options) => {
      stops.push({ id, options });
      return { executionId: id, ok: true, scopeEmpty: true, stopped: true };
    },
    workdir: root
  });

  assert.equal(requests.length, 1);
  const [request] = requests;
  assert.equal(request.mode, "detached");
  assert.equal(request.purpose, "assistant");
  assert.equal(request.inheritProcessEnv, false);
  assert.equal(request.execution.kind, "assistant");
  assert.equal(request.execution.lifecycle, "service");
  assert.equal(request.execution.ownerId, "session-1");
  assert.equal(request.execution.projectSlug, "catalogue");
  assert.equal(request.execution.sessionId, "session-1");
  assert.match(
    request.args[1],
    /export VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID=\$\$/u
  );
  assert.match(request.args[1], /exec "\$@" <\/dev\/null/u);
  assert.equal(request.baseEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(request.baseEnv.OPENCODE_DB, path.join(root, "state", "opencode.db"));
  assert.equal(request.credentialHome.home, path.join(privateRoot, "home"));
  assert.equal(server.executionId, executionId);

  const proof = await server.stop();
  assert.equal(proof.exited, true);
  assert.deepEqual(stops, [{
    id: executionId,
    options: {
      reason: "opencode-server-stop",
      termTimeoutMs: 3000
    }
  }]);
  await assert.rejects(access(privateRoot), { code: "ENOENT" });
});
