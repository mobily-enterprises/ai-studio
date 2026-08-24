import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  applyLocalCliRuntimeNamespace,
  isDirectServerExecution,
  parseStartupArgs,
  serverStartOptions
} from "../../../bin/server.js";
import { startServer } from "../../../server.js";

const PLAYWRIGHT_SERVER_ENTRYPOINT = fileURLToPath(import.meta.url);

function playwrightServerStartOptions({
  cwd = process.cwd(),
  env = process.env
} = {}) {
  const startup = parseStartupArgs(["--no-open", cwd]);
  applyLocalCliRuntimeNamespace({
    env,
    runtimeMode: startup.runtimeMode
  });
  return {
    ...serverStartOptions({
      ...startup,
      env
    }),
    browserLifecycleShutdown: false
  };
}

async function main() {
  await startServer(playwrightServerStartOptions());
}

if (isDirectServerExecution({
  entrypointPath: PLAYWRIGHT_SERVER_ENTRYPOINT
})) {
  main().catch((error) => {
    console.error("Failed to start the Vibe64 Playwright server:", error);
    process.exitCode = 1;
  });
}

export {
  playwrightServerStartOptions
};
