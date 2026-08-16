import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  resolveStudioTargetRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  projectServiceTargetRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  inspectGenesisLaunch
} from "@local/vibe64-genesis/server";

const EXPECTED_UNCONFIGURED_CODES = new Set([
  "BLUEPRINT_REQUIRED",
  "STACK_REQUIRED"
]);

function resolveCurrentAppRoot(appRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: appRoot
  });
}

function currentAppResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_current_app_inspection_failed",
    fallbackMessage: "The current app could not be inspected."
  });
}

function unconfiguredCurrentApp(root = "", message = "") {
  return {
    components: [],
    diagnostics: [],
    message: message || "Genesis does not declare a launch target for this project yet.",
    ok: true,
    ready: false,
    resources: [],
    root,
    runtimeRequirements: [],
    stackHash: "",
    status: "unconfigured",
    targets: []
  };
}

function launchView(root = "", launch = {}) {
  return {
    components: Array.isArray(launch.components) ? launch.components : [],
    diagnostics: Array.isArray(launch.diagnostics) ? launch.diagnostics : [],
    ok: true,
    ready: launch.status === "ready",
    resources: Array.isArray(launch.resources) ? launch.resources : [],
    root,
    runtimeRequirements: Array.isArray(launch.runtimeRequirements) ? launch.runtimeRequirements : [],
    stackHash: String(launch.stackHash || ""),
    status: String(launch.status || "unconfigured"),
    targets: Array.isArray(launch.targets) ? launch.targets : []
  };
}

function createService({
  appRoot = "",
  env = process.env,
  inspectLaunch = inspectGenesisLaunch,
  projectService
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createService requires the Vibe64 Project API.");
  }

  function selectedProjectRoot() {
    if (String(appRoot || "").trim()) {
      return resolveCurrentAppRoot(appRoot);
    }
    if (typeof projectService.currentProjectSourceRoot === "function") {
      return String(projectService.currentProjectSourceRoot() || "").trim();
    }
    return projectServiceTargetRoot(projectService);
  }

  async function rootForInput(input = {}) {
    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) {
      return selectedProjectRoot();
    }
    const runtime = await projectService.createRuntime({
      inspectSource: false
    });
    const session = await runtime.getSession(sessionId, {
      inspectSource: false
    });
    const root = sessionSourcePath(session);
    if (!root) {
      const error = new Error("The selected session does not have a source directory.");
      error.code = "vibe64_session_source_required";
      error.sessionId = sessionId;
      throw error;
    }
    return root;
  }

  async function projectEnvironment(input = {}) {
    const userEnvironment = typeof projectService.projectExecutionEnvironment === "function"
      ? await projectService.projectExecutionEnvironment({
          scope: "dev",
          sessionId: input.sessionId
        })
      : {};
    return {
      ...env,
      ...userEnvironment
    };
  }

  return Object.freeze({
    async inspectCurrentApp(input = {}) {
      return currentAppResult(async () => {
        const root = await rootForInput(input);
        if (!root) {
          return unconfiguredCurrentApp("", "Choose a project source or session before inspecting Genesis launch targets.");
        }
        try {
          return launchView(root, await inspectLaunch({
            environment: await projectEnvironment(input),
            projectRoot: root
          }));
        } catch (error) {
          if (!EXPECTED_UNCONFIGURED_CODES.has(String(error?.code || ""))) {
            throw error;
          }
          return unconfiguredCurrentApp(root, String(error?.message || ""));
        }
      });
    }
  });
}

export {
  createService,
  resolveCurrentAppRoot
};
