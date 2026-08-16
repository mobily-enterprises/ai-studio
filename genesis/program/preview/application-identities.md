# Preview application identities

People can inspect an application as one of a small set of named application
users without turning that convenience into a production sign-in mechanism.

## Sources

- `packages/vibe64-project/src/server/previewApplicationIdentities.js`
- `packages/vibe64-terminals/src/server/previewIdentityCommand.js`
- `src/components/studio/PreviewIdentitySettings.vue`

## Public contract

The project workspace stores named selectors outside source control. When a
Genesis launch target declares the identity protocol, Vibe64 offers those names
and guest mode, invokes the application-owned identity command with a
per-launch secret, and refreshes the managed browser session. Arbitrary caller
identities are rejected and Vibe64 never creates or changes application users.
