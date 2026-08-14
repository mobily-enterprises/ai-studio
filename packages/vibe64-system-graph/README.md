# @local/vibe64-system-graph

Vibe64's visual browser for the two City documents owned by Genesis:

- `.genesis/machine-city.json` describes physical source files and discovered functions.
- `.genesis/program-city.json` describes explanatory subsystems, public operations, and their source implementations.

This package reads those documents from the active session source and projects them into Vibe64's existing WebGL layout. It does not scan source code, infer framework facts, edit project architecture, or maintain a competing `vibe64.system.json` document.

The server exposes status, read, and explicit refresh endpoints. Refresh delegates to Genesis once. The client owns only presentation: City selection, layout, navigation history, source opening, and inspection of fields present in the selected Genesis document.

Missing or invalid City documents are shown as unavailable. Vibe64 never fills gaps with adapter-derived facts, because doing so would create a second architecture authority.
