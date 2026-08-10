import path from "node:path";

import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  resolveProjectCanonicalRepositoryPath,
  resolveProjectGithubMirrorPath
} from "@local/vibe64-core/server/projectState";
import {
  repositoryCommandProfileForSession
} from "./repositoryCommandProfile.js";

function pathsResolveEqual(left = "", right = "") {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  return Boolean(
    normalizedLeft &&
    normalizedRight &&
    path.resolve(normalizedLeft) === path.resolve(normalizedRight)
  );
}

function sessionRepositoryStorage(session = {}, {
  projectRoot = session.targetRoot,
  requireConfigured = false
} = {}) {
  const repositoryProfile = repositoryCommandProfileForSession(session);
  if (!repositoryProfile.canonicalGit && !repositoryProfile.githubPr) {
    return {
      canonicalRepositoryPath: "",
      githubMirrorPath: "",
      ok: true,
      path: ""
    };
  }

  const normalizedProjectRoot = normalizeText(projectRoot);
  if (!normalizedProjectRoot || !path.isAbsolute(normalizedProjectRoot)) {
    return {
      message: "Session repository storage requires an absolute project root.",
      ok: false
    };
  }

  const field = repositoryProfile.canonicalGit
    ? "canonical_repository_path"
    : "github_mirror_path";
  const expectedPath = repositoryProfile.canonicalGit
    ? resolveProjectCanonicalRepositoryPath({
        projectRoot: normalizedProjectRoot
      })
    : resolveProjectGithubMirrorPath({
        projectRoot: normalizedProjectRoot
      });
  const configuredPath = normalizeText(session.metadata?.[field]);
  if (configuredPath && !pathsResolveEqual(configuredPath, expectedPath)) {
    return {
      message: "Session repository storage metadata does not match the project's repository role.",
      ok: false
    };
  }
  if (requireConfigured && !configuredPath) {
    return {
      message: `Session repository storage metadata is missing ${field}.`,
      ok: false
    };
  }

  return {
    canonicalRepositoryPath: repositoryProfile.canonicalGit ? expectedPath : "",
    githubMirrorPath: repositoryProfile.githubPr ? expectedPath : "",
    ok: true,
    path: expectedPath
  };
}

export {
  pathsResolveEqual,
  sessionRepositoryStorage
};
