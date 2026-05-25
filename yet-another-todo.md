# Yet Another TODO

This file tracks the current outstanding findings from the AI Studio state-machine review.

Canonical product/design decisions live in `.jskit/APP_BLUEPRINT.md`.

## Original Finding Status

| Finding | Status |
| --- | --- |
| 1. Client autopilot still contains workflow recovery policy | Outstanding |
| 2. Background Codex bootstrap is not visible enough | Outstanding |
| 3. Session list/detail reads are pure but still heavy | Outstanding |
| 4. Command action completion and session publishing are still loosely coupled | Outstanding |
| 5. Skip-merge flow is still procedural | Outstanding |
| 6. Non-command actions run inside the session mutation queue | Not to do by design |
| 7. `workflowStepMachines.js` is too large and repetitive | Outstanding |
| 8. Public payload still exposes raw autopilot definition | Done |
| 9. Numbered questions must remain UI sugar | Done |
| 10. Simple markdown does not parse pointlists | Done |

## Outstanding Findings

### Finding 1 - P1 High: Client autopilot still contains workflow recovery policy

Evidence:

- `src/composables/useAiStudioAutopilotController.js`
- `server/lib/aiStudio/sessionRealtimeEvents.js`

Problem:

The client still knows too much about stale command starts, operation key drift, command-completion polling, and stuck execution recovery. That code exists because the server operation/realtime contract does not return enough lifecycle truth.

Tackle:

- Include session revision/state details in realtime events or operation responses.
- Make command-terminal completion return a clear post-operation state.
- Keep the client as a transport/retry shell over explicit server lifecycle states.

### Finding 2 - P1 High: Background Codex bootstrap is not visible enough

Evidence:

- `packages/ai-studio-terminals/src/server/commandTerminal.js`
- `packages/ai-studio-terminals/src/server/service.js`

Problem:

Successful command completion schedules Codex thread/bootstrap work in the background. Failures are logged but not represented as durable, visible session state.

Tackle:

- Persist a visible background task/bootstrap status on the session.
- Surface status in `presentation.terminal` or a dedicated `presentation.backgroundTasks` block.
- Add recovery/retry action when bootstrap fails.

### Finding 3 - P2 Medium: Session list/detail reads are pure but still heavy

Evidence:

- `server/lib/aiStudio/runtime.js`
- `packages/ai-studio-sessions/src/server/service.js`

Problem:

Listing sessions builds full projected views and enriches open sessions with Codex terminal state. This is read-only now, but still does unnecessary work for list views.

Tackle:

- Make list payload intentionally shallow.
- Keep full projection/enrichment for selected session detail.
- Batch terminal-state reads if list enrichment remains necessary.

### Finding 4 - P2 Medium: Command action completion and session publishing are still loosely coupled

Evidence:

- `packages/ai-studio-terminals/src/server/commandTerminal.js`

Problem:

Command result persistence, advance-on-success, post-commit publishing, and bootstrap effects are separate phases. This fixed latency but still leaves several timing windows.

Tackle:

- Persist a command lifecycle record with states such as `started`, `result_written`, `advanced`, `published`, `bootstrap_started`, `bootstrap_done`.
- Let the client follow that lifecycle instead of inferring from `attempting_execution`.

### Finding 5 - P2 Medium: Skip-merge flow is still procedural

Evidence:

- `server/lib/aiStudio/workflowPresentation.js`

Problem:

Skip merge still advances through multiple steps procedurally and special-cases main checkout sync.

Tackle:

- Express skipped transitions declaratively in the workflow catalog.
- Remove the hard-coded bounded advance loop.

### Finding 7 - P2 Medium: `workflowStepMachines.js` is too large and repetitive

Evidence:

- `server/lib/aiStudio/workflowStepMachines.js`

Problem:

Many step machines repeat the same prompt/action/input lifecycle in one large file.

Tackle:

- Extract reusable prompt, command, review, and input machine factories.
- Leave only step-specific state deltas in individual definitions.

## Explicit Non-TODOs

### Finding 6 - Keep Non-Command Actions Serialized

Evidence:

- `server/lib/aiStudio/runtime.js`

Decision:

Do not split prompt/adapter/finish action handlers out of the per-session mutation queue by default.

Why:

- AI Studio is an interactive, sequential workflow.
- Long-running prompt work is already made visible by the live Codex terminal.
- Long-running command work is already made visible by the command terminal.
- Releasing the mutation queue would add run-token state, stale completion handling, and extra recovery paths without a demonstrated UX gain.
- Sequential behavior is desirable: users should not be able to start the next workflow action while the current action is still being prepared or executed.

Only revisit this if timestamped logs show a real user-visible gap before the Codex/command terminal appears. This decision is documented in `.jskit/APP_BLUEPRINT.md`.

## Completed Findings

### Prior completed finding: Centralized workflow presentation/intent contract

Evidence:

- `server/lib/aiStudio/workflow.js`
- `server/lib/aiStudio/workflowMachine.js`
- `server/lib/aiStudio/workflowPresentation.js`
- `server/lib/aiStudio/workflowStepMachines.js`
- `tests/server/aiStudioWorkflowMachine.unit.test.js`

Previous problem:

Step definitions were split across the workflow profile, step machines, presentation code, intent dispatch, and autopilot projection.

Done:

- Made the workflow catalog the canonical place for declarative presentation and intent contract data.
- Kept evaluated autopilot state server-internal.
- Moved public presentation generation to read from the centralized workflow metadata.

### Finding 9 - Numbered questions remain UI sugar

Evidence:

- `.jskit/APP_BLUEPRINT.md`
- `src/lib/aiStudioNumberedQuestionSugar.js`
- `src/composables/useAiStudioStepInputForm.js`
- `tests/client/aiStudioNumberedQuestionSugar.vitest.js`
- `tests/client/useAiStudioStepInputForm.vitest.js`

Previous problem:

The product decision was correct, but the implementation did not make the client-only contract obvious enough. Generated question field names looked like possible server payload fields, and the parser lived inside the step-input composable.

Done:

- Kept the server contract as one prompt/message and one logical `response` field.
- Extracted numbered-question handling into a client-only UI-sugar helper.
- Generated private UI field names such as `__ui_question_1`.
- Added tests that structured server input is not reinterpreted and that submit payloads contain only one `response` field.

### Finding 8 - Public payload no longer exposes raw autopilot definition

Evidence:

- `server/lib/aiStudio/workflowMachine.js`
- `tests/client/dumbClientOwnership.vitest.js`

Previous problem:

The client is tested not to read `currentStepDefinition.autopilot`, but the public payload still exposes it.

Done:

- Removed `currentStepDefinition.autopilot` from normal public session payloads.
- Kept evaluated autopilot state server-internal for `presentation.auto.nextOperation`.
- Added server test coverage that the raw autopilot field is absent while the presentation operation is still present.

### Finding 10 - Simple markdown parses pointlists

Evidence:

- `src/lib/studioLongTextBlocks.js`
- `tests/client/studioLongTextBlocks.vitest.js`

Previous problem:

The simple markdown parser handles `-`, `*`, `+`, and ordered lists, but not point/bullet list forms like `• item`.

Done:

- Extend unordered list parsing to include point bullets such as `•`.
- Add tests for pointlists.
