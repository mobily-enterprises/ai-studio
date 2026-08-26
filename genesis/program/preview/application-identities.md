# Preview application identities

People can inspect an application as one of a small set of named application
users without turning that convenience into a production sign-in mechanism.

## Sources

- `packages/vibe64-project/src/server/previewApplicationIdentities.js`
- `packages/vibe64-terminals/src/server/previewIdentityCommand.js`
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
