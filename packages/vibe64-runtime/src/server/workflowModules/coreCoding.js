import {
  vibe64Error,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  VIBE64_CLIENT_CONTROL_ACTIONS,
  VIBE64_CLIENT_CONTROL_ICON_TOKENS,
  VIBE64_CLIENT_CONTROL_STATE_FLAGS
} from "@local/vibe64-core/shared";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import {
  HUMAN_INPUT_RESPONSE_ARTIFACT,
  ISSUE_BODY_ARTIFACT,
  ISSUE_TITLE_ARTIFACT,
  ISSUE_WORD_ARTIFACT,
  REPORT_ARTIFACT
} from "../workflowArtifacts.js";
import {
  buildAgentConversationActionDefinition,
  buildAgentConversationStepDefinition
} from "../workflowDefinitionBuilders.js";
import {
  defineWorkflow,
  workflowGroup,
  workflowWhen
} from "../workflowDefinitionComposers.js";
import {
  coreLifecycleWorkflowIntentHandlers
} from "./coreLifecycle.js";
import { when } from "../workflowConditions.js";
import {
  STEP_INPUT_KIND,
  STEP_STATUS,
  assertAgentResultSource,
  artifactIsReady,
  artifactText,
  commandFailureInteraction,
  commandSucceeded,
  currentStepHelperInstruction,
  disableAction,
  handleStandardPromptInput,
  machineState,
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
  unsupportedInputKind,
  writeState
} from "../workflowStepMachineHelpers.js";

const moduleId = "core.coding";

const VIBE64_WORKFLOW_DEFINITION_IDS = deepFreeze({
  BIG_FEATURE: "big_feature",
  GENERAL_CODING: "general_coding",
  SEED_APPLICATION: "seed_application"
});
const DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID = VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE;
const CORE_CODING_WORKFLOW_GROUP_IDS = deepFreeze({
  FINISH_OFF: "finish_off",
  QA: "qa"
});

const agentConversationStepId = "agent_conversation";
const changesAcceptedStepId = "changes_accepted";
const deepUiCheckRunStepId = "deep_ui_check_run";
const implementationReviewedStepId = "implementation_reviewed";
const planAndExecuteStepId = "plan_and_execute";
const projectKnowledgeUpdatedStepId = "project_knowledge_updated";
const reportCreatedStepId = "report_created";
const reviewRunStepId = "review_run";
const seedPlanExecutedStepId = "seed_plan_executed";
const seedPlanMadeStepId = "seed_plan_made";
const finalReviewConversationActionId = "final_review_conversation";
const humanReviewConversationActionId = "human_review_conversation";
const ISSUE_FILE_STEP_ID = "issue_file_created";
const draftIssueActionId = "draft_issue";
const rejectIssueDraftActionId = "reject_issue_draft";
const SEED_APPLICATION_STEP_ID = "seed_application_defined";
const GITHUB_ISSUE_MODE_METADATA = "github_issue_mode";
const PLAN_READY_METADATA = "plan_ready";
const IMPLEMENTATION_DONE_METADATA = "implementation_done";
const GITHUB_ISSUE_MODES = deepFreeze({
  CREATE: "create",
  REUSE: "reuse",
  SKIP: "skip"
});

async function skipOptionalCheck(ctx = {}) {
  return ctx.forceAdvance("Skipped optional check.");
}

async function requestFinalReviewTweak(ctx = {}) {
  await ctx.writeMetadata("autopilot_final_review_followup", "recheck");
  return ctx.runAction(finalReviewConversationActionId, ctx.conversationInput());
}

async function recheckAfterFinalTweak(ctx = {}) {
  await ctx.deleteMetadata("autopilot_final_review_followup");
  return ctx.rewind(ctx.recheckTargetStepId());
}

const finalReviewIntentHandlers = deepFreeze({
  request_review_tweak: requestFinalReviewTweak,
  recheck_after_final_tweak: recheckAfterFinalTweak
});
const optionalCheckIntentHandlers = deepFreeze({
  skip_optional_check: skipOptionalCheck
});

function finishOffWorkflowGroup({
  recheckTo = "",
  rejectTo = ""
} = {}) {
  return workflowGroup({
    id: CORE_CODING_WORKFLOW_GROUP_IDS.FINISH_OFF,
    intentHandlers: {
      ...coreLifecycleWorkflowIntentHandlers,
      [changesAcceptedStepId]: finalReviewIntentHandlers
    },
    steps: [
      {
        recheckTo,
        rejectTo,
        stepId: changesAcceptedStepId
      },
      reportCreatedStepId,
      projectKnowledgeUpdatedStepId,
      "changes_committed",
      "create_pull_request",
      "pr_merged",
      "main_checkout_synced",
      "session_finished"
    ]
  });
}

function qaWorkflowGroup({
  humanReview = true
} = {}) {
  return workflowGroup({
    id: CORE_CODING_WORKFLOW_GROUP_IDS.QA,
    intentHandlers: {
      [deepUiCheckRunStepId]: optionalCheckIntentHandlers
    },
    steps: [
      workflowWhen(humanReview, implementationReviewedStepId),
      deepUiCheckRunStepId,
      reviewRunStepId,
      "project_validated"
    ]
  });
}

function createIssueOnGithubAction() {
  return {
    adapterCapability: "create_issue_on_gh",
    disabledReason: "Create the issue file before submitting it to GitHub.",
    disabledWhen: [when.metadataExists("issue_url")],
    disabledWhenReason: "The GitHub issue already exists.",
    enabledWhen: [when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_WORD_ARTIFACT, ISSUE_BODY_ARTIFACT)],
    enabledWhenReason: "Create the issue file before submitting it to GitHub.",
    icon: "github",
    id: "create_issue_on_gh",
    label: "Create issue on GH",
    type: "command"
  };
}

const coreCodingStepDefinitionsById = deepFreeze({
  [SEED_APPLICATION_STEP_ID]: {
    actions: [],
    autopilot: {
      kind: "issue_discussion",
      stop: true
    },
    description: "Define the initial application foundation as an issue.",
    id: SEED_APPLICATION_STEP_ID,
    label: "Seed application",
    next: {
      disabledReason: "Define and save the seed issue before continuing.",
      enabledWhen: [when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT)]
    },
    rewindCleanup: {
      actionResults: [],
      artifacts: [ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT],
      metadata: ["issue_title", ISSUE_WORD_ARTIFACT]
    }
  },
  [ISSUE_FILE_STEP_ID]: {
    actions: [
      {
        disabledReason: "Work details are already saved.",
        disabledWhen: [
          when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT)
        ],
        icon: "message-square-plus",
        id: draftIssueActionId,
        inputFields: [
          {
            kind: "textarea",
            label: "What do you want Vibe64 to work on?",
            name: "conversationRequest",
            placeholder: "Describe the feature, bug, or change you want.",
            requiredMessage: "Describe what you want Vibe64 to work on."
          }
        ],
        label: "Describe work",
        promptId: draftIssueActionId,
        recordsConversationTurn: true,
        type: "prompt"
      },
      {
        disabledReason: "Draft an issue before requesting improvements.",
        disabledWhen: [when.metadataExists("issue_url")],
        disabledWhenReason: "An existing issue is already selected.",
        enabledWhen: [when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT)],
        enabledWhenReason: "Draft an issue before requesting improvements.",
        icon: "rotate-ccw",
        id: rejectIssueDraftActionId,
        inputFields: [
          {
            kind: "textarea",
            label: "What should change?",
            name: "feedback",
            placeholder: "Tell Codex how to improve the saved issue draft.",
            requiredMessage: "Explain what should change before sending the improvement request."
          }
        ],
        label: "Send improvement request",
        promptId: draftIssueActionId,
        recordsConversationTurn: true,
        type: "prompt"
      },
      createIssueOnGithubAction()
    ],
    autopilot: {
      kind: "issue_discussion",
      stop: true
    },
    description: "Define the work and create a GitHub issue only when the starting point requires one.",
    id: ISSUE_FILE_STEP_ID,
    label: "Define work",
    next: {
      disabledReason: "Define the work before continuing.",
      enabledWhen: [when.allArtifactsReady(ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT)]
    },
    presentation: {
      stop: {
        intents: [
          {
            actionId: draftIssueActionId,
            id: draftIssueActionId,
            label: "Describe work",
            style: "primary",
            type: "action"
          },
          {
            actionId: "create_issue_on_gh",
            id: "create_issue_on_gh",
            label: "Create issue on GH",
            style: "secondary",
            type: "action"
          }
        ],
        screen: {
          kind: "issue_source",
          message: "Describe the work, review the saved details, and create a GitHub issue only when this session requires one.",
          primaryIntentId: draftIssueActionId,
          title: "Define work"
        }
      }
    },
    rewindCleanup: {
      actionResults: [draftIssueActionId, rejectIssueDraftActionId, "create_issue_on_gh"],
      artifacts: [ISSUE_TITLE_ARTIFACT, ISSUE_BODY_ARTIFACT, ISSUE_WORD_ARTIFACT],
      metadata: [
        "issue_url",
        "issue_number",
        "issue_title",
        "issue_source",
        "work_anchor_number",
        "work_anchor_title",
        "work_anchor_type",
        "work_anchor_url",
        ISSUE_WORD_ARTIFACT,
        PLAN_READY_METADATA,
        IMPLEMENTATION_DONE_METADATA
      ]
    }
  },
  [seedPlanMadeStepId]: {
    actions: [
      {
        id: "make_seed_plan",
        label: "Make seed plan",
        promptId: "make_seed_plan",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "make_seed_plan",
      label: "Make seed plan"
    },
    description: "Ask Codex to plan the initial framework seed work.",
    id: seedPlanMadeStepId,
    label: "Make seed plan",
    rewindCleanup: {
      actionResults: ["make_seed_plan"]
    }
  },
  [seedPlanExecutedStepId]: {
    actions: [
      {
        id: "execute_seed_plan",
        label: "Execute seed plan",
        promptId: "execute_seed_plan",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "execute_seed_plan",
      label: "Execute seed plan"
    },
    description: "Ask Codex to seed the framework app and local development foundation.",
    id: seedPlanExecutedStepId,
    label: "Execute seed plan",
    rewindCleanup: {
      actionResults: ["execute_seed_plan"]
    }
  },
  [planAndExecuteStepId]: {
    actions: [
      {
        disabledWhen: [when.metadataExists(PLAN_READY_METADATA)],
        disabledWhenReason: "The plan is already ready.",
        id: "make_plan",
        label: "Make a plan",
        promptId: "make_plan",
        type: "prompt"
      },
      {
        disabledReason: "Implementation is already complete.",
        disabledWhen: [when.metadataExists(IMPLEMENTATION_DONE_METADATA)],
        disabledWhenReason: "Implementation is already complete.",
        enabledWhen: [when.metadataExists(PLAN_READY_METADATA)],
        enabledWhenReason: "Make the plan before executing it.",
        id: "execute_plan",
        label: "Execute plan",
        promptId: "execute_plan",
        type: "prompt"
      }
    ],
    autopilot: {
      actionSequence: [
        {
          actionId: "make_plan",
          completeWhen: [when.metadataExists(PLAN_READY_METADATA)],
          label: "Make a plan"
        },
        {
          actionId: "execute_plan",
          completeWhen: [when.metadataExists(IMPLEMENTATION_DONE_METADATA)],
          label: "Execute plan"
        }
      ],
      label: "Plan and execute"
    },
    description: "Ask Codex to create the implementation plan, then execute it.",
    id: planAndExecuteStepId,
    label: "Plan and execute",
    next: {
      disabledReason: "Execute the plan before continuing.",
      enabledWhen: [when.metadataExists(IMPLEMENTATION_DONE_METADATA)]
    },
    rewindCleanup: {
      actionResults: ["make_plan", "execute_plan"],
      metadata: [PLAN_READY_METADATA, IMPLEMENTATION_DONE_METADATA]
    }
  },
  [implementationReviewedStepId]: {
    actions: [
      buildAgentConversationActionDefinition({
        id: humanReviewConversationActionId,
        label: "Ask AI for tweaks",
        inputLabel: "What would you like changed?",
        inputPlaceholder: "Describe the tweak in plain language."
      })
    ],
    autopilot: {
      actionId: humanReviewConversationActionId,
      kind: "implementation_review",
      stop: true
    },
    description: "Try the implemented work and request small tweaks before slower review steps.",
    id: implementationReviewedStepId,
    label: "Human review",
    presentation: {
      stop: {
        intents: [
          {
            control: {
              action: VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF,
              disabledWhen: [VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_DISABLED],
              icon: VIBE64_CLIENT_CONTROL_ICON_TOKENS.DIFF,
              loadingWhen: [VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_LOADING]
            },
            enabled: true,
            id: "open_diff",
            label: "Review diff"
          },
          {
            id: "accept_review",
            label: "Looks good, continue",
            style: "primary",
            type: "continue"
          },
          {
            actionId: humanReviewConversationActionId,
            id: "request_review_tweak",
            style: "secondary",
            type: "action"
          }
        ],
        persistWhenComplete: true,
        screen: {
          kind: "review",
          message: "Try the work now. Ask Codex for small tweaks, or continue when it looks right.",
          sections: ["launch_controls", "report_preview", "response_preview"],
          title: "Human review",
          primaryIntentId: "request_review_tweak",
          variant: "implementation"
        }
      }
    },
    rewindCleanup: {
      actionResults: [humanReviewConversationActionId],
      artifacts: [HUMAN_INPUT_RESPONSE_ARTIFACT]
    }
  },
  [agentConversationStepId]: buildAgentConversationStepDefinition({
    actionLabel: "Ask Codex for changes",
    description: "Ask Codex to make focused code changes while you inspect and steer the work.",
    id: agentConversationStepId,
    inputLabel: "What should Codex change?",
    inputPlaceholder: "Describe the code change, cleanup, bug fix, or follow-up request.",
    label: "Make changes",
    responseArtifact: HUMAN_INPUT_RESPONSE_ARTIFACT
  }),
  [deepUiCheckRunStepId]: {
    actions: [
      {
        id: "run_deep_ui_check",
        label: "Run deep UI check",
        promptId: "run_deep_ui_check",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "run_deep_ui_check",
      label: "Run deep UI check",
      userDecision: true
    },
    description: "Run the deeper UI review when the target supports it.",
    id: deepUiCheckRunStepId,
    label: "Run deep UI check",
    presentation: {
      decision: {
        intents: [
          {
            actionId: "run_deep_ui_check",
            id: "run_optional_check",
            style: "primary",
            type: "action"
          },
          {
            enabledWhen: "has_next_step",
            id: "skip_optional_check",
            label: "Skip"
          }
        ],
        screen: {
          kind: "decision",
          message: "This optional check can take a long time. Run it now, or skip it and continue.",
          titleActionId: "run_deep_ui_check",
          titleSuffix: "?"
        }
      }
    },
    rewindCleanup: {
      actionResults: ["run_deep_ui_check"]
    }
  },
  [reviewRunStepId]: {
    actions: [
      {
        id: "run_deslop",
        label: "Run deslop",
        promptId: "run_deslop",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "run_deslop",
      label: "Run deslop"
    },
    description: "Run the review/deslop prompt.",
    id: reviewRunStepId,
    label: "Run review/deslop",
    rewindCleanup: {
      actionResults: ["run_deslop"]
    }
  },
  [changesAcceptedStepId]: {
    actions: [
      buildAgentConversationActionDefinition({
        id: finalReviewConversationActionId,
        label: "Ask AI for tweaks",
        inputLabel: "What should Codex adjust before finalizing?",
        inputPlaceholder: "Describe the final tweak. Studio will rerun review and validation afterwards."
      })
    ],
    autopilot: {
      actionId: finalReviewConversationActionId,
      kind: "final_review",
      stop: true
    },
    description: "Review the validated work before the report, commit, and pull request.",
    id: changesAcceptedStepId,
    label: "Final review",
    presentation: {
      automation: {
        recheckAfterPrompt: {
          intentId: "recheck_after_final_tweak",
          label: "Recheck changes",
          metadataName: "autopilot_final_review_followup",
          metadataValue: "recheck",
          promptComplete: true,
          statuses: ["ready", "done"]
        }
      },
      stop: {
        intents: [
          {
            control: {
              action: VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF,
              disabledWhen: [VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_DISABLED],
              icon: VIBE64_CLIENT_CONTROL_ICON_TOKENS.DIFF,
              loadingWhen: [VIBE64_CLIENT_CONTROL_STATE_FLAGS.DIFF_LOADING]
            },
            enabled: true,
            id: "open_diff",
            label: "Review diff"
          },
          {
            id: "accept_review",
            label: "Accept and finalize",
            style: "primary",
            type: "continue"
          },
          {
            actionId: finalReviewConversationActionId,
            id: "request_review_tweak",
            style: "secondary"
          },
          {
            enabled: true,
            id: "reject",
            inputFields: [
              {
                kind: "textarea",
                label: "What should change in the plan?",
                name: "feedback",
                requiredMessage: "Describe what should change before sending the work back to Codex."
              }
            ],
            label: "Reject, revise",
            type: "reject"
          }
        ],
        persistWhenComplete: true,
        screen: {
          kind: "review",
          message: "Review the validated work before Autopilot writes the report and commits.",
          sections: ["launch_controls", "report_preview", "response_preview"],
          title: "Final review",
          primaryIntentId: "request_review_tweak",
          variant: "final"
        }
      }
    },
    rewindCleanup: {
      actionResults: [finalReviewConversationActionId],
      metadata: ["autopilot_final_review_followup"]
    }
  },
  [reportCreatedStepId]: {
    actions: [
      {
        id: "write_report",
        label: "Write report",
        promptId: "write_report",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "write_report",
      completeWhen: [when.artifactReady(REPORT_ARTIFACT)],
      label: "Write report"
    },
    description: "Write the local report explaining what changed and why.",
    id: reportCreatedStepId,
    label: "Write report",
    next: {
      disabledReason: "Write the session report before updating project knowledge.",
      enabledWhen: [when.artifactReady(REPORT_ARTIFACT)]
    },
    rewindCleanup: {
      actionResults: ["write_report"],
      artifacts: [REPORT_ARTIFACT]
    }
  },
  [projectKnowledgeUpdatedStepId]: {
    actions: [
      {
        id: "update_project_knowledge",
        label: "Update project knowledge",
        promptId: "update_project_knowledge",
        type: "prompt"
      }
    ],
    autopilot: {
      actionId: "update_project_knowledge",
      label: "Update project knowledge"
    },
    description: "Update adapter-supported project knowledge.",
    id: projectKnowledgeUpdatedStepId,
    label: "Update project knowledge",
    rewindCleanup: {
      actionResults: ["update_project_knowledge"]
    }
  }
});

const coreCodingWorkflowDefinitions = deepFreeze([
  defineWorkflow({
    description: "Create the initial application scaffold and local development foundation.",
    id: VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION,
    label: "Seed application",
    parts: [
      "session_created",
      "work_source_selected",
      "worktree_created",
      SEED_APPLICATION_STEP_ID,
      seedPlanMadeStepId,
      seedPlanExecutedStepId,
      "dependencies_installed",
      "project_validated",
      finishOffWorkflowGroup({
        rejectTo: seedPlanMadeStepId,
        recheckTo: "project_validated"
      })
    ],
    sessionWord: "seeding",
    userSelectable: false
  }),
  defineWorkflow({
    description: "Plan, implement, review, validate, commit, create a PR, and optionally merge.",
    id: VIBE64_WORKFLOW_DEFINITION_IDS.BIG_FEATURE,
    label: "Big feature",
    parts: [
      "session_created",
      "work_source_selected",
      "worktree_created",
      "dependencies_installed",
      ISSUE_FILE_STEP_ID,
      planAndExecuteStepId,
      qaWorkflowGroup({
        humanReview: true
      }),
      finishOffWorkflowGroup({
        rejectTo: planAndExecuteStepId,
        recheckTo: reviewRunStepId
      })
    ],
    userSelectable: true
  }),
  defineWorkflow({
    description: "Make focused code changes with Codex, review, validate, commit, create a PR, and optionally merge.",
    id: VIBE64_WORKFLOW_DEFINITION_IDS.GENERAL_CODING,
    label: "General coding",
    parts: [
      "session_created",
      "work_source_selected",
      "worktree_created",
      "dependencies_installed",
      agentConversationStepId,
      qaWorkflowGroup(),
      finishOffWorkflowGroup({
        rejectTo: agentConversationStepId,
        recheckTo: reviewRunStepId
      })
    ],
    sessionWord: "coding",
    userSelectable: true
  })
]);

function issueFilesAreReady(session = {}) {
  return [
    ISSUE_TITLE_ARTIFACT,
    ISSUE_WORD_ARTIFACT,
    ISSUE_BODY_ARTIFACT
  ].every((artifactName) => artifactIsReady(session, artifactName));
}

function githubIssueMode(session = {}) {
  return normalizeText(session.metadata?.[GITHUB_ISSUE_MODE_METADATA]);
}

function githubIssueShouldBeCreated(session = {}) {
  return githubIssueMode(session) === GITHUB_ISSUE_MODES.CREATE;
}

function githubIssueShouldBeSkipped(session = {}) {
  return githubIssueMode(session) === GITHUB_ISSUE_MODES.SKIP;
}

function githubIssueIsReused(session = {}) {
  return githubIssueMode(session) === GITHUB_ISSUE_MODES.REUSE;
}

function disableActions(session = {}, reasonsById = {}) {
  const reasons = Object.entries(reasonsById)
    .filter(([, reason]) => normalizeText(reason));
  if (reasons.length === 0) {
    return Array.isArray(session.actions) ? session.actions : [];
  }
  return (Array.isArray(session.actions) ? session.actions : []).map((action) => {
    const reasonEntry = reasons.find(([id]) => action.id === id);
    if (!reasonEntry) {
      return action;
    }
    return {
      ...action,
      disabledReason: reasonEntry[1],
      enabled: false
    };
  });
}

function inputResponseText(input = {}) {
  return normalizeText(input.text || input.fields?.response || input.fields?.conversationRequest);
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
  const title = requireInputValue(fields.title, "Work title is required.");
  const body = requireInputValue(fields.body, "Work description is required.");
  const word = requireInputValue(fields.word, "Session label is required.");
  const mode = githubIssueMode(context.session);
  const preservesExistingPrAnchor = mode === GITHUB_ISSUE_MODES.SKIP &&
    normalizeText(context.session.metadata?.work_source) === "existing_pr";
  const staleMetadata = preservesExistingPrAnchor
    ? ["issue_number", "issue_url"]
    : ["issue_number", "issue_url", "work_anchor_number", "work_anchor_url"];
  const metadata = {
    issue_title: title,
    ...(preservesExistingPrAnchor ? {} : { work_anchor_title: title }),
    ...(mode === GITHUB_ISSUE_MODES.SKIP
      ? {
          issue_source: "none",
          ...(preservesExistingPrAnchor ? {} : { work_anchor_type: "description" })
        }
      : {
          issue_source: "draft",
          work_anchor_type: "issue"
        })
  };

  await Promise.all([
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_TITLE_ARTIFACT, artifactText(title)),
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_BODY_ARTIFACT, artifactText(body)),
    context.runtime.store.writeArtifact(context.session.sessionId, ISSUE_WORD_ARTIFACT, artifactText(word)),
    ...Object.entries(metadata).map(([name, value]) => context.runtime.store.writeMetadataValue(
      context.session.sessionId,
      name,
      value
    )),
    context.runtime.store.writeIssueWordMetadata(context.session.sessionId, word),
    context.runtime.store.deleteMetadataValues(context.session.sessionId, staleMetadata)
  ]);
}

function issueInputInteraction(status = STEP_STATUS.WAITING_FOR_INPUT, values = {}, {
  createGithubIssue = false
} = {}) {
  const reviewIntents = status === STEP_STATUS.CONFIRM_FILES
    ? [
        {
          id: "continue_step",
          label: createGithubIssue ? "Create GitHub issue" : "Use this description",
          style: "primary",
          type: createGithubIssue ? "action" : "continue",
          ...(createGithubIssue ? { actionId: "create_issue_on_gh" } : {})
        },
        {
          actionId: rejectIssueDraftActionId,
          id: rejectIssueDraftActionId,
          label: "Send improvement request",
          style: "secondary",
          type: "action"
        }
      ]
    : [];
  return {
    fields: [
      {
        kind: "text",
        label: createGithubIssue ? "Issue title" : "Work title",
        name: "title",
        required: true,
        requiredMessage: createGithubIssue ? "Issue title is required." : "Work title is required.",
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
        label: createGithubIssue ? "Issue body" : "Work description",
        name: "body",
        required: true,
        requiredMessage: createGithubIssue ? "Issue body is required." : "Work description is required.",
        value: values.body || ""
      }
    ],
    kind: "confirm_files_run_command",
    intents: reviewIntents,
    prompt: status === STEP_STATUS.CONFIRM_FILES
      ? (createGithubIssue
          ? "Review the issue details. Save changes here, or create the GitHub issue."
          : "Review the work details. Save changes here, or continue without creating a GitHub issue.")
      : (createGithubIssue
          ? "Discuss the requested change, then submit the issue title, session label, and issue body."
          : "Discuss the requested change, then submit the work title, session label, and description."),
    submitKind: status === STEP_STATUS.CONFIRM_FILES
      ? STEP_INPUT_KIND.CONFIRM_FILES
      : STEP_INPUT_KIND.READY,
    submitLabel: status === STEP_STATUS.CONFIRM_FILES ? "Update details" : "Save details",
    title: createGithubIssue ? "Define issue" : "Define work"
  };
}

const issueFilePhase = Object.freeze({
  CHOOSE_SOURCE: "choose_source",
  CREATING_ISSUE: "creating_issue",
  DRAFTING: "drafting",
  EXISTING_SELECTED: "existing_selected",
  REVIEW_DRAFT: "review_draft",
  SKIPPED: "skipped"
});

function issueSkipMessage(session = {}) {
  return normalizeText(session.metadata?.work_source) === "existing_pr"
    ? "Skipped: existing PR selected as the work anchor; no GitHub issue is required."
    : "No GitHub issue is required for this session.";
}

function issueSkipState(session = {}) {
  return machineState(STEP_STATUS.DONE, {
    message: issueSkipMessage(session),
    phase: issueFilePhase.SKIPPED,
    skipReason: issueSkipMessage(session)
  });
}

function issueSourceSelectionState(details = {}) {
  return machineState(STEP_STATUS.READY, {
    phase: issueFilePhase.CHOOSE_SOURCE,
    ...details
  });
}

function issueDraftReviewState(details = {}) {
  return machineState(STEP_STATUS.CONFIRM_FILES, {
    phase: issueFilePhase.REVIEW_DRAFT,
    ...details
  });
}

function issueDraftPromptIsActive(state = {}) {
  return [
    STEP_STATUS.ATTEMPTING_EXECUTION,
    STEP_STATUS.AWAITING_AGENT_RESULT,
    STEP_STATUS.WAITING_FOR_INPUT
  ].includes(state.status);
}

async function submitIssueDraftAgentResult(context = {}, machine = {}, input = {}) {
  assertAgentResultSource(context.session, input);
  switch (input.kind) {
    case STEP_INPUT_KIND.WAITING_FOR_INPUT:
      await writeState(context, machine, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
        message: input.message,
        phase: issueFilePhase.DRAFTING,
        response: inputResponseText(input),
        source: input.source
      }));
      return;

    case STEP_INPUT_KIND.CONFIRM_FILES:
    case STEP_INPUT_KIND.READY:
      await writeIssueFieldValues(context, input.fields);
      await writeState(context, machine, issueDraftReviewState({
        response: inputResponseText(input),
        source: input.source
      }));
      return;

    default:
      throw unsupportedInputKind(input.kind, machine.stepId);
  }
}

const issueFileMachine = {
  promptActionId: draftIssueActionId,
  stepId: ISSUE_FILE_STEP_ID,

  initialState(context = {}) {
    const filesReady = issueFilesAreReady(context.session);
    if (githubIssueShouldBeSkipped(context.session) && filesReady) {
      return issueSkipState(context.session);
    }
    if ((githubIssueIsReused(context.session) || githubIssueShouldBeCreated(context.session)) && filesReady && metadataExists(context.session, "issue_url")) {
      return machineState(STEP_STATUS.DONE, {
        phase: issueFilePhase.EXISTING_SELECTED
      });
    }
    return filesReady
      ? issueDraftReviewState()
      : issueSourceSelectionState();
  },

  async view(context = {}) {
    let state = await readState(context, this);
    const filesReady = issueFilesAreReady(context.session);
    const createGithubIssue = githubIssueShouldBeCreated(context.session);
    const skipGithubIssue = githubIssueShouldBeSkipped(context.session);
    if (skipGithubIssue && filesReady && state.status !== STEP_STATUS.CONFIRM_FILES && !issueDraftPromptIsActive(state)) {
      state = issueSkipState(context.session);
    } else if ((githubIssueIsReused(context.session) || createGithubIssue) && filesReady && metadataExists(context.session, "issue_url")) {
      state = machineState(STEP_STATUS.DONE, {
        phase: issueFilePhase.EXISTING_SELECTED
      });
    } else if (filesReady && state.status !== STEP_STATUS.CONFIRM_FILES && !issueDraftPromptIsActive(state)) {
      state = issueDraftReviewState({
        from: state.status
      });
    } else if (state.status === STEP_STATUS.DONE) {
      state = issueSourceSelectionState({
        from: STEP_STATUS.DONE,
        message: "Issue details are incomplete. Select the issue again or draft a new one."
      });
    }

    switch (state.status) {
      case STEP_STATUS.READY:
        return {
          actions: disableActions(context.session, {
            create_issue_on_gh: createGithubIssue
              ? "Save the issue details before creating the GitHub issue."
              : "This session continues without creating a GitHub issue.",
            [rejectIssueDraftActionId]: "Describe the work before requesting improvements."
          }),
          next: nextForSession(context.session, {
            disabledReason: "Describe the work before continuing."
          }),
          stepMachine: publicState(this, {
            ...state,
            message: state.message || "Describe the work before continuing."
          })
        };

      case STEP_STATUS.ATTEMPTING_EXECUTION:
        return promptStepWaitingView(context, this, state, "Wait for Vibe64 to create the GitHub issue.");

      case STEP_STATUS.AWAITING_AGENT_RESULT:
        return promptStepWaitingView(context, this, state, "Wait for Codex to draft the work details.");

      case STEP_STATUS.WAITING_FOR_INPUT:
        if (state.phase === issueFilePhase.CREATING_ISSUE) {
          return {
            actions: disableAction(context.session, "create_issue_on_gh", "Resolve the issue command before retrying."),
            interaction: commandFailureInteraction({
              prompt: state.message || "Could not create the GitHub issue. Explain what should happen, then retry.",
              title: "Issue command needs attention"
            }),
            next: nextForSession(context.session, {
              disabledReason: "Resolve the issue command before continuing."
            }),
            stepMachine: publicState(this, state)
          };
        }
        return promptStepWaitingForInputView(context, this, state, {
          prompt: state.message || "Codex needs more information before it can draft the issue.",
          title: "Describe the issue"
        });

      case STEP_STATUS.CONFIRM_FILES: {
        const values = await readIssueFieldValues(context);
        return {
          actions: skipGithubIssue
            ? disableAction(context.session, "create_issue_on_gh", "This session continues without creating a GitHub issue.")
            : context.session.actions,
          interaction: issueInputInteraction(STEP_STATUS.CONFIRM_FILES, values, {
            createGithubIssue
          }),
          next: nextForSession(context.session, {
            disabledReason: createGithubIssue ? "Create the GitHub issue before continuing." : "",
            enabled: !createGithubIssue
          }),
          stepMachine: publicState(this, {
            ...state,
            message: state.message || (createGithubIssue ? "Review the saved issue draft." : "Review the saved work description.")
          })
        };
      }

      case STEP_STATUS.DONE:
        return {
          actions: disableActions(context.session, {
            create_issue_on_gh: state.skipReason || "The GitHub issue state is already resolved.",
            [draftIssueActionId]: state.skipReason || "Work details are already saved.",
            [rejectIssueDraftActionId]: state.skipReason || "Work details are already saved."
          }),
          next: nextForSession(context.session, {
            enabled: true
          }),
          stepMachine: publicState(this, {
            ...state,
            message: state.message || "Work details are ready."
          })
        };

      case STEP_STATUS.FAILED:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Resolve the work definition failure before continuing."
          }),
          stepMachine: publicState(this, {
            ...state,
            message: state.message || "Work definition failed."
          })
        };

      default:
        return {
          next: nextForSession(context.session, {
            disabledReason: "Describe the work before continuing."
          }),
          stepMachine: publicState(this, state)
        };
    }
  },

  async actionStarted(context = {}) {
    if (context.actionId === draftIssueActionId) {
      await writeState(context, this, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
        phase: issueFilePhase.DRAFTING
      }));
      return;
    }

    if (context.actionId === "create_issue_on_gh") {
      await writeState(context, this, machineState(STEP_STATUS.ATTEMPTING_EXECUTION, {
        phase: issueFilePhase.CREATING_ISSUE
      }));
      return;
    }

    if (context.actionId === rejectIssueDraftActionId) {
      await writeState(context, this, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
        phase: issueFilePhase.DRAFTING
      }));
    }
  },

  async actionFinished(context = {}) {
    if (context.actionId === "create_issue_on_gh") {
      if (await commandSucceeded(context, "issue_url")) {
        await writeState(context, this, machineState(STEP_STATUS.DONE, {
          phase: issueFilePhase.EXISTING_SELECTED
        }));
        return;
      }
      await writeState(context, this, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
        from: STEP_STATUS.ATTEMPTING_EXECUTION,
        message: normalizeText(context.actionResult?.message) || "Could not create the GitHub issue.",
        output: normalizeText(context.actionResult?.output),
        phase: issueFilePhase.CREATING_ISSUE
      }));
      return;
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);

    switch (state.status) {
      case STEP_STATUS.READY:
        if (input.kind === STEP_INPUT_KIND.CONFIRM_FILES || input.kind === STEP_INPUT_KIND.READY) {
          await writeIssueFieldValues(context, input.fields);
          await writeState(context, this, issueDraftReviewState({
            response: inputResponseText(input),
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.AWAITING_AGENT_RESULT:
        await submitIssueDraftAgentResult(context, this, input);
        return;

      case STEP_STATUS.WAITING_FOR_INPUT:
        if (state.phase === issueFilePhase.CREATING_ISSUE && (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE)) {
          await writeState(context, this, issueDraftReviewState({
            message: input.message,
            response: inputResponseText(input),
            source: input.source
          }));
          return;
        }
        if (input.source === "codex") {
          await submitIssueDraftAgentResult(context, this, input);
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.CONFIRM_FILES:
        if (input.kind === STEP_INPUT_KIND.CONFIRM_FILES || input.kind === STEP_INPUT_KIND.READY) {
          await writeIssueFieldValues(context, input.fields);
          await writeState(context, this, githubIssueShouldBeSkipped(context.session)
            ? issueSkipState(context.session)
            : issueDraftReviewState({
                response: inputResponseText(input),
                source: input.source
              }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED || input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, issueSourceSelectionState({
            message: input.message,
            response: inputResponseText(input),
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.DONE:
      default:
        throw vibe64Error("The issue step is already complete.", "vibe64_step_input_not_available");
    }
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    if (![STEP_INPUT_KIND.READY, STEP_INPUT_KIND.CONFIRM_FILES].includes(input.kind)) {
      return "";
    }
    return githubIssueShouldBeSkipped(context.session)
      ? "Work description saved."
      : "Issue draft submitted for review.";
  },

  promptInstruction() {
    return currentStepHelperInstruction({
      doneFields: {
        body: "Markdown issue body describing the requested change, context, and acceptance criteria.",
        title: "Concise GitHub issue title.",
        word: "Short Vibe64 session label/word derived from the issue title."
      },
      doneMeaning: "You have enough information to propose a GitHub issue title, body, and Vibe64 session label for user review.",
      waitingForInputMeaning: "You need more information from the user before drafting the issue."
    });
  }
};

const makePlanMachine = {
  promptActionId: "make_plan",
  stepId: planAndExecuteStepId,

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

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Plan submitted for review."
      : "";
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
  stepId: seedPlanMadeStepId,

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "make_seed_plan");
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Seed plan submitted for review."
      : "";
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
  stepId: planAndExecuteStepId,

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

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Implementation submitted for review."
      : "";
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

const planAndExecutePhase = Object.freeze({
  EXECUTING: "executing",
  PLANNING: "planning",
  PLAN_READY: "plan_ready"
});

function planAndExecuteReadyState(details = {}) {
  return machineState(STEP_STATUS.READY, {
    phase: planAndExecutePhase.PLANNING,
    ...details
  });
}

function planAndExecutePlanReadyState(details = {}) {
  return machineState(STEP_STATUS.READY, {
    phase: planAndExecutePhase.PLAN_READY,
    ...details
  });
}

async function markPlanAndExecuteActionStarted(context = {}, machine = {}, {
  actionId = "",
  phase = ""
} = {}) {
  if (context.actionId !== actionId) {
    return;
  }
  const state = await readState(context, machine);
  switch (state.status) {
    case STEP_STATUS.READY:
    case STEP_STATUS.FAILED:
    case STEP_STATUS.WAITING_FOR_INPUT:
      await writeState(context, machine, machineState(STEP_STATUS.AWAITING_AGENT_RESULT, {
        phase,
        response: state.response,
        source: state.source
      }));
      return;
    case STEP_STATUS.AWAITING_AGENT_RESULT:
    case STEP_STATUS.DONE:
    default:
      return;
  }
}

const planAndExecuteMachine = {
  promptActionId: "make_plan",
  stepId: planAndExecuteStepId,

  initialState(context = {}) {
    if (metadataExists(context.session, IMPLEMENTATION_DONE_METADATA)) {
      return machineState(STEP_STATUS.DONE, {
        phase: planAndExecutePhase.EXECUTING
      });
    }
    if (metadataExists(context.session, PLAN_READY_METADATA)) {
      return planAndExecutePlanReadyState();
    }
    return planAndExecuteReadyState();
  },

  async view(context = {}) {
    let state = await readState(context, this);
    if (metadataExists(context.session, IMPLEMENTATION_DONE_METADATA)) {
      state = machineState(STEP_STATUS.DONE, {
        phase: planAndExecutePhase.EXECUTING
      });
    } else if (
      metadataExists(context.session, PLAN_READY_METADATA) &&
      ![STEP_STATUS.AWAITING_AGENT_RESULT, STEP_STATUS.WAITING_FOR_INPUT].includes(state.status)
    ) {
      state = planAndExecutePlanReadyState({
        from: state.status
      });
    }

    switch (state.status) {
      case STEP_STATUS.DONE:
        return promptStepDoneView(context, this, state);
      case STEP_STATUS.WAITING_FOR_INPUT:
        return promptStepWaitingForInputView(context, this, state, {
          actionId: state.phase === planAndExecutePhase.EXECUTING ? "execute_plan" : "make_plan",
          prompt: state.message || "Codex needs more information before this step can continue."
        });
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.FAILED:
      default:
        return promptStepWaitingView(
          context,
          this,
          state,
          state.phase === planAndExecutePhase.PLAN_READY
            ? "Ask Codex to execute the plan before continuing."
            : "Ask Codex to make the plan before continuing."
        );
    }
  },

  async submitInput(context = {}) {
    const state = await readState(context, this);
    const input = normalizeMachineInput(context.input);
    if (state.status === STEP_STATUS.AWAITING_AGENT_RESULT) {
      assertAgentResultSource(context.session, input);
    }

    switch (state.status) {
      case STEP_STATUS.READY:
      case STEP_STATUS.AWAITING_AGENT_RESULT:
      case STEP_STATUS.WAITING_FOR_INPUT:
      case STEP_STATUS.FAILED:
        if (input.kind === STEP_INPUT_KIND.WAITING_FOR_INPUT) {
          await writeState(context, this, machineState(STEP_STATUS.WAITING_FOR_INPUT, {
            from: STEP_STATUS.AWAITING_AGENT_RESULT,
            message: input.message,
            phase: state.phase || planAndExecutePhase.PLANNING,
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.USER_RESPONSE) {
          await writeState(context, this, machineState(STEP_STATUS.READY, {
            message: input.message,
            phase: state.phase || planAndExecutePhase.PLANNING,
            response: inputResponseText(input),
            source: input.source
          }));
          return;
        }
        if (input.kind === STEP_INPUT_KIND.READY || input.kind === STEP_INPUT_KIND.CONSIDER_RESOLVED) {
          if (state.phase === planAndExecutePhase.EXECUTING) {
            await context.runtime.store.writeMetadataValue(context.session.sessionId, IMPLEMENTATION_DONE_METADATA, "yes");
            await writeState(context, this, machineState(STEP_STATUS.DONE, {
              message: input.message,
              phase: planAndExecutePhase.EXECUTING,
              source: input.source
            }));
            return;
          }
          await context.runtime.store.writeMetadataValue(context.session.sessionId, PLAN_READY_METADATA, "yes");
          await writeState(context, this, planAndExecutePlanReadyState({
            message: input.message,
            source: input.source
          }));
          return;
        }
        throw unsupportedInputKind(input.kind, this.stepId);

      case STEP_STATUS.DONE:
      default:
        throw vibe64Error("This step is already complete.", "vibe64_step_input_not_available");
    }
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    if (input.kind !== STEP_INPUT_KIND.READY) {
      return "";
    }
    return context.session.stepMachine?.phase === planAndExecutePhase.EXECUTING
      ? "Implementation submitted for review."
      : "Plan submitted for review.";
  },

  async actionStarted(context = {}) {
    await markPlanAndExecuteActionStarted(context, this, {
      actionId: "make_plan",
      phase: planAndExecutePhase.PLANNING
    });
    await markPlanAndExecuteActionStarted(context, this, {
      actionId: "execute_plan",
      phase: planAndExecutePhase.EXECUTING
    });
  },

  promptInstruction({ action = {} } = {}) {
    return normalizeText(action.id) === "execute_plan"
      ? currentStepHelperInstruction({
          doneMeaning: "The implementation work is complete enough to continue to review.",
          waitingForInputMeaning: "You cannot continue implementation without a user decision or missing project detail."
        })
      : currentStepHelperInstruction({
          doneMeaning: "The implementation plan has been written in the Codex response and is ready for execution.",
          waitingForInputMeaning: "You cannot make a useful plan without a user decision or clarification."
        });
  }
};

const seedPlanExecutedMachine = {
  ...executePlanMachine,
  promptActionId: "execute_seed_plan",
  stepId: seedPlanExecutedStepId,

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "execute_seed_plan");
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Seed implementation submitted for review."
      : "";
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
  stepId: deepUiCheckRunStepId,

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "run_deep_ui_check");
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Deep UI check completed."
      : "";
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
  stepId: reviewRunStepId,

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "run_deslop");
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Review/deslop completed."
      : "";
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
  stepId: projectKnowledgeUpdatedStepId,

  async actionStarted(context = {}) {
    return markPromptActionStarted(context, this, "update_project_knowledge");
  },

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Project knowledge update completed."
      : "";
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
  stepId: reportCreatedStepId,

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

  inputCompletionMessage(context = {}) {
    const input = normalizeMachineInput(context.input);
    return input.kind === STEP_INPUT_KIND.READY
      ? "Report submitted for review."
      : "";
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

const coreCodingSteps = Object.freeze(Object.values(Object.freeze({
  [SEED_APPLICATION_STEP_ID]: {
    config: {
      draftReady: issueFilesAreReady,
      completionMessage: "Seed issue draft submitted for review.",
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
      unsupportedDoneMessage: "The seed definition step cannot accept input right now.",
      waitingForInputState: (input = {}) => ({
        doing: "discussion",
        message: input.message
      }),
      waitingInteraction: () => issueInputInteraction(STEP_STATUS.WAITING_FOR_INPUT, {})
    },
    definition: coreCodingStepDefinitionsById[SEED_APPLICATION_STEP_ID],
    factoryId: "editable_artifact_review",
    id: SEED_APPLICATION_STEP_ID
  },
  [ISSUE_FILE_STEP_ID]: {
    definition: coreCodingStepDefinitionsById[ISSUE_FILE_STEP_ID],
    id: ISSUE_FILE_STEP_ID,
    machine: issueFileMachine
  },
  [seedPlanMadeStepId]: {
    definition: coreCodingStepDefinitionsById[seedPlanMadeStepId],
    id: seedPlanMadeStepId,
    machine: seedPlanMadeMachine
  },
  [seedPlanExecutedStepId]: {
    definition: coreCodingStepDefinitionsById[seedPlanExecutedStepId],
    id: seedPlanExecutedStepId,
    machine: seedPlanExecutedMachine
  },
  [planAndExecuteStepId]: {
    definition: coreCodingStepDefinitionsById[planAndExecuteStepId],
    id: planAndExecuteStepId,
    machine: planAndExecuteMachine
  },
  [implementationReviewedStepId]: {
    config: {
      completionMessage: "Human review turn completed.",
      completionPolicy: {
        decidedBy: "ai",
        enoughWhen: "the requested focused tweak has either been made and focused checks run when practical, or you can clearly report that no code change is needed.",
        waitingForInputMeaning: "You cannot complete the focused review tweak without a user decision or missing project detail."
      },
      promptActionId: humanReviewConversationActionId,
      waitingMessage: "Wait for Codex to finish this review turn."
    },
    definition: coreCodingStepDefinitionsById[implementationReviewedStepId],
    factoryId: "chat_with_ai",
    id: implementationReviewedStepId
  },
  [agentConversationStepId]: {
    config: {
      completionMessage: "Codex conversation turn completed.",
      completionPolicy: {
        decidedBy: "user"
      },
      nextWhenIdle: (context = {}) => ({
        disabledReason: "Ask Codex for changes before continuing.",
        enabled: artifactIsReady(context.session, HUMAN_INPUT_RESPONSE_ARTIFACT)
      }),
      promptActionId: "agent_conversation"
    },
    definition: coreCodingStepDefinitionsById[agentConversationStepId],
    factoryId: "chat_with_ai",
    id: agentConversationStepId
  },
  [deepUiCheckRunStepId]: {
    definition: coreCodingStepDefinitionsById[deepUiCheckRunStepId],
    id: deepUiCheckRunStepId,
    machine: deepUiCheckMachine
  },
  [reviewRunStepId]: {
    definition: coreCodingStepDefinitionsById[reviewRunStepId],
    id: reviewRunStepId,
    machine: reviewRunMachine
  },
  [changesAcceptedStepId]: {
    config: {
      completionMessage: "Final review turn completed.",
      completionPolicy: {
        decidedBy: "ai",
        enoughWhen: "the requested final tweak has either been made or you can clearly report the blocker; Vibe64 can then rerun review and validation.",
        waitingForInputMeaning: "You cannot complete the final review tweak without a user decision or missing project detail."
      },
      promptActionId: finalReviewConversationActionId,
      waitingMessage: "Wait for Codex to finish this review turn."
    },
    definition: coreCodingStepDefinitionsById[changesAcceptedStepId],
    factoryId: "chat_with_ai",
    id: changesAcceptedStepId
  },
  [reportCreatedStepId]: {
    definition: coreCodingStepDefinitionsById[reportCreatedStepId],
    id: reportCreatedStepId,
    machine: reportCreatedMachine
  },
  [projectKnowledgeUpdatedStepId]: {
    definition: coreCodingStepDefinitionsById[projectKnowledgeUpdatedStepId],
    id: projectKnowledgeUpdatedStepId,
    machine: projectKnowledgeUpdatedMachine
  }
})));

const coreCodingWorkflowModule = Object.freeze({
  id: moduleId,
  steps: coreCodingSteps,
  workflowDefinitions: coreCodingWorkflowDefinitions
});

const _testing = deepFreeze({
  groupIds: CORE_CODING_WORKFLOW_GROUP_IDS,
  moduleId,
  ownedStepIds: [
    SEED_APPLICATION_STEP_ID,
    ISSUE_FILE_STEP_ID,
    seedPlanMadeStepId,
    seedPlanExecutedStepId,
    planAndExecuteStepId,
    implementationReviewedStepId,
    agentConversationStepId,
    deepUiCheckRunStepId,
    reviewRunStepId,
    changesAcceptedStepId,
    reportCreatedStepId,
    projectKnowledgeUpdatedStepId
  ],
  workflowDefinitionIds: VIBE64_WORKFLOW_DEFINITION_IDS
});

export {
  VIBE64_WORKFLOW_DEFINITION_IDS,
  DEFAULT_VIBE64_WORKFLOW_DEFINITION_ID,
  ISSUE_FILE_STEP_ID,
  SEED_APPLICATION_STEP_ID,
  _testing,
  coreCodingWorkflowModule,
  finishOffWorkflowGroup,
  qaWorkflowGroup
};
