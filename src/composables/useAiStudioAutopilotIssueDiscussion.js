import { computed, nextTick, ref, watch } from "vue";
import {
  useAiStudioCodexQuestionExchange
} from "@/composables/useAiStudioCodexQuestionExchange.js";
import {
  clearAiStudioIssueArtifacts,
  saveAiStudioIssueArtifacts
} from "@/lib/aiStudioSessionApi.js";
import {
  buildAnsweredIssueDraftPrompt,
  buildInitialIssueDraftPrompt
} from "@/lib/aiStudioAutopilotIssuePrompt.js";
import {
  latestIssueDefinitionMarker
} from "@/lib/aiStudioAutopilotIssueMarkers.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const ISSUE_BODY_ARTIFACT = "issue.md";
const ISSUE_TITLE_ARTIFACT = "issue_title";
const STORAGE_KEY_PREFIX = "ai-studio:autopilot:issue-discussion:";

const ISSUE_DISCUSSION_STATE = Object.freeze({
  INPUT: "input",
  QUESTIONS: "questions",
  REVIEW: "review",
  SAVING: "saving",
  WAITING: "waiting"
});

function browserLocalStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  return window.localStorage;
}

function localStorageKey(sessionId = "") {
  return `${STORAGE_KEY_PREFIX}${String(sessionId || "").trim()}`;
}

function readStoredDiscussion(sessionId = "") {
  const storage = browserLocalStorage();
  const key = localStorageKey(sessionId);
  if (!storage || !sessionId) {
    return {};
  }
  try {
    const value = JSON.parse(storage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeStoredDiscussion(sessionId = "", value = {}) {
  const storage = browserLocalStorage();
  if (!storage || !sessionId) {
    return;
  }
  storage.setItem(localStorageKey(sessionId), JSON.stringify({
    activeRequestId: String(value.activeRequestId || ""),
    ignoredRequestIds: Array.isArray(value.ignoredRequestIds) ? value.ignoredRequestIds : [],
    outputCursor: Number.isSafeInteger(value.outputCursor) ? value.outputCursor : 0,
    questionAnswers: Array.isArray(value.questionAnswers) ? value.questionAnswers : [],
    requestText: String(value.requestText || "")
  }));
}

function clearStoredDiscussion(sessionId = "") {
  browserLocalStorage()?.removeItem(localStorageKey(sessionId));
}

function createRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function artifactIsReady(session = {}, artifactName = "") {
  return session?.artifactReadiness?.[artifactName]?.nonEmpty === true;
}

function issueArtifactsAreReady(session = {}) {
  return artifactIsReady(session, ISSUE_TITLE_ARTIFACT) && artifactIsReady(session, ISSUE_BODY_ARTIFACT);
}

function issueIsSelected(session = {}) {
  return Boolean(String(session?.metadata?.issue_url || "").trim());
}

function nextIsReady(next = {}) {
  return next?.visible === true && next.enabled === true;
}

function loadedDiscussionState(activeRequestId = "") {
  return String(activeRequestId || "").trim()
    ? ISSUE_DISCUSSION_STATE.WAITING
    : ISSUE_DISCUSSION_STATE.INPUT;
}

function storedIgnoredRequestIds(stored = {}) {
  if (Array.isArray(stored.ignoredRequestIds)) {
    return stored.ignoredRequestIds.map(String);
  }
  if (Array.isArray(stored.rejectedRequestIds)) {
    return stored.rejectedRequestIds.map(String);
  }
  return [];
}

function withQuestionAnswers(questions = [], answers = []) {
  return questions.map((question, index) => ({
    ...question,
    answer: String(answers[index] || question.answer || "")
  }));
}

function issueQuestionOwnerId(sessionId = "") {
  return `issue:${String(sessionId || "").trim()}`;
}

function useAiStudioAutopilotIssueDiscussion({
  actions = {},
  clearIssueArtifacts = clearAiStudioIssueArtifacts,
  codexTerminal = {},
  questionExchange = null,
  readyForIssue = () => false,
  refreshSessionData = async () => null,
  saveIssueArtifacts = saveAiStudioIssueArtifacts,
  session
} = {}) {
  const state = ref(ISSUE_DISCUSSION_STATE.INPUT);
  const requestText = ref("");
  const activeRequestId = ref("");
  const ignoredRequestIds = ref(new Set());
  const outputCursor = ref(0);
  const draftBody = ref("");
  const draftTitle = ref("");
  const failure = ref("");
  const saving = ref(false);
  const storedQuestionAnswers = ref([]);
  const codexQuestions = questionExchange || useAiStudioCodexQuestionExchange({
    codexTerminal
  });

  const currentSession = computed(() => readRefOrGetterValue(session) || null);
  const sessionId = computed(() => String(currentSession.value?.sessionId || ""));
  const codexOutput = computed(() => String(readRefOrGetterValue(codexTerminal.output) || ""));
  const promptInjectionError = computed(() => String(readRefOrGetterValue(codexTerminal.promptInjectionError) || ""));
  const ready = computed(() => Boolean(readRefOrGetterValue(readyForIssue)));
  const waiting = computed(() => ready.value && state.value === ISSUE_DISCUSSION_STATE.WAITING);
  const questionOwnerId = computed(() => issueQuestionOwnerId(sessionId.value));
  const issueQuestionActive = computed(() => ready.value &&
    state.value === ISSUE_DISCUSSION_STATE.QUESTIONS &&
    codexQuestions.isOwner(questionOwnerId.value));
  const reviewing = computed(() => ready.value && state.value === ISSUE_DISCUSSION_STATE.REVIEW);
  const inputVisible = computed(() => ready.value && state.value === ISSUE_DISCUSSION_STATE.INPUT);
  const questions = computed(() => issueQuestionActive.value ? codexQuestions.questions.value : []);
  const canSubmit = computed(() => {
    return ready.value &&
      inputVisible.value &&
      Boolean(requestText.value.trim()) &&
      !saving.value;
  });
  const canAccept = computed(() => {
    return ready.value &&
      reviewing.value &&
      Boolean(draftTitle.value.trim()) &&
      Boolean(draftBody.value.trim()) &&
      !saving.value;
  });
  const questionFailure = computed(() => issueQuestionActive.value ? codexQuestions.failure.value : "");
  const statusText = computed(() => {
    if (failure.value || questionFailure.value) {
      return failure.value || questionFailure.value;
    }
    if (saving.value || state.value === ISSUE_DISCUSSION_STATE.SAVING) {
      return "Saving issue file...";
    }
    if (waiting.value) {
      return "Asking Codex to define the issue...";
    }
    if (issueQuestionActive.value) {
      return "A few questions first";
    }
    if (reviewing.value) {
      return "Does this sound right?";
    }
    return "What would you like to do?";
  });

  async function submitInitialRequest() {
    const normalizedRequest = requestText.value.trim();
    if (!normalizedRequest || !ready.value) {
      failure.value = normalizedRequest ? "Issue discussion is not available yet." : "Describe what you would like to do.";
      return;
    }

    const requestId = createRequestId();
    requestText.value = normalizedRequest;
    activeRequestId.value = requestId;
    outputCursor.value = codexOutput.value.length;
    failure.value = "";
    persistDiscussion();
    await injectIssuePrompt(buildInitialIssueDraftPrompt({
      requestId,
      requestText: normalizedRequest
    }), requestId);
  }

  async function rejectIssueDraft() {
    if (!reviewing.value) {
      return;
    }

    saving.value = true;
    failure.value = "";
    try {
      const response = await clearIssueArtifacts(sessionId.value);
      if (response?.ok === false) {
        throw new Error(response.error || response.errors?.[0]?.message || "Issue file could not be cleared.");
      }

      returnToInputIgnoringCurrentCodexAnswer();
      await refreshSessionData();
    } catch (error) {
      failure.value = String(error?.message || error || "Issue file could not be cleared.");
      state.value = ISSUE_DISCUSSION_STATE.REVIEW;
    } finally {
      saving.value = false;
    }
  }

  function cancelWaiting() {
    if (!waiting.value) {
      return;
    }

    failure.value = "";
    returnToInputIgnoringCurrentCodexAnswer();
  }

  async function acceptIssueDraft() {
    if (!canAccept.value) {
      failure.value = "Issue title and body are required.";
      return;
    }

    saving.value = true;
    state.value = ISSUE_DISCUSSION_STATE.SAVING;
    failure.value = "";
    try {
      const response = await saveIssueArtifacts(sessionId.value, {
        body: draftBody.value,
        title: draftTitle.value
      });
      if (response?.ok === false) {
        throw new Error(response.error || response.errors?.[0]?.message || "Issue file could not be saved.");
      }

      await refreshSessionData();
      await nextTick();
      if (!await advanceIfReady()) {
        throw new Error("Issue file was saved, but the next workflow step is not ready.");
      }
      clearStoredDiscussion(sessionId.value);
    } catch (error) {
      failure.value = String(error?.message || error || "Issue file could not be saved.");
      state.value = ISSUE_DISCUSSION_STATE.REVIEW;
    } finally {
      saving.value = false;
    }
  }

  async function injectIssuePrompt(prompt, requestId) {
    state.value = ISSUE_DISCUSSION_STATE.WAITING;
    if (typeof codexTerminal.injectPrompt !== "function") {
      resetActiveRequestAfterPromptFailure("Codex prompt injection is not available.");
      return;
    }

    const injected = await codexTerminal.injectPrompt(prompt, {
      requestId,
      sessionId: sessionId.value
    });
    if (injected === false) {
      resetActiveRequestAfterPromptFailure("Codex prompt could not be sent.");
    }
  }

  function resetActiveRequestAfterPromptFailure(message = "") {
    activeRequestId.value = "";
    failure.value = message;
    state.value = ISSUE_DISCUSSION_STATE.INPUT;
    persistDiscussion();
  }

  async function advanceIfReady() {
    await refreshSessionData();
    await nextTick();
    const next = readRefOrGetterValue(actions.currentNext);
    if (!nextIsReady(next)) {
      return false;
    }
    if (typeof actions.goNext !== "function") {
      return false;
    }
    await actions.goNext?.();
    await refreshSessionData();
    return true;
  }

  function persistDiscussion() {
    writeStoredDiscussion(sessionId.value, {
      activeRequestId: activeRequestId.value,
      ignoredRequestIds: [...ignoredRequestIds.value],
      outputCursor: outputCursor.value,
      questionAnswers: questions.value.map((question) => String(question.answer || "")),
      requestText: requestText.value
    });
  }

  function returnToInputIgnoringCurrentCodexAnswer() {
    const requestIdToIgnore = activeRequestId.value;
    if (requestIdToIgnore) {
      ignoredRequestIds.value = new Set([
        ...ignoredRequestIds.value,
        requestIdToIgnore
      ]);
    }

    activeRequestId.value = "";
    draftBody.value = "";
    draftTitle.value = "";
    storedQuestionAnswers.value = [];
    codexQuestions.clearForOwner(questionOwnerId.value);
    outputCursor.value = codexOutput.value.length;
    state.value = ISSUE_DISCUSSION_STATE.INPUT;
    persistDiscussion();
  }

  function loadDiscussion(nextSessionId = "") {
    const stored = readStoredDiscussion(nextSessionId);
    requestText.value = String(stored.requestText || "");
    activeRequestId.value = String(stored.activeRequestId || "");
    ignoredRequestIds.value = new Set(storedIgnoredRequestIds(stored));
    outputCursor.value = Number.isSafeInteger(stored.outputCursor) && stored.outputCursor >= 0
      ? stored.outputCursor
      : 0;
    storedQuestionAnswers.value = Array.isArray(stored.questionAnswers)
      ? stored.questionAnswers.map(String)
      : [];
    draftBody.value = "";
    draftTitle.value = "";
    failure.value = "";
    state.value = loadedDiscussionState(activeRequestId.value);
    applyLatestMarker();
  }

  function latestAcceptableDefinitionMarker() {
    const output = codexOutputAfterCursor();
    if (activeRequestId.value) {
      return latestIssueDefinitionMarker(output, {
        ignoredRequestIds: ignoredRequestIds.value,
        requestId: activeRequestId.value
      });
    }

    return latestIssueDefinitionMarker(output, {
      ignoredRequestIds: ignoredRequestIds.value
    });
  }

  function codexOutputAfterCursor() {
    const output = codexOutput.value;
    const cursor = Number(outputCursor.value || 0);
    if (!Number.isSafeInteger(cursor) || cursor <= 0) {
      return output;
    }
    if (cursor >= output.length) {
      return activeRequestId.value ? output : "";
    }
    return output.slice(cursor);
  }

  function applyLatestMarker() {
    if (!ready.value || issueArtifactsAreReady(currentSession.value) || issueIsSelected(currentSession.value)) {
      return;
    }

    const marker = latestAcceptableDefinitionMarker();
    if (!marker) {
      return;
    }
    if (issueQuestionActive.value && marker.kind === "questions" && marker.requestId === activeRequestId.value) {
      return;
    }

    activeRequestId.value = marker.requestId;
    failure.value = "";
    if (marker.kind === "questions") {
      draftBody.value = "";
      draftTitle.value = "";
      state.value = ISSUE_DISCUSSION_STATE.QUESTIONS;
      startQuestionExchange(marker);
    } else {
      draftBody.value = marker.body;
      draftTitle.value = marker.title;
      codexQuestions.clearForOwner(questionOwnerId.value);
      state.value = ISSUE_DISCUSSION_STATE.REVIEW;
    }
    persistDiscussion();
  }

  function startQuestionExchange(marker = {}) {
    codexQuestions.start({
      contextLabel: "Issue definition",
      onAnswerChange: (nextQuestions = []) => {
        storedQuestionAnswers.value = nextQuestions.map((question) => String(question.answer || ""));
        persistDiscussion();
      },
      onCancel: () => {
        failure.value = "";
        returnToInputIgnoringCurrentCodexAnswer();
      },
      onSubmitted: ({ prepared = {} } = {}) => {
        if (prepared.answeredRequestId) {
          ignoredRequestIds.value = new Set([
            ...ignoredRequestIds.value,
            prepared.answeredRequestId
          ]);
        }
        activeRequestId.value = prepared.requestId;
        outputCursor.value = prepared.outputCursor;
        failure.value = "";
        storedQuestionAnswers.value = [];
        state.value = ISSUE_DISCUSSION_STATE.WAITING;
        persistDiscussion();
      },
      ownerId: questionOwnerId.value,
      prepareSubmit: ({ questions: answeredQuestions = [] } = {}) => {
        const requestId = createRequestId();
        return {
          answeredRequestId: activeRequestId.value,
          injectionContext: {
            requestId,
            sessionId: sessionId.value
          },
          outputCursor: codexOutput.value.length,
          prompt: buildAnsweredIssueDraftPrompt({
            requestId,
            requestText: requestText.value,
            questions: answeredQuestions
          }),
          requestId
        };
      },
      questions: withQuestionAnswers(marker.questions, storedQuestionAnswers.value)
    });
  }

  watch(sessionId, loadDiscussion, {
    immediate: true
  });

  watch([codexOutput, ready], () => {
    if (state.value === ISSUE_DISCUSSION_STATE.SAVING) {
      return;
    }
    applyLatestMarker();
  });

  watch(promptInjectionError, (error) => {
    if (!error || !waiting.value) {
      return;
    }
    resetActiveRequestAfterPromptFailure(error);
  });

  return {
    acceptIssueDraft,
    cancelWaiting,
    canAccept,
    canSubmit,
    draftBody,
    draftTitle,
    failure,
    inputVisible,
    requestText,
    reviewing,
    rejectIssueDraft,
    saving,
    state,
    statusText,
    submitInitialRequest,
    waiting
  };
}

export {
  ISSUE_DISCUSSION_STATE,
  useAiStudioAutopilotIssueDiscussion
};
