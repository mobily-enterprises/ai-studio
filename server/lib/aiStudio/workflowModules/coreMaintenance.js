import { deepFreeze } from "../deepFreeze.js";
import {
  HUMAN_INPUT_RESPONSE_ARTIFACT
} from "../workflowArtifacts.js";
import {
  agentConversationStep
} from "../workflowDefinitionBuilders.js";
import {
  artifactIsReady,
  createChatWithAiMachine,
  createFinishSessionMachine,
  createInstallDependenciesMachine
} from "../workflowStepMachineHelpers.js";

const CORE_MAINTENANCE_WORKFLOW_MODULE_ID = "core.maintenance";
const CORE_MAINTENANCE_WORKFLOW_PROFILE_IDS = deepFreeze({
  NON_CODE_MAINTENANCE: "non_code_maintenance",
  NON_COMMIT_MAINTENANCE: "non_commit_maintenance"
});
const CORE_MAINTENANCE_CHECKLIST_STEP_ID = "checklist_items_installed";
const CORE_MAINTENANCE_CONVERSATION_STEP_ID = "maintenance_conversation";
const CORE_MAINTENANCE_LOCAL_FINISH_STEP_ID = "local_session_finished";
const HUMAN_INPUT_RESPONSE_READY_CONDITION = `artifact:${HUMAN_INPUT_RESPONSE_ARTIFACT}`;

const CORE_MAINTENANCE_OWNED_STEP_IDS = deepFreeze([
  CORE_MAINTENANCE_CHECKLIST_STEP_ID,
  CORE_MAINTENANCE_CONVERSATION_STEP_ID,
  CORE_MAINTENANCE_LOCAL_FINISH_STEP_ID
]);

const CORE_MAINTENANCE_STEP_DEFINITIONS = deepFreeze({
  [CORE_MAINTENANCE_CHECKLIST_STEP_ID]: {
    actions: [
      {
        adapterCapability: "install_dependencies",
        disabledReason: "Checklist items are already installed.",
        disabledWhen: ["metadata:dependencies_installed"],
        icon: "sync",
        id: "install_dependencies",
        label: "Install checklist items",
        type: "command"
      }
    ],
    autopilot: {
      actionId: "install_dependencies",
      completeWhen: ["metadata:dependencies_installed"],
      label: "Install checklist items"
    },
    description: "Install the adapter-provided local checklist items needed before talking to Codex.",
    id: CORE_MAINTENANCE_CHECKLIST_STEP_ID,
    label: "Install checklist items",
    next: {
      disabledReason: "Install checklist items before continuing.",
      enabledWhen: ["metadata:dependencies_installed"]
    },
    rewindCleanup: {
      actionResults: ["install_dependencies"],
      metadata: ["dependencies_installed", "dependencies_path"]
    }
  },
  [CORE_MAINTENANCE_CONVERSATION_STEP_ID]: agentConversationStep({
    actionLabel: "Ask Codex",
    description: "Ask Codex for local maintenance help and save the answer as an editable AI response artifact.",
    id: CORE_MAINTENANCE_CONVERSATION_STEP_ID,
    label: "Talk to Codex",
    next: {
      disabledReason: "Ask Codex and save an AI response before finishing.",
      enabledWhen: [HUMAN_INPUT_RESPONSE_READY_CONDITION]
    },
    responseArtifact: HUMAN_INPUT_RESPONSE_ARTIFACT
  }),
  [CORE_MAINTENANCE_LOCAL_FINISH_STEP_ID]: {
    actions: [
      {
        adapterCapability: "finish_session",
        id: "finish_session",
        label: "Archive",
        type: "finish"
      }
    ],
    autopilot: {
      kind: "finished",
      stop: true
    },
    description: "Archive this local maintenance session without creating a pull request.",
    id: CORE_MAINTENANCE_LOCAL_FINISH_STEP_ID,
    label: "Finish local session",
    next: {
      visible: false
    },
    presentation: {
      stop: {
        intents: [
          {
            actionId: "finish_session",
            id: "archive_session",
            label: "Archive",
            style: "primary",
            type: "action"
          }
        ],
        screen: {
          icon: "success",
          kind: "finished",
          message: "The session is complete.",
          sections: ["report_preview"],
          title: "Congratulations!"
        }
      }
    },
    rewindCleanup: {
      actionResults: ["finish_session"]
    }
  }
});

const CORE_MAINTENANCE_NON_COMMIT_WORKFLOW_PROFILE = deepFreeze({
  description: "Run a local maintenance task without commit, pull request, or merge steps.",
  id: CORE_MAINTENANCE_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE,
  label: "Non-commit maintenance",
  initialMetadata: {
    work_source: "new_branch"
  },
  sessionWord: "maintenance",
  stepIds: [
    "session_created",
    "worktree_created",
    CORE_MAINTENANCE_CHECKLIST_STEP_ID,
    CORE_MAINTENANCE_CONVERSATION_STEP_ID,
    CORE_MAINTENANCE_LOCAL_FINISH_STEP_ID
  ],
  userSelectable: true
});

const CORE_MAINTENANCE_NON_CODE_WORKFLOW_PROFILE = deepFreeze({
  description: "Update documentation or other non-code project files, validate, commit, create a PR, and optionally merge.",
  id: CORE_MAINTENANCE_WORKFLOW_PROFILE_IDS.NON_CODE_MAINTENANCE,
  label: "Documentation/non code maintenance",
  sessionWord: "documentation",
  stepIds: [
    "session_created",
    "work_source_selected",
    "worktree_created",
    "dependencies_installed",
    CORE_MAINTENANCE_CONVERSATION_STEP_ID,
    "project_validated",
    "changes_committed",
    "create_pull_request",
    "pr_merged",
    "main_checkout_synced",
    "session_finished"
  ],
  userSelectable: true
});

const CORE_MAINTENANCE_STEP_MACHINES = Object.freeze({
  [CORE_MAINTENANCE_CHECKLIST_STEP_ID]: createInstallDependenciesMachine({
    stepId: CORE_MAINTENANCE_CHECKLIST_STEP_ID
  }),
  [CORE_MAINTENANCE_CONVERSATION_STEP_ID]: createChatWithAiMachine({
    completionPolicy: {
      decidedBy: "user"
    },
    nextWhenIdle: (context = {}) => ({
      disabledReason: "Ask Codex for changes before continuing.",
      enabled: artifactIsReady(context.session, HUMAN_INPUT_RESPONSE_ARTIFACT)
    }),
    promptActionId: "agent_conversation",
    stepId: CORE_MAINTENANCE_CONVERSATION_STEP_ID
  }),
  [CORE_MAINTENANCE_LOCAL_FINISH_STEP_ID]: createFinishSessionMachine({
    stepId: CORE_MAINTENANCE_LOCAL_FINISH_STEP_ID
  })
});

function coreMaintenanceWorkflowDefinitionModule() {
  return {
    id: CORE_MAINTENANCE_WORKFLOW_MODULE_ID,
    steps: CORE_MAINTENANCE_OWNED_STEP_IDS.map((stepId) => ({
      definition: CORE_MAINTENANCE_STEP_DEFINITIONS[stepId]
    })),
    workflows: [
      CORE_MAINTENANCE_NON_CODE_WORKFLOW_PROFILE,
      CORE_MAINTENANCE_NON_COMMIT_WORKFLOW_PROFILE
    ]
  };
}

function coreMaintenanceWorkflowMachineModule() {
  return {
    id: CORE_MAINTENANCE_WORKFLOW_MODULE_ID,
    steps: CORE_MAINTENANCE_OWNED_STEP_IDS.map((stepId) => ({
      id: stepId,
      machine: CORE_MAINTENANCE_STEP_MACHINES[stepId]
    }))
  };
}

const _testing = deepFreeze({
  moduleId: CORE_MAINTENANCE_WORKFLOW_MODULE_ID,
  ownedStepIds: CORE_MAINTENANCE_OWNED_STEP_IDS,
  workflowProfileIds: CORE_MAINTENANCE_WORKFLOW_PROFILE_IDS
});

export {
  _testing,
  coreMaintenanceWorkflowDefinitionModule,
  coreMaintenanceWorkflowMachineModule
};
