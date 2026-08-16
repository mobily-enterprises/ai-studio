# Source editing and change review

People can inspect and make focused source changes and review the complete Git
diff produced in a session.

## Sources

- `packages/vibe64-source-editor/src/server/service.js`
- `src/composables/useVibe64SourceEditor.js`
- `src/components/studio/vibe64-session/Vibe64SessionDiffContent.vue`

## Public contract

The source browser lists, searches, opens, edits, and saves allowed project
files inside the selected session source. It rejects paths outside that source
and reports concurrent changes rather than silently overwriting them. The
review surface presents the session's Git changes and can open an exact changed
file for inspection or discussion with the agent.
