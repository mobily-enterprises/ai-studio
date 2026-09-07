# Blueprint

Vibe64 is the visual, managed shell around Genesis for people building software
with an AI coding agent.

People can open or create a project, work in isolated sessions, and have a
direct conversation with the agent while seeing the source, changes, running
application, environment, and the system's explained structure in one place.
Each session keeps valuable work recoverable and separate from unrelated work.
People can explore a project's database through a readable relationship diagram,
starting with its keys and expanding detail when needed. Expanding fields keeps
every table in place and preserves the current zoom. Connections identify
the linked fields and their relationship, remain traceable while tables move,
and avoid covering tables where space permits. People can search fields, focus
on a table's neighbours, arrange or group tables, pin important positions, undo
layout changes, and keep named views. The session's diagram layout is shared
among its users: moving a table updates the other open diagrams automatically.
The first project message carries the relevant Genesis task prompt; later
messages and active-turn steering stay concise instead of rebuilding it. The
project's shorter durable operating guide is loaded when a conversation is
created and refreshed after compaction without becoming a visible message or
extra agent turn. For a new project, the opening conversation first establishes
what the person wants to make, who it is for, and the first useful outcome, then
asks before selecting any technology.

People can choose the name Vibe64 uses in welcomes and collaboration cues.
Project owners can set a shared tone, answer length, assumed experience,
explanation style, and project-specific communication requirements in the
project's portable Genesis
source. Those choices apply when a conversation next establishes stable
context; they do not rewrite past conversation or get repeated with every
message. Personal names and prompt suggestions remain separate Vibe64 conveniences
and are not added to agent prompts.

The chat selector stays focused on choosing among AIs that are already
configured and connected. A host may contribute an always-available built-in
OpenCode connection and identify one connected provider as the preferred
new-session default. Workspace owners manage account credentials and add
further connections in the separate account-management area. Each distinct
connected OpenCode provider route remains its own choice, including separate
plans from the same provider. The chat selector shows only models the host
currently permits, while a host model-access policy can expose one recommended
recovery model and give the owner a warned switch for broader access. Starting
a session presents the configured list promptly without waiting for an AI
provider to start or discover models. A session stays within
the assistant application that owns its conversation. Leaving a model's
thinking choice at its provider default leaves that choice to the provider
instead of silently selecting another listed option. Vibe64 also respects each
AI's declared response capacity rather than assuming every model can produce
the same size answer.
The chat's Codex models and thinking choices come from the connected Codex
service, so newly available models appear without an editor update.
Codex helper tasks accept the installed stable Codex version when it meets the
minimum requirement, so upgrading Codex does not require an editor update merely
to recognise a newer version. Helper isolation checks still apply.

Renewing a session keeps its current AI by default, while letting the person
choose any other connected assistant application, provider, model, and thinking
option for the fresh session. Vibe64 validates that choice when renewal starts
and records it with the handover, so recovery and retries create the successor
with the same choice. If the old model cannot prepare the draft, the person can
complete the canonical handover template instead. Once the approved handover is
accepted as the first turn in that fresh assistant conversation, renewal
completes even if the model cannot answer it.
The new session and its handover remain available for the person to repair an
expired login, quota, or provider problem and continue. Renewal stops only when
Vibe64 cannot establish the fresh conversation, its handover, or its saved
source safely.

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
agent for help. When a provider reports exhausted quota or another account
failure, completed project work remains available and the conversation gives a
direct route to the relevant account recovery. Non-urgent background checks
favor useful freshness over constant polling: hidden views stop checks that
serve only that view, returning
to a view refreshes it promptly, and repeated failures slow recovery checks.
Open sessions that choose the same coding-assistant application
share one running assistant service, and that service stops when its final
session is archived. Short-lived suggestions and focused helper tasks reuse the
session's chosen service instead of keeping another assistant service running.
Suggestions and tool-free helper conversations can run alongside preview and
foreground work. Only operations that change shared source or prepare its
environment require the source lock. A ready preview replaces any stale error
from an overlapping start request.
People can inspect and explicitly restart the application while the assistant
is working; automatic startup waits until that work is idle.
Commands and background processes started for a session remain owned by that
session and stop with it, even while the assistant service itself is shared.

Short actions show one compact progress line that a person can dismiss or open
for full history. The browser remembers a dismissal for that exact attempt
across reloads, while a new attempt appears normally. Long-running application
output stays out of the way until opened and remains available after the run
ends. An interactive AI terminal is launched
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

Deslop is a deliberate cleanup of committed work, not an automatic extra agent
turn. After Save, Vibe64 may offer Deslop for the exact commit it just
published. Accepting uses the ordinary visible project conversation; declining
has no lasting effect. People can also request Deslop directly for a commit or
recent commits outside Vibe64.

People can choose how cautiously the AI engineers a project. The choice follows
the project's source, always keeps ordinary work simple and targeted, and makes
the AI ask before a real requirement forces materially greater complexity.
