const MAX_SHELL_TABS = 5;

function shellShortcutAction(event = {}) {
  const key = String(event.key || "").toLowerCase();
  const plainAlt = event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey;

  if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && key === "t") {
    return {
      type: "new-tab"
    };
  }
  if (plainAlt && key === "n") {
    return {
      type: "new-tab"
    };
  }
  if (plainAlt && /^[1-9]$/u.test(key)) {
    const tabIndex = Number(key) - 1;
    if (tabIndex < MAX_SHELL_TABS) {
      return {
        tabIndex,
        type: "select-tab"
      };
    }
  }
  return null;
}

function consumeShellShortcutEvent(event = {}) {
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
}

export {
  consumeShellShortcutEvent,
  MAX_SHELL_TABS,
  shellShortcutAction
};
