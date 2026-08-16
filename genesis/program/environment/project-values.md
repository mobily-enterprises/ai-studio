# Project environment

People can supply the environment values a project needs while Vibe64 and its
host provide managed system values separately.

## Sources

- `packages/vibe64-project/src/server/service.js`
- `packages/vibe64-project/src/server/projectEnvironmentFiles.js`
- `src/components/studio/EnvPanel.vue`

## Public contract

The environment view distinguishes editable user values from host-owned system
values, masks secrets, supports explicit add, replace, and confirmed removal,
and applies values to session preparation, checks, launches, and agent work.
When Genesis declares an environment-file projection, Vibe64 writes it outside
ordinary Git tracking with restrictive permissions and preserves a pre-existing
user file before taking ownership.
