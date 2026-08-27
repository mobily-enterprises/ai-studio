# Blueprint

Vibe64 is the visual, managed shell around Genesis for people building software
with an AI coding agent.

People can open or create a project, work in isolated sessions, and have a
direct conversation with the agent while seeing the source, changes, running
application, environment, and the system's explained structure in one place.
Each session keeps valuable work recoverable and separate from unrelated work.
Internal no-op follow-up chatter stays hidden, while completed code-changing
work ends with one concise, useful account of what happened.

Every project has exactly one source authority. For a GitHub-connected project,
the configured GitHub branch is authoritative. For a hosted Vibe64-only
project, Vibe64's own repository is authoritative. For a standalone local
project, the folder the person opened is authoritative and Save records the
session's work there as an ordinary local commit.

All hosted editing happens in isolated session checkouts. A hosted project's
container is never an application checkout and is never used as a source or
cache. Vibe64 may keep a disposable local mirror of GitHub history solely to
speed transfers, but sessions still clone from GitHub, every successful Save is
verified there before the mirror is refreshed, and a missing or stale mirror
can never change correctness. Vibe64-only projects use their Vibe64 repository
directly and do not retain another project-level checkout. A new hosted project
is not ready until its authority contains its initial Genesis foundation and
can create a session.

Vibe64 makes machine-facing work dependable. It manages project access,
credentials, development environments, application processes, previews,
browser identities, and attachments without putting private machine state into
the project. It shows clear status and failures and lets people retry or ask the
agent for help.

Genesis remains the portable authority for what a project is, how its Program
is explained, which technologies it uses, its environment/resource
declarations, and its explicit Verification evidence. It also composes and
transports other named Stack sections without interpreting them. Vibe64 owns
the strict mechanical contracts for workspace setup, launch, preview identity,
and application deployment, then executes them under its host policy without
inventing commands from a framework or project shape.

People can choose how cautiously the AI engineers a project. The choice follows
the project's source, always keeps ordinary work simple and targeted, and makes
the AI ask before a real requirement forces materially greater complexity.
