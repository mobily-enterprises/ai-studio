function normalizedGitActorText(value = "") {
  return String(value || "").trim();
}

function sessionUsesGithub(session = {}) {
  const metadata = session?.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
    ? session.metadata
    : {};
  const remoteUrl = normalizedGitActorText(
    metadata.source_remote_url ||
    metadata.github_repository ||
    session.sourceRemoteUrl ||
    session.githubRepository
  );
  if (!remoteUrl) {
    return false;
  }
  if (normalizedGitActorText(metadata.github_repository || session.githubRepository)) {
    return true;
  }
  try {
    const url = new URL(remoteUrl);
    return url.hostname.toLowerCase() === "github.com";
  } catch {
    return /^(?:git@|ssh:\/\/git@)github\.com(?::|\/)/iu.test(remoteUrl);
  }
}

function sessionGithubCommandActor(session = {}) {
  const metadata = session?.metadata && typeof session.metadata === "object" && !Array.isArray(session.metadata)
    ? session.metadata
    : {};
  const scope = normalizedGitActorText(metadata.session_git_command_actor_scope);
  const userKey = normalizedGitActorText(metadata.session_git_command_actor_user_key);
  const account = scope === "local" ? "local GitHub" : userKey;
  const available = sessionUsesGithub(session);
  if (!account) {
    return {
      active: false,
      available,
      displayLabel: "not selected",
      label: "GitHub: not selected",
      title: "No GitHub command actor is selected for this session yet."
    };
  }
  return {
    active: true,
    available,
    displayLabel: account,
    label: `GitHub: ${account}`,
    title: `GitHub commands for this session run as ${account}.`
  };
}

export {
  sessionGithubCommandActor,
  sessionUsesGithub
};
