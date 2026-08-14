Save all current project work in Git.

Run `git status --short --branch`, then commit all intended current work, including relevant untracked project files. This is a save operation: do not edit files, clean up code, run audits, lint, tests, or builds unless Git itself prevents the commit and you need to explain why.

Inspect the repository's configured remotes and current branch. Push only when this project has a clearly configured, authorized canonical remote and branch; never guess a destination. If no authorized canonical destination is clear, stop after the local commit and ask the user before pushing.

Before pushing, fetch only that canonical remote branch. Fast-forward when the local commit is behind it. If local and remote history diverge, perform only a non-mutating merge preflight. If the preflight reports conflicts or cannot prove a clean merge, stop and ask the user. If it proves a clean merge, merge once and push the current branch to its canonical branch. If that merge unexpectedly fails, abort it immediately, verify the committed worktree was restored, and stop.

Never rebase, force-push, push another ref, create a fork, create a pull request, or deploy. Verify the canonical remote branch equals the local commit after any push, then report the commit SHA and whether it was pushed in one concise response.
