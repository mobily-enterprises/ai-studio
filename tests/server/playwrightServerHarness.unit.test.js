import assert from "node:assert/strict";
import test from "node:test";

import {
  VIBE64_LOCAL_RUNTIME_NAMESPACE,
  VIBE64_RUNTIME_NAMESPACE_ENV
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  playwrightServerStartOptions
} from "../e2e/support/start-web-server.mjs";

test("Playwright starts the local app without browser-disconnect shutdown", () => {
  const env = {
    PORT: "4173"
  };

  assert.deepEqual(playwrightServerStartOptions({
    cwd: "/workspace/vibe64",
    env
  }), {
    browserLifecycleShutdown: false,
    port: undefined,
    runtimeMode: "local",
    startupSlug: "vibe64",
    strictPort: true,
    targetRoot: "/workspace/vibe64"
  });
  assert.equal(
    env[VIBE64_RUNTIME_NAMESPACE_ENV],
    VIBE64_LOCAL_RUNTIME_NAMESPACE
  );
});
