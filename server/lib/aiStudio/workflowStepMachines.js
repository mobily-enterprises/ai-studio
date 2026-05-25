import {
  aiStudioError,
  normalizeText
} from "./core.js";
import {
  coreMaintenanceWorkflowMachineModule
} from "./workflowModules/coreMaintenance.js";
import {
  HUMAN_INPUT_RESPONSE_ARTIFACT,
  ISSUE_BODY_ARTIFACT,
  ISSUE_TITLE_ARTIFACT,
  ISSUE_WORD_ARTIFACT,
  PULL_REQUEST_BODY_DRAFT_ARTIFACT,
  PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
  REPORT_ARTIFACT
} from "./workflowArtifacts.js";
import {
  STEP_INPUT_KIND,
  STEP_STATUS,
  actionCreatedMetadata,
  allMetadataExists,
  artifactIsReady,
  artifactText,
  assertAgentResultSource,
  assertInputMatchesCurrentState,
  commandFailureInteraction,
  commandStepView,
  commandSucceeded,
  createChatWithAiMachine,
  createEditableArtifactReviewMachine,
  createFinishSessionMachine,
  createInstallDependenciesMachine,
  currentStepHelperInstruction,
  disableAction,
  handleStandardPromptInput,
  machineState,
  markCommandActionStarted,
  markPromptActionStarted,
  metadataExists,
  nextForSession,
  normalizeMachineInput,
  promptStepDoneView,
  promptStepWaitingForInputView,
  promptStepWaitingView,
  publicState,
  readState,
  requireInputValue,
  submitCommandFailureInput,
  unsupportedInputKind,
  writeCommandActionFinishedState,
  writeState
} from "./workflowStepMachineHelpers.js";
import {
  AI_STUDIO_CORE_WORKFLOW_MODULE_ID,
  registerWorkflowModule,
  workflowStepMachineForStep
} from "./workflowRegistry.js";

const sessionCreatedMachine = {
  stepId: "session_created",

  initialState() {
    return machineState(STEP_STATUS.DONE);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    return {
      next: nextForSession(context.session, {
        enabled: true
      }),
      stepMachine: publicState(this, state)
    };
  }
};

function issueFilesAreReady(session = {}) {
  return [
    ISSUE_TITLE_ARTIFACT,
    ISSUE_WORD_ARTIFACT,
    ISSUE_BODY_ARTIFACT
  ].every((artifactName) => artifactIsReady(session, artifactName));
}

async function readIssueFieldValues(context = {}) {
  const [title, body, word] = await Promise.all([
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_TITLE_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_BODY_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, ISSUE_WORD_ARTIFACT)
  ]);
  return {
    body: normalizeText(body),
    title: normalizeText(title),
    word: normalizeText(word)
  };
}

async function writeIssueFieldValues(context = {}, fields = {}) {
  const title = requireInputValue(fields.title, "Issue title is required.");
  const body = requireInputValue(fields.body, "Issue body is required.");
  const word = requireInputValue(fields.word, "Session label is required.");

  await Promise.all([
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_TITLE_ARTIFACT, artifactText(title)),
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_BODY_ARTIFACT, artifactText(body)),
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_WORD_ARTIFACT, artifactText(word)),
    context.runtime.store.writeMetadataValue(context.session.sessionId, "issue_title", title),
    context.runtime.store.writeIssueWordMetadata(context.session.sessionId, word)
  ]);
}

function pullRequestFilesAreReady(session = {}) {
  return [
    PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
    PULL_REQUEST_BODY_DRAFT_ARTIFACT
  ].every((artifactName) => artifactIsReady(session, artifactName));
}

async function readPullRequestFieldValues(context = {}) {
  const [title, body] = await Promise.all([
    context.runtime.store.readArtifact(context.session.sessionId, PULL_REQUEST_TITLE_DRAFT_ARTIFACT),
    context.runtime.store.readArtifact(context.session.sessionId, PULL_REQUEST_BODY_DRAFT_ARTIFACT)
  ]);
  return {
    body: normalizeText(body),
    title: normalizeText(title)
  };
}

async function writePullRequestFieldValues(context = {}, fields = {}) {
  const title = requireInputValue(fields.title, "Pull request title is required.");
  const body = requireInputValue(fields.body, "Pull request body is required.");
  await Promise.all([
    context.runtime.store.writeArtifact(
      context.session.sessionId,
      PULL_REQUEST_TITLE_DRAFT_ARTIFACT,
      artifactText(title)
    ),
    context.runtime.store.writeArtifact(
      context.session.sessionId,
      PULL_REQUEST_BODY_DRAFT_ARTIFACT,
      artifactText(body)
    )
  ]);
}

function issueInputInteraction(status = STEP_STATUS.WAITING_FOR_INPUT, values = {}) {
  return {
    fields: [
      {
        kind: "text",
        label: "Issue title",
        name: "title",
        required: true,
        requiredMessage: "Issue title is required.",
        value: values.title || ""
      },
      {
        kind: "text",
        label: "Session label",
        name: "word",
        required: true,
        requiredMessage: "Session label is required.",
        value: values.word || ""
      },
      {
        kind: "textarea",
        label: "Issue body",
        name: "body",
        required: true,
        requiredMessage: "Issue body is required.",
        value: values.body || ""
      }
    ],
    kind: "confirm_files_run_command",
    prompt: status === STEP_STATUS.CONFIRM_FILES
      ? "Review the issue details. Save changes here, or continue to create the GitHub issue."
      : "Discuss the requested change, then submit the issue title, session label, and issue body.",
    submitKind: status === STEP_STATUS.CONFIRM_FILES
      ? STEP_INPUT_KIND.CONFIRM_FILES
      : STEP_INPUT_KIND.READY,
    submitLabel: status === STEP_STATUS.CONFIRM_FILES ? "Update issue" : "Save issue",
    title: "Define issue"
  };
}

function pullRequestInputInteraction(values = {}) {
  return {
    fields: [
      {
        kind: "text",
        label: "Pull request title",
        name: "title",
        required: true,
        requiredMessage: "Pull request title is required.",
        value: values.title || ""
      },
      {
        kind: "textarea",
        label: "Pull request body",
        name: "body",
        required: true,
        requiredMessage: "Pull request body is required.",
        value: values.body || ""
      }
    ],
    kind: "collect_input_run_command",
    prompt: "Review the pull request details. Save changes here, or continue to create the GitHub pull request.",
    submitKind: STEP_INPUT_KIND.CONFIRM_FILES,
    submitLabel: "Update PR",
    title: "Create pull request"
  };
}

const workSourceSelectedMachine = {
  stepId: "work_source_selected",

  initialState(context = {}) {
    return metadataExists(context.session, "work_source")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "work_source")) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Choose a work source before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async actionFinished(context = {}) {
    if (!["use_new_branch", "use_existing_pr"].includes(context.actionId)) {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, await commandSucceeded(context, "work_source")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.FAILED, {
              message: normalizeText(context.actionResult?.message)
            }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  }
};

const worktreeCreatedMachine = {
  stepId: "worktree_created",

  initialState(context = {}) {
    if (metadataExists(context.session, "worktree_path")) {
      return machineState(STEP_STATUS.DONE);
    }
    if (!metadataExists(context.session, "work_source")) {
      return machineState(STEP_STATUS.WAITING_FOR_INPUT, {
        message: "Choose a work source before creating the worktree."
      });
    }
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "worktree_path")) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          actions: disableAction(context.session, "create_worktree", "This step is already complete."),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.WAITING_FOR_INPUT:
        if (state.from === STEP_STATUS.ATTEMPTING_EXECUTION) {
          return {
            actions: disableAction(context.session, "create_worktree", "Resolve the worktree command failure before retrying."),
            interaction: commandFailureInteraction({
              prompt: state.message || "The worktree command failed. Explain what should happen, then retry the command.",
              title: "Worktree command needs attention"
            }),
            next: nextForSession(context.session, {
              disabledReason: "Resolve the worktree command failure before continuing."
            }),
            stepMachine: publicState(this, state)
          };
        }
        return {
          next: nextForSession(context.session, {
            disabledReason: state.message || "Create the worktree before continuing."
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Create the worktree before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            response: input.text || input.fields.response,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        throw aiStudioError("The worktree step cannot accept input right now.", "ai_studio_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId !== "create_worktree") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION));
        return;

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        return;
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId !== "create_worktree") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
      case STEP_STATUS.WAITING_FOR_INPUT:
        await writeState(context, this, await commandSucceeded(context, "worktree_path")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
              from: STEP_STATUS.ATTEMPTING_EXECUTION,
              message: normalizeText(context.actionResult?.message),
              output: normalizeText(context.actionResult?.output)
            }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  }
};

const dependenciesInstalledMachine = createInstallDependenciesMachine({
  stepId: "dependencies_installed"
});

const issueDefinitionMachine = createEditableArtifactReviewMachine({
  command: {
    actionId: "use_existing_issue",
    doneMetadata: "issue_url",
    failureState: (context = {}) => machineState(STEP_STATUS.FAILED, {
      message: normalizeText(context.actionResult?.message)
    }),
    finishStatuses: [
      STEP_STATUS.WAITING_FOR_INPUT,
      STEP_STATUS.CONFIRM_FILES,
      STEP_STATUS.FAILED
    ],
    markAttemptingOnStart: false
  },
  done: (session = {}) => metadataExists(session, "issue_url"),
  draftReady: issueFilesAreReady,
  initialDetails: {
    doing: "discussion"
  },
  interaction: issueInputInteraction,
  nextWhenDrafting: {
    disabledReason: "Define and save the issue before continuing."
  },
  nextWhenWorking: {
    disabledReason: "Define and save the issue before continuing."
  },
  onConfirmedActions: (context = {}) => disableAction(context.session, "use_existing_issue", "Issue details are already saved."),
  onDoneActions: (context = {}) => disableAction(context.session, "use_existing_issue", "An existing issue is already selected."),
  readValues: readIssueFieldValues,
  saveValues: writeIssueFieldValues,
  stepId: "issue_file_created",
  unsupportedDoneMessage: "The issue is already complete.",
  waitingForInputState: (input = {}) => ({
    doing: "discussion",
    message: input.message
  }),
  waitingInteraction: () => issueInputInteraction(STEP_STATUS.WAITING_FOR_INPUT, {})
});

const issueSubmittedMachine = {
  stepId: "issue_submitted",

  initialState(context = {}) {
    if (metadataExists(context.session, "issue_url")) {
      return machineState(STEP_STATUS.DONE);
    }
    return issueFilesAreReady(context.session)
      ? machineState(STEP_STATUS.READY)
      : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
          message: "Define and save the issue before creating it on GitHub."
        });
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "issue_url")) {
      state = machineState(STEP_STATUS.DONE);
    } else if (issueFilesAreReady(context.session) && state.status === STEP_STATUS.WAITING_FOR_INPUT && state.from !== STEP_STATUS.ATTEMPTING_EXECUTION) {
      state = machineState(STEP_STATUS.READY);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return {
          actions: disableAction(context.session, "create_issue_on_gh", "The GitHub issue already exists."),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.WAITING_FOR_INPUT:
        return {
          actions: disableAction(context.session, "create_issue_on_gh", "Resolve the issue command failure before retrying."),
          interaction: commandFailureInteraction({
            prompt: state.message || "The GitHub issue command failed. Explain what should happen, then retry the command.",
            title: "Issue command needs attention"
          }),
          next: nextForSession(context.session, {
            disabledReason: "Resolve the GitHub issue command failure before continuing."
          }),
          stepMachine: publicState(this, state)
        };

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Create the GitHub issue before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            response: input.text || input.fields.response,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.READY:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        throw aiStudioError("The GitHub issue step cannot accept input right now.", "ai_studio_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId !== "create_issue_on_gh") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.FAILED:
        await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION));
        return;

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        return;
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId !== "create_issue_on_gh") {
      return;
    }

    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.READY:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        await writeState(context, this, await commandSucceeded(context, "issue_url")
          ? machineState(STEP_STATUS.DONE)
          : machineState(STEP_STATUS.WAITING_FOR_INPUT, {
              from: STEP_STATUS.ATTEMPTING_EXECUTION,
              message: normalizeText(context.actionResult?.message),
              output: normalizeText(context.actionResult?.output)
            }));
        return;

      case STEP_STATUS.DONE:
      default:
        return;
    }
  }
};

const seedApplicationDefinitionMachine = createEditableArtifactReviewMachine({
  draftReady: issueFilesAreReady,
  initialDetails: {
    doing: "discussion"
  },
  interaction: issueInputInteraction,
  nextWhenDrafting: {
    disabledReason: "Define and save the seed issue before continuing."
  },
  nextWhenWorking: {
    disabledReason: "Define and save the seed issue before continuing."
  },
  readValues: readIssueFieldValues,
  saveValues: writeIssueFieldValues,
  stepId: "seed_application_defined",
  unsupportedDoneMessage: "The seed definition step cannot accept input right now.",
  waitingForInputState: (input = {}) => ({
    doing: "discussion",
    message: input.message
  }),
  waitingInteraction: () => issueInputInteraction(STEP_STATUS.WAITING_FOR_INPUT, {})
});

const makePlanMachine = {
  promptActionId: "make_plan",
  stepId: "plan_made",

  initialState() {
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state);
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Ask Codex to make the plan before continuing.");
    }
  },

  async submitInput(context = {}) {
    return handleStandardPromptInput(context, this);
  },

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "make_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The implementation plan has been written in the Codex response and is ready for execution.",
      waitingForInputMeaning: "You cannot make a useful plan without a user decision or clarification."
    });
  }
};

const seedPlanMadeMachine = {
  ...makePlanMachine,
  promptActionId: "make_seed_plan",
  stepId: "seed_plan_made",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "make_seed_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The seed implementation plan has been written in the Codex response and is ready for execution.",
      waitingForInputMeaning: "You cannot make a useful seed plan without a user decision or clarification."
    });
  }
};

const executePlanMachine = {
  promptActionId: "execute_plan",
  stepId: "plan_executed",

  initialState() {
    return machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    const state = await readState(context, this);
    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state);
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Ask Codex to execute the plan before continuing.");
    }
  },

  async submitInput(context = {}) {
    return handleStandardPromptInput(context, this);
  },

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "execute_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The implementation work is complete enough to continue to review.",
      waitingForInputMeaning: "You cannot continue implementation without a user decision or missing project detail."
    });
  }
};

const seedPlanExecutedMachine = {
  ...executePlanMachine,
  promptActionId: "execute_seed_plan",
  stepId: "seed_plan_executed",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "execute_seed_plan");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The seed implementation work is complete enough to continue.",
      waitingForInputMeaning: "You cannot continue seeding without a user decision or missing project detail."
    });
  }
};

const deepUiCheckMachine = {
  ...executePlanMachine,
  promptActionId: "run_deep_ui_check",
  stepId: "deep_ui_check_run",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "run_deep_ui_check");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The deep UI check has been completed or intentionally found no required fix.",
      waitingForInputMeaning: "You cannot complete the UI check without a user decision."
    });
  }
};

const reviewRunMachine = {
  ...executePlanMachine,
  promptActionId: "run_deslop",
  stepId: "review_run",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "run_deslop");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The review/deslop loop has completed and only acceptable low-risk findings remain.",
      waitingForInputMeaning: "You cannot complete review/deslop without a user decision."
    });
  }
};

const projectKnowledgeUpdatedMachine = {
  ...executePlanMachine,
  promptActionId: "update_project_knowledge",
  stepId: "project_knowledge_updated",

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "update_project_knowledge");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "Project knowledge has been updated or there is no adapter-supported project knowledge to update.",
      waitingForInputMeaning: "You cannot update project knowledge without a user decision."
    });
  }
};

const reportCreatedMachine = {
  promptActionId: "write_report",
  stepId: "report_created",

  initialState(context = {}) {
    return artifactIsReady(context.session, REPORT_ARTIFACT)
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (artifactIsReady(context.session, REPORT_ARTIFACT)) {
      state = machineState(STEP_STATUS.DONE);
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state);
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Write the session report before updating project knowledge.");
    }
  },

  async submitInput(context = {}) {
    return handleStandardPromptInput(context, this, {
      responseArtifact: REPORT_ARTIFACT
    });
  },

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "write_report");
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneFields: {
        response: "Markdown session report"
      },
      doneMeaning: "The report text is complete and should be saved by Studio as the session report.",
      waitingForInputMeaning: "You cannot write the report without a user decision or missing context."
    });
  }
};

const agentConversationMachine = createChatWithAiMachine({
  completionPolicy: {
    decidedBy: "user"
  },
  nextWhenIdle: (context = {}) => ({
    disabledReason: "Ask Codex for changes before continuing.",
    enabled: artifactIsReady(context.session, HUMAN_INPUT_RESPONSE_ARTIFACT)
  }),
  promptActionId: "agent_conversation",
  stepId: "agent_conversation"
});

const implementationReviewMachine = createChatWithAiMachine({
  completionPolicy: {
    decidedBy: "ai",
    enoughWhen: "the requested focused tweak has either been made and focused checks run when practical, or you can clearly report that no code change is needed.",
    waitingForInputMeaning: "You cannot complete the focused review tweak without a user decision or missing project detail."
  },
  promptActionId: "human_review_conversation",
  stepId: "implementation_reviewed",
  waitingMessage: "Wait for Codex to finish this review turn."
});

const finalReviewMachine = createChatWithAiMachine({
  completionPolicy: {
    decidedBy: "ai",
    enoughWhen: "the requested final tweak has either been made or you can clearly report the blocker; AI Studio can then rerun review and validation.",
    waitingForInputMeaning: "You cannot complete the final review tweak without a user decision or missing project detail."
  },
  promptActionId: "final_review_conversation",
  stepId: "changes_accepted",
  waitingMessage: "Wait for Codex to finish this review turn."
});

const projectValidatedMachine = {
  stepId: "project_validated",

  initialState(context = {}) {
    return allMetadataExists(context.session, ["code_index_updated", "automated_checks_passed"])
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (allMetadataExists(context.session, ["code_index_updated", "automated_checks_passed"])) {
      state = machineState(STEP_STATUS.DONE);
    }
    return commandStepView(context, this, state, {
      disabledReason: "Update the code index and run automated checks successfully before continuing.",
      failurePrompt: "The project validation command failed. Explain what should happen, then retry validation.",
      failureTitle: "Validation needs attention"
    });
  },

  async submitInput(context = {}) {
    return submitCommandFailureInput(context, this);
  },

  async actionStarted(context = {}) {
    return markCommandActionStarted(context, this, ["update_code_index", "run_automated_checks"]);
  },

  async actionFinished(context = {}) {
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["update_code_index", "run_automated_checks"],
      done: allMetadataExists(await context.runtime.getSession(context.session.sessionId), [
        "code_index_updated",
        "automated_checks_passed"
      ]),
      failureTitle: "Validation needs attention"
    });
  }
};

const changesCommittedMachine = {
  stepId: "changes_committed",

  initialState(context = {}) {
    return metadataExists(context.session, "accepted_commit")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "accepted_commit")) {
      state = machineState(STEP_STATUS.DONE);
    }
    return commandStepView(context, this, state, {
      disabledReason: "Commit and push changes before continuing.",
      failurePrompt: "The commit or push command failed. Explain what should happen, then retry it.",
      failureTitle: "Commit needs attention"
    });
  },

  async submitInput(context = {}) {
    return submitCommandFailureInput(context, this);
  },

  async actionStarted(context = {}) {
    return markCommandActionStarted(context, this, ["commit_changes"]);
  },

  async actionFinished(context = {}) {
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["commit_changes"],
      done: await actionCreatedMetadata(context, "accepted_commit"),
      failureTitle: "Commit needs attention"
    });
  }
};

const pullRequestMergedMachine = {
  promptActionId: "prepare_for_merge",
  stepId: "pr_merged",

  initialState(context = {}) {
    return metadataExists(context.session, "pr_merged") || metadataExists(context.session, "merge_skipped")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "pr_merged") || metadataExists(context.session, "merge_skipped")) {
      state = machineState(STEP_STATUS.DONE);
    }
    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);

      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, {
          ...state,
          message: state.message || "The merge step needs input before it can continue."
        });

      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(context, this, state, "Merge the pull request or choose not to merge before continuing.");
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (state.status === STEP_STATUS.AWAITING_AGENT_RESULT) {
          assertAgentResultSource(context.session, input);
        }
        if (input.kind === STEP_INPUT_KIND.WAITING_FOR_INPUT) {
          await writeState(context, this, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
            from: state.status === STEP_STATUS.ATTEMPTING_EXECUTION
              ? STEP_STATUS.ATTEMPTING_EXECUTION
              : STEP_STATUS.AWAITING_AGENT_RESULT,
            message: input.message,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.USER_RESPONSE || input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            response: input.text || input.fields.response,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.READY) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            message: input.message,
            promptComplete: true,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.ATTEMPTING_EXECUTION:
      case STEP_STATUS.DONE:
      default:
        throw aiStudioError("The merge step cannot accept input right now.", "ai_studio_step_input_not_available");
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId === "prepare_for_merge") {
      return markPromptActionStarted(context, this, "prepare_for_merge");
    }
    return markCommandActionStarted(context, this, ["merge_pr"]);
  },

  async actionFinished(context = {}) {
    if (context.actionId === "skip_merge") {
      await writeState(context, this, machineState(STEP_STATUS.DONE));
      return;
    }
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["merge_pr"],
      done: await actionCreatedMetadata(context, "pr_merged"),
      failureTitle: "Merge needs attention"
    });
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneMeaning: "The pull request and main checkout are ready for the merge command.",
      waitingForInputMeaning: "The merge preparation found a blocker that needs user input."
    });
  }
};

const mainCheckoutSyncedMachine = {
  stepId: "main_checkout_synced",

  initialState(context = {}) {
    return metadataExists(context.session, "main_checkout_synced") || metadataExists(context.session, "merge_skipped")
      ? machineState(STEP_STATUS.DONE)
      : machineState(STEP_STATUS.READY);
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, "main_checkout_synced") || metadataExists(context.session, "merge_skipped")) {
      state = machineState(STEP_STATUS.DONE);
    }
    return commandStepView(context, this, state, {
      disabledReason: "Sync the main checkout after merging before continuing.",
      failurePrompt: "The main checkout sync command failed. Explain what should happen, then retry it.",
      failureTitle: "Main checkout sync needs attention"
    });
  },

  async submitInput(context = {}) {
    return submitCommandFailureInput(context, this);
  },

  async actionStarted(context = {}) {
    return markCommandActionStarted(context, this, ["sync_main_checkout"]);
  },

  async actionFinished(context = {}) {
    return writeCommandActionFinishedState(context, this, {
      actionIds: ["sync_main_checkout"],
      done: await actionCreatedMetadata(context, "main_checkout_synced"),
      failureTitle: "Main checkout sync needs attention"
    });
  }
};

const pullRequestMachine = createEditableArtifactReviewMachine({
  command: {
    actionId: "create_pr_on_gh",
    doneMetadata: "pr_url",
    failureState: (context = {}) => machineState(STEP_STATUS.WAITING_FOR_INPUT, {
      from: STEP_STATUS.ATTEMPTING_EXECUTION,
      message: normalizeText(context.actionResult?.message),
      output: normalizeText(context.actionResult?.output)
    })
  },
  done: (session = {}) => metadataExists(session, "pr_url"),
  draftOrigin: "prompt",
  draftReady: pullRequestFilesAreReady,
  interaction: (_status, values = {}) => pullRequestInputInteraction(values),
  nextWhenConfirmed: {
    disabledReason: "Create the pull request before continuing."
  },
  nextWhenDrafting: {
    disabledReason: "Resolve the pull request content before continuing."
  },
  nextWhenWaitingForInput: {
    disabledReason: "Resolve the pull request input request before continuing."
  },
  nextWhenWorking: {
    disabledReason: "Create the pull request before continuing."
  },
  onWaitingActions: (context = {}) => disableAction(context.session, "create_pr_on_gh", "Resolve the pull request input request before retrying."),
  promptInstruction() {
    return currentStepHelperInstruction({
      doneFields: {
        body: "Markdown pull request body",
        title: "Pull request title"
      },
      doneMeaning: "The pull request title and body are ready for user confirmation.",
      waitingForInputMeaning: "You cannot draft the pull request without a user decision or missing repository context."
    });
  },
  readValues: readPullRequestFieldValues,
  saveValues: writePullRequestFieldValues,
  stepId: "create_pull_request",
  unsupportedDoneMessage: "The pull request step cannot accept input right now.",
  userResponseResumeStatus: (state = {}) => state.from === STEP_STATUS.ATTEMPTING_EXECUTION
    ? STEP_STATUS.CONFIRM_FILES
    : STEP_STATUS.AWAITING_AGENT_RESULT,
  waitingInteraction: (state = {}) => commandFailureInteraction({
    prompt: state.message || "Codex needs more information before the pull request can continue.",
    title: "Pull request needs input"
  })
});

const sessionFinishedMachine = createFinishSessionMachine({
  stepId: "session_finished"
});

const stepMachines = new Map([
  [sessionCreatedMachine.stepId, sessionCreatedMachine],
  [workSourceSelectedMachine.stepId, workSourceSelectedMachine],
  [worktreeCreatedMachine.stepId, worktreeCreatedMachine],
  [dependenciesInstalledMachine.stepId, dependenciesInstalledMachine],
  [seedApplicationDefinitionMachine.stepId, seedApplicationDefinitionMachine],
  [issueDefinitionMachine.stepId, issueDefinitionMachine],
  [issueSubmittedMachine.stepId, issueSubmittedMachine],
  [seedPlanMadeMachine.stepId, seedPlanMadeMachine],
  [seedPlanExecutedMachine.stepId, seedPlanExecutedMachine],
  [makePlanMachine.stepId, makePlanMachine],
  [executePlanMachine.stepId, executePlanMachine],
  [implementationReviewMachine.stepId, implementationReviewMachine],
  [agentConversationMachine.stepId, agentConversationMachine],
  [deepUiCheckMachine.stepId, deepUiCheckMachine],
  [reviewRunMachine.stepId, reviewRunMachine],
  [projectValidatedMachine.stepId, projectValidatedMachine],
  [finalReviewMachine.stepId, finalReviewMachine],
  [reportCreatedMachine.stepId, reportCreatedMachine],
  [projectKnowledgeUpdatedMachine.stepId, projectKnowledgeUpdatedMachine],
  [changesCommittedMachine.stepId, changesCommittedMachine],
  [pullRequestMachine.stepId, pullRequestMachine],
  [pullRequestMergedMachine.stepId, pullRequestMergedMachine],
  [mainCheckoutSyncedMachine.stepId, mainCheckoutSyncedMachine],
  [sessionFinishedMachine.stepId, sessionFinishedMachine]
]);

registerWorkflowModule({
  id: AI_STUDIO_CORE_WORKFLOW_MODULE_ID,
  steps: Array.from(stepMachines.values())
    .map((machine) => ({
      id: machine.stepId,
      machine
    }))
});

registerWorkflowModule(coreMaintenanceWorkflowMachineModule());

function stepMachineForStep(stepId = "") {
  return workflowStepMachineForStep(stepId);
}

function currentStepPromptInputInstruction(session = {}, action = {}) {
  const machine = stepMachineForStep(session.currentStep);
  if (!machine || typeof machine.promptInstruction !== "function") {
    return "";
  }
  return machine.promptInstruction({
    action,
    session
  })
    .replaceAll("{{session.currentStep}}", normalizeText(session.currentStep))
    .replaceAll("{{session.stepMachine.status}}", normalizeText(session.stepMachine?.status));
}

async function applyStepMachineView(runtime, session = {}) {
  const machine = stepMachineForStep(session.currentStep);
  if (!machine) {
    return session;
  }

  const view = await machine.view({
    runtime,
    session
  });
  const stepMachine = view.stepMachine || null;
  const currentStepDefinition = {
    ...session.currentStepDefinition,
    ...(view.interaction === undefined ? {} : { interaction: view.interaction })
  };
  let workflowAutopilot = session.workflowAutopilot;
  if ([STEP_STATUS.DONE, STEP_STATUS.WAITING_FOR_INPUT].includes(normalizeText(stepMachine?.status)) && workflowAutopilot) {
    workflowAutopilot = {
      ...workflowAutopilot,
      stage: null
    };
  }

  return {
    ...session,
    ...(view.actions ? { actions: view.actions } : {}),
    currentStepDefinition,
    ...(view.next ? { next: view.next } : {}),
    stepMachine,
    workflowAutopilot
  };
}

async function saveStepMachineInput(runtime, sessionId = "", input = {}) {
  const session = await runtime.getSession(sessionId);
  const normalizedInput = normalizeMachineInput(input);
  const machine = stepMachineForStep(session.currentStep);
  if (!machine || typeof machine.submitInput !== "function") {
    throw aiStudioError(
      `The current AI Studio step does not accept direct input: ${session.currentStep || "(none)"}`,
      "ai_studio_step_input_not_available"
    );
  }
  try {
    assertInputMatchesCurrentState(session, normalizedInput);
    await machine.submitInput({
      input: normalizedInput,
      runtime,
      session
    });
  } catch (error) {
    error.currentStep = normalizeText(session.currentStep);
    error.expectedInput = session.currentStepDefinition?.interaction || null;
    error.stepStatus = normalizeText(session.stepMachine?.status);
    throw error;
  }
  return runtime.getSession(session.sessionId);
}

async function recoverStuckStepMachineExecution(runtime, session = {}, {
  message = "Recovered stuck command execution. Re-run the current step."
} = {}) {
  const machine = stepMachineForStep(session.currentStep);
  if (!machine) {
    throw aiStudioError(
      `The current AI Studio step cannot be recovered: ${session.currentStep || "(none)"}`,
      "ai_studio_step_recovery_not_available"
    );
  }
  const state = await readState({
    runtime,
    session
  }, machine);
  if (normalizeText(state.status) !== STEP_STATUS.ATTEMPTING_EXECUTION) {
    throw aiStudioError(
      "The current AI Studio step is not waiting on an in-flight command.",
      "ai_studio_step_recovery_not_available"
    );
  }
  await writeState({
    runtime,
    session
  }, machine, machineState(STEP_STATUS.READY, {
    from: STEP_STATUS.ATTEMPTING_EXECUTION,
    message: normalizeText(message)
  }));
}

async function recordStepMachineActionStarted(runtime, session = {}, actionId = "") {
  const machine = stepMachineForStep(session.currentStep);
  if (typeof machine?.actionStarted !== "function") {
    return;
  }
  await machine.actionStarted({
    actionId,
    runtime,
    session
  });
}

async function recordStepMachineActionFinished(runtime, session = {}, actionId = "", actionResult = {}) {
  const machine = stepMachineForStep(session.currentStep);
  if (typeof machine?.actionFinished !== "function") {
    return;
  }
  await machine.actionFinished({
    actionId,
    actionResult,
    runtime,
    session
  });
}

export {
  STEP_STATUS,
  applyStepMachineView,
  currentStepPromptInputInstruction,
  recordStepMachineActionFinished,
  recordStepMachineActionStarted,
  recoverStuckStepMachineExecution,
  saveStepMachineInput,
  stepMachineForStep
};
