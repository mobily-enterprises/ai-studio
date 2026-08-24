import {
  agentMessageActionInputValidator,
  agentTurnInterruptActionInputValidator,
  currentSessionInputValidator,
  repositoryHistoryInputValidator,
  repositoryVersionFileDiffInputValidator,
  repositoryVersionFilesInputValidator,
  sessionConversationLogInputValidator,
  sessionChangeDiffInputValidator,
  sessionChangesInputValidator,
  sessionCreateInputValidator,
  sessionIdInputValidator,
  sessionInspectInputValidator,
  sessionListInputValidator,
  sessionPreviewStateInputValidator,
  sessionRenewalDraftGuardActionInputValidator,
  sessionRenewalDraftRequestActionInputValidator,
  sessionRenewalDraftUpdateActionInputValidator,
  sessionRenewalInspectActionInputValidator,
  sessionRenewalRetryActionInputValidator,
  sessionSaveInputValidator,
  sessionUpdateInputValidator,
  sessionViewStateInputValidator
} from "./inputSchemas.js";
import {
  sessionChangedActionEvent,
  sessionViewChangedActionEvent
} from "./events.js";

const ACTION_LIST_SESSIONS = "vibe64.sessions.list";
const ACTION_CREATE_SESSION = "vibe64.sessions.create";
const ACTION_UPDATE_CURRENT_SESSION = "vibe64.sessions.current.update";
const ACTION_INSPECT_SESSION_WORK = "vibe64.sessions.work.inspect";
const ACTION_SAVE_SESSION_WORK = "vibe64.sessions.work.save";
const ACTION_CHECK_SESSION_UPDATES = "vibe64.sessions.updates.check";
const ACTION_UPDATE_SESSION_WORK = "vibe64.sessions.updates.apply";
const ACTION_INSPECT_SESSION = "vibe64.sessions.inspect";
const ACTION_INSPECT_SESSION_RENEWAL = "vibe64.sessions.renewal.inspect";
const ACTION_REQUEST_SESSION_RENEWAL_DRAFT = "vibe64.sessions.renewal.draft.request";
const ACTION_UPDATE_SESSION_RENEWAL_DRAFT = "vibe64.sessions.renewal.draft.update";
const ACTION_CANCEL_SESSION_RENEWAL = "vibe64.sessions.renewal.cancel";
const ACTION_CONFIRM_SESSION_RENEWAL = "vibe64.sessions.renewal.confirm";
const ACTION_RETRY_SESSION_RENEWAL = "vibe64.sessions.renewal.retry";
const ACTION_INSPECT_SESSION_CHANGES = "vibe64.sessions.changes.inspect";
const ACTION_INSPECT_SESSION_CHANGE_DIFF = "vibe64.sessions.changes.diff.inspect";
const ACTION_READ_SESSION_CONVERSATION_LOG = "vibe64.sessions.conversation-log.read";
const ACTION_RETRY_WORKSPACE_SETUP = "vibe64.sessions.workspace-setup.retry";
const ACTION_ABANDON_SESSION = "vibe64.sessions.abandon";
const ACTION_SEND_AGENT_MESSAGE = "vibe64.sessions.agent-message.send";
const ACTION_INTERRUPT_AGENT_TURN = "vibe64.sessions.agent-turn.interrupt";
const ACTION_BROADCAST_SESSION_VIEW_STATE = "vibe64.sessions.view-state.broadcast";
const ACTION_BROADCAST_SESSION_PREVIEW_STATE = "vibe64.sessions.preview-state.broadcast";
const ACTION_INSPECT_REPOSITORY_HISTORY = "vibe64.repository.history.inspect";
const ACTION_INSPECT_REPOSITORY_VERSION_FILES = "vibe64.repository.history.files.inspect";
const ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF = "vibe64.repository.history.diff.inspect";

function action({
  events = [],
  execute,
  id,
  input,
  kind,
  idempotency = kind === "query" ? "none" : "optional"
}) {
  return Object.freeze({
    id,
    version: 1,
    kind,
    input,
    output: null,
    idempotency,
    audit: {
      actionName: id
    },
    observability: {},
    events,
    execute
  });
}

function authenticatedVibe64User(context = {}) {
  const vibe64User = context?.requestMeta?.request?.vibe64User;
  return vibe64User && typeof vibe64User === "object" && !Array.isArray(vibe64User)
    ? vibe64User
    : null;
}

function withoutSessionId(input = {}) {
  const { sessionId: _sessionId, ...rest } = input;
  void _sessionId;
  return rest;
}

function createSessionActions({ sessions } = {}) {
  if (!sessions) {
    throw new TypeError("createSessionActions requires sessions.");
  }

  return Object.freeze([
    action({
      id: ACTION_INSPECT_REPOSITORY_HISTORY,
      kind: "query",
      input: repositoryHistoryInputValidator,
      execute: (input) => sessions.inspectRepositoryHistory(input || {})
    }),
    action({
      id: ACTION_INSPECT_REPOSITORY_VERSION_FILES,
      kind: "query",
      input: repositoryVersionFilesInputValidator,
      execute: (input) => sessions.inspectRepositoryVersionFiles(input || {})
    }),
    action({
      id: ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
      kind: "query",
      input: repositoryVersionFileDiffInputValidator,
      execute: (input) => sessions.inspectRepositoryVersionFileDiff(input || {})
    }),
    action({
      id: ACTION_LIST_SESSIONS,
      kind: "query",
      input: sessionListInputValidator,
      execute: (input) => sessions.listSessions(input || {})
    }),
    action({
      id: ACTION_CREATE_SESSION,
      kind: "command",
      input: sessionCreateInputValidator,
      execute: (input) => sessions.createSession(input || {})
    }),
    action({
      id: ACTION_UPDATE_CURRENT_SESSION,
      kind: "command",
      input: currentSessionInputValidator,
      execute: (input) => sessions.updateCurrentSession(input?.sessionId || "")
    }),
    action({
      id: ACTION_INSPECT_SESSION,
      kind: "query",
      input: sessionInspectInputValidator,
      execute: (input) => sessions.inspectSession(input.sessionId, {
        projectSlug: input.projectSlug,
        vibe64User: input.vibe64User || null
      })
    }),
    action({
      id: ACTION_INSPECT_SESSION_RENEWAL,
      kind: "query",
      input: sessionRenewalInspectActionInputValidator,
      execute: (input, context) => sessions.inspectSessionRenewal(input.sessionId, {
        vibe64User: authenticatedVibe64User(context)
      })
    }),
    action({
      id: ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
      kind: "command",
      idempotency: "domain_native",
      input: sessionRenewalDraftRequestActionInputValidator,
      execute: (input, context) => sessions.requestSessionRenewalDraft(input.sessionId, {
        operationKey: input.operationKey,
        originId: input.originId,
        vibe64User: authenticatedVibe64User(context)
      })
    }),
    action({
      id: ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
      kind: "command",
      idempotency: "domain_native",
      input: sessionRenewalDraftUpdateActionInputValidator,
      execute: (input, context) => sessions.updateSessionRenewalDraft(input.sessionId, {
        draft: input.draft,
        expectedHash: input.expectedHash,
        expectedRevision: input.expectedRevision,
        operationKey: input.operationKey,
        originId: input.originId,
        vibe64User: authenticatedVibe64User(context)
      })
    }),
    action({
      id: ACTION_CANCEL_SESSION_RENEWAL,
      kind: "command",
      idempotency: "domain_native",
      input: sessionRenewalDraftGuardActionInputValidator,
      execute: (input, context) => sessions.cancelSessionRenewal(input.sessionId, {
        expectedHash: input.expectedHash,
        expectedRevision: input.expectedRevision,
        operationKey: input.operationKey,
        originId: input.originId,
        vibe64User: authenticatedVibe64User(context)
      })
    }),
    action({
      id: ACTION_CONFIRM_SESSION_RENEWAL,
      kind: "command",
      idempotency: "domain_native",
      input: sessionRenewalDraftGuardActionInputValidator,
      execute: (input, context) => sessions.confirmSessionRenewal(input.sessionId, {
        expectedHash: input.expectedHash,
        expectedRevision: input.expectedRevision,
        operationKey: input.operationKey,
        originId: input.originId,
        vibe64User: authenticatedVibe64User(context)
      })
    }),
    action({
      id: ACTION_RETRY_SESSION_RENEWAL,
      kind: "command",
      idempotency: "domain_native",
      input: sessionRenewalRetryActionInputValidator,
      execute: (input, context) => sessions.retrySessionRenewal(input.sessionId, {
        operationKey: input.operationKey,
        originId: input.originId,
        vibe64User: authenticatedVibe64User(context)
      })
    }),
    action({
      id: ACTION_INSPECT_SESSION_CHANGES,
      kind: "query",
      input: sessionChangesInputValidator,
      execute: (input) => sessions.inspectSessionChanges(input.sessionId, {
        limit: input.limit,
        offset: input.offset
      })
    }),
    action({
      id: ACTION_INSPECT_SESSION_CHANGE_DIFF,
      kind: "query",
      input: sessionChangeDiffInputValidator,
      execute: (input) => sessions.inspectSessionChangeDiff(input.sessionId, {
        lineLimit: input.lineLimit,
        path: input.path
      })
    }),
    action({
      id: ACTION_INSPECT_SESSION_WORK,
      kind: "query",
      input: sessionIdInputValidator,
      execute: (input) => sessions.inspectSessionWork(input.sessionId)
    }),
    action({
      id: ACTION_SAVE_SESSION_WORK,
      kind: "command",
      input: sessionSaveInputValidator,
      events: [sessionChangedActionEvent({ reason: "session-work-saved" })],
      execute: (input) => sessions.saveSessionWork(input.sessionId, withoutSessionId(input))
    }),
    action({
      id: ACTION_CHECK_SESSION_UPDATES,
      kind: "command",
      input: sessionUpdateInputValidator,
      execute: (input) => sessions.checkSessionUpdates(input.sessionId, withoutSessionId(input))
    }),
    action({
      id: ACTION_UPDATE_SESSION_WORK,
      kind: "command",
      input: sessionUpdateInputValidator,
      events: [sessionChangedActionEvent({ reason: "session-work-updated" })],
      execute: (input) => sessions.updateSessionWork(input.sessionId, withoutSessionId(input))
    }),
    action({
      id: ACTION_READ_SESSION_CONVERSATION_LOG,
      kind: "query",
      input: sessionConversationLogInputValidator,
      execute: (input) => sessions.readSessionConversationLog(input.sessionId, {
        beforeTurnId: input.beforeTurnId,
        limit: input.limit
      })
    }),
    action({
      id: ACTION_RETRY_WORKSPACE_SETUP,
      kind: "command",
      input: sessionIdInputValidator,
      execute: (input) => sessions.retryWorkspaceSetup(input.sessionId, {
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      })
    }),
    action({
      id: ACTION_ABANDON_SESSION,
      kind: "command",
      input: sessionIdInputValidator,
      execute: (input) => sessions.abandonSession(input.sessionId, {
        originId: input.originId || "",
        vibe64User: input.vibe64User || null
      })
    }),
    action({
      id: ACTION_SEND_AGENT_MESSAGE,
      kind: "command",
      input: agentMessageActionInputValidator,
      execute: (input) => sessions.sendAgentMessage(input.sessionId, withoutSessionId(input))
    }),
    action({
      id: ACTION_INTERRUPT_AGENT_TURN,
      kind: "command",
      input: agentTurnInterruptActionInputValidator,
      events: [sessionChangedActionEvent({ reason: "session-agent-turn-interrupted" })],
      execute: (input) => sessions.interruptAgentTurn(input.sessionId, withoutSessionId(input))
    }),
    action({
      id: ACTION_BROADCAST_SESSION_VIEW_STATE,
      kind: "command",
      input: sessionViewStateInputValidator,
      events: [sessionViewChangedActionEvent()],
      execute: (input) => sessions.broadcastSessionViewState(input.sessionId, withoutSessionId(input))
    }),
    action({
      id: ACTION_BROADCAST_SESSION_PREVIEW_STATE,
      kind: "command",
      input: sessionPreviewStateInputValidator,
      execute: (input) => sessions.broadcastSessionPreviewState(input.sessionId, withoutSessionId(input))
    })
  ]);
}

export {
  ACTION_CANCEL_SESSION_RENEWAL,
  ACTION_CHECK_SESSION_UPDATES,
  ACTION_INSPECT_REPOSITORY_HISTORY,
  ACTION_INSPECT_REPOSITORY_VERSION_FILE_DIFF,
  ACTION_INSPECT_REPOSITORY_VERSION_FILES,
  ACTION_ABANDON_SESSION,
  ACTION_BROADCAST_SESSION_PREVIEW_STATE,
  ACTION_BROADCAST_SESSION_VIEW_STATE,
  ACTION_CREATE_SESSION,
  ACTION_CONFIRM_SESSION_RENEWAL,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_RENEWAL,
  ACTION_INSPECT_SESSION_CHANGE_DIFF,
  ACTION_INSPECT_SESSION_CHANGES,
  ACTION_INSPECT_SESSION_WORK,
  ACTION_INTERRUPT_AGENT_TURN,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_REQUEST_SESSION_RENEWAL_DRAFT,
  ACTION_RETRY_SESSION_RENEWAL,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_SAVE_SESSION_WORK,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_UPDATE_CURRENT_SESSION,
  ACTION_UPDATE_SESSION_RENEWAL_DRAFT,
  ACTION_UPDATE_SESSION_WORK,
  createSessionActions
};
