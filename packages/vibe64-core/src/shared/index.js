const AI_STUDIO_OPERATION_ROUTES = Object.freeze({
  COMMAND_TERMINAL: "command-terminal",
  SESSION_ACTION: "session-action",
  SESSION_ADVANCE: "session-advance",
  SESSION_INTENT: "session-intent"
});

const AI_STUDIO_ACTION_DISPATCH_ROUTES = Object.freeze({
  ...AI_STUDIO_OPERATION_ROUTES,
  EXTERNAL_LINK: "external-link"
});

const AI_STUDIO_CLIENT_CONTROL_ACTIONS = Object.freeze({
  OPEN_DIFF: "open_diff",
  START_CODEX_TERMINAL: "start_codex_terminal"
});

const AI_STUDIO_CLIENT_CONTROL_ICON_TOKENS = Object.freeze({
  DIFF: "diff"
});

const AI_STUDIO_CLIENT_CONTROL_STATE_FLAGS = Object.freeze({
  DIFF_DISABLED: "diff_disabled",
  DIFF_LOADING: "diff_loading"
});

export {
  AI_STUDIO_ACTION_DISPATCH_ROUTES,
  AI_STUDIO_CLIENT_CONTROL_ACTIONS,
  AI_STUDIO_CLIENT_CONTROL_ICON_TOKENS,
  AI_STUDIO_CLIENT_CONTROL_STATE_FLAGS,
  AI_STUDIO_OPERATION_ROUTES
};
