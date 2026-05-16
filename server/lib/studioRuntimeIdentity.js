const AI_STUDIO_RUNTIME_NAME = "ai-studio";

const STUDIO_TOOLCHAIN_IMAGE = `${AI_STUDIO_RUNTIME_NAME}-toolchain:0.1.0`;
const STUDIO_TOOL_HOME_VOLUME = "ai_studio_tool_home";
const STUDIO_TEMP_DIR_NAME = AI_STUDIO_RUNTIME_NAME;

const STUDIO_DOCKER_LABEL_PREFIX = AI_STUDIO_RUNTIME_NAME;
const STUDIO_DAEMON_PID_LABEL = `${STUDIO_DOCKER_LABEL_PREFIX}.daemon-pid`;

const STUDIO_HOST_UID_ENV = "AI_STUDIO_HOST_UID";
const STUDIO_HOST_GID_ENV = "AI_STUDIO_HOST_GID";

const STUDIO_CODEX_CONTAINER_PREFIX = `${AI_STUDIO_RUNTIME_NAME}-codex`;

function studioDockerLabel(name = "", value = undefined) {
  const key = `${STUDIO_DOCKER_LABEL_PREFIX}.${String(name || "").trim()}`;
  return value === undefined ? key : `${key}=${String(value)}`;
}

export {
  AI_STUDIO_RUNTIME_NAME,
  STUDIO_CODEX_CONTAINER_PREFIX,
  STUDIO_DAEMON_PID_LABEL,
  STUDIO_HOST_GID_ENV,
  STUDIO_HOST_UID_ENV,
  STUDIO_TEMP_DIR_NAME,
  STUDIO_TOOLCHAIN_IMAGE,
  STUDIO_TOOL_HOME_VOLUME,
  studioDockerLabel
};
