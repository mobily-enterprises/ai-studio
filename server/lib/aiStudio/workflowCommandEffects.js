import path from "node:path";

import {
  shellQuote
} from "../shellCommands.js";

function metadataFilePath(session = {}, name = "") {
  return session.metadataRoot && name ? path.join(session.metadataRoot, name) : "";
}

function artifactFilePath(session = {}, name = "") {
  return session.artifactsRoot && name ? path.join(session.artifactsRoot, name) : "";
}

function requiredCommandFileScript(filePath = "", label = "file") {
  const quotedFilePath = shellQuote(filePath);
  return [
    `if [ ! -s ${quotedFilePath} ]; then`,
    `  printf '[studio] Missing ${label}: %s\\n' ${quotedFilePath} >&2`,
    "  exit 1",
    "fi"
  ].join("\n");
}

function requiredArtifactScript(session = {}, name = "", label = "artifact") {
  return requiredCommandFileScript(artifactFilePath(session, name), label);
}

function removeMetadataScript(session = {}, name = "") {
  return `rm -f ${shellQuote(metadataFilePath(session, name))}`;
}

function writeMetadataScript(session = {}, name = "", valueExpression = "") {
  return `printf '%s\\n' ${valueExpression} > ${shellQuote(metadataFilePath(session, name))}`;
}

export {
  artifactFilePath,
  metadataFilePath,
  removeMetadataScript,
  requiredArtifactScript,
  requiredCommandFileScript,
  writeMetadataScript
};
