import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runtimeNetworkName
} from "../../server/lib/aiStudio/runtimeContainers.js";
import {
  runHostCommand
} from "../../server/lib/shellCommands.js";

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(tmpdir(), "ai-studio-test-"));
  try {
    return await callback(root);
  } finally {
    await runHostCommand("docker", ["network", "rm", runtimeNetworkName(root)], {
      timeout: 5_000
    });
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

export {
  withTemporaryRoot
};
