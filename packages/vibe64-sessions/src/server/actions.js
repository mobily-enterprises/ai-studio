import {
  agentMessageActionInputValidator,
  agentTurnInterruptActionInputValidator,
  currentSessionInputValidator,
  sessionConversationLogInputValidator,
  sessionCreateInputValidator,
  sessionDiffInputValidator,
  sessionIdInputValidator,
  sessionInspectInputValidator,
  sessionListInputValidator,
  sessionPreviewStateInputValidator,
  sessionSaveInputValidator,
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
const ACTION_INSPECT_SESSION = "vibe64.sessions.inspect";
const ACTION_INSPECT_SESSION_DIFF = "vibe64.sessions.diff.inspect";
const ACTION_READ_SESSION_CONVERSATION_LOG = "vibe64.sessions.conversation-log.read";
const ACTION_RETRY_WORKSPACE_SETUP = "vibe64.sessions.workspace-setup.retry";
const ACTION_ABANDON_SESSION = "vibe64.sessions.abandon";
const ACTION_SEND_AGENT_MESSAGE = "vibe64.sessions.agent-message.send";
const ACTION_INTERRUPT_AGENT_TURN = "vibe64.sessions.agent-turn.interrupt";
const ACTION_BROADCAST_SESSION_VIEW_STATE = "vibe64.sessions.view-state.broadcast";
const ACTION_BROADCAST_SESSION_PREVIEW_STATE = "vibe64.sessions.preview-state.broadcast";

function action({ events = [], execute, id, input, kind }) {
  return Object.freeze({
    id,
    version: 1,
    kind,
    input,
    output: null,
    idempotency: kind === "query" ? "none" : "optional",
    audit: {
      actionName: id
    },
    observability: {},
    events,
    execute
  });
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
      id: ACTION_INSPECT_SESSION_DIFF,
      kind: "query",
      input: sessionDiffInputValidator,
      execute: (input) => sessions.inspectSessionDiff(input.sessionId, {
        full: input.full,
        lineLimit: input.lineLimit
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
  ACTION_ABANDON_SESSION,
  ACTION_BROADCAST_SESSION_PREVIEW_STATE,
  ACTION_BROADCAST_SESSION_VIEW_STATE,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_DIFF,
  ACTION_INSPECT_SESSION_WORK,
  ACTION_INTERRUPT_AGENT_TURN,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_SAVE_SESSION_WORK,
  ACTION_SEND_AGENT_MESSAGE,
  ACTION_UPDATE_CURRENT_SESSION,
  createSessionActions
};
