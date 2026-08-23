import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  resolveProjectCanonicalRepositoryPath,
  resolveProjectGithubMirrorPath,
  resolveProjectRecordPath,
  resolveProjectRuntimeRoot
} from "@local/vibe64-core/server/projectState";

test("project state paths require one explicit absolute runtime root", () => {
  for (const resolvePath of [
    resolveProjectRuntimeRoot,
    resolveProjectRecordPath,
    resolveProjectCanonicalRepositoryPath,
    resolveProjectGithubMirrorPath
  ]) {
    assert.throws(
      () => resolvePath(),
      (error) => error?.code === "vibe64_project_runtime_root_invalid" ||
        error?.code === "vibe64_repository_storage_project_runtime_root_invalid"
    );
    assert.throws(
      () => resolvePath({ projectRuntimeRoot: "relative/project-state" }),
      (error) => error?.code === "vibe64_project_runtime_root_invalid" ||
        error?.code === "vibe64_repository_storage_project_runtime_root_invalid"
    );
  }
});

test("repository storage resolves only beneath the explicit runtime root", () => {
  const projectRuntimeRoot = path.resolve("/tmp/vibe64-runtime-project");

  assert.equal(resolveProjectRuntimeRoot({ projectRuntimeRoot }), projectRuntimeRoot);
  assert.equal(
    resolveProjectRecordPath({ projectRuntimeRoot }),
    path.join(projectRuntimeRoot, "project.json")
  );
  assert.equal(
    resolveProjectCanonicalRepositoryPath({ projectRuntimeRoot }),
    path.join(projectRuntimeRoot, "canonical-repository", "repository.git")
  );
  assert.equal(
    resolveProjectGithubMirrorPath({ projectRuntimeRoot }),
    path.join(projectRuntimeRoot, "github-mirror", "repository.git")
  );
});
