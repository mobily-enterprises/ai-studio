---
name: genesis-program
description: Create, reconcile, or review the explanatory Blueprint and subsystem-oriented Program of a Genesis project. Use when adopting a codebase, documenting public operations, or updating explanations after implementation changes.
---

# Genesis Blueprint and Program

Blueprint and Program are maintained explanations, not proof, ownership, or an
exhaustive semantic model.

## Blueprint

`genesis/blueprint.md` is a short, cohesive, non-technical description of what
the product should do. Prefer explicit user intent. Do not mention frameworks,
packages, route spellings, schemas, source files, implementation plans, tests,
or private architecture.

Update Blueprint after implementation only when the change intentionally adds,
removes, or alters observable product behavior. Never turn an accident, bug,
private design choice, or ambiguity into product intent.

## Program

Organize Program beneath conceptual subsystem directories:

```text
genesis/program/billing/invoices.md
genesis/program/authentication/sessions.md
```

Create one module for each meaningful public operation provided by a subsystem,
regardless of language or source layout. Public operations include exported
functions or methods, API actions, commands, UI operations, and other observable
entry points. Do not mirror source files or document every helper.

Each module contains:

```markdown
# Human-readable boundary name

One short explanation of why the boundary exists.

## Sources

- `exact/authored/source/path`

## Public contract

Meaningful inputs, outputs, effects, failures, and guarantees.
```

An optional `## Implementation map` may name only private helpers or seams that
materially help a future agent change, trace, or debug the operation. It is
informational, not a public guarantee. Tests are evidence and never
implementation Sources.

Prefer fewer, clearer modules. Remove stale and duplicate explanations. A
source may support several operations; helper and glue files may appear in no
Program module.

## Task boundaries

The caller determines whether this is initial description, complete Program
refresh, focused post-change reconciliation, Blueprint-only work, or read-only
review. Respect the caller's edit boundary. Report ambiguity rather than
inventing intent.
