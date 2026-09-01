---
name: genesis-deslop
description: Deslop committed work through an explicit behavior-preserving cleanup pass. Use when asked to Deslop a commit or recent commits, simplify completed work, remove repeated helpers, clarify ownership, or align changed code with established project and technology patterns.
---

# Genesis Deslop

Review and simplify committed work without changing product behavior. Deslop is
explicit: never run it merely because implementation finished.

When this repository is Genesis itself or has `genesis-compiler` installed
locally, invoke every Genesis CLI operation through the project-pinned package:
`npm exec --no -- genesis <arguments>`. This runs without fetching another
package. Otherwise use `genesis <arguments>` only when that executable is
already available on `PATH`. Never install or update Genesis merely to satisfy
a workflow instruction.

## Load the effective project instructions once

A Deslop request may arrive either as a complete Genesis-generated prompt or
as a direct request such as `Deslop` in an agent session.

If the current task already contains `GENESIS CONTEXT` whose task is `deslop`,
continue with it directly. Do not generate another prompt.

Otherwise, before resolving Git scope, run the Genesis
`prompt --task deslop` operation once using the invocation rule above. For a
bare `Deslop` request, pass no request argument. When the user names a count,
commit, or range, pass that exact request as one safely quoted argument. Treat
the printed prompt as the instructions for this same turn; do not dispatch it
to another agent and do not generate it again. This step composes the selected
Stack's technology-specific Deslop guidance and any project customization with
the portable contract below.

## Resolve the committed scope

Before reading or editing the selected change, require a clean worktree and
index with `git status --short`. Stop and report the existing paths when it is
not clean; do not stash, commit, discard, or mix them into Deslop.

Resolve the user's scope as follows:

- With no stated scope, use the latest commit.
- “The last N commits” means the net surviving change from the first parent
  before those N commits through `HEAD`.
- A named commit means that commit against its first parent.
- An explicit commit range means exactly that range.
- A root commit uses Git's root-diff form because it has no parent.

Inspect the resolved commit identities and changed paths before editing. Review
the committed diff, current source, direct call sites, relevant tests, and the
affected Program and Stack context. Do not substitute the ordinary working-tree
diff for the selected committed scope.

## Apply the cleanup contract

Apply the engineering approach supplied with the task. If this skill is invoked
directly, read `genesis/engineering.md` as well as the relevant project context.
Cleanup must reduce or preserve complexity, never introduce unapproved
machinery that the selected profile or a concrete requirement does not need.

Consult `.genesis/machine-city.json` or run the Genesis `index <name-or-path>`
operation to find existing public and internal functions before introducing or
consolidating an abstraction. Confirm every apparent duplicate in source and
its call sites.

Within the selected commits' intended behavior and scope, leave no
repeated helpers, no code that is unclear or hard to reason about, and no code
that goes against established patterns in the codebase. Remove unnecessary
wrappers, abandoned scaffolding, parallel framework plumbing, and speculative
abstractions. Consolidate ownership where one clear module is enough. Do not
optimize for tiny files or indirection; optimize for a small, obvious design
that a junior programmer can follow.

Cleanup is not a second implementation pass. A committed path limits where cleanup
may occur; it does not authorize different behavior in that file. Deslop may
reorganize behavior already present; it may not complete, correct, or extend
behavior. If review reveals a defect, missing behavior, contract mismatch, or
test gap, report it as a follow-up finding and leave it unchanged, even when it
is inside a changed path or appears related to the preceding implementation. Do
not implement the finding or alter tests to accommodate it during Deslop.

Apply every technology-specific Deslop instruction supplied by the selected
Stack and load applicable official technology skills for framework and language
context. Stack guidance enriches this contract; it cannot weaken the
behavior-preserving boundary, change the selected Git scope, or authorize
unrelated implementation.

You may edit or delete implementation and test files when that is the clearest
behavior-preserving cleanup. If moving or renaming selected source makes an
affected Program citation stale, update only that citation or informational
Implementation map. Do not change the Blueprint or a Program public contract to
excuse cleanup behavior. Do not edit `.genesis/`, Git metadata, dependency
directories, generated build output, retained migration history, or external
resources. Do not weaken tests, public behavior, or data guarantees. Do not
create a second architecture or perform unrelated rewrites.

Leave the cleanup as ordinary uncommitted work for review and a later normal
commit. Never amend or rewrite the selected commits. Run focused checks when
useful. Final declared checks remain available through the Genesis `verify`
operation. Summarize the resolved commit range, what became simpler, files
changed, checks actually run, and follow-up findings left unchanged.
