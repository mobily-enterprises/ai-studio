import { diffLines } from "diff";

const SOURCE_EDITOR_DIFF_TIMEOUT_MS = 100;

export function sourceEditorDocumentChanges(currentText, nextText) {
  if (currentText === nextText) {
    return [];
  }

  const parts = diffLines(currentText, nextText, {
    timeout: SOURCE_EDITOR_DIFF_TIMEOUT_MS
  });
  if (!parts) {
    return [{
      from: 0,
      insert: nextText,
      to: currentText.length
    }];
  }

  const changes = [];
  let currentPosition = 0;
  let pendingChange = null;

  for (const part of parts) {
    if (!part.added && !part.removed) {
      if (pendingChange) {
        changes.push(pendingChange);
        pendingChange = null;
      }
      currentPosition += part.value.length;
      continue;
    }

    pendingChange ||= {
      from: currentPosition,
      insert: "",
      to: currentPosition
    };
    if (part.added) {
      pendingChange.insert += part.value;
    } else {
      currentPosition += part.value.length;
      pendingChange.to = currentPosition;
    }
  }

  if (pendingChange) {
    changes.push(pendingChange);
  }
  return changes;
}
