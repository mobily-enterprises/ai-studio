# Preview application identities

People can inspect an application as one of a small set of named application
users without turning that convenience into a production sign-in mechanism.

## Sources

- `packages/vibe64-project/src/server/previewApplicationIdentities.js`
- `packages/vibe64-terminals/src/server/previewIdentityCommand.js`
- `packages/vibe64-terminals/src/server/agentPreviewCommand.js`
- `packages/vibe64-execution/src/server/runtime/agentPlaywrightCommandSource.js`
- `packages/vibe64-genesis/src/server/outputs.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminal.js`
- `src/components/studio/PreviewIdentitySettings.vue`

## Public contract

The project workspace stores named selectors outside source control. When a
web-presented Vibe64 Outputs target declares
`vibe64.preview-identity.command.v1`, Vibe64 offers those names and guest mode,
maps the command's declared runtimes, invokes the safe committed
application-owned executable with a fresh per-run secret, and refreshes the
managed browser session. The executable may select an existing application
user by the declared email, login, or user-ID selector. Arbitrary caller
identities are rejected, and Vibe64 never creates users or changes their roles
or data.

After a service restart, stale browser metadata may no longer match the current
control token. Browser recovery uses the execution manager's durable ownership
for the exact project and session, never an execution ID from invalid metadata.
Only a proven empty browser service scope and a dead control socket permit
replacement. Unproven cleanup or an unrelated live listener remains a visible
failure, and a later request can retry recovery. Playwright preparation failures
retain the underlying browser diagnostic rather than claiming authentication
failed before application login was reached.
