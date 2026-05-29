const GITHUB_SSH_TO_HTTPS_GIT_CONFIG = Object.freeze([
  {
    key: "url.https://github.com/.insteadOf",
    value: "git@github.com:"
  },
  {
    key: "url.https://github.com/.insteadOf",
    value: "ssh://git@github.com/"
  }
]);

function githubSshToHttpsGitEnv() {
  return Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(GITHUB_SSH_TO_HTTPS_GIT_CONFIG.length)],
    ...GITHUB_SSH_TO_HTTPS_GIT_CONFIG.flatMap((entry, index) => [
      [`GIT_CONFIG_KEY_${index}`, entry.key],
      [`GIT_CONFIG_VALUE_${index}`, entry.value]
    ])
  ]);
}

function githubSshToHttpsGitDockerEnvArgs() {
  return Object.entries(githubSshToHttpsGitEnv()).flatMap(([key, value]) => [
    "-e",
    `${key}=${value}`
  ]);
}

export {
  GITHUB_SSH_TO_HTTPS_GIT_CONFIG,
  githubSshToHttpsGitDockerEnvArgs,
  githubSshToHttpsGitEnv
};
