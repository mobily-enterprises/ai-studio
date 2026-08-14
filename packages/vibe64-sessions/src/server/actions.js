import {
  currentSessionInputValidator,
  sessionConversationLogInputValidator,
  sessionCreateInputValidator,
  sessionDiffInputValidator,
  sessionIdInputValidator,
  sessionInspectInputValidator,
  sessionListInputValidator
} from "./inputSchemas.js";

const ACTION_LIST_SESSIONS = "feature.vibe64-sessions.list";
const ACTION_CREATE_SESSION = "feature.vibe64-sessions.create";
const ACTION_UPDATE_CURRENT_SESSION = "feature.vibe64-sessions.current.update";
const ACTION_INSPECT_SESSION = "feature.vibe64-sessions.inspect";
const ACTION_INSPECT_SESSION_DIFF = "feature.vibe64-sessions.diff.inspect";
const ACTION_READ_SESSION_CONVERSATION_LOG = "feature.vibe64-sessions.conversation-log.read";
const ACTION_RETRY_WORKSPACE_SETUP = "feature.vibe64-sessions.workspace-setup.retry";
const ACTION_ABANDON_SESSION = "feature.vibe64-sessions.abandon";

function action(id, kind, input, execute) {
  return Object.freeze({
    id,
    version: 1,
    kind,
    channels: ["api", "automation", "internal"],
    surfaces: ["app"],
    input,
    output: null,
    idempotency: kind === "query" ? "none" : "optional",
    audit: {
      actionName: id
    },
    observability: {},
    execute
  });
}

const featureActions = Object.freeze([
  action(ACTION_LIST_SESSIONS, "query", sessionListInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.listSessions(input || {});
  }),
  action(ACTION_CREATE_SESSION, "command", sessionCreateInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.createSession(input || {});
  }),
  action(ACTION_UPDATE_CURRENT_SESSION, "command", currentSessionInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.updateCurrentSession(input?.sessionId || "");
  }),
  action(ACTION_INSPECT_SESSION, "query", sessionInspectInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.inspectSession(input.sessionId, {
      projectSlug: input.projectSlug,
      vibe64User: input.vibe64User || null
    });
  }),
  action(ACTION_INSPECT_SESSION_DIFF, "query", sessionDiffInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.inspectSessionDiff(input.sessionId, {
      full: input.full,
      lineLimit: input.lineLimit
    });
  }),
  action(ACTION_READ_SESSION_CONVERSATION_LOG, "query", sessionConversationLogInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.readSessionConversationLog(input.sessionId, {
      beforeTurnId: input.beforeTurnId,
      limit: input.limit
    });
  }),
  action(ACTION_RETRY_WORKSPACE_SETUP, "command", sessionIdInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.retryWorkspaceSetup(input.sessionId, {
      originId: input.originId || "",
      vibe64User: input.vibe64User || null
    });
  }),
  action(ACTION_ABANDON_SESSION, "command", sessionIdInputValidator, (input, context, deps) => {
    void context;
    return deps.featureService.abandonSession(input.sessionId, {
      originId: input.originId || "",
      vibe64User: input.vibe64User || null
    });
  })
]);

export {
  ACTION_ABANDON_SESSION,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_INSPECT_SESSION_DIFF,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RETRY_WORKSPACE_SETUP,
  ACTION_UPDATE_CURRENT_SESSION,
  featureActions
};
