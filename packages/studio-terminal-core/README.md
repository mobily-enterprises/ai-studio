# @local/studio-terminal-core

Shared terminal runtime primitives used by Vibe64's managed agent and preview
processes.

The package owns runtime identity, command environment, terminal ownership,
tool-home, and launch-target construction that several Vibe64 packages use. It
does not own application workflows or technology-specific project behavior.
