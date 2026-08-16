---
name: genesis-project
description: Work safely in a Genesis-enriched codebase using its Blueprint, Stack, subsystem Program, path-focused context, and concrete verification. Use for implementation or review in a repository containing genesis/blueprint.md.
---

# Genesis project work

Genesis is an explanatory and verification companion. It does not replace the
codebase, tests, Git review, or the coding agent.

## Establish context

1. Read `genesis/blueprint.md` for non-technical product intent.
2. Read `genesis/stack.md` for the selected technical composition, resources,
   and verification commands.
3. Locate the source involved in the request.
4. Run `genesis index <name-or-path>` before adding a helper or public operation.
   Reuse an existing function when it already owns the behavior.
5. Run `genesis context <path...>` for the relevant Program explanations and
   selected Stack context.
6. Load applicable technology skills from `.agents/skills/` or from the
   agent's own installed skill catalog.

Program is concise, fallible explanation. Its Sources and optional
Implementation maps aid navigation but never substitute for reading code,
tests, and runtime behavior.

`.genesis/machine-city.json` is a derived detailed file/function map.
`.genesis/program-city.json` is a derived simpler subsystem/operation map.
Neither is authority or proof; both may be regenerated with `genesis index`.

## Implement ordinary local work

- Work directly in the current Git tree and leave useful edits visible in the
  ordinary diff.
- Do not edit the Blueprint, Program, or `.genesis/` during implementation; the
  separate reconciliation turn owns explanatory updates. Keep an exact Stack
  `## Launch` declaration aligned when the implementation establishes or
  intentionally changes how the project is started or how Vibe64 may request
  an application preview identity. Record only capability metadata and
  environment variable names there, never environment values or secrets.
- Follow established project and technology seams instead of creating parallel
  frameworks, persistence layers, transports, validators, or UI systems.
- Never invent unavailable external-resource values or pass literal
  environment-variable names as data. Report the missing resource and preserve
  useful work.
- Keep the implementation direct and cohesive. Run focused checks when useful.

## Verify and report

After the selected technology's workspace substrate exists, use `genesis
verify` for the Stack's declared final checks. An unconfigured result means the
declared workspace or checks do not exist yet; it is not a failing check. Report
files changed, checks actually run, and anything still requiring attention.
Never claim that an unrun check passed or that passing checks prove the whole
product.
