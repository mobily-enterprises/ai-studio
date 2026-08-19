const MAX_COMMIT_SUBJECT_LENGTH = 72;
const MAX_PROMPT_FILES = 40;
const MAX_PROMPT_PATH_LENGTH = 180;

function text(value = "") {
  return String(value || "").trim();
}

function commitMessageError(message, code = "vibe64_session_save_message_failed") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedPath(value = "") {
  const path = text(value);
  return path.length <= MAX_PROMPT_PATH_LENGTH
    ? path
    : `…${path.slice(-(MAX_PROMPT_PATH_LENGTH - 1))}`;
}

function changeDescription(file = {}) {
  const status = text(file.status || file.changeType || "Changed");
  const path = boundedPath(file.path || file.newPath || file.oldPath);
  const added = Number.isFinite(Number(file.added)) ? Number(file.added) : 0;
  const deleted = Number.isFinite(Number(file.deleted)) ? Number(file.deleted) : 0;
  return `- ${status}: ${path} (+${added} -${deleted})`;
}

function sessionSaveCommitMessagePrompt(changes = {}) {
  const files = (Array.isArray(changes.files) ? changes.files : []).slice(0, MAX_PROMPT_FILES);
  const totalCount = Math.max(files.length, Number(changes.totalCount) || 0);
  const omitted = Math.max(0, totalCount - files.length);
  return [
    "Write the Git commit subject for the project changes listed below.",
    "Return exactly one plain-text line and nothing else.",
    `Use an imperative, specific description of the user-visible or architectural outcome. Maximum ${MAX_COMMIT_SUBJECT_LENGTH} characters.`,
    "Do not use Markdown, quotes, a trailing full stop, issue numbers, or generic wording such as 'save work', 'update files', or 'changes'.",
    "Do not inspect the repository and do not use tools. Base the subject only on this bounded change summary.",
    "",
    `Changed files: ${totalCount}`,
    ...files.map(changeDescription),
    ...(omitted ? [`- …and ${omitted} more changed files`] : [])
  ].join("\n");
}

function normalizeSessionSaveCommitMessage(value = "") {
  const subject = text(value);
  const hasControlCharacters = [...subject].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    !subject ||
    subject.length > MAX_COMMIT_SUBJECT_LENGTH ||
    hasControlCharacters ||
    /^([`'"]|[-*#]\s)/u.test(subject) ||
    /([`'"])$/u.test(subject) ||
    /\.$/u.test(subject)
  ) {
    throw commitMessageError(
      "The assistant did not return one valid commit subject. Save was not started.",
      "vibe64_session_save_message_invalid"
    );
  }
  if (/^(save( vibe64)? work|update files|changes)$/iu.test(subject)) {
    throw commitMessageError(
      "The assistant returned a generic commit subject. Save was not started.",
      "vibe64_session_save_message_generic"
    );
  }
  return subject;
}

async function generateSessionSaveCommitMessage({
  changes = {},
  deleteThread,
  runAgentTurn
} = {}) {
  if (typeof runAgentTurn !== "function" || typeof deleteThread !== "function") {
    throw new TypeError("Commit-message generation requires the existing ephemeral assistant lifecycle.");
  }
  let failure = null;
  let result = null;
  let threadId = "";
  try {
    result = await runAgentTurn({
      ephemeral: true,
      prompt: sessionSaveCommitMessagePrompt(changes),
      promptLabel: "Name saved work",
      timeoutMs: 30_000
    }, {
      onEvent(event = {}) {
        if (event.type === "thread") {
          threadId = text(event.threadId);
        }
      }
    });
    threadId = text(result?.threadId) || threadId;
    if (result?.ok === false) {
      throw commitMessageError(
        text(result.error) || "The assistant could not name this work. Save was not started.",
        text(result.code) || "vibe64_session_save_message_failed"
      );
    }
  } catch (error) {
    failure = error instanceof Error
      ? error
      : commitMessageError("The assistant could not name this work. Save was not started.");
  }

  if (threadId) {
    try {
      const cleanup = await deleteThread({ threadId });
      if (cleanup?.ok === false) {
        throw commitMessageError(
          text(cleanup.error) || "The temporary naming conversation could not be removed. Save was not started.",
          text(cleanup.code) || "vibe64_session_save_message_cleanup_failed"
        );
      }
    } catch (error) {
      failure ||= error instanceof Error
        ? error
        : commitMessageError("The temporary naming conversation could not be removed. Save was not started.");
    }
  }

  if (failure) {
    throw failure;
  }
  return normalizeSessionSaveCommitMessage(result?.text);
}

export {
  MAX_COMMIT_SUBJECT_LENGTH,
  generateSessionSaveCommitMessage,
  normalizeSessionSaveCommitMessage,
  sessionSaveCommitMessagePrompt
};
