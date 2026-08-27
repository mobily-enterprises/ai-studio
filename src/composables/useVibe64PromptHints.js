import { computed, onScopeDispose, ref, watch } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import {
  VIBE64_PROMPT_HINT_LABEL_MAX_CHARACTERS,
  VIBE64_PROMPT_HINT_PROMPT_MAX_CHARACTERS,
  VIBE64_PROMPT_HINT_STATIC_STARTERS
} from "@local/vibe64-runtime/shared";
import {
  vibe64SessionPromptHintsCancelPath,
  vibe64SessionPromptHintsPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64BrowserTabOriginId
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const PROMPT_HINT_DEBOUNCE_MS = 320;
const PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT = 8;
let promptHintOperationSequence = 0;

function normalizedPromptHintText(value = "") {
  return String(value || "").trim();
}

function promptHintOperationId() {
  promptHintOperationSequence += 1;
  return `hint:${Date.now().toString(36)}:${promptHintOperationSequence.toString(36)}`;
}

function promptHintConversationFingerprint(turns = []) {
  const recentTurns = (Array.isArray(turns) ? turns : [])
    .slice(-PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT);
  return JSON.stringify(recentTurns.map((turn = {}) => ({
    assistant: normalizedPromptHintText(turn?.assistant?.text),
    turnId: normalizedPromptHintText(turn?.turnId),
    user: normalizedPromptHintText(turn?.user?.text)
  })));
}

function normalizedPromptHintSuggestion(suggestion = {}) {
  if (
    !suggestion ||
    typeof suggestion !== "object" ||
    Array.isArray(suggestion) ||
    Object.keys(suggestion).length !== 2 ||
    !Object.hasOwn(suggestion, "label") ||
    !Object.hasOwn(suggestion, "prompt") ||
    typeof suggestion.label !== "string" ||
    typeof suggestion.prompt !== "string" ||
    [suggestion.label, suggestion.prompt].some((text) => (
      Array.from(text).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint <= 0x1f || codePoint === 0x7f;
      })
    ))
  ) {
    return null;
  }
  const label = normalizedPromptHintText(suggestion.label).replace(/[\t ]+/gu, " ");
  const prompt = normalizedPromptHintText(suggestion.prompt).replace(/[\t ]+/gu, " ");
  const labelWordCount = label ? label.split(/\s+/u).length : 0;
  return (
    label &&
    prompt &&
    Array.from(label).length <= VIBE64_PROMPT_HINT_LABEL_MAX_CHARACTERS &&
    Array.from(prompt).length <= VIBE64_PROMPT_HINT_PROMPT_MAX_CHARACTERS &&
    labelWordCount >= 2 &&
    labelWordCount <= 4
  )
    ? { label, prompt }
    : null;
}

function normalizedPromptHintSuggestions(value = []) {
  const suggestions = (Array.isArray(value) ? value : [])
    .map(normalizedPromptHintSuggestion)
    .filter(Boolean);
  return (
    suggestions.length === 3 &&
    new Set(suggestions.map(({ label }) => label.toLocaleLowerCase())).size === 3 &&
    new Set(suggestions.map(({ prompt }) => prompt.toLocaleLowerCase())).size === 3
  )
    ? suggestions
    : [];
}

function useVibe64PromptHints({
  active = true,
  blankConversation = false,
  canRequest = true,
  conversationKey = "",
  draft = "",
  existingProject = false,
  onSelect = () => false,
  policy = {},
  sessionId = "",
  sessionsApiPath = ""
} = {}, {
  debounceMs = PROMPT_HINT_DEBOUNCE_MS,
  request = (path, options) => getHttpWebClient().request(path, options)
} = {}) {
  const composerFocused = ref(false);
  const dismissedRequestKey = ref("");
  const loading = ref(false);
  const preview = ref("");
  const suggestions = ref([]);
  const status = ref("idle");
  const originId = vibe64BrowserTabOriginId();
  let debounceTimer = 0;
  let requestRevision = 0;
  let currentOperation = null;
  let scheduledKey = "";

  const currentSessionId = computed(() => normalizedPromptHintText(
    readRefOrGetterValue(sessionId)
  ));
  const currentSessionsApiPath = computed(() => normalizedPromptHintText(
    readRefOrGetterValue(sessionsApiPath)
  ));
  const currentPolicy = computed(() => readRefOrGetterValue(policy) || {});
  const policyKey = computed(() => [
    currentPolicy.value.enabled === false ? "off" : "on",
    currentPolicy.value.ready === true ? "ready" : "loading",
    Number(currentPolicy.value.revision || 0),
    Number(currentPolicy.value.version || 0)
  ].join(":"));
  const requestKey = computed(() => [
    currentSessionId.value,
    normalizedPromptHintText(readRefOrGetterValue(conversationKey)),
    policyKey.value,
    readRefOrGetterValue(blankConversation) === true ? "blank" : "history",
    readRefOrGetterValue(existingProject) === true ? "existing" : "greenfield"
  ].join("\0"));
  const eligible = computed(() => Boolean(
    readRefOrGetterValue(active) !== false &&
    readRefOrGetterValue(canRequest) !== false &&
    currentPolicy.value.enabled !== false &&
    currentPolicy.value.ready === true &&
    currentSessionId.value &&
    currentSessionsApiPath.value &&
    dismissedRequestKey.value !== requestKey.value
  ));
  const visible = computed(() => Boolean(
    eligible.value && (loading.value || suggestions.value.length === 3)
  ));

  function clearDebounce() {
    if (!debounceTimer) {
      return;
    }
    clearTimeout(debounceTimer);
    debounceTimer = 0;
  }

  function sendCancellation(operation = currentOperation) {
    if (!operation?.operationId || !operation?.sessionId || !operation?.sessionsApiPath) {
      return;
    }
    void request(vibe64SessionPromptHintsCancelPath(
      operation.sessionsApiPath,
      operation.sessionId
    ), {
      body: {
        operationId: operation.operationId,
        originId
      },
      method: "POST"
    }).catch(() => null);
  }

  function cancelCurrentPromptHints({ notify = true } = {}) {
    clearDebounce();
    requestRevision += 1;
    const operation = currentOperation;
    currentOperation = null;
    operation?.controller?.abort?.();
    if (notify) {
      sendCancellation(operation);
    }
    loading.value = false;
  }

  function clearPromptHints({ notify = true } = {}) {
    cancelCurrentPromptHints({ notify });
    preview.value = "";
    suggestions.value = [];
    status.value = "idle";
  }

  async function generatePromptHints(revision, key) {
    debounceTimer = 0;
    if (!eligible.value || key !== requestKey.value || revision !== requestRevision) {
      loading.value = false;
      return;
    }
    const operationId = promptHintOperationId();
    const controller = new AbortController();
    const operation = {
      controller,
      operationId,
      sessionId: currentSessionId.value,
      sessionsApiPath: currentSessionsApiPath.value
    };
    currentOperation = operation;
    try {
      const response = await request(vibe64SessionPromptHintsPath(
        operation.sessionsApiPath,
        operation.sessionId
      ), {
        body: {
          operationId,
          originId
        },
        method: "POST",
        signal: controller.signal
      });
      if (
        revision !== requestRevision ||
        currentOperation !== operation ||
        !eligible.value ||
        key !== requestKey.value
      ) {
        return;
      }
      const nextSuggestions = response?.status === "ready"
        ? normalizedPromptHintSuggestions(response.suggestions)
        : [];
      suggestions.value = nextSuggestions;
      status.value = nextSuggestions.length === 3 ? "ready" : "idle";
    } catch {
      if (revision === requestRevision && currentOperation === operation) {
        suggestions.value = [];
        status.value = "idle";
      }
    } finally {
      if (revision === requestRevision && currentOperation === operation) {
        currentOperation = null;
        loading.value = false;
      }
    }
  }

  function schedulePromptHints() {
    clearPromptHints();
    if (!eligible.value) {
      scheduledKey = "";
      return;
    }
    const key = requestKey.value;
    scheduledKey = key;
    if (readRefOrGetterValue(blankConversation) === true) {
      suggestions.value = normalizedPromptHintSuggestions(
        readRefOrGetterValue(existingProject) === true
          ? VIBE64_PROMPT_HINT_STATIC_STARTERS.existingProject
          : VIBE64_PROMPT_HINT_STATIC_STARTERS.greenfield
      );
      status.value = "static";
      return;
    }
    loading.value = true;
    status.value = "loading";
    const revision = requestRevision;
    debounceTimer = setTimeout(() => {
      void generatePromptHints(revision, key);
    }, Math.max(0, Number(debounceMs) || 0));
  }

  function focusComposer() {
    if (readRefOrGetterValue(active) === false || composerFocused.value) {
      return;
    }
    dismissedRequestKey.value = "";
    composerFocused.value = true;
  }

  function blurComposer() {
    preview.value = "";
    composerFocused.value = false;
  }

  function dismissPromptHints() {
    preview.value = "";
    dismissedRequestKey.value = requestKey.value;
  }

  function currentPromptHintSuggestion(suggestion = null) {
    const normalized = normalizedPromptHintSuggestion(suggestion);
    if (!normalized) {
      return null;
    }
    return suggestions.value.find(({ label, prompt }) => (
      label === normalized.label && prompt === normalized.prompt
    )) || null;
  }

  function previewPromptHint(suggestion = null) {
    preview.value = "";
    if (normalizedPromptHintText(readRefOrGetterValue(draft))) {
      return false;
    }
    const current = currentPromptHintSuggestion(suggestion);
    if (!current) {
      return false;
    }
    preview.value = current.prompt;
    return true;
  }

  function selectPromptHint(suggestion = null) {
    const current = currentPromptHintSuggestion(suggestion);
    if (!current) {
      return false;
    }
    preview.value = "";
    return onSelect(current.prompt) !== false;
  }

  watch(() => readRefOrGetterValue(active) !== false, (isActive) => {
    if (isActive) {
      return;
    }
    composerFocused.value = false;
    dismissedRequestKey.value = "";
  }, { flush: "sync" });

  watch(() => normalizedPromptHintText(readRefOrGetterValue(draft)), (value) => {
    if (value) {
      preview.value = "";
    }
  }, { flush: "sync" });

  watch(() => [
    eligible.value ? "eligible" : "blocked",
    requestKey.value,
    dismissedRequestKey.value === requestKey.value ? "dismissed" : "available"
  ].join("\0"), () => {
    if (!eligible.value) {
      scheduledKey = "";
      clearPromptHints();
      return;
    }
    if (scheduledKey !== requestKey.value) {
      schedulePromptHints();
    }
  }, {
    flush: "sync",
    immediate: true
  });

  onScopeDispose(() => {
    clearPromptHints();
  });

  return {
    blurComposer,
    composerFocused,
    dismissPromptHints,
    focusComposer,
    loading,
    preview,
    previewPromptHint,
    selectPromptHint,
    status,
    suggestions,
    visible
  };
}

export {
  PROMPT_HINT_DEBOUNCE_MS,
  PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT,
  normalizedPromptHintSuggestions,
  promptHintConversationFingerprint,
  useVibe64PromptHints
};
