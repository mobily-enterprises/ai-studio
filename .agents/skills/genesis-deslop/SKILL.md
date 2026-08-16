---
name: genesis-deslop
description: Perform a separate behavior-preserving cleanup pass after implementation. Use when asked to Deslop, simplify, remove repeated helpers, clarify ownership, or align changed code with established project and technology patterns.
---

# Genesis Deslop

Review and simplify the current local codebase without changing product
behavior. Start with the requested scope, or otherwise the ordinary Git diff
and the code immediately around it.

Consult `.genesis/machine-city.json` or run `genesis index <name-or-path>` to
find existing public and internal functions before introducing or consolidating
an abstraction. Confirm every apparent duplicate in source and its call sites.

Leave no repeated helpers, no code that is unclear or hard to reason about, no
obviously wrong code, and no code that goes against best practices or
established patterns in the codebase. Remove unnecessary wrappers, abandoned
scaffolding, parallel framework plumbing, and speculative abstractions.
Consolidate ownership where one clear module is enough. Do not optimize for tiny
files or indirection; optimize for a small, obvious design that a junior
programmer can follow.

Apply every technology-specific Deslop instruction supplied by the selected
Stack. Load applicable official technology skills for additional framework and
language context, but do not expect them to contain Genesis's cleanup policy.

You may edit or delete implementation and test files when that is the clearest
behavior-preserving cleanup. Do not edit `genesis/`, `.genesis/`, Git metadata,
dependency directories, generated build output, retained migration history, or
external resources. Do not weaken tests, public behavior, or data guarantees.
Do not create a second architecture or perform unrelated rewrites.

Run focused checks when useful. Final declared checks remain available through
`genesis verify`. Summarize what became simpler, files changed, and checks
actually run.
