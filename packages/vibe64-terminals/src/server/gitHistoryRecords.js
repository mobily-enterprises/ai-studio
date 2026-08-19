const GIT_HISTORY_RECORD_FORMAT = "%H%x00%P%x00%an%x00%ae%x00%aI%x00%s";

function text(value = "") {
  return String(value || "").trim();
}

function parseGitHistoryRecords(value = "") {
  const fields = String(value || "").split("\0");
  const versions = [];
  for (let index = 0; index + 5 < fields.length; index += 6) {
    const commit = text(fields[index]);
    if (!commit) {
      continue;
    }
    const parents = text(fields[index + 1]).split(/\s+/u).filter(Boolean);
    versions.push({
      author: text(fields[index + 2]),
      authorEmail: text(fields[index + 3]),
      committedAt: text(fields[index + 4]),
      commit,
      isMerge: parents.length > 1,
      message: text(fields[index + 5]),
      parents,
      shortCommit: commit.slice(0, 8)
    });
  }
  return versions;
}

export {
  GIT_HISTORY_RECORD_FORMAT,
  parseGitHistoryRecords
};
