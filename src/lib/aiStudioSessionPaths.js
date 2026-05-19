function aiStudioSessionWorktreePath(session = {}) {
  const metadata = session?.metadata || {};
  return String(metadata.worktree_path || metadata.worktree || session?.worktree || "").trim();
}

export {
  aiStudioSessionWorktreePath
};
