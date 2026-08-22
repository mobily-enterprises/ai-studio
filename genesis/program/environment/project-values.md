# Project environment

People can supply the environment values a project needs while Vibe64 and its
host provide managed system values separately.

## Sources

- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/projectEnvironmentFiles.js`
- `packages/vibe64-terminals/src/server/agentEnvCommand.js`
- `src/components/studio/EnvPanel.vue`

## Public contract

The environment view distinguishes editable user values from host-owned system
values, masks secrets, supports explicit add, replace, and confirmed removal,
and applies values to session preparation, checks, launches, and agent work.
When Genesis declares an environment-file projection, Vibe64 writes it outside
ordinary Git tracking with restrictive permissions and preserves a pre-existing
user file before taking ownership.

Stack declarations are inspected only from a real baseline checkout or an
explicit session source. A hosted catalog project's metadata namespace is not
source and is never passed to Genesis merely because no baseline checkout is
available; Env values remain usable without one.

Project agents receive the managed `vibe64-env` command. It reads configuration
metadata without exposing values and delegates explicit development mutations
to the project Env service. A host may contribute a production Env provider
through the terminal service; public/local Vibe64 otherwise reports production
as unavailable. Mutations require an explicit scope, accept values only on
stdin, never copy values between scopes, and never reveal stored values.
