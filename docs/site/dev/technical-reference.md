---
title: Technical reference
description: Vibe64 project, runtime, Git, launch, preview, and cleanup ownership.
layout: doc
---

# Technical reference

This page records the operational boundary between the project, Genesis, and
Vibe64. Project knowledge should remain portable. Machine policy, credentials,
and live session state should not leak into the repository.

## Source-owned project files

A Genesis-enabled project has this portable shape:

```text
<project>/
  .git/
  genesis/
    blueprint.md
    stack.md
    stack/
    program/
      <subsystem>/
        <public-operation>.md
  .agents/
    skills/
  .codex/
    hooks.json
  .genesis/
    machine-city.json
    program-city.json
    verification.json
  application source...
```

The files have deliberately different jobs:

- `genesis/blueprint.md` contains non-technical, human product intent.
- `genesis/stack.md` selects technology components and may replace their
  verification or launch declarations.
- `genesis/stack/` contains project additions or overrides to a selected
  component's Description and Deslop guidance.
- `genesis/program/` explains public operations in conceptual subsystem
  directories. It does not mirror source files.
- `.agents/skills/` contains Genesis workflow skills and any authoritative
  technology skill selected by Stack.
- `.codex/hooks.json` contains the optional project-local Codex lifecycle
  integration installed by Genesis.
- `.genesis/machine-city.json` and `.genesis/program-city.json` are derived
  navigation documents.
- `.genesis/verification.json` is present only after declared checks pass. It
  records exact code and Stack hashes; it is evidence, not a correctness claim.

`genesis init` creates a technology-neutral Genesis project. `genesis adopt`
preserves an existing implementation and produces the prompt used to describe
it. Neither operation needs a Vibe64 project type.

A newly initialized blank project starts chat with the Genesis `start` prompt.
The agent asks what the application is for, records the resulting product intent
in the Blueprint, and then offers compatible Stack choices from the installed
Genesis catalog. Vibe64 does not carry a separate onboarding prompt or choose a
technology on the user's behalf.

## Vibe64-owned runtime state

Local Editor opens one arbitrary folder as canonical source. Private state is
stored outside that source under the real OS user's state directory:

```text
~/.local/state/vibe64/
  auth/
  projects/
    <slug>-<hash>/
      sessions/
      runtime/
      runtime-config/
  services/
  users/
  logs/
  setup.json
```

Online supplies explicit roots from its launcher. A typical single-owner layout
is:

```text
/var/lib/vibe64/<owner>/
  projects/
    <project>/
      .git/
      application source...
  services/
    _daemon/
      <service-owner>/
        <service>/
          data/
    <project>/
      <service-owner>/
        <service>/
          data/
```

Sessions, runtime files, resolved Env values, secrets, domains, publish state,
billing state, auth markers, terminal state, and UI preferences are Vibe64-owned
state. They must not be stored in the source-owned Genesis files.

GitHub and Codex credentials live in the real OS home of the acting user or
daemon owner. Vibe64 owns how those credentials are exposed to its Git and agent
processes. Genesis never reads or stores credential values.

## Root resolution

Directory policy is centralized in the Vibe64 root resolver. Feature packages
must not invent state paths.

```text
local editor systemRoot   = ~/.local/state/vibe64
serviceDataRoot           = <systemRoot>/services unless explicitly configured
sourceRoot                = active source checkout
projectRuntimeRoot        = Vibe64-owned runtime root
managedSourceRoot         = /var/lib/vibe64/<owner>/projects by default
projectSessionSourceRoot  = source bucket for Vibe64-created session copies
```

Supported host overrides are:

```text
VIBE64_SYSTEM_ROOT        explicit editor system-state root
VIBE64_SERVICE_DATA_ROOT explicit host service-data root
VIBE64_TARGET_ROOT        explicit target project root
VIBE64_APP_ROOT           Vibe64 application checkout root
```

Normal Local Editor runs use `~/.local/state/vibe64`. A composed launcher can
provide an explicit system root through its runtime profile; a direct CLI run
does not treat `VIBE64_SYSTEM_ROOT` as a casual state-placement preference.

## Execution ownership

Genesis supplies its own declarations and opaque section transport. Vibe64
owns the operational contracts it consumes and the execution policy.

Genesis owns:

- prompt and focused context generation;
- selected Stack guidance and Agent Skills;
- generic resource declarations;
- argument-safe verification commands;
- exact opaque Stack-section composition without private interpretation;
- Machine and Program City generation.

Vibe64 owns:

- Git repositories, branches, worktrees, credentials, commits, and pushes;
- user Env storage and secret handling;
- strict mechanical parsing of `vibe64.workspace-setup.v1`,
  `vibe64.launch.v1`, `vibe64.preview-identity.command.v1`, and
  `vibe64.application-deployment.v1`;
- mapping supported runtime requirements to pinned runtime packs;
- process creation, interruption, logs, recovery, and cleanup;
- port allocation, readiness, proxying, and preview URLs;
- the exact Playwright and Chromium release available to generated projects.

Vibe64 does not infer a framework launch command. If the Stack has no Vibe64
Launch section, preview is unavailable with a clear diagnostic. An unknown
runtime requirement is rejected rather than mapped to a similar host tool.

Workspace setup and Launch are separate Vibe64 contracts carried in opaque
Stack sections. Vibe64 accepts only their strict Markdown v1 grammars: headings
and list roles provide structure, descriptive labels remain readable, and each
command and argument is a separate backticked value. Vibe64 runs setup's ordered
argv through the managed execution gateway and records success against that
exact recipe. Merely reading preview status never starts setup or a process.
Launch remains pending until the current setup recipe has succeeded; a Stack
with no setup recipe is simply unconfigured rather than failed. Component
conflicts are reported instead of interleaving competing commands.

## Project environment projection

Genesis Stack components declare resource kinds, environment variable names,
and optional generated environment-file paths. They never supply or inspect
secret values. Local Vibe64 uses the user's project Env; Vibe64 Online may
provision declared MySQL or PostgreSQL resources and supply their values. Other
Genesis hosts can satisfy the same declarations using their own environment
mechanism.

When Stack requests a dotenv projection, Vibe64 writes it deterministically
with mode `0600`. It first protects the generated path and its preserved backup
names in the repository's local `.git/info/exclude`, so secrets are never added
to source history by an ordinary Git operation. An existing user-owned file is
preserved before Vibe64 takes ownership. Symbolic-link paths are rejected.

The browser toolchain is a Vibe64 release contract. Vibe64 exposes its exact
managed Playwright version and browser path; project commands run with browser
downloads disabled. A project must never repair a mismatch by downloading
Chrome or Chromium itself.

## Application preview identity

An optional `previewIdentity` declaration on a Vibe64 Launch target advertises
application identity switching. It names a safe committed, application-owned
project-relative executable such as `tools/preview-identity`, declares the
`vibe64.preview-identity.command.v1` protocol, and lists the application
identifier types it accepts: email, login, or user ID. It may also declare
app-specific enable and secret environment variable names, command runtime
requirements, and a timeout.

Genesis transports the Launch section without parsing it. Vibe64 validates the
declaration, maps its runtime requirements to pinned runtime packs, verifies the
executable, and owns command execution, identity selections, secrets, and the
preview browser lifecycle.

Vibe64 stores managed app identities in project-local runtime state, outside
Git and the Genesis files. Each entry contains a Vibe64-facing name plus one
application selector such as email, login, or user ID; the first entry is the
default. Managed Preview and Playwright select a configured entry by name or
request guest mode. Callers cannot submit arbitrary application identities.

For an enabled preview launch, Vibe64 supplies `true` and a fresh per-launch
secret only through the application-specific environment names declared by
the Vibe64 Launch contract. These are system launch values, not user-managed project Env
values. The executable reads one protocol request from standard
input and writes one response to standard output. It remains responsible for
locating an existing user, rejecting missing or disabled users, and creating or
clearing the application's normal browser session. Vibe64 never creates
application users or changes their roles or data.

Any internal endpoint used by that executable must remain disabled unless both
the enable flag and per-launch secret are present. This is a development-preview
control, not a production sign-in API.

## Host runtime naming

Runtime names and paths are deterministic, daemon-scoped, and project-scoped.
For namespace `tonymobily` and project `beepollen`, the layout is:

```text
daemon runtime bucket    <systemRoot>/runtime/<namespace>
project runtime bucket   <projectRuntimeRoot>/runtime/
service data             <serviceDataRoot>/<project>/<service-owner>/<service>/data
daemon service data      <serviceDataRoot>/_daemon/<service-owner>/<service>/data
terminal lock/log data   <projectRuntimeRoot>/runtime/terminals/
```

The namespace is sanitized to lowercase host-safe name parts before it appears
in paths, socket names, lock names, or process metadata. `service-owner` is a
stable host-selected storage namespace; it grants no prompt or Stack authority.

## Cleanup ownership

Vibe64 cleanup targets Vibe64-owned state roots, lock files, logs, terminal
metadata, and child processes started by the Studio daemon. It does not scan
arbitrary host services or delete unrelated project files.

Cleanup relies on deterministic roots and daemon process identity, not ad hoc
searches for arbitrary host resources. Source-owned Genesis files change only
through ordinary project work and Git review.
