Save the current project work in Git with one ordinary commit.

Run `git status --short --branch`, then commit all intended current work, including relevant untracked project files. This is a save operation: do not edit files, clean up code, run audits, lint, tests, or builds unless Git itself prevents the commit and you need to explain why.

Do not push. Never rebase, force-push, create a pull request, merge a branch, or deploy. If there is nothing to commit, say so. Otherwise verify that the working tree is clean and report the commit SHA concisely.
