# Blueprint

Vibe64 is the visual, managed shell around Genesis for people building software
with an AI coding agent.

People can open or create a project, work in isolated sessions, and have a
direct conversation with the agent while seeing the source, changes, running
application, environment, and the system's explained structure in one place.
Each session keeps valuable work recoverable and separate from unrelated work.
Internal no-op follow-up chatter stays hidden, while completed code-changing
work ends with one concise, useful account of what happened.

The chat selector stays focused on choosing among AIs that are already
configured and available. Workspace owners manage AI accounts and add further
connections in the separate account-management area.

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
agent for help. Open sessions that choose the same coding-assistant application
share one running assistant service, and that service stops when its final
session closes. Short-lived suggestions and focused helper tasks reuse the
session's chosen service instead of keeping another assistant service running.
Commands and background processes started for a session remain owned by that
session and stop with it, even while the assistant service itself is shared.

Short actions show one compact progress line unless a person opens their full
history. Long-running application output stays out of the way until opened and
remains available after the run ends. An interactive AI terminal is launched
explicitly, always matches the kind of assistant chosen when the session began,
and can be closed independently of the conversation. A project that declares
no application output remains idle: Preview says there is nothing to run and
does not show empty launch controls.

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
