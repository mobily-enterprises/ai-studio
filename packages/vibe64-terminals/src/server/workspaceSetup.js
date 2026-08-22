import path from "node:path";

import {
  pathInsideOrEqual,
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  inspectVibe64WorkspaceSetup
} from "@local/vibe64-genesis/server";
import {
  workspaceSetupState,
  writeWorkspaceSetupState
} from "@local/vibe64-runtime/server/workspaceSetupState";
import {
  vibe64RuntimePacks
} from "@local/vibe64-terminals/server/vibe64LaunchTargets";
import {
  loadProjectExecutionEnv
} from "@local/vibe64-terminals/server/projectExecutionEnv";

const WORKSPACE_SETUP_COMMAND_TIMEOUT_MS = 15 * 60 * 1000;

function diagnosticText(diagnostics = []) {
  return (Array.isArray(diagnostics) ? diagnostics : [])
    .map((diagnostic) => normalizeText(
      typeof diagnostic === "string"
        ? diagnostic
        : diagnostic?.message || diagnostic?.code
    ))
    .find(Boolean) || "";
}

function diagnosticsInclude(diagnostics = [], code = "") {
  return (Array.isArray(diagnostics) ? diagnostics : [])
    .some((diagnostic) => normalizeText(diagnostic?.code) === code);
}

function stateTimestamp(clock) {
  const value = typeof clock === "function" ? clock() : new Date();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function setupStep(step = {}, index = 0, sourcePath = "") {
  const argv = Array.isArray(step.argv) ? step.argv.map((value) => String(value)) : [];
  if (!normalizeText(argv[0])) {
    throw new Error(`Workspace preparation step ${index + 1} has no command.`);
  }
  const cwd = path.resolve(sourcePath, normalizeText(step.workdir) || ".");
  if (!pathInsideOrEqual(sourcePath, cwd)) {
    throw new Error(`Workspace preparation step ${index + 1} has a work directory outside the session source.`);
  }
  return {
    argv,
    cwd,
    label: normalizeText(step.label) || `Workspace preparation step ${index + 1}`,
    runtimeRequirements: Array.isArray(step.runtimeRequirements)
      ? step.runtimeRequirements
      : []
  };
}

function preparedRecipe(setup = {}, sourcePath = "") {
  const recipeHash = normalizeText(setup.recipeHash);
  if (!recipeHash) {
    throw new Error("Vibe64 produced a ready workspace preparation recipe without an identity.");
  }
  const steps = (Array.isArray(setup.steps) ? setup.steps : [])
    .map((step, index) => setupStep(step, index, sourcePath));
  if (steps.length < 1) {
    throw new Error("Vibe64 produced a ready workspace preparation recipe without any steps.");
  }
  const runtime = vibe64RuntimePacks([
    ...(Array.isArray(setup.runtimeRequirements) ? setup.runtimeRequirements : []),
    ...steps.flatMap((step) => step.runtimeRequirements)
  ]);
  if (!runtime.available) {
    throw new Error(runtime.disabledReason);
  }
  return {
    recipeHash,
    runtimes: runtime.runtimes,
    steps
  };
}

function commandDiagnostic(result = {}, label = "") {
  const output = normalizeText(result.stderr || result.error || result.output);
  if (output) {
    return output.slice(-1600);
  }
  if (result.timedOut === true) {
    return `${label} timed out after 15 minutes.`;
  }
  return `${label} exited with code ${Number(result.exitCode) || 1}.`;
}

function createWorkspaceSetupRunner({
  clock = () => new Date(),
  inspect = inspectVibe64WorkspaceSetup,
  projectService,
  runCommand = runVibe64Command
} = {}) {
  if (!projectService) {
    throw new TypeError("createWorkspaceSetupRunner requires the Vibe64 project service.");
  }
  const activeRuns = new Map();

  async function persist(runtime, sessionId, value) {
    return writeWorkspaceSetupState(runtime.store, sessionId, {
      ...value,
      updatedAt: stateTimestamp(clock)
    });
  }

  async function persistInspectedState(runtime, sessionId, previous, value) {
    const next = workspaceSetupState(value);
    const unchanged = [
      "currentLabel",
      "diagnostic",
      "recipeHash",
      "status"
    ].every((name) => previous[name] === next[name]);
    return unchanged && previous.status !== "running"
      ? previous
      : persist(runtime, sessionId, value);
  }

  async function failed(runtime, sessionId, {
    currentLabel = "",
    diagnostic = "Workspace preparation failed.",
    recipeHash = "",
    startedAt = ""
  } = {}) {
    return persist(runtime, sessionId, {
      currentLabel,
      diagnostic,
      finishedAt: stateTimestamp(clock),
      recipeHash,
      startedAt,
      status: "failed"
    });
  }

  async function execute({
    recipe,
    runtime,
    session,
    sourcePath,
    startedAt
  }) {
    const projectEnv = await loadProjectExecutionEnv({
      projectService,
      session,
      sourcePath,
      target: "workspace-setup",
      targetRoot: session.targetRoot,
      worktreePath: sourcePath
    });
    let currentLabel = recipe.steps[0].label;
    for (const step of recipe.steps) {
      currentLabel = step.label;
      await persist(runtime, session.sessionId, {
        currentLabel,
        diagnostic: "",
        finishedAt: "",
        recipeHash: recipe.recipeHash,
        startedAt,
        status: "running"
      });
      const result = await runCommand({
        actor: "app",
        allowedRoots: [sourcePath],
        args: step.argv.slice(1),
        baseEnv: runtime.promptEnvironment,
        command: step.argv[0],
        cwd: step.cwd,
        envPolicy: "project",
        mode: "capture",
        project: {
          runtimeConfigEnv: projectEnv
        },
        purpose: "source",
        runtimes: recipe.runtimes,
        timeout: WORKSPACE_SETUP_COMMAND_TIMEOUT_MS
      });
      if (result?.ok !== true) {
        return failed(runtime, session.sessionId, {
          currentLabel,
          diagnostic: commandDiagnostic(result, currentLabel),
          recipeHash: recipe.recipeHash,
          startedAt
        });
      }
    }
    return persist(runtime, session.sessionId, {
      currentLabel,
      diagnostic: "",
      finishedAt: stateTimestamp(clock),
      recipeHash: recipe.recipeHash,
      startedAt,
      status: "succeeded"
    });
  }

  function observe(sessionId, operation, context) {
    const completion = operation
      .catch(async (error) => failed(context.runtime, sessionId, {
        currentLabel: context.currentLabel,
        diagnostic: normalizeText(error?.message) || "Workspace preparation failed.",
        recipeHash: context.recipeHash,
        startedAt: context.startedAt
      }).catch(() => workspaceSetupState({
        currentLabel: context.currentLabel,
        diagnostic: normalizeText(error?.message) || "Workspace preparation failed.",
        finishedAt: stateTimestamp(clock),
        recipeHash: context.recipeHash,
        startedAt: context.startedAt,
        status: "failed",
        updatedAt: stateTimestamp(clock)
      })))
      .finally(() => {
        activeRuns.delete(sessionId);
      });
    activeRuns.set(sessionId, completion);
    return completion;
  }

  async function start({ retry = false, runtime, session } = {}) {
    const sessionId = normalizeText(session?.sessionId || session?.id);
    if (!sessionId || !runtime?.store) {
      throw new TypeError("Workspace preparation requires a stored Vibe64 session.");
    }
    if (activeRuns.has(sessionId)) {
      return {
        completion: activeRuns.get(sessionId),
        state: workspaceSetupState(session.workspaceSetup)
      };
    }
    const sourcePath = sessionSourcePath(session);
    if (!sourcePath) {
      const state = await failed(runtime, sessionId, {
        diagnostic: "Workspace preparation requires an attached session source."
      });
      return { completion: null, state };
    }
    const previous = workspaceSetupState(session.workspaceSetup);

    let setup;
    try {
      setup = await inspect({
        environment: runtime.promptEnvironment,
        projectRoot: sourcePath
      });
    } catch (error) {
      if (normalizeText(error?.code) === "STACK_REQUIRED") {
        const state = await persistInspectedState(runtime, sessionId, previous, {
          currentLabel: "",
          diagnostic: "",
          finishedAt: "",
          recipeHash: "",
          startedAt: "",
          status: "unconfigured"
        });
        return { completion: null, state };
      }
      const state = await persistInspectedState(runtime, sessionId, previous, {
        currentLabel: "",
        diagnostic: normalizeText(error?.message) || "Vibe64 could not inspect workspace preparation.",
        finishedAt: stateTimestamp(clock),
        recipeHash: "",
        startedAt: "",
        status: "failed"
      });
      return { completion: null, state };
    }

    if (normalizeText(setup?.status) === "unconfigured") {
      const state = await persistInspectedState(runtime, sessionId, previous, {
        currentLabel: "",
        diagnostic: "",
        finishedAt: "",
        recipeHash: "",
        startedAt: "",
        status: "unconfigured"
      });
      return { completion: null, state };
    }
    if (normalizeText(setup?.status) !== "ready") {
      const ambiguous = diagnosticsInclude(
        setup?.diagnostics,
        "STACK_SECTION_AMBIGUOUS"
      );
      const state = await persistInspectedState(runtime, sessionId, previous, {
        currentLabel: "",
        diagnostic: diagnosticText(setup?.diagnostics) || "Vibe64 could not select one workspace preparation recipe.",
        finishedAt: stateTimestamp(clock),
        recipeHash: "",
        startedAt: "",
        status: ambiguous ? "ambiguous" : "failed"
      });
      return { completion: null, state };
    }

    let recipe;
    try {
      recipe = preparedRecipe(setup, sourcePath);
    } catch (error) {
      const state = await persistInspectedState(runtime, sessionId, previous, {
        currentLabel: "",
        diagnostic: normalizeText(error?.message),
        finishedAt: stateTimestamp(clock),
        recipeHash: "",
        startedAt: "",
        status: "failed"
      });
      return { completion: null, state };
    }
    if (
      previous.recipeHash === recipe.recipeHash &&
      (previous.status === "succeeded" || (previous.status === "failed" && retry !== true))
    ) {
      return {
        completion: null,
        state: previous
      };
    }
    const startedAt = stateTimestamp(clock);
    const state = await persist(runtime, sessionId, {
      currentLabel: recipe.steps[0].label,
      diagnostic: "",
      finishedAt: "",
      recipeHash: recipe.recipeHash,
      startedAt,
      status: "running"
    });
    const completion = observe(sessionId, execute({
      recipe,
      runtime,
      session,
      sourcePath,
      startedAt
    }), {
      currentLabel: recipe.steps[0].label,
      recipeHash: recipe.recipeHash,
      runtime,
      startedAt
    });
    return { completion, state };
  }

  return Object.freeze({
    isRunning(sessionId = "") {
      return activeRuns.has(normalizeText(sessionId));
    },
    start,
    wait(sessionId = "") {
      return activeRuns.get(normalizeText(sessionId)) || null;
    }
  });
}

export {
  WORKSPACE_SETUP_COMMAND_TIMEOUT_MS,
  createWorkspaceSetupRunner
};
