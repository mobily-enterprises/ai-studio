# Managed project outputs

People can run and inspect a project's web, terminal, and finite build outputs
without leaving the coding workspace.

## Sources

- `packages/vibe64-genesis/src/server/outputs.js`
- `packages/vibe64-terminals/src/server/vibe64OutputTargets.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminal.js`
- `packages/vibe64-terminals/src/server/outputResults.js`
- `packages/vibe64-terminals/src/server/launchPreviewProxy.js`
- `src/components/studio/Vibe64LongRunningTerminal.vue`
- `src/components/studio/Vibe64OutputControls.vue`
- `src/components/studio/vibe64-session/Vibe64AutopilotView.vue`
- `src/components/studio/vibe64-session/Vibe64ProjectOnboarding.vue`
- `src/composables/useVibe64OutputControls.js`
- `src/composables/useVibe64OutputControlsSurface.js`

## Public contract

Vibe64 lists only targets in the strict Markdown `vibe64.outputs.v1` contract
transported as an opaque Stack section by Genesis. Each target declares exact
Prepare, Build, and Run argv, a working directory and runtime requirements,
plus either an interactive presentation or finite downloadable results. Vibe64
never guesses a framework command or substitutes an unknown runtime. After
bounded output discovery proves that a project declares no target, Preview
states that there is no application output and presents no empty launch
menu. The embedded browser toolbar remains visible; URL navigation requires a
known preview destination, while Reload can recheck output status without one.
A blocked Outputs declaration with no targets reports its actionable
inspection diagnostic instead of claiming that the project has no output.
Declared targets blocked by missing resources remain visible but disabled.
Working directories resolve relative to the session source. An ordinary name
such as `..build` is valid; a path resolving outside that source is rejected.

Starting a target waits for the separately owned workspace-setup recipe, then
runs every step through the managed execution gateway. Web targets use the
preview resource profile, finite targets use the bounded job profile, and
interactive terminal targets use the terminal profile. Web presentation owns
port allocation, readiness and the managed proxy. A hosted web target publishes
its ingress socket as soon as readiness is confirmed, independently of client
status polling. Later status inspection verifies the bound socket identity and
republishes a missing or replaced socket. Finite runs snapshot only their
declared regular files into bounded immutable result storage and expose
downloads by generated result identity rather than a caller-supplied path.

Status inspection resolves the environment without provisioning resources or
writing project environment files. Confirmed preview readiness supersedes a
failed overlapping start request, so a running preview is not covered by an old
startup error. Late start failures from a previous project or session are ignored.

The broad Genesis opening inspection is not launch admission. Existing-project
setup diagnostics, including stale Program source citations, and inspection
request failures appear in a persistent compact warning above the preview.
They do not unmount a running iframe or its toolbar. Recheck setup refreshes
only that inspection, works during assistant activity, and removes the warning
when resolved. Reload remains the separate browser/output-status action.
Starter selection and adoption still guide new or uninitialized projects;
Vibe64's output and workspace-setup contracts continue to validate actual launches.

Status inspection never starts work. Logs, retry, stop, open, fresh restart,
result history, and authenticated downloads remain available through the
session-owned output controller and studio controls.
An active assistant turn delays automatic startup, not status inspection or an
explicit restart. Both restart controls send the forced-start command for
running and exited targets. Session renewal still suspends source operations;
launch preparation remains protected by the server's source-operation lock.

A long-running target does not occupy the workspace with terminal output by
default. When a run has output, its console action opens the complete terminal;
there is no one-line terminal mode. Hiding the terminal disconnects only the
view and does not stop the target. Once opened, the terminal remains open after
the process exits until the person hides it.
