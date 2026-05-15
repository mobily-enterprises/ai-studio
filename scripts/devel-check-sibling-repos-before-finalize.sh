#!/usr/bin/env bash
set -euo pipefail

# Development-only finalization guard for dogfooding jskit-ai-studio.
# It protects editable sibling repos provisioned by
# scripts/devel-provision-jskit-ai-studio-session.sh from being lost when a
# JSKIT session is finalized and later cleaned up.

SCRIPT_NAME="devel-check-sibling-repos-before-finalize"

log() {
  printf '[%s] %s\n' "$SCRIPT_NAME" "$*" >&2
}

fail() {
  printf '[%s] ERROR: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

required_env() {
  local name="$1"
  local value="${!name-}"
  if [ -z "$value" ]; then
    fail "$name is required."
  fi
}

required_env JSKIT_SESSION_ROOT

SIBLING_ROOT="$JSKIT_SESSION_ROOT/sibling-repos"
SIBLING_MANIFEST="$SIBLING_ROOT/manifest.tsv"

if [ ! -f "$SIBLING_MANIFEST" ]; then
  log "No provisioned sibling repos to check."
  exit 0
fi

failures=0

while IFS=$'\t' read -r name repo_path base_commit marker_path; do
  if [ -z "$name" ]; then
    continue
  fi

  if ! git -C "$repo_path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    printf '[%s] Sibling %s is missing or is not a git repo: %s\n' "$SCRIPT_NAME" "$name" "$repo_path" >&2
    failures=1
    continue
  fi

  dirty="$(git -C "$repo_path" status --porcelain)"
  if [ -n "$dirty" ]; then
    printf '[%s] Sibling %s has uncommitted changes at %s:\n%s\n' "$SCRIPT_NAME" "$name" "$repo_path" "$dirty" >&2
    printf '[%s] Commit/stash those changes or ask Codex to open a sibling PR before finalizing.\n' "$SCRIPT_NAME" >&2
    failures=1
    continue
  fi

  if [ -n "$base_commit" ] && git -C "$repo_path" rev-parse --verify "$base_commit^{commit}" >/dev/null 2>&1; then
    ahead_count="$(git -C "$repo_path" rev-list --count "$base_commit..HEAD")"
    if [ "$ahead_count" != "0" ] && [ ! -s "$marker_path" ]; then
      printf '[%s] Sibling %s has %s commit(s) after the session base that are not recorded as preserved.\n' "$SCRIPT_NAME" "$name" "$ahead_count" >&2
      printf '[%s] Open/push a sibling PR, then write its URL to %s before finalizing this JSKIT session.\n' "$SCRIPT_NAME" "$marker_path" >&2
      failures=1
      continue
    fi
  fi

  log "Sibling $name is clean."
done < "$SIBLING_MANIFEST"

if [ "$failures" != "0" ]; then
  exit 1
fi

log "All provisioned sibling repos are clean or recorded as preserved."
