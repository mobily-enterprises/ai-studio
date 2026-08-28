---
name: genesis-deslop
description: Perform a separate behavior-preserving cleanup pass after implementation. Use when asked to Deslop, simplify, remove repeated helpers, clarify ownership, or align changed code with established project and technology patterns.
---

# Genesis Deslop

Review and simplify the current local codebase without changing product
behavior. Start with the requested scope, or otherwise the ordinary Git diff
and the code immediately around it.

When this repository is Genesis itself or has `genesis-compiler` installed
locally, invoke every Genesis CLI operation through the project-pinned package:
`npm exec --no -- genesis <arguments>`. This runs without fetching another
package. Otherwise use `genesis <arguments>` only when that executable is
already available on `PATH`. Never install or update Genesis merely to satisfy
a workflow instruction.

Apply the engineering approach supplied with the task. If this skill is invoked
directly, read `genesis/engineering.md` as well as the relevant project context.
Cleanup must reduce or preserve complexity, never introduce unapproved
machinery that the selected profile or a concrete requirement does not need.

Consult `.genesis/machine-city.json` or run the Genesis `index <name-or-path>`
operation to find existing public and internal functions before introducing or
consolidating an abstraction. Confirm every apparent duplicate in source and
its call sites.

Within the preceding implementation's intended behavior and scope, leave no
repeated helpers, no code that is unclear or hard to reason about, and no code
that goes against established patterns in the codebase. Remove unnecessary
wrappers, abandoned scaffolding, parallel framework plumbing, and speculative
abstractions. Consolidate ownership where one clear module is enough. Do not
optimize for tiny files or indirection; optimize for a small, obvious design
that a junior programmer can follow.

Cleanup is not a second implementation pass. A changed path limits where cleanup
may occur; it does not authorize different behavior in that file. Deslop may
reorganize behavior already present; it may not complete, correct, or extend
behavior. If review reveals a defect, missing behavior, contract mismatch, or
test gap, report it as a follow-up finding and leave it unchanged, even when it
is inside a changed path or appears related to the preceding implementation. Do
not implement the finding or alter tests to accommodate it during Deslop.

Apply every technology-specific Deslop instruction supplied by the selected
Stack. Load applicable official technology skills for additional framework and
language context, but do not expect them to contain Genesis's cleanup policy.

You may edit or delete implementation and test files when that is the clearest
behavior-preserving cleanup. Do not edit `genesis/`, `.genesis/`, Git metadata,
dependency directories, generated build output, retained migration history, or
external resources. Do not weaken tests, public behavior, or data guarantees.
Do not create a second architecture or perform unrelated rewrites.

Run focused checks when useful. Final declared checks remain available through
the Genesis `verify` operation. Summarize what became simpler, files changed,
and checks actually run.
