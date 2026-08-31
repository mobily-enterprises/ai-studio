---
name: genesis-project
description: Work safely in a Genesis-enriched codebase using its Blueprint, Stack, subsystem Program, path-focused context, and concrete verification. Use for implementation or review in a repository containing genesis/blueprint.md.
---

# Genesis project work

Genesis is an explanatory and verification companion. It does not replace the
codebase, tests, Git review, or the coding agent.

## Run Genesis commands

When this repository is Genesis itself or has `genesis-compiler` installed
locally, invoke every Genesis CLI operation through the project-pinned package:
`npm exec --no -- genesis <arguments>`. This runs without fetching another
package. Otherwise use `genesis <arguments>` only when that executable is
already available on `PATH`. Never install or update Genesis merely to satisfy
a workflow instruction.

## Establish context

1. Read `genesis/blueprint.md` for non-technical product intent.
2. Read `genesis/engineering.md` for the selected engineering profile and any
   project-specific requirements.
3. Read `genesis/stack.md` for the selected technical composition, resources,
   and verification commands.
4. Locate the source involved in the request.
5. Run the Genesis `index <name-or-path>` operation before adding a helper or
   public operation. Reuse an existing function when it already owns the
   behavior.
6. Run the Genesis `context <path...>` operation for the relevant Program
   explanations and selected Stack context.
7. Load applicable technology skills from `.agents/skills/` or from the
   agent's own installed skill catalog.

For an existing application's first Stack selection, inspect its real setup,
build, and output commands before relying on component defaults. A selected
component describes its current foundation; it does not silently port older
source. When the existing commands differ, keep the implementation unchanged
and declare exact project-owned consumer-operation overrides (for Vibe64,
`## Workspace setup` and `## Outputs`). Genesis composes those sections as
opaque text; the named consumer alone owns their meaning and execution. Do not
claim the inherited component recipe is usable until it matches the source.

Program is concise, fallible explanation. Its Sources and optional
Implementation maps aid navigation but never substitute for reading code,
tests, and runtime behavior.

`.genesis/machine-city.json` is a derived detailed file/function map.
`.genesis/program-city.json` is a derived simpler subsystem/operation map.
Neither is authority or proof; both may be regenerated with the Genesis
`index` operation.

## Implement ordinary local work

- Apply the effective engineering approach supplied by Genesis. Every change
  must be easy to reason about and be the smallest targeted implementation that
  fully meets known requirements. Do not overengineer or overcomplicate it, and
  do not add speculative abstractions, layers,
  dependencies, infrastructure, compatibility paths, distributed patterns,
  cryptography, or other advanced machinery.
- When a concrete requirement makes material complexity necessary, stop before
  writing it. Explain why the direct design is insufficient and the smallest
  added complexity proposed, then ask the user to approve or clarify the
  tradeoff. Never silently override the engineering approach.
- Work directly in the current Git tree and leave useful edits visible in the
  ordinary diff.
- Keep the Blueprint and affected Program modules aligned in this same turn
  when implementation intentionally changes observable product behavior.
  Private restructuring may require only corrected Sources or an informational
  Implementation map, and may require no explanatory edit. Keep exact
  consumer-owned operation declarations, such as Vibe64 `## Outputs`, aligned
  when implementation intentionally changes the corresponding commands or
  capabilities. Record only capability metadata and environment-variable names
  there, never values or secrets; do not infer or execute the section as
  Genesis behavior. Treat `.genesis/` as replaceable derived navigation data,
  not authored product intent.
- Follow established project and technology seams instead of creating parallel
  frameworks, persistence layers, transports, validators, or UI systems.
- Never invent unavailable external-resource values or pass literal
  environment-variable names as data. Report the missing resource and preserve
  useful work.
- Keep the implementation direct and cohesive. Apply any supplied Stack
  Post-change guidance before reporting completion; it is part of this
  implementation turn, not a request for another agent turn. Run focused checks
  when useful.

## Verify and report

After the selected technology's workspace substrate exists, use the Genesis
`verify` operation for the Stack's declared final checks. An unconfigured result
means the declared workspace or checks do not exist yet; it is not a failing
check. Report files changed, checks actually run, and anything still requiring
attention. Never claim that an unrun check passed or that passing checks prove
the whole product.
