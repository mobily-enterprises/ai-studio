# @local/vibe64-genesis

The single Vibe64 integration boundary around `genesis-compiler`.

It initializes Genesis projects, selects Stack pieces, generates Codex task prompts, reads launch declarations, refreshes both Cities, and places the Genesis executable on Codex's PATH. Vibe64 packages use this boundary instead of reproducing Genesis prompts, skills, indexes, or explanatory contracts. Project verification runs through the Genesis CLI inside Vibe64's managed execution environment.
