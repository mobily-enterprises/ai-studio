import {
  stripStudioContextBlocksForDisplay
} from "@/lib/codexOutput.js";

function promptEchoCandidates(prompt) {
  const source = String(prompt || "");
  return [...new Set([
    source,
    source.replace(/\r?\n/gu, "\r\n"),
    source.replace(/\r?\n/gu, "\n"),
    source.replace(/\r?\n/gu, "\r")
  ])].filter(Boolean);
}

function promptEchoReplacement(prompt) {
  const compactPrompt = stripStudioContextBlocksForDisplay(prompt).replace(/\s+/gu, " ").trim();
  if (!compactPrompt || compactPrompt.length > 220) {
    return "Prompt sent.";
  }
  return compactPrompt;
}

function promptEchoMatch(output, filter) {
  if (filter.expired) {
    return null;
  }
  if (filter.match) {
    const matchStillValid = output.length >= filter.match.end &&
      output.startsWith(filter.match.candidate, filter.match.start);
    if (matchStillValid) {
      return filter.match;
    }
    filter.match = null;
  }

  const start = Math.max(0, filter.outputStart);
  if (start > output.length) {
    return null;
  }

  for (const candidate of filter.candidates) {
    if (output.startsWith(candidate, start)) {
      return {
        candidate,
        end: start + candidate.length,
        partial: false,
        start
      };
    }
    const tailLength = output.length - start;
    if (tailLength < candidate.length && candidate.startsWith(output.slice(start))) {
      return {
        end: output.length,
        partial: true,
        start
      };
    }
  }

  for (const candidate of filter.candidates) {
    const matchStart = output.indexOf(candidate, start);
    if (matchStart >= start && matchStart - start <= 1024) {
      return {
        candidate,
        end: matchStart + candidate.length,
        partial: false,
        start: matchStart
      };
    }
  }
  if (output.length - start > filter.longestCandidateLength + 1024) {
    filter.expired = true;
  }
  return null;
}

function createCodexPromptEchoFilters() {
  let filters = [];
  let nextFilterId = 0;

  function add({
    outputStart = 0,
    prompt = ""
  } = {}) {
    const candidates = promptEchoCandidates(prompt);
    if (!candidates.length) {
      return 0;
    }

    const replacement = promptEchoReplacement(prompt);
    nextFilterId += 1;
    filters = [
      ...filters.filter((filter) => (
        filter.outputStart !== outputStart ||
        filter.replacement !== replacement
      )),
      {
        candidates,
        id: nextFilterId,
        longestCandidateLength: Math.max(...candidates.map((candidate) => candidate.length)),
        outputStart,
        replacement
      }
    ].sort((left, right) => left.outputStart - right.outputStart);
    return nextFilterId;
  }

  function remove(filterId) {
    if (!filterId) {
      return;
    }
    filters = filters.filter((filter) => filter.id !== filterId);
  }

  function clear() {
    filters = [];
  }

  function apply(output) {
    const source = String(output || "");
    if (!filters.length) {
      return source;
    }

    let displayOutput = "";
    let cursor = 0;
    for (const filter of filters) {
      const match = promptEchoMatch(source, filter);
      if (!match || match.start < cursor) {
        continue;
      }
      if (!match.partial) {
        filter.match = match;
      }
      displayOutput += source.slice(cursor, match.start);
      if (!match.partial) {
        displayOutput += filter.replacement;
      }
      cursor = match.end;
    }
    displayOutput += source.slice(cursor);
    return displayOutput;
  }

  function hasPending() {
    return filters.some((filter) => !filter.match && !filter.expired);
  }

  return Object.freeze({
    add,
    apply,
    clear,
    hasPending,
    remove
  });
}

export {
  createCodexPromptEchoFilters
};
