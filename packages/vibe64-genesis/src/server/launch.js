import {
  assertMatchingStackInspections,
  backtickedArguments,
  httpReadinessLine,
  invalidStackOperation,
  isExplicitlyEmptyStackSection,
  oneLineText,
  processArguments,
  projectPath,
  runtimeArguments,
  uniqueSorted,
  urlPath
} from "./stackOperation.js";

const VIBE64_LAUNCH_CONTRACT = "vibe64.launch.v1";
const VIBE64_LAUNCH_SECTION = "Launch";
const VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL = "vibe64.preview-identity.command.v1";
const ERROR_CODE = "VIBE64_LAUNCH_INVALID";
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PLACEHOLDER = /\{([a-z][a-z0-9-]*)\}/gu;
const TARGET_HEADING = /^### Target `([^`\r\n]+)`:[ \t]+(.+)$/u;
const ENVIRONMENT_NAME = /^[A-Z_][A-Z0-9_]*$/u;
const RESERVED_ENVIRONMENT_NAMES = new Set([
  "HOME",
  "LOGNAME",
  "NODE_OPTIONS",
  "PATH",
  "TMPDIR",
  "USER"
]);
const IDENTITY_TYPES = new Set(["email", "login", "user-id"]);
const PREVIEW_FIELDS = [
  ["- Command: ", "command", "Command"],
  ["- Protocol: ", "protocol", "Protocol"],
  ["- Identity types: ", "identityTypes", "Identity types"],
  ["- Enabled environment: ", "enabledEnvironment", "Enabled environment"],
  ["- Secret environment: ", "secretEnvironment", "Secret environment"],
  ["- Runtimes: ", "runtimes", "Runtimes"],
  ["- Timeout ms: ", "timeoutMs", "Timeout ms"]
];

function invalid(launchPath, message, line, details = {}) {
  invalidStackOperation(ERROR_CODE, launchPath, message, line, details);
}

function launchId(value, launchPath, label, line) {
  const normalized = oneLineText(value, ERROR_CODE, launchPath, label, line);
  if (!ID_PATTERN.test(normalized)) {
    invalid(launchPath, `${label} must use lowercase letters, digits, and single hyphens.`, line);
  }
  return normalized;
}

function tokenValues(source, prefix, launchPath, label, line, options) {
  return backtickedArguments(
    source.slice(prefix.length),
    ERROR_CODE,
    launchPath,
    label,
    line,
    options
  );
}

function oneToken(source, prefix, launchPath, label, line) {
  return tokenValues(source, prefix, launchPath, label, line, { count: 1 })[0];
}

function launchArguments(source, launchPath, label, line) {
  const argv = processArguments(source, ERROR_CODE, launchPath, label, line);
  for (const argument of argv) {
    if ([...argument.matchAll(PLACEHOLDER)].some((match) => !["host", "port"].includes(match[1]))) {
      invalid(launchPath, `${label} supports only {host} and {port} placeholders.`, line);
    }
  }
  return argv;
}

function setOnce(draft, field, value, launchPath, line, label) {
  if (draft.seen.has(field)) invalid(launchPath, `Duplicate ${label}.`, line);
  draft.seen.add(field);
  draft[field] = value;
}

function targetDraft(match, launchPath, line) {
  return {
    id: launchId(match[1], launchPath, "Launch target id", line),
    label: oneLineText(match[2], ERROR_CODE, launchPath, "Launch target label", line),
    default: false,
    workdir: ".",
    preferredPort: null,
    urlPath: "/",
    readiness: null,
    runtimeRequirements: [],
    steps: [],
    previewIdentity: null,
    seen: new Set(),
    line
  };
}

function preferredPort(value, launchPath, line) {
  if (!/^[0-9]+$/u.test(value)) {
    invalid(launchPath, "Launch target preferred port must be an integer from 1024 through 65535.", line);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    invalid(launchPath, "Launch target preferred port must be an integer from 1024 through 65535.", line);
  }
  return port;
}

function parseTargetLine(draft, source, launchPath, line) {
  if (source === "- Default.") {
    setOnce(draft, "default", true, launchPath, line, "Launch target Default entry");
    return;
  }
  if (source.startsWith("- Workdir: ")) {
    setOnce(
      draft,
      "workdir",
      projectPath(
        oneToken(source, "- Workdir: ", launchPath, "Launch target Workdir", line),
        ERROR_CODE,
        launchPath,
        "Launch target workdir",
        line
      ),
      launchPath,
      line,
      "Launch target Workdir entry"
    );
    return;
  }
  if (source.startsWith("- Preferred port: ")) {
    setOnce(
      draft,
      "preferredPort",
      preferredPort(
        oneToken(source, "- Preferred port: ", launchPath, "Launch target Preferred port", line),
        launchPath,
        line
      ),
      launchPath,
      line,
      "Launch target Preferred port entry"
    );
    return;
  }
  if (source.startsWith("- URL path: ")) {
    setOnce(
      draft,
      "urlPath",
      urlPath(
        oneToken(source, "- URL path: ", launchPath, "Launch target URL path", line),
        ERROR_CODE,
        launchPath,
        "Launch target URL path",
        line
      ),
      launchPath,
      line,
      "Launch target URL path entry"
    );
    return;
  }
  if (source.startsWith("- Runtimes: ")) {
    setOnce(
      draft,
      "runtimeRequirements",
      runtimeArguments(
        source.slice("- Runtimes: ".length),
        ERROR_CODE,
        launchPath,
        "Launch target runtimes",
        line
      ),
      launchPath,
      line,
      "Launch target Runtimes entry"
    );
    return;
  }
  if (source.startsWith("- Ready when: ")) {
    setOnce(
      draft,
      "readiness",
      httpReadinessLine(source, ERROR_CODE, launchPath, "Launch target readiness", line),
      launchPath,
      line,
      "Launch target Ready when entry"
    );
    return;
  }
  const step = source.match(/^- (Prepare|Serve) `([^`\r\n]+)`:[ \t]+(.+)$/u);
  if (step) {
    draft.steps.push({
      label: oneLineText(step[2], ERROR_CODE, launchPath, "Launch step label", line),
      argv: launchArguments(step[3], launchPath, "Launch step command", line),
      role: step[1] === "Serve" ? "server" : "prepare"
    });
    return;
  }
  invalid(launchPath, `Unknown Launch target entry: ${source}.`, line);
}

function environmentName(value, launchPath, label, line) {
  if (value === undefined) return "";
  const name = oneLineText(value, ERROR_CODE, launchPath, `Preview identity ${label} environment name`, line);
  if (
    !ENVIRONMENT_NAME.test(name)
    || RESERVED_ENVIRONMENT_NAMES.has(name)
    || name.startsWith("XDG_")
  ) {
    invalid(launchPath, `Preview identity ${label} environment name is invalid.`, line);
  }
  return name;
}

function previewDraft(line) {
  return { seen: new Set(), line };
}

function parsePreviewLine(draft, source, launchPath, line) {
  const field = PREVIEW_FIELDS.find(([prefix]) => source.startsWith(prefix));
  if (!field) invalid(launchPath, `Unknown Preview identity entry: ${source}.`, line);
  const [prefix, key, label] = field;
  const values = tokenValues(source, prefix, launchPath, `Preview identity ${label}`, line);
  if (!["command", "identityTypes", "runtimes"].includes(key) && values.length !== 1) {
    invalid(launchPath, `Preview identity ${label} accepts exactly one value.`, line);
  }
  setOnce(draft, key, values, launchPath, line, `Preview identity ${label} entry`);
}

function normalizePreviewIdentity(draft, launchPath, targetId) {
  for (const [field, label] of [
    ["command", "Command"],
    ["protocol", "Protocol"],
    ["identityTypes", "Identity types"]
  ]) {
    if (!draft[field]) {
      invalid(launchPath, `Launch target ${targetId} Preview identity needs ${label}.`, draft.line);
    }
  }
  const commandSource = draft.command.map((value) => `\`${value}\``).join(" ");
  const command = processArguments(
    commandSource,
    ERROR_CODE,
    launchPath,
    "Preview identity command",
    draft.line
  );
  if (
    !command[0].includes("/")
    || command[0].includes("\\")
    || command[0].split("/").some((part) => !part || [".", ".."].includes(part))
    || command.some((argument) => /\{(?:host|port)\}/u.test(argument))
  ) {
    invalid(
      launchPath,
      "Preview identity command must use a literal app-owned project-relative executable.",
      draft.line
    );
  }
  const protocol = draft.protocol[0];
  if (protocol !== VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL) {
    invalid(
      launchPath,
      `Preview identity protocol must be ${VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL}.`,
      draft.line
    );
  }
  const identityTypes = [...new Set(draft.identityTypes.map((type) => {
    if (!IDENTITY_TYPES.has(type)) {
      invalid(launchPath, `Unsupported preview identity type: ${type}.`, draft.line);
    }
    return type;
  }))];
  if (identityTypes.length !== draft.identityTypes.length) {
    invalid(launchPath, "Preview identity types must not contain duplicates.", draft.line);
  }
  const environment = {
    enabled: environmentName(draft.enabledEnvironment?.[0], launchPath, "enabled", draft.line),
    secret: environmentName(draft.secretEnvironment?.[0], launchPath, "secret", draft.line)
  };
  if (environment.enabled && environment.enabled === environment.secret) {
    invalid(launchPath, "Preview identity enabled and secret environment names must differ.", draft.line);
  }
  let timeoutMs = 10_000;
  if (draft.timeoutMs) {
    const value = draft.timeoutMs[0];
    if (!/^[0-9]+$/u.test(value)) {
      invalid(launchPath, "Preview identity Timeout ms must be from 1 through 30000.", draft.line);
    }
    timeoutMs = Number(value);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
      invalid(launchPath, "Preview identity Timeout ms must be from 1 through 30000.", draft.line);
    }
  }
  return {
    command,
    environment,
    identityTypes,
    protocol,
    runtimes: draft.runtimes
      ? runtimeArguments(
          draft.runtimes.map((value) => `\`${value}\``).join(" "),
          ERROR_CODE,
          launchPath,
          "Preview identity runtimes",
          draft.line
        )
      : [],
    timeoutMs
  };
}

function normalizeTarget(draft, launchPath) {
  if (draft.steps.length === 0) {
    invalid(launchPath, `Launch target ${draft.id} needs at least one step.`, draft.line);
  }
  const serverSteps = draft.steps.filter(({ role }) => role === "server");
  if (serverSteps.length !== 1 || draft.steps.at(-1).role !== "server") {
    invalid(launchPath, `Launch target ${draft.id} needs exactly one final Serve step.`, draft.line);
  }
  if (!draft.readiness) {
    invalid(launchPath, `Launch target ${draft.id} needs one Ready when entry.`, draft.line);
  }
  return {
    id: draft.id,
    label: draft.label,
    default: draft.default,
    workdir: draft.workdir,
    preferredPort: draft.preferredPort,
    urlPath: draft.urlPath,
    readiness: draft.readiness,
    runtimeRequirements: draft.runtimeRequirements,
    steps: draft.steps,
    ...(draft.previewIdentity
      ? { previewIdentity: normalizePreviewIdentity(draft.previewIdentity, launchPath, draft.id) }
      : {})
  };
}

function parseVibe64LaunchLines(lines, {
  path: launchPath = "genesis/stack.md#Launch"
} = {}) {
  if (!Array.isArray(lines)) {
    invalid(launchPath, "Launch must be supplied as exact Stack section lines.");
  }
  if (isExplicitlyEmptyStackSection(lines)) return { version: 1, targets: [] };

  const targets = [];
  let target = null;
  let inPreviewIdentity = false;
  for (let index = 0; index < lines.length; index += 1) {
    const source = lines[index].trim();
    if (!source) continue;
    const line = index + 1;
    const heading = source.match(TARGET_HEADING);
    if (heading) {
      if (target) targets.push(normalizeTarget(target, launchPath));
      target = targetDraft(heading, launchPath, line);
      inPreviewIdentity = false;
      continue;
    }
    if (source === "#### Preview identity") {
      if (!target || target.previewIdentity) {
        invalid(launchPath, "Preview identity must appear once below a Launch target.", line);
      }
      target.previewIdentity = previewDraft(line);
      inPreviewIdentity = true;
      continue;
    }
    if (!target) invalid(launchPath, "## Launch must begin with a Target heading.", line);
    if (inPreviewIdentity) parsePreviewLine(target.previewIdentity, source, launchPath, line);
    else parseTargetLine(target, source, launchPath, line);
  }
  if (target) targets.push(normalizeTarget(target, launchPath));
  if (targets.length === 0) {
    invalid(launchPath, "## Launch needs at least one Target or exactly `- Nothing.`.");
  }
  const ids = targets.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) invalid(launchPath, "Launch contains a duplicate target id.");
  if (targets.filter(({ default: isDefault }) => isDefault).length > 1) {
    invalid(launchPath, "Launch may declare at most one default target.");
  }
  return { version: 1, targets };
}

function vibe64LaunchInspection({ environment = {}, section = {} } = {}) {
  assertMatchingStackInspections(section, environment, "Launch section");
  const sectionDiagnostics = [...(section.diagnostics || [])];
  const environmentDiagnostics = [...(environment.diagnostics || [])];
  let parsed = { version: 1, targets: [] };
  if (section.status === "ready") parsed = parseVibe64LaunchLines(section.lines);
  const disabledReason = environmentDiagnostics.length === 0
    ? null
    : environmentDiagnostics.map(({ message }) => message).join(" ");
  const targets = parsed.targets.map((target) => ({
    ...target,
    source: section.source || null,
    available: sectionDiagnostics.length === 0 && environmentDiagnostics.length === 0,
    disabledReason
  }));
  const diagnostics = [...sectionDiagnostics, ...environmentDiagnostics];
  let status = "ready";
  if (diagnostics.length > 0) status = "blocked";
  else if (targets.length === 0) status = "unconfigured";
  return {
    contract: VIBE64_LAUNCH_CONTRACT,
    status,
    stackHash: section.stackHash,
    components: [...(section.components || [])],
    environmentDefaults: structuredClone(environment.environmentDefaults || []),
    runtimeRequirements: uniqueSorted(
      targets.flatMap((target) => target.runtimeRequirements)
    ),
    resources: structuredClone(environment.resources || []),
    targets,
    diagnostics
  };
}

export {
  VIBE64_LAUNCH_CONTRACT,
  VIBE64_LAUNCH_SECTION,
  VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  parseVibe64LaunchLines,
  vibe64LaunchInspection
};
